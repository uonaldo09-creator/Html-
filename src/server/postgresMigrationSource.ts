import { createHash } from "node:crypto";
import { decryptBackup, encryptBackup } from "./backupEncryption";
import {
  migrationTables,
  type MigrationBatch,
  type MigrationRecord,
  type SourceTable,
} from "./convexMigration";

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
