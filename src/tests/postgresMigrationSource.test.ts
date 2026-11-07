import { describe, expect, it } from "vitest";
import { PostgresMigrationSource } from "../server/postgresMigrationSource";
import {
  migrationTables,
  runBatchedMigration,
  type MigrationAdapter,
  type MigrationCheckpoint,
  type SourceTable,
} from "../server/convexMigration";

const sqlTables: Record<string, string> = {
  universities: "universities",
  users: "users",
  student_profiles: "studentProfiles",
  parent_profiles: "parentProfiles",
  reviews: "reviews",
  bookmarks: "bookmarks",
  notifications: "notifications",
  chat_history: "chatHistory",
  sessions: "sessions",
  audit_logs: "auditLogs",
  login_attempts: "loginAttempts",
  university_reviews_agg: "universityReviewsAgg",
  analytics_events: "analyticsEvents",
};

class SyntheticReadOnlyPgClient {
  readonly statements: string[] = [];
  /**
   * Synthetic fixture modeling PostgreSQL 17 catalog behavior for unit tests.
   * `last_value`/`is_called` are runtime relation state (queried after metadata),
   * not pg_sequence columns. Real SQL correctness is verified by the PG17
   * integration test, which executes PostgresMigrationSource's actual SQL.
   */
  readonly sequenceByTable: Record<string, {
    sequence_schema?: string;
    sequence_name?: string;
    last_value: string | number | null;
    is_called: boolean;
    seqstart?: number;
    seqincrement?: number;
    seqmin?: number;
    seqmax?: number;
    seqcache?: number;
    seqcycle?: boolean;
    can_select?: boolean;
  } | null> = {};
  sequenceQueryError: Error | null = null;
  readonly rows: Record<string, Record<string, unknown>[]> = {
    universities: [],
    users: [],
    studentProfiles: [],
    parentProfiles: [],
    reviews: [],
    bookmarks: [],
    notifications: [],
    chatHistory: [],
    sessions: [
      { token: "opaque-token-1", email: "a@example.test" },
      { token: "opaque-token-2", email: "b@example.test" },
    ],
    auditLogs: [],
    loginAttempts: [],
    universityReviewsAgg: [],
    analyticsEvents: [{
      id: 1001,
      event_type: "synthetic.page_view",
      details: null,
      user_email: null,
      ip_address: null,
      created_at: "2026-10-13 19:34:56.123",
    }],
  };

  async query(text: string, values: unknown[] = []) {
    this.statements.push(text);
    if (text.startsWith("BEGIN") || text === "COMMIT") return { rows: [] };
    if (/nextval|currval|setval/i.test(text)) {
      throw new Error("Source inspection must not call nextval/currval/setval.");
    }
    if (text.includes("pg_get_serial_sequence") && text.includes("pg_sequence")) {
      if (this.sequenceQueryError) throw this.sequenceQueryError;
      const tableName = String(values[0]).replace(/^public\./, "");
      const sequence = this.sequenceByTable[tableName];
      if (!sequence) return { rows: [] };
      return {
        rows: [{
          sequence_schema: sequence.sequence_schema ?? "public",
          sequence_name: sequence.sequence_name ?? `${tableName}_id_seq`,
          seqstart: sequence.seqstart ?? 1,
          seqincrement: sequence.seqincrement ?? 1,
          seqmin: sequence.seqmin ?? 1,
          seqmax: sequence.seqmax ?? 2147483647,
          seqcache: sequence.seqcache ?? 1,
          seqcycle: sequence.seqcycle ?? false,
          can_select: sequence.can_select ?? true,
        }],
      };
    }
    const runtimeState = text.match(/^SELECT last_value::bigint AS last_value, is_called AS is_called FROM "([^"]+)"\."([^"]+)"/);
    if (runtimeState) {
      const relation = runtimeState[2];
      let sequence = null as (typeof this.sequenceByTable)[string] | null;
      for (const [tableName, seq] of Object.entries(this.sequenceByTable)) {
        if (!seq) continue;
        const name = seq.sequence_name ?? `${tableName}_id_seq`;
        if (name === relation) { sequence = seq; break; }
      }
      if (!sequence) throw new Error(`Synthetic sequence relation ${relation} not found.`);
      return { rows: [{ last_value: sequence.last_value, is_called: sequence.is_called }] };
    }
    if (text.includes("COALESCE(MAX(")) {
      const sqlTable = text.match(/FROM "([a-z_]+)"/)?.[1];
      if (!sqlTable) throw new Error("Unexpected synthetic SQL.");
      const sourceTable = sqlTables[sqlTable];
      const keyColumn = sqlTable === "university_reviews_agg" ? "university_id" : "id";
      const max = this.rows[sourceTable].reduce((current, row) => {
        const value = Number(row[keyColumn]);
        return Number.isSafeInteger(value) && value > current ? value : current;
      }, 0);
      return { rows: [{ max_id: String(max) }] };
    }

    const sqlTable = text.match(/FROM "([a-z_]+)"/)?.[1];
    if (!sqlTable) throw new Error("Unexpected synthetic SQL.");
    const sourceTable = sqlTables[sqlTable];
    const sourceRows = this.rows[sourceTable];
    if (text.startsWith("SELECT COUNT(*)")) return { rows: [{ count: String(sourceRows.length) }] };

    const keyColumn = text.includes('WHERE "token"') || text.includes('ORDER BY "token"') ? "token"
      : text.includes('WHERE "university_id"') || text.includes('ORDER BY "university_id"') ? "university_id"
        : "id";
    const cursor = text.includes(" WHERE ") ? values[0] : null;
    const limit = Number(values.at(-1));
    const page = sourceRows
      .filter((row) => cursor === null || String(row[keyColumn]) > String(cursor))
      .sort((left, right) => String(left[keyColumn]).localeCompare(String(right[keyColumn])))
      .slice(0, limit);
    return { rows: page };
  }
}

