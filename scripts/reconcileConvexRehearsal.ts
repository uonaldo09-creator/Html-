import { Client } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import {
  assertMigrationPreflightClear,
  migrationTables,
  validateMigrationSnapshot,
  type SourceTable,
} from "../src/server/convexMigration";
import { PostgresMigrationSource } from "../src/server/postgresMigrationSource";
import { validateBackupEncryptionConfig } from "../src/server/backupEncryption";
import {
  ConvexInternalHttpTransport,
  ConvexMigrationDestination,
} from "../src/server/convexMigrationDestination";
import { transformPostgresMigrationRecord } from "../src/server/convexMigrationTransform";

const TARGET = "groovy-zebra-380";
const TARGET_URL = "https://groovy-zebra-380.ap-southeast-2.convex.cloud";
const FINGERPRINT = "144c878f03ea1245468a11de231274419af1e9b228a46a920648a416c0210541";

const COUNTS: Record<SourceTable, number> = {
  universities: 31,
  users: 13,
  studentProfiles: 4,
  parentProfiles: 0,
  reviews: 157,
  bookmarks: 6,
  notifications: 4,
  chatHistory: 32,
  sessions: 0,
  auditLogs: 66,
  loginAttempts: 19,
  universityReviewsAgg: 0,
  analyticsEvents: 0,
};

