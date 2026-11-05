import { createHash } from "node:crypto";
import { decryptBackup, encryptBackup } from "./backupEncryption";
import {
  migrationTables,
  type MigrationBatch,
  type MigrationRecord,
  type SourceTable,
} from "./convexMigration";
import type { MigrationIdCounterFloor } from "./convexMigrationOrchestrator";

interface ReadOnlyPgClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

const PAGE_SIZE = 100;
const TABLES = {
  universities: { sql: "universities", keyColumn: "id", keyField: "id" },
  users: { sql: "users", keyColumn: "id", keyField: "id" },
  studentProfiles: { sql: "student_profiles", keyColumn: "id", keyField: "id" },
  parentProfiles: { sql: "parent_profiles", keyColumn: "id", keyField: "id" },
  reviews: { sql: "reviews", keyColumn: "id", keyField: "id" },
  bookmarks: { sql: "bookmarks", keyColumn: "id", keyField: "id" },
  notifications: { sql: "notifications", keyColumn: "id", keyField: "id" },
  chatHistory: { sql: "chat_history", keyColumn: "id", keyField: "id" },
  sessions: { sql: "sessions", keyColumn: "token", keyField: "token" },
  auditLogs: { sql: "audit_logs", keyColumn: "id", keyField: "id" },
  loginAttempts: { sql: "login_attempts", keyColumn: "id", keyField: "id" },
  analyticsEvents: { sql: "analytics_events", keyColumn: "id", keyField: "id" },
  universityReviewsAgg: {
    sql: "university_reviews_agg",
    keyColumn: "university_id",
    keyField: "universityId",
  },
} satisfies Record<SourceTable, { sql: string; keyColumn: string; keyField: string }>;

function tableMetadata(table: SourceTable) {
  const metadata = TABLES[table];
  if (!metadata || !migrationTables.some(({ source }) => source === table)) {
    throw new Error("PostgreSQL migration table is not allowlisted.");
  }
  return metadata;
}

function toCamelCase(column: string): string {
  if (column === "avg_placement_lpa") return "avgPlacementLPA";
  return column.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

const bigintNumberFields = new Set(["lockedUntil", "expiresAt", "absoluteExpiresAt"]);

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const field = toCamelCase(key);
    if (!bigintNumberFields.has(field)) return [field, value];
    const numberValue = typeof value === "string" ? Number(value) : value;
    if (typeof numberValue !== "number" || !Number.isSafeInteger(numberValue)) {
      throw new Error(`PostgreSQL migration field ${field} is outside the safe integer range.`);
    }
    return [field, numberValue];
  }));
}

function parseCursor(table: SourceTable, cursor: string | null): string | number | null {
  if (cursor === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(decryptBackup(cursor));
  } catch {
    throw new Error("Migration source cursor is invalid.");
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("table" in decoded) ||
    decoded.table !== table ||
    !("key" in decoded) ||
    (typeof decoded.key !== "string" && typeof decoded.key !== "number")
  ) {
    throw new Error("Migration source cursor does not match its table.");
  }
  return decoded.key;
}

function encodeCursor(table: SourceTable, key: string | number): string {
  return encryptBackup(JSON.stringify({ table, key }));
}

export class PostgresMigrationSource {
  private active = false;
  private closed = false;

  constructor(private readonly client: ReadOnlyPgClient) {}

  async beginReadOnlySnapshot(): Promise<void> {
    if (this.active || this.closed) throw new Error("PostgreSQL migration snapshot cannot be started.");
    await this.client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    this.active = true;
  }

  async close(): Promise<void> {
    if (!this.active || this.closed) return;
    try {
      await this.client.query("COMMIT");
    } finally {
      this.active = false;
      this.closed = true;
    }
  }

  async sourceFingerprint(): Promise<string> {
    this.assertActive();
    const digest = createHash("sha256");
    for (const { source } of migrationTables) {
      digest.update(source);
      let cursor: string | number | null = null;
      while (true) {
        const rows = await this.readRows(source, cursor, PAGE_SIZE);
        for (const row of rows) {
          const normalized = normalizeRow(row);
          const key = normalized[tableMetadata(source).keyField];
          if (typeof key !== "string" && typeof key !== "number") {
            throw new Error("PostgreSQL migration source contains an invalid key.");
          }
          digest.update(JSON.stringify(normalized));
          digest.update("\n");
          cursor = key;
        }
        if (rows.length < PAGE_SIZE) break;
      }
    }
    return digest.digest("hex");
  }