describe("PostgresMigrationSource", () => {
  it("requires and keeps a repeatable-read, read-only transaction", async () => {
    const client = new SyntheticReadOnlyPgClient();
    const source = new PostgresMigrationSource(client);

    await expect(source.countSource("users")).rejects.toThrow(/active read-only snapshot/);
    await source.beginReadOnlySnapshot();
    expect(await source.countSource("sessions")).toBe(2);
    await source.close();
    expect(client.statements[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(client.statements.at(-1)).toBe("COMMIT");
    await expect(source.countSource("users")).rejects.toThrow(/active read-only snapshot/);
  });

  it("pages through allowlisted tables with encrypted cursors", async () => {
    const originalKey = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = "b".repeat(64);
    try {
      const client = new SyntheticReadOnlyPgClient();
      const source = new PostgresMigrationSource(client);
      await source.beginReadOnlySnapshot();

      const first = await source.readBatch("sessions", null, 1);
      expect(first.records).toEqual([
        { key: "opaque-token-1", value: { token: "opaque-token-1", email: "a@example.test" } },
      ]);
      expect(first.done).toBe(false);
      expect(first.nextCursor).not.toContain("opaque-token-1");

      const second = await source.readBatch("sessions", first.nextCursor, 1);
      expect(second.records[0]?.key).toBe("opaque-token-2");
      expect(second.done).toBe(true);

      await expect(source.countSource("users; DROP TABLE users" as SourceTable)).rejects.toThrow(/allowlisted/);
      expect(client.statements.some((statement) => statement.includes("DROP TABLE"))).toBe(false);
      await source.close();
    } finally {
      if (originalKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
      else process.env.BACKUP_ENCRYPTION_KEY = originalKey;
    }
  });

  it("fingerprints the entire bounded snapshot without exposing row contents", async () => {
    const client = new SyntheticReadOnlyPgClient();
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    const fingerprint = await source.sourceFingerprint();
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(client.statements.every((statement) => !statement.includes("INSERT") && !statement.includes("UPDATE"))).toBe(true);
    await source.close();
  });

  it("normalizes PostgreSQL bigint strings to the schema's numeric fields", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.users = [{ id: 81, locked_until: "123456789" }];
    client.rows.sessions = [{
      token: "synthetic-token",
      email: "synthetic@example.test",
      expires_at: "1798800000000",
      absolute_expires_at: "1799000000000",
    }];
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    const user = await source.readBatch("users", null, 10);
    expect(user.records[0]?.value).toEqual({ id: 81, lockedUntil: 123456789 });
    const session = await source.readBatch("sessions", null, 10);
    expect(session.records[0]?.value).toEqual({
      token: "synthetic-token",
      email: "synthetic@example.test",
      expiresAt: 1798800000000,
      absoluteExpiresAt: 1799000000000,
    });

    client.rows.users = [{ id: 82, locked_until: "9007199254740992" }];
    await expect(source.readBatch("users", null, 10)).rejects.toThrow(/safe integer range/);
    client.rows.users = [{ id: 83, locked_until: Number.MAX_SAFE_INTEGER + 1 }];
    await expect(source.readBatch("users", null, 10)).rejects.toThrow(/safe integer range/);
    await source.close();
  });

  it("reads analytics events by the legacy integer key and preserves timestamp text", async () => {
    const client = new SyntheticReadOnlyPgClient();
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    expect(await source.countSource("analyticsEvents")).toBe(1);
    expect(await source.readBatch("analyticsEvents", null, 10)).toMatchObject({
      records: [{
        key: "1001",
        value: {
          id: 1001,
          eventType: "synthetic.page_view",
          details: null,
          userEmail: null,
          ipAddress: null,
          createdAt: "2026-10-13 19:34:56.123",
        },
      }],
      done: true,
    });
    expect(client.statements.some((statement) =>
      statement.includes('"created_at"::text AS "created_at"'),
    )).toBe(true);
    await source.close();
  });

  it("runs a synthetic source-to-destination import, verifies it, and resumes idempotently", async () => {
    const originalKey = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = "c".repeat(64);
    const client = new SyntheticReadOnlyPgClient();
    client.rows.universities = [
      { id: 990001, name: "Synthetic University", state: "TS" },
    ];
    const source = new PostgresMigrationSource(client);
    const destination = new Map<SourceTable, Map<string, unknown>>();
    const checkpoints = new Map<SourceTable, MigrationCheckpoint>();
    const adapter: MigrationAdapter = {
      sourceFingerprint: () => source.sourceFingerprint(),
      countSource: (table) => source.countSource(table),
      readBatch: (table, cursor, limit) => source.readBatch(table, cursor, limit),
      classify: async (table, records) => {
        const rows = destination.get(table) ?? new Map<string, unknown>();
        const identical: string[] = [];
        const missing: string[] = [];
        const conflicting: string[] = [];
        for (const record of records) {
          if (!rows.has(record.key)) missing.push(record.key);
          else if (JSON.stringify(rows.get(record.key)) === JSON.stringify(record.value)) identical.push(record.key);
          else conflicting.push(record.key);
        }
        return { identical, missing, conflicting };
      },
      insertBatch: async (table, records) => {
        const rows = destination.get(table) ?? new Map<string, unknown>();
        for (const record of records) rows.set(record.key, record.value);
        destination.set(table, rows);
      },
      loadCheckpoint: async (table) => checkpoints.get(table) ?? null,
      saveCheckpoint: async (table, checkpoint) => {
        checkpoints.set(table, checkpoint);
      },
    };

    try {
      await source.beginReadOnlySnapshot();
      const dryRun = await runBatchedMigration(adapter, { batchSize: 1, maxRetries: 2, dryRun: true });
      expect(dryRun.universities).toMatchObject({ sourceCount: 1, plannedInsert: 1, verified: 0 });
      expect(destination.size).toBe(0);

      const imported = await runBatchedMigration(adapter, { batchSize: 1, maxRetries: 2 });
      expect(imported.universities).toMatchObject({ sourceCount: 1, inserted: 1, verified: 1 });
      expect(destination.get("universities")?.get("990001")).toEqual({
        id: 990001,
        name: "Synthetic University",
        state: "TS",
      });

      const resumed = await runBatchedMigration(adapter, { batchSize: 1, maxRetries: 2 });
      expect(resumed).toEqual(imported);
      expect(destination.get("universities")?.size).toBe(1);
      expect(migrationTables).toHaveLength(13);
    } finally {
      await source.close();
      if (originalKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
      else process.env.BACKUP_ENCRYPTION_KEY = originalKey;
    }
  });
});


  it("reads sequence-aware ID counter floors without using nextval/currval/setval (bookmarks 6/232)", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.bookmarks = [{ id: 6, user_email: "a@example.test", university_id: 1 }];
    client.sequenceByTable.bookmarks = { last_value: 232, is_called: true, seqincrement: 1, can_select: true };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    await expect(source.readIdCounterFloor("bookmarks")).resolves.toEqual({
      maxLegacyId: 6,
      sequenceNextId: 233,
    });
    expect(client.statements.some((s) => /nextval|currval|setval/i.test(s))).toBe(false);
    expect(client.statements.some((s) => s.includes("has_sequence_privilege"))).toBe(true);
    await source.close();
  });

  it("uses initial last_value for a genuinely fresh sequence (is_called=false)", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.reviews = [];
    client.sequenceByTable.reviews = {
      last_value: 1,
      is_called: false,
      seqstart: 1,
      seqincrement: 1,
      can_select: true,
    };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    await expect(source.readIdCounterFloor("reviews")).resolves.toEqual({
      maxLegacyId: 0,
      sequenceNextId: 1,
    });
    await source.close();
  });

  

  it("returns last_value when is_called=false (SETVAL boundary regression)", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.bookmarks = [];
    client.sequenceByTable.bookmarks = {
      last_value: 500,
      is_called: false,
      seqstart: 1,
      seqincrement: 1,
      can_select: true,
    };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();
    await expect(source.readIdCounterFloor("bookmarks")).resolves.toEqual({
      maxLegacyId: 0,
      sequenceNextId: 500,
    });
    await source.close();
  });

  it("fails closed when SELECT permission is missing before interpreting sequence state", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.reviews = [];
    client.sequenceByTable.reviews = {
      last_value: 232,
      is_called: true,
      seqstart: 1,
      seqincrement: 1,
      can_select: false,
    };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    await expect(source.readIdCounterFloor("reviews")).rejects.toThrow(
      /Missing SELECT privilege|failing closed/i,
    );
    expect(client.statements.some((s) => s.includes('FROM "public"."reviews_id_seq"'))).toBe(false);
    await source.close();
  });

  it("succeeds with SELECT on the sequence even without USAGE/UPDATE", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.bookmarks = [{ id: 6 }];
    client.sequenceByTable.bookmarks = {
      last_value: 232,
      is_called: true,
      seqincrement: 1,
      can_select: true,
      // USAGE/UPDATE not modeled or required by inspection.
    };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();
    await expect(source.readIdCounterFloor("bookmarks")).resolves.toEqual({
      maxLegacyId: 6,
      sequenceNextId: 233,
    });
    expect(client.statements.some((s) => /USAGE|UPDATE/i.test(s))).toBe(false);
    await source.close();
  });

  it("fails closed for invalid increment or cycling sequences", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.users = [];
    client.sequenceByTable.users = { last_value: 1, is_called: true, seqincrement: 0, can_select: true };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();
    await expect(source.readIdCounterFloor("users")).rejects.toThrow(/invalid|unsupported|failing closed/i);

    client.sequenceByTable.users = { last_value: 1, is_called: true, seqincrement: 1, seqcycle: true, can_select: true };
    await expect(source.readIdCounterFloor("users")).rejects.toThrow(/Cycling sequence|failing closed/i);
    await source.close();
  });

  it("handles tables without associated sequences and token-keyed tables", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.auditLogs = [];
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    await expect(source.readIdCounterFloor("auditLogs")).resolves.toEqual({
      maxLegacyId: 0,
      sequenceNextId: null,
    });
    await expect(source.readIdCounterFloor("sessions")).resolves.toEqual({
      maxLegacyId: 0,
      sequenceNextId: null,
    });
    await source.close();
  });

  it("reserves beyond a cached sequence high-water boundary", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.bookmarks = [{ id: 6 }];
    // PostgreSQL can report last_value ahead of recently returned nextval() due to cache.
    client.sequenceByTable.bookmarks = {
      last_value: 232,
      is_called: true,
      seqincrement: 1,
      seqcache: 50,
      can_select: true,
    };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();
    await expect(source.readIdCounterFloor("bookmarks")).resolves.toEqual({
      maxLegacyId: 6,
      sequenceNextId: 233,
    });
    await source.close();
  });

  it("fails closed when sequence metadata cannot be read", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.bookmarks = [{ id: 6 }];
    client.sequenceQueryError = new Error("permission denied for relation pg_sequence");
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();

    await expect(source.readIdCounterFloor("bookmarks")).rejects.toThrow(
      /sequence metadata|Failing closed|SELECT on the mapped source table|no nextval\/currval\/setval/i,
    );
    expect(client.statements.every((s) => !/nextval|currval|setval/i.test(s))).toBe(true);
    await source.close();
  });

  it("uses last_value when is_called=false even if start_value differs (non-NULL state)", async () => {
    const client = new SyntheticReadOnlyPgClient();
    client.rows.bookmarks = [{ id: 6 }];
    client.sequenceByTable.bookmarks = {
      last_value: 232,
      is_called: false,
      seqstart: 1,
      seqincrement: 1,
      can_select: true,
    };
    const source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();
    await expect(source.readIdCounterFloor("bookmarks")).resolves.toEqual({
      maxLegacyId: 6,
      sequenceNextId: 232,
    });
    await source.close();
  });
