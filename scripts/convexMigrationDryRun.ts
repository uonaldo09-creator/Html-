import { existsSync } from "node:fs";
import { Client } from "pg";
import { config } from "dotenv";
import { migrationTables, type SourceTable, type MigrationRecord, type MigrationCheckpoint } from "../src/server/convexMigration";
import { PostgresMigrationSource } from "../src/server/postgresMigrationSource";
import { validateBackupEncryptionConfig } from "../src/server/backupEncryption";
import { ConvexInternalHttpTransport, ConvexMigrationDestination, type MigrationDestination } from "../src/server/convexMigrationDestination";
import { runConvexMigration } from "../src/server/convexMigrationOrchestrator";

const TARGET_NAME = "groovy-zebra-380";
const TARGET_URL = "https://groovy-zebra-380.ap-southeast-2.convex.cloud";
const EXPECTED_DATABASE = "uniinfo_restore_rehearsal_v5";
const EXPECTED_TOTAL_ROWS = 332;
const APPROVED_WARNING_CODES = ["unresolved_optional_relationship"] as const;

class EmptyTargetDryRunDestination implements MigrationDestination {
  constructor(private readonly actual: ConvexMigrationDestination) {}

  async classify(table: SourceTable, records: readonly MigrationRecord[]) {
    // Recheck the live destination before every planned batch.
    // This planner is valid only while every target table remains empty.
    const currentKeys = await this.actual.listKeys(table);
    if (currentKeys.length !== 0) {
      throw new Error(`Dry-run safety check failed: destination table ${table} is no longer empty.`);
    }
    return {
      identical: [] as string[],
      missing: records.map((record) => record.key),
      conflicting: [] as string[],
    };
  }

  async insertBatch(_table: SourceTable, _records: readonly MigrationRecord[]): Promise<void> {
    throw new Error("DRY_RUN_NO_WRITES: insertBatch must never be called.");
  }

  async loadCheckpoint(_table: SourceTable): Promise<MigrationCheckpoint | null> {
    throw new Error("DRY_RUN_NO_WRITES: checkpoint reads are disabled in this planner.");
  }

  async saveCheckpoint(_table: SourceTable, _checkpoint: MigrationCheckpoint): Promise<void> {
    throw new Error("DRY_RUN_NO_WRITES: checkpoint writes must never be called.");
  }

  async listKeys(table: SourceTable): Promise<string[]> {
    return this.actual.listKeys(table);
  }
}

