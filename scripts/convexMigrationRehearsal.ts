import { existsSync } from "node:fs";
import { Client } from "pg";
import { config } from "dotenv";
import {
  assertMigrationPreflightClear,
  migrationTables,
  runBatchedMigration,
  validateMigrationSnapshot,
  type MigrationAdapter,
  type SourceTable,
} from "../src/server/convexMigration";
import { PostgresMigrationSource } from "../src/server/postgresMigrationSource";
import { validateBackupEncryptionConfig } from "../src/server/backupEncryption";
import {
  ConvexInternalHttpTransport,
  ConvexMigrationDestination,
} from "../src/server/convexMigrationDestination";
import { transformPostgresMigrationRecord } from "../src/server/convexMigrationTransform";
import { resolveConvexDeploymentTarget } from "../src/server/convexDeploymentTarget";

const TARGET_NAME = "groovy-zebra-380";
const TARGET_URL = "https://groovy-zebra-380.ap-southeast-2.convex.cloud";
const EXPECTED_FINGERPRINT = "144c878f03ea1245468a11de231274419af1e9b228a46a920648a416c0210541";
const EXPECTED_COUNTS: Record<SourceTable, number> = {
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
const APPROVED_WARNING_CODES = ["unresolved_optional_relationship"] as const;
const CONFIRMATION = "COPY_332_ROWS_TO_ISOLATED_REHEARSAL";

async function main(): Promise<void> {
  config({ path: ".env", quiet: true });

  const keyFile = process.env.MIGRATION_REHEARSAL_KEY_FILE;
  if (!keyFile || !existsSync(keyFile)) {
    throw new Error("Temporary rehearsal deploy-key file is missing.");
  }
  const keyResult = config({ path: keyFile, override: true, quiet: true });
  if (keyResult.error || !process.env.CONVEX_DEPLOY_KEY) {
    throw new Error("Could not load the isolated deployment credential.");
  }

  if (process.env.ALLOW_REHEARSAL_IMPORT !== CONFIRMATION) {
    throw new Error("Explicit rehearsal-import confirmation was not supplied.");
  }
  if (process.env.CONVEX_MIGRATION_ENABLED !== "false") {
    throw new Error("Refusing to run: CONVEX_MIGRATION_ENABLED must remain false.");
  }
  if (process.env.MIGRATION_SOURCE_MODE !== "local-v5") {
    throw new Error("Refusing to run: source mode must be local-v5.");
  }

  validateBackupEncryptionConfig();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is missing.");

  const dbUrl = new URL(connectionString);
  if (
    dbUrl.protocol !== "postgresql:" ||
    dbUrl.hostname !== "127.0.0.1" ||
    dbUrl.port !== "5432" ||
    decodeURIComponent(dbUrl.pathname.slice(1)) !== "uniinfo_restore_rehearsal_v5" ||
    decodeURIComponent(dbUrl.username) !== "postgres" ||
    dbUrl.search ||
    dbUrl.hash
  ) {
    throw new Error("Refusing connection: source is not the approved local V5 database.");
  }

  try {
    resolveConvexDeploymentTarget({
      deploymentName: TARGET_NAME,
      url: TARGET_URL,
      role: "synthetic-migration",
    });
  } catch {
    throw new Error("Refusing target: deployment identity is not the approved isolated target.");
  }

  const transport = ConvexInternalHttpTransport.create({
    url: TARGET_URL,
    deploymentName: TARGET_NAME,
    adminKey: process.env.CONVEX_DEPLOY_KEY,
    isolatedSyntheticConfirmed: true,
  });
  const destination = new ConvexMigrationDestination(transport, TARGET_NAME);

  // Require an empty destination and no existing migration checkpoints.
  for (const { source: table } of migrationTables) {
    if ((await destination.listKeys(table)).length !== 0) {
      throw new Error(`Refusing import: destination table ${table} is not empty.`);
    }
    if (await destination.loadCheckpoint(table)) {
      throw new Error(`Refusing import: a checkpoint already exists for ${table}.`);
    }
  }

  const client = new Client({
    connectionString,
    ssl: false,
    application_name: "uniinfo_v5_isolated_convex_rehearsal",
  });

  let connected = false;
  let snapshotStarted = false;
  let source: PostgresMigrationSource | null = null;

  try {
    await client.connect();
    connected = true;

    source = new PostgresMigrationSource(client);
    await source.beginReadOnlySnapshot();
    snapshotStarted = true;

    const fingerprintBefore = await source.sourceFingerprint();
    if (fingerprintBefore !== EXPECTED_FINGERPRINT) {
      throw new Error("Source fingerprint changed since the approved dry-run plan.");
    }

    const snapshot = Object.fromEntries(
      migrationTables.map(({ source: table }) => [table, [] as Record<string, unknown>[]]),
    ) as Record<SourceTable, Record<string, unknown>[]>;

    for (const { source: table } of migrationTables) {
      const expectedCount = await source.countSource(table);
      if (expectedCount !== EXPECTED_COUNTS[table]) {
        throw new Error(`Unexpected source count for ${table}; rerun validation and planning.`);
      }

      let cursor: string | null = null;
      while (true) {
        const batch = await source.readBatch(table, cursor, 100);
        snapshot[table].push(
          ...batch.records.map(({ value }) => value as Record<string, unknown>),
        );

        if (batch.done) break;
        if (!batch.nextCursor || batch.nextCursor === cursor) {
          throw new Error(`Source cursor stalled for ${table}.`);
        }
        cursor = batch.nextCursor;
      }

      if (snapshot[table].length !== expectedCount) {
        throw new Error(`Source snapshot count mismatch for ${table}.`);
      }
    }

    const fingerprintAfter = await source.sourceFingerprint();
    if (fingerprintBefore !== fingerprintAfter) {
      throw new Error("Source fingerprint changed during read-only preflight.");
    }

    const issues = validateMigrationSnapshot(
      snapshot as Parameters<typeof validateMigrationSnapshot>[0],
    );
    assertMigrationPreflightClear(issues, [...APPROVED_WARNING_CODES]);

    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length !== 0) {
      throw new Error(`Preflight found ${errors.length} validation error(s).`);
    }

    // Recheck emptiness immediately before the first destination write.
    for (const { source: table } of migrationTables) {
      if ((await destination.listKeys(table)).length !== 0) {
        throw new Error(`Destination table ${table} changed before import.`);
      }
      if (await destination.loadCheckpoint(table)) {
        throw new Error(`Unexpected checkpoint appeared for ${table}.`);
      }
    }

    const adapter: MigrationAdapter = {
      sourceFingerprint: () => source!.sourceFingerprint(),
      countSource: (table) => source!.countSource(table),
      readBatch: async (table, cursor, limit) => {
        const batch = await source!.readBatch(table, cursor, limit);
        return {
          ...batch,
          records: batch.records.map(({ value }) =>
            transformPostgresMigrationRecord(
              table,
              value as Record<string, unknown>,
            ),
          ),
        };
      },
      classify: (table, records) => destination.classify(table, records),
      insertBatch: (table, records) => destination.insertBatch(table, records),
      loadCheckpoint: (table) => destination.loadCheckpoint(table),
      saveCheckpoint: (table, checkpoint) => destination.saveCheckpoint(table, checkpoint),
    };

    console.log("Preflight passed. Beginning explicitly approved isolated rehearsal import.");

    // This is the write stage. All writes target only the dedicated temporary deployment.
    const results = await runBatchedMigration(adapter, {
      batchSize: 50,
      maxRetries: 2,
      dryRun: false,
    });

    const tableReport: Array<Record<string, string | number | boolean>> = [];

    for (const { source: table } of migrationTables) {
      const result = results[table];
      const expectedCount = EXPECTED_COUNTS[table];

      if (
        result.sourceCount !== expectedCount ||
        result.inserted !== expectedCount ||
        result.verified !== expectedCount
      ) {
        throw new Error(`Import count or verification mismatch for ${table}.`);
      }

      const expectedKeys = snapshot[table]
        .map((row) => transformPostgresMigrationRecord(table, row).key)
        .sort();
      const actualKeys = (await destination.listKeys(table)).sort();

      if (
        expectedKeys.length !== actualKeys.length ||
        expectedKeys.some((key, index) => key !== actualKeys[index])
      ) {
        throw new Error(`Destination key reconciliation failed for ${table}.`);
      }

      // Reclassify every source record with write:false to compare its stored content.
      for (let offset = 0; offset < snapshot[table].length; offset += 50) {
        const records = snapshot[table]
          .slice(offset, offset + 50)
          .map((row) => transformPostgresMigrationRecord(table, row));
        const classification = await destination.classify(table, records);

        if (
          classification.identical.length !== records.length ||
          classification.missing.length !== 0 ||
          classification.conflicting.length !== 0
        ) {
          throw new Error(`Record-content reconciliation failed for ${table}.`);
        }
      }

      const checkpoint = await destination.loadCheckpoint(table);
      if (
        !checkpoint ||
        checkpoint.sourceFingerprint !== fingerprintBefore ||
        checkpoint.sourceCount !== expectedCount ||
        checkpoint.inserted !== expectedCount ||
        checkpoint.verified !== expectedCount ||
        !checkpoint.done
      ) {
        throw new Error(`Checkpoint reconciliation failed for ${table}.`);
      }

      tableReport.push({
        table,
        sourceCount: result.sourceCount,
        inserted: result.inserted,
        verified: result.verified,
        destinationKeys: actualKeys.length,
        contentsMatched: true,
        checkpointVerified: true,
      });
    }

    // Check parent/child relationships for all relationship-bearing source rows.
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
      checks.push({
        tableName: "universityReviewsAgg",
        legacyKey: row.universityId as number,
      });
    }

    const relations = await transport.invoke<{ checked: number; invalid: number }>(
      "migration:verifyRecordRelations",
      { checks },
    );
    if (relations.checked !== checks.length || relations.invalid !== 0) {
      throw new Error("Destination relationship reconciliation failed.");
    }

    if ((await source.sourceFingerprint()) !== fingerprintBefore) {
      throw new Error("Source fingerprint changed during reconciliation.");
    }

    const grouped = new Map<string, {
      severity: string; table: string; code: string; field: string | null; count: number;
    }>();
    for (const issue of issues) {
      const field = issue.field ?? null;
      const groupKey = JSON.stringify([issue.severity, issue.table, issue.code, field]);
      const existing = grouped.get(groupKey);
      if (existing) existing.count++;
      else grouped.set(groupKey, {
        severity: issue.severity,
        table: issue.table,
        code: issue.code,
        field,
        count: 1,
      });
    }

    console.log(JSON.stringify({
      status: "REHEARSAL_IMPORT_AND_RECONCILIATION_PASS_WITH_WARNINGS",
      source: {
        database: "uniinfo_restore_rehearsal_v5",
        fingerprint: fingerprintBefore,
        totalRows: Object.values(EXPECTED_COUNTS).reduce((sum, count) => sum + count, 0),
        tableCount: migrationTables.length,
        writesAttempted: false,
      },
      destination: {
        deployment: TARGET_NAME,
        url: TARGET_URL,
        importCompleted: true,
        destinationWritesWereIsolated: true,
        totalRecordsVerified: tableReport.reduce((sum, row) => sum + Number(row.verified), 0),
        tables: tableReport,
      },
      relationshipReconciliation: relations,
      validation: {
        errors: errors.length,
        warnings: issues.filter((issue) => issue.severity === "warning").length,
        groupedIssues: [...grouped.values()],
      },
      safety: {
        migrationFeatureFlag: process.env.CONVEX_MIGRATION_ENABLED,
        productionDatabaseModified: false,
        existingConvexDeploymentModified: false,
        automaticRouteSwitch: false,
      },
      rollback: "PostgreSQL remains authoritative. This temporary rehearsal deployment can be discarded; no production route was switched.",
    }, null, 2));
  } finally {
    if (source && snapshotStarted) await source.close().catch(() => undefined);
    if (connected) await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Rehearsal stopped: ${message}`);
  console.error("If the write stage had started, do not rerun blindly. Inspect the isolated target first.");
  process.exitCode = 1;
});