  /**
   * Read-only PostgreSQL 17 catalog query for sequence configuration and
   * privilege checks. Runtime state (`last_value`, `is_called`) lives in the
   * sequence relation itself, not in `pg_sequence`; after confirmed SELECT
   * privilege the relation is queried separately with a strictly validated,
   * catalog-derived quoted identifier. No nextval/currval/setval.
   */
  static readonly SEQUENCE_METADATA_SQL = `
    SELECT
      n.nspname::text AS sequence_schema,
      c.relname::text AS sequence_name,
      s.seqstart::bigint AS seqstart,
      s.seqincrement::bigint AS seqincrement,
      s.seqmin::bigint AS seqmin,
      s.seqmax::bigint AS seqmax,
      s.seqcache::bigint AS seqcache,
      s.seqcycle AS seqcycle,
      has_sequence_privilege(current_user, s.seqrelid, 'SELECT') AS can_select
    FROM pg_get_serial_sequence($1::regclass::text, $2) AS seq_ref
    JOIN pg_class c ON c.oid = to_regclass(seq_ref::text)
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_sequence s ON s.seqrelid = c.oid
    WHERE seq_ref IS NOT NULL`;

  async readIdCounterFloor(table: SourceTable): Promise<MigrationIdCounterFloor> {
    this.assertActive();
    const { sql: sqlTable, keyColumn, keyField } = tableMetadata(table);
    if (keyField === "token") {
      return { maxLegacyId: 0, sequenceNextId: null };
    }

    const maxResult = await this.client.query(
      `SELECT COALESCE(MAX("${keyColumn}")::bigint, 0::bigint) AS max_id FROM "${sqlTable}"`,
    );
    const maxLegacyId = Number(maxResult.rows[0]?.max_id);
    if (!Number.isSafeInteger(maxLegacyId) || maxLegacyId < 0) {
      throw new Error(
        `PostgreSQL migration source returned an unsafe maximum legacy ID for ${table}.`,
      );
    }

    let sequenceNextId: number | null = null;
    try {
      const sequenceResult = await this.client.query(
        PostgresMigrationSource.SEQUENCE_METADATA_SQL,
        [`public.${sqlTable}`, keyColumn],
      );
      const sequence = sequenceResult.rows[0];
      if (sequence) {
        const canSelect =
          sequence.can_select === true || sequence.can_select === "t" || sequence.can_select === 1;
        if (!canSelect) {
          throw new Error(
            `Missing SELECT privilege on the sequence associated with ${table}.${keyColumn}. ` +
              `PostgreSQL sequence runtime state cannot be read without SELECT; ` +
              `failing closed. The approved migration reader requires SELECT on this mapped sequence (no USAGE/UPDATE, no nextval/currval/setval).`,
          );
        }

        const seqcycle =
          sequence.seqcycle === true || sequence.seqcycle === "t" || sequence.seqcycle === 1;
        if (seqcycle) {
          throw new Error(
            `Cycling sequence is not supported for ${table}.${keyColumn}; failing closed to prevent ID-counter reuse.`,
          );
        }

        const increment = Number(sequence.seqincrement);
        const startValue = Number(sequence.seqstart);
        const minValue = Number(sequence.seqmin);
        const maxValue = Number(sequence.seqmax);
        const cache = Number(sequence.seqcache);
        if (
          !Number.isSafeInteger(increment) || increment <= 0 ||
          !Number.isSafeInteger(startValue) ||
          !Number.isSafeInteger(minValue) ||
          !Number.isSafeInteger(maxValue) ||
          !Number.isSafeInteger(cache) || cache < 1 ||
          minValue > maxValue
        ) {
          throw new Error(
            `PostgreSQL sequence metadata is invalid or unsupported for ${table}.${keyColumn} (nonpositive/unsafe increment, invalid bounds, or cache); failing closed.`,
          );
        }

        // Sequence runtime state is stored in the sequence relation, not pg_sequence.
        // The identifier is catalog-derived (allowlisted table/column -> pg_get_serial_sequence)
        // and strictly validated before quoting.
        const schemaName = String(sequence.sequence_schema ?? "");
        const relationName = String(sequence.sequence_name ?? "");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(relationName)) {
          throw new Error(
            `PostgreSQL returned an unexpected sequence identifier for ${table}.${keyColumn}; failing closed.`,
          );
        }
        const stateResult = await this.client.query(
          `SELECT last_value::bigint AS last_value, is_called AS is_called FROM "${schemaName}"."${relationName}"`,
        );
        const state = stateResult.rows[0] as
          | { last_value: unknown; is_called: unknown }
          | undefined;
        if (!state) {
          throw new Error(
            `PostgreSQL sequence runtime state could not be read for ${table}.${keyColumn}; failing closed.`,
          );
        }

        const isCalled =
          state.is_called === true || state.is_called === "t" || state.is_called === 1;
        const lastValueRaw = state.last_value;

        if (!isCalled) {
          // Sequence has not been advanced/returned by nextval in its current state.
          // Use start_value as the next safe allocation boundary (genuinely unused).
          // Runtime state may still carry last_value; it is not the next allocation.
          sequenceNextId = startValue;
        } else {
          if (lastValueRaw === null || lastValueRaw === undefined) {
            throw new Error(
              `PostgreSQL sequence runtime state is incomplete for ${table}.${keyColumn}; failing closed.`,
            );
          }
          const lastValue = Number(lastValueRaw);
          if (!Number.isSafeInteger(lastValue)) {
            throw new Error(
              `PostgreSQL sequence last_value is unsafe for ${table}.${keyColumn}; failing closed.`,
            );
          }
          // last_value is the highest reserved value (can exceed the most recently
          // returned nextval() because of cache). Reserve conservatively beyond it.
          sequenceNextId = lastValue + increment;
        }

        if (
          !Number.isSafeInteger(sequenceNextId) ||
          sequenceNextId < 1 ||
          sequenceNextId > Number.MAX_SAFE_INTEGER ||
          sequenceNextId < minValue ||
          sequenceNextId > maxValue + 1
        ) {
          throw new Error(
            `PostgreSQL sequence floor is unsafe or out of bounds for ${table}.${keyColumn}; failing closed.`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot read PostgreSQL sequence metadata for ${table}.${keyColumn} during read-only migration inspection. ` +
          `The approved migration reader requires SELECT on the mapped source table and SELECT on its associated sequence (if present) to inspect sequence state; ` +
          `it does not require USAGE/UPDATE and must never call nextval/currval/setval. ` +
          `Failing closed to prevent Convex ID-counter reuse. ${message}`,
        { cause: error },
      );
    }

    return { maxLegacyId, sequenceNextId };
  }

  async countSource(table: SourceTable): Promise<number> {
    this.assertActive();
    const { sql: sqlTable } = tableMetadata(table);
    const result = await this.client.query(`SELECT COUNT(*) AS count FROM "${sqlTable}"`);
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("PostgreSQL migration source returned an invalid count.");
    }
    return count;
  }

  async readBatch(
    table: SourceTable,
    cursor: string | null,
    limit: number,
  ): Promise<MigrationBatch> {
    this.assertActive();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
      throw new RangeError(`Migration source page size must be between 1 and ${PAGE_SIZE}.`);
    }
    const lastKey = parseCursor(table, cursor);
    const rows = await this.readRows(table, lastKey, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).map(normalizeRow);
    const metadata = tableMetadata(table);
    const records: MigrationRecord[] = pageRows.map((value) => {
      const key = value[metadata.keyField];
      if (typeof key !== "string" && typeof key !== "number") {
        throw new Error("PostgreSQL migration source contains an invalid key.");
      }
      return { key: String(key), value };
    });
    const last = records.at(-1);
    const lastValue = last?.value as Record<string, unknown> | undefined;
    const lastKeyValue = lastValue?.[metadata.keyField];
    return {
      records,
      nextCursor:
        hasMore && (typeof lastKeyValue === "string" || typeof lastKeyValue === "number")
          ? encodeCursor(table, lastKeyValue)
          : null,
      done: !hasMore,
    };
  }

  private assertActive(): void {
    if (!this.active || this.closed) {
      throw new Error("PostgreSQL migration source requires an active read-only snapshot.");
    }
  }

  private async readRows(
    table: SourceTable,
    cursor: string | number | null,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    const { sql: sqlTable, keyColumn } = tableMetadata(table);
    const quotedKey = `"${keyColumn}"`;
    const result =
      cursor === null
        ? await this.client.query(
            `SELECT ${table === "analyticsEvents"
              ? '"id", "event_type", "details", "user_email", "ip_address", "created_at"::text AS "created_at"'
              : "*"} FROM "${sqlTable}" ORDER BY ${quotedKey} ASC LIMIT $1`,
            [limit],
          )
        : await this.client.query(
            `SELECT ${table === "analyticsEvents"
              ? '"id", "event_type", "details", "user_email", "ip_address", "created_at"::text AS "created_at"'
              : "*"} FROM "${sqlTable}" WHERE ${quotedKey} > $1 ORDER BY ${quotedKey} ASC LIMIT $2`,
            [cursor, limit],
          );
    return result.rows;
  }
}
