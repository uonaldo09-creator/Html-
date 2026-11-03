import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { PostgresMigrationSource } from "../src/server/postgresMigrationSource";
import {
  migrationTables,
  validateMigrationSnapshot,
  type SourceTable,
} from "../src/server/convexMigration";
import { validateBackupEncryptionConfig } from "../src/server/backupEncryption";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const caPath = process.env.PGSSLROOTCERT;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!caPath) {
    throw new Error("PGSSLROOTCERT is not configured.");
  }
  if (process.env.CONVEX_MIGRATION_ENABLED !== "false") {
    throw new Error("Safety check failed: CONVEX_MIGRATION_ENABLED must be false.");
  }

  validateBackupEncryptionConfig();

  const ca = readFileSync(caPath, "utf8");
  const client = new Client({
    connectionString,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
    application_name: "uniinfo_migration_validate_only",
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
          throw new Error(`Pagination cursor failed for table ${table}.`);
        }

        cursor = batch.nextCursor;
      }

      if (snapshot[table].length !== expectedCount) {
        throw new Error(`Source count mismatch for table ${table}.`);
      }

      totalRows += expectedCount;
    }

    const fingerprintAfter = await source.sourceFingerprint();

    if (fingerprintBefore !== fingerprintAfter) {
      throw new Error("Source fingerprint changed during validation.");
    }

    const issues = validateMigrationSnapshot(snapshot);
    const issueGroups = new Map<string, {
      severity: string;
      table: string;
      code: string;
      field: string | null;
      count: number;
    }>();

    for (const issue of issues) {
      const field = issue.field ?? null;
      const key = JSON.stringify([
        issue.severity,
        issue.table,
        issue.code,
        field,
      ]);
      const group = issueGroups.get(key);

      if (group) {
        group.count += 1;
      } else {
        issueGroups.set(key, {
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
      readOnlySnapshot: true,
      tlsCertificateVerification: true,
      sourceFingerprint: fingerprintAfter,
      tableCounts: counts,
      totalRows,
      validationIssueCount: issues.length,
      result: issues.length === 0 ? "PASS" : "REVIEW_REQUIRED",
      issues: [...issueGroups.values()],
      writesAttempted: false,
      convexContacted: false,
    }, null, 2));

    if (issues.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    try {
      if (snapshotStarted) {
        await source.close();
      }
    } finally {
      if (connected) {
        await client.end();
      }
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  const safeMessage = process.env.DATABASE_URL
    ? message.split(process.env.DATABASE_URL).join("[DATABASE_URL redacted]")
    : message;

  console.error(`Validation failed: ${safeMessage}`);
  process.exitCode = 1;
});