async function main() {
  config({ path: ".env", quiet: true });

  const keyFile = join(tmpdir(), "uniinfo-migration-rehearsal.env");
  if (!existsSync(keyFile)) throw new Error("Rehearsal key file is missing.");
  const loaded = config({ path: keyFile, override: true, quiet: true });
  if (loaded.error || !process.env.CONVEX_DEPLOY_KEY) {
    throw new Error("Could not load isolated rehearsal credentials.");
  }

  if (process.env.CONVEX_MIGRATION_ENABLED !== "false") {
    throw new Error("CONVEX_MIGRATION_ENABLED must remain false.");
  }
  if (process.env.MIGRATION_SOURCE_MODE !== "local-v5") {
    throw new Error("Source mode must be local-v5.");
  }
  validateBackupEncryptionConfig();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Local V5 connection is missing.");
  const db = new URL(connectionString);
  if (
    db.protocol !== "postgresql:" ||
    db.hostname !== "127.0.0.1" ||
    db.port !== "5432" ||
    decodeURIComponent(db.pathname.slice(1)) !== "uniinfo_restore_rehearsal_v5" ||
    decodeURIComponent(db.username) !== "postgres" ||
    db.search || db.hash
  ) {
    throw new Error("Refusing source: not the approved local V5 database.");
  }

  const transport = ConvexInternalHttpTransport.create({
    url: TARGET_URL,
    deploymentName: TARGET,
    adminKey: process.env.CONVEX_DEPLOY_KEY,
    isolatedSyntheticConfirmed: true,
  });
  const destination = new ConvexMigrationDestination(transport, TARGET);

  const client = new Client({
    connectionString,
    ssl: false,
    application_name: "uniinfo_v5_readonly_reconciliation",
  });
  let connected = false;
  let snapshotStarted = false;
  let source: PostgresMigrationSource | undefined;

  try {
    await client.connect();
    connected = true;
    source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();
    snapshotStarted = true;

    const before = await source.sourceFingerprint();
    if (before !== FINGERPRINT) throw new Error("Source fingerprint differs from the approved rehearsal.");

    const snapshot = Object.fromEntries(
      migrationTables.map(({ source: table }) => [table, [] as Record<string, unknown>[]]),
    ) as Record<SourceTable, Record<string, unknown>[]>;

    for (const { source: table } of migrationTables) {
      const count = await source.countSource(table);
      if (count !== COUNTS[table]) throw new Error(`Unexpected source count for ${table}.`);

      let cursor: string | null = null;
      while (true) {
        const batch = await source.readBatch(table, cursor, 100);
        snapshot[table].push(...batch.records.map(({ value }) => value as Record<string, unknown>));
        if (batch.done) break;
        if (!batch.nextCursor || batch.nextCursor === cursor) {
          throw new Error(`Source cursor did not advance for ${table}.`);
        }
        cursor = batch.nextCursor;
      }

      if (snapshot[table].length !== count) throw new Error(`Read count mismatch for ${table}.`);
    }

    if (await source.sourceFingerprint() !== before) {
      throw new Error("Source fingerprint changed during the read-only snapshot.");
    }

    const issues = validateMigrationSnapshot(
      snapshot as Parameters<typeof validateMigrationSnapshot>[0],
    );
    assertMigrationPreflightClear(issues);

    const errors = issues.filter((issue) => issue.severity === "error").length;
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    if (errors !== 0 || warnings !== 0) {
      throw new Error(`Validation changed: errors=${errors}, warnings=${warnings}. Review before proceeding.`);
    }

    const tableResults = [];
    for (const { source: table } of migrationTables) {
      const rows = snapshot[table];
      const expected = rows
        .map((row) => transformPostgresMigrationRecord(table, row).key)
        .sort();
      const actual = (await destination.listKeys(table)).sort();

      if (expected.length !== actual.length ||
          expected.some((key, index) => key !== actual[index])) {
        throw new Error(`Destination key reconciliation failed for ${table}.`);
      }

      const checkpoint = await destination.loadCheckpoint(table);
      if (
        !checkpoint ||
        !checkpoint.done ||
        checkpoint.sourceFingerprint !== before ||
        checkpoint.sourceCount !== COUNTS[table] ||
        checkpoint.inserted !== COUNTS[table] ||
        checkpoint.verified !== COUNTS[table]
      ) {
        throw new Error(`Checkpoint reconciliation failed for ${table}.`);
      }

      let contentsChecked = 0;
      for (let offset = 0; offset < rows.length; offset += 50) {
        const records = rows.slice(offset, offset + 50)
          .map((row) => transformPostgresMigrationRecord(table, row));
        const classification = await destination.classify(table, records);

        if (
          classification.identical.length !== records.length ||
          classification.missing.length !== 0 ||
          classification.conflicting.length !== 0
        ) {
          throw new Error(`Record content mismatch for ${table}.`);
        }
        contentsChecked += records.length;
      }

      tableResults.push({
        table,
        sourceRows: rows.length,
        destinationKeys: actual.length,
        contentsMatched: contentsChecked === rows.length,
        recordsContentChecked: contentsChecked,
        checkpointVerified: true,
      });
    }

    const checks: Array<{ tableName: string; legacyKey: string | number }> = [];
    for (const table of [
      "studentProfiles", "parentProfiles", "reviews", "bookmarks",
      "notifications", "chatHistory",
    ] as const) {
      for (const row of snapshot[table]) {
        checks.push({ tableName: table, legacyKey: row.id as number });
      }
    }
    for (const row of snapshot.sessions) {
      checks.push({
        tableName: "sessions",
        legacyKey: transformPostgresMigrationRecord("sessions", row).key,
      });
    }
    for (const row of snapshot.universityReviewsAgg) {
      checks.push({ tableName: "universityReviewsAgg", legacyKey: row.universityId as number });
    }

    let relationsChecked = 0;
    let relationsInvalid = 0;
    for (let offset = 0; offset < checks.length; offset += 80) {
      const batch = checks.slice(offset, offset + 80);
      const result = await transport.invoke<{ checked: number; invalid: number }>(
        "migration:verifyRecordRelations",
        { checks: batch },
      );
      if (result.checked !== batch.length) {
        throw new Error("Relationship verifier returned an unexpected checked count.");
      }
      relationsChecked += result.checked;
      relationsInvalid += result.invalid;
    }

    if (relationsChecked !== checks.length || relationsInvalid !== 0) {
      throw new Error(`Relationship reconciliation failed: checked=${relationsChecked}, invalid=${relationsInvalid}.`);
    }
    if (await source.sourceFingerprint() !== before) {
      throw new Error("Source fingerprint changed before reconciliation completed.");
    }

    console.log(JSON.stringify({
      status: "RECONCILIATION_PASS",
      mode: "read-only destination reconciliation",
      source: {
        database: "uniinfo_restore_rehearsal_v5",
        fingerprint: before,
        totalRows: Object.values(COUNTS).reduce((a, b) => a + b, 0),
        tables: migrationTables.length,
      },
      destination: TARGET,
      tableResults,
      totals: {
        sourceRows: tableResults.reduce((sum, row) => sum + row.sourceRows, 0),
        destinationKeys: tableResults.reduce((sum, row) => sum + row.destinationKeys, 0),
        recordsContentChecked: tableResults.reduce((sum, row) => sum + row.recordsContentChecked, 0),
        completedCheckpoints: tableResults.filter((row) => row.checkpointVerified).length,
      },
      relationshipReconciliation: {
        checks: relationsChecked,
        invalid: relationsInvalid,
        batchSize: 80,
      },
      validation: { errors, warnings },
      safety: {
        migrationFeatureFlag: process.env.CONVEX_MIGRATION_ENABLED,
        insertsAttempted: false,
        checkpointWritesAttempted: false,
        productionTargetUsed: false,
      },
      rollback: "PostgreSQL remains authoritative; no production route switched.",
    }, null, 2));
  } finally {
    if (source && snapshotStarted) await source.close().catch(() => undefined);
    if (connected) await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("Reconciliation stopped:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});