async function main(): Promise<void> {
  const baseEnv = config({ path: ".env" });
  if (baseEnv.error) throw new Error("Could not load the project environment file.");

  const keyFile = process.env.MIGRATION_REHEARSAL_KEY_FILE;
  if (!keyFile || !existsSync(keyFile)) {
    throw new Error("The temporary rehearsal deploy-key file is missing.");
  }
  const tokenEnv = config({ path: keyFile, override: true });
  if (tokenEnv.error || !process.env.CONVEX_DEPLOY_KEY) {
    throw new Error("Could not load the rehearsal deploy key.");
  }

  if (process.env.CONVEX_MIGRATION_ENABLED !== "false") {
    throw new Error("Safety check failed: CONVEX_MIGRATION_ENABLED must be false.");
  }
  if (process.env.MIGRATION_SOURCE_MODE !== "local-v5") {
    throw new Error("Safety check failed: source mode must be local-v5.");
  }
  validateBackupEncryptionConfig();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Local V5 DATABASE_URL is missing.");

  const dbUrl = new URL(connectionString);
  if (
    dbUrl.protocol !== "postgresql:" ||
    dbUrl.hostname !== "127.0.0.1" ||
    dbUrl.port !== "5432" ||
    decodeURIComponent(dbUrl.pathname.slice(1)) !== EXPECTED_DATABASE ||
    decodeURIComponent(dbUrl.username) !== "postgres" ||
    dbUrl.search ||
    dbUrl.hash
  ) {
    throw new Error("Refusing connection: the source is not the approved loopback V5 database.");
  }

  if (
    new URL(TARGET_URL).hostname !== `${TARGET_NAME}.ap-southeast-2.convex.cloud` ||
    ["prod", "graceful-kangaroo-272"].includes(TARGET_NAME)
  ) {
    throw new Error("Refusing target: the Convex deployment is not positively identified as isolated.");
  }

  const transport = ConvexInternalHttpTransport.create({
    url: TARGET_URL,
    deploymentName: TARGET_NAME,
    adminKey: process.env.CONVEX_DEPLOY_KEY,
    isolatedSyntheticConfirmed: true,
  });
  const actualDestination = new ConvexMigrationDestination(transport, TARGET_NAME);

  const inventoryBefore: Record<string, number> = {};
  for (const { source: table } of migrationTables) {
    const keys = await actualDestination.listKeys(table);
    inventoryBefore[table] = keys.length;
    if (keys.length !== 0) {
      throw new Error(`Refusing dry run: target table ${table} already contains records.`);
    }
  }

  const client = new Client({
    connectionString,
    ssl: false,
    application_name: "uniinfo_v5_convex_no_write_dry_run",
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;

    const source = Object.assign(
      new PostgresMigrationSource(client),
      { kind: "postgres" as const },
    );

    const result = await runConvexMigration(
      source,
      new EmptyTargetDryRunDestination(actualDestination),
      {
        mode: "dry-run",
        batchSize: 50,
        maxRetries: 2,
        approvedWarningCodes: [...APPROVED_WARNING_CODES],
      },
    );

    if (!result.tables) throw new Error("Dry run returned no table plan.");

    const tables = migrationTables.map(({ source: table }) => {
      const row = result.tables![table];
      return {
        table,
        sourceCount: row.sourceCount,
        plannedInsert: row.plannedInsert,
        alreadyPresent: row.alreadyPresent,
        inserted: row.inserted,
        verified: row.verified,
      };
    });

    const totalRows = tables.reduce((sum, row) => sum + row.sourceCount, 0);
    const totalPlanned = tables.reduce((sum, row) => sum + row.plannedInsert, 0);

    if (totalRows !== EXPECTED_TOTAL_ROWS || totalPlanned !== totalRows) {
      throw new Error("Unexpected source or planned-insert total; reconciliation is required.");
    }

    const inventoryAfter: Record<string, number> = {};
    for (const { source: table } of migrationTables) {
      const keys = await actualDestination.listKeys(table);
      inventoryAfter[table] = keys.length;
      if (keys.length !== 0) {
        throw new Error(`Dry-run safety check failed: target table ${table} is no longer empty.`);
      }
    }

    const grouped = new Map<string, {
      severity: string;
      table: string;
      code: string;
      field: string | null;
      count: number;
    }>();

    for (const issue of result.issues) {
      const field = issue.field ?? null;
      const groupKey = JSON.stringify([issue.severity, issue.table, issue.code, field]);
      const current = grouped.get(groupKey);
      if (current) {
        current.count += 1;
      } else {
        grouped.set(groupKey, {
          severity: issue.severity,
          table: issue.table,
          code: issue.code,
          field,
          count: 1,
        });
      }
    }

    console.log(JSON.stringify({
      status: result.issues.some((issue) => issue.severity === "error")
        ? "ERRORS_REMAIN"
        : result.issues.length > 0
          ? "DRY_RUN_PLAN_COMPLETE_WITH_WARNINGS"
          : "DRY_RUN_PLAN_PASS",
      mode: result.mode,
      source: {
        database: EXPECTED_DATABASE,
        readOnlyRepeatableReadSnapshot: true,
        fingerprint: result.sourceFingerprint,
        tableCount: tables.length,
        totalRows,
      },
      destination: {
        deployment: TARGET_NAME,
        targetUrl: TARGET_URL,
        verifiedEmptyBefore: true,
        verifiedEmptyAfter: true,
        inventoryBefore,
        inventoryAfter,
        classificationMethod: "planned inserts derived from a repeatedly verified empty destination",
        liveRecordClassificationMutationsInvoked: false,
      },
      tables,
      totals: {
        sourceRows: totalRows,
        plannedInsert: totalPlanned,
        alreadyPresent: tables.reduce((sum, row) => sum + row.alreadyPresent, 0),
        inserted: tables.reduce((sum, row) => sum + row.inserted, 0),
        verified: tables.reduce((sum, row) => sum + row.verified, 0),
      },
      validation: {
        issueCount: result.issues.length,
        errors: result.issues.filter((issue) => issue.severity === "error").length,
        warnings: result.issues.filter((issue) => issue.severity === "warning").length,
        explicitlyAllowedWarningCodes: APPROVED_WARNING_CODES,
        issues: [...grouped.values()],
      },
      safety: {
        migrationFeatureFlag: process.env.CONVEX_MIGRATION_ENABLED,
        sourceWritesAttempted: false,
        destinationInsertsAttempted: false,
        checkpointWritesAttempted: false,
        productionTargetUsed: false,
      },
      limitation: "This plans imports for a verified-empty target. It does not exercise the deployed record-classification mutations or constitute post-import reconciliation.",
      rollback: result.rollback,
    }, null, 2));
  } finally {
    if (connected) await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Convex dry-run planner stopped safely: ${message}`);
  process.exitCode = 1;
});