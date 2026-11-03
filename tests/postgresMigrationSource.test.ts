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
