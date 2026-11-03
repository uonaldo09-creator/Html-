import "dotenv/config";
import { Client } from "pg";
import {
  migrationTables,
  validateMigrationSnapshot,
  type SourceTable,
} from "../src/server/convexMigration";
import { PostgresMigrationSource } from "../src/server/postgresMigrationSource";
import { validateBackupEncryptionConfig } from "../src/server/backupEncryption";

async function main(): Promise<void> {
  if (process.env.MIGRATION_SOURCE_MODE !== "local-v5") {
    throw new Error("Set MIGRATION_SOURCE_MODE=local-v5 explicitly.");
  }
  if (process.env.CONVEX_MIGRATION_ENABLED !== "false") {
    throw new Error("Migration safety check failed.");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is missing.");

  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);

  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "5432" ||
    databaseName !== "uniinfo_restore_rehearsal_v5" ||
    username !== "postgres" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Refusing connection: target is not the approved local V5 database.");
  }

  validateBackupEncryptionConfig();

  const client = new Client({
    connectionString,
    ssl: false,
    application_name: "uniinfo_local_v5_validate_only",
  });

  const source = new PostgresMigrationSource(client);
  let connected = false;
  let snapshotStarted = false;

  try {
    await client.connect();
    connected = true;
    await source.beginReadOnlySnapshot();
    snapshotStarted = true;

    const fingerprintBefore = await source.sourceFingerprint();
    const snapshot = Object.fromEntries(
      migrationTables.map(({ source: table }) => [table, []]),
    ) as Record<SourceTable, unknown[]>;

    const counts = {} as Record<SourceTable, number>;
    let totalRows = 0;

    for (const { source: table } of migrationTables) {
      const expectedCount = await source.countSource(table);
      counts[table] = expectedCount;

      let cursor: string | null = null;
      while (true) {
        const batch = await source.readBatch(table, cursor, 100);
        snapshot[table].push(...batch.records.map(({ value }) => value));

        if (batch.done) break;
        if (!batch.nextCursor || batch.nextCursor === cursor) {
          throw new Error(`Pagination failed for table ${table}.`);
        }
        cursor = batch.nextCursor;
      }

      if (snapshot[table].length !== expectedCount) {
        throw new Error(`Count mismatch for table ${table}.`);
      }
      totalRows += expectedCount;
    }

    const fingerprintAfter = await source.sourceFingerprint();
    if (fingerprintBefore !== fingerprintAfter) {
      throw new Error("Fingerprint changed during the read-only snapshot.");
    }

    const issues = validateMigrationSnapshot(snapshot);
    const grouped = new Map<string, {
      severity: string;
      table: string;
      code: string;
      field: string | null;
      count: number;
    }>();

    for (const issue of issues) {
      const field = issue.field ?? null;
      const key = JSON.stringify([issue.severity, issue.table, issue.code, field]);
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, {
          severity: issue.severity,
          table: issue.table,
          code: issue.code,
          field,
          count: 1,
        });
      }
    }

    console.log(JSON.stringify({
      mode: "validate-only",
      source: "local:uniinfo_restore_rehearsal_v5",
      readOnlySnapshot: true,
      tls: "disabled for loopback-only local rehearsal",
      sourceFingerprint: fingerprintAfter,
      tableCounts: counts,
      totalRows,
      validationIssueCount: issues.length,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      result: issues.some((issue) => issue.severity === "error")
        ? "ERRORS_REMAIN"
        : issues.length > 0 ? "WARNINGS_REMAIN" : "PASS",
      issues: [...grouped.values()],
      writesAttempted: false,
      convexContacted: false,
    }, null, 2));

    if (issues.some((issue) => issue.severity === "error")) {
      process.exitCode = 2;
    }
  } finally {
    try {
      if (snapshotStarted) await source.close();
    } finally {
      if (connected) await client.end();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Local V5 validation failed: ${message}`);
  process.exitCode = 1;
});
