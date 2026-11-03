import {
  assertMigrationPreflightClear,
  migrationTables,
  runBatchedMigration,
  validateMigrationSnapshot,
  type MigrationAdapter,
  type MigrationBatch,
  type MigrationCheckpoint,
  type MigrationRecord,
  type MigrationRunResult,
  type SourceTable,
} from "./convexMigration";
import type { MigrationDestination } from "./convexMigrationDestination";
import { transformPostgresMigrationRecord } from "./convexMigrationTransform";

export type MigrationMode = "validate-only" | "dry-run" | "synthetic" | "verify";

export interface MigrationSource {
  readonly kind: "postgres" | "synthetic";
  beginReadOnlySnapshot(): Promise<void>;
  close(): Promise<void>;
  sourceFingerprint(): Promise<string>;
  countSource(table: SourceTable): Promise<number>;
  readBatch(table: SourceTable, cursor: string | null, limit: number): Promise<MigrationBatch>;
}

export interface MigrationExecutionOptions {
  mode: MigrationMode;
  batchSize: number;
  maxRetries: number;
  approvedWarningCodes?: readonly string[];
  isolatedSyntheticDeployment?: string;
  confirmSyntheticImport?: boolean;
}

export interface MigrationExecutionResult {
  mode: MigrationMode;
  sourceFingerprint: string;
  issues: ReturnType<typeof validateMigrationSnapshot>;
  tables?: MigrationRunResult;
  rollback: "PostgreSQL remains authoritative; no automatic delete or route switch.";
}

const CURRENT_DEVELOPMENT_DEPLOYMENT = "graceful-kangaroo-272";

async function readCompleteSnapshot(
  source: MigrationSource,
  batchSize: number,
): Promise<Record<SourceTable, unknown[]>> {
  const snapshot = Object.fromEntries(
    migrationTables.map(({ source: table }) => [table, []]),
  ) as Record<SourceTable, unknown[]>;

  for (const { source: table } of migrationTables) {
    const expectedCount = await source.countSource(table);
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new Error("Migration preflight could not verify a source table count.");
    }
    let cursor: string | null = null;
    while (true) {
      const batch = await source.readBatch(table, cursor, batchSize);
      if (batch.records.length > batchSize || (!batch.done && batch.records.length === 0)) {
        throw new Error("Migration preflight received an invalid source batch.");
      }
      snapshot[table].push(...batch.records.map(({ value }) => value));
      if (batch.done) break;
      if (!batch.nextCursor || batch.nextCursor === cursor) {
        throw new Error("Migration preflight source cursor did not advance.");
      }
      cursor = batch.nextCursor;
    }
    if (snapshot[table].length !== expectedCount) {
      throw new Error("Migration preflight source count verification failed.");
    }
  }
  return snapshot;
}

function composeAdapter(
  source: MigrationSource,
  destination: MigrationDestination,
): MigrationAdapter {
  return {
    sourceFingerprint: () => source.sourceFingerprint(),
    countSource: (table) => source.countSource(table),
    readBatch: async (table, cursor, limit) => {
      const batch = await source.readBatch(table, cursor, limit);
      return {
        ...batch,
        records: batch.records.map(({ value }) =>
          transformPostgresMigrationRecord(table, value)),
      };
    },
    classify: (table, records) => destination.classify(table, records),
    insertBatch: (table, records) => destination.insertBatch(table, records),
    loadCheckpoint: (table) => destination.loadCheckpoint(table),
    saveCheckpoint: (table, checkpoint) => destination.saveCheckpoint(table, checkpoint),
  };
}

export async function runConvexMigration(
  source: MigrationSource,
  destination: MigrationDestination | null,
  options: MigrationExecutionOptions,
): Promise<MigrationExecutionResult> {
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) {
    throw new RangeError("Migration batch size must be between 1 and 100.");
  }
  if (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 1) {
    throw new RangeError("Migration retry count must be a positive safe integer.");
  }
  if (
    options.mode === "synthetic" &&
    (source.kind !== "synthetic" ||
      !destination ||
      !options.confirmSyntheticImport ||
      !options.isolatedSyntheticDeployment ||
      options.isolatedSyntheticDeployment === CURRENT_DEVELOPMENT_DEPLOYMENT ||
      options.isolatedSyntheticDeployment === "prod")
  ) {
    throw new Error("Synthetic writes require a confirmed isolated synthetic source and destination.");
  }
  if (options.mode === "verify" && (!destination || source.kind !== "synthetic")) {
    throw new Error("Verification mode requires an isolated synthetic destination and source.");
  }

  await source.beginReadOnlySnapshot();
  try {
    const fingerprint = await source.sourceFingerprint();
    if (!fingerprint) throw new Error("Migration source fingerprint is required.");
    const snapshot = await readCompleteSnapshot(source, options.batchSize);
    const issues = validateMigrationSnapshot(snapshot);
    assertMigrationPreflightClear(issues, options.approvedWarningCodes);
    if (options.mode === "validate-only") {
      return {
        mode: options.mode,
        sourceFingerprint: fingerprint,
        issues,
        rollback: "PostgreSQL remains authoritative; no automatic delete or route switch.",
      };
    }
    if (options.mode === "dry-run" && !destination) {
      throw new Error("Dry-run classification requires an isolated destination.");
    }
    if (!destination) throw new Error("Migration destination is required.");
    if (await source.sourceFingerprint() !== fingerprint) {
      throw new Error("Migration source changed during preflight.");
    }

    const tables = await runBatchedMigration(composeAdapter(source, destination), {
      batchSize: options.batchSize,
      maxRetries: options.maxRetries,
      dryRun: options.mode === "dry-run" || options.mode === "verify",
    });
    if (
      options.mode === "verify" &&
      migrationTables.some(({ source: table }) => tables[table].plannedInsert > 0)
    ) {
      throw new Error("Destination verification found source records missing from Convex.");
    }
    if (options.mode === "verify" || options.mode === "synthetic") {
      const expectedKeys = Object.fromEntries(
        migrationTables.map(({ source: table }) => [
          table,
          snapshot[table].map((value) =>
            transformPostgresMigrationRecord(table, value).key),
        ]),
      ) as Record<SourceTable, string[]>;
      for (const { source: table } of migrationTables) {
        const expected = [...expectedKeys[table]].sort();
        const actual = (await destination.listKeys(table)).sort();
        if (
          expected.length !== actual.length ||
          expected.some((key, index) => key !== actual[index])
        ) {
          throw new Error(`Destination key verification failed for table ${table}.`);
        }
      }
    }
    return {
      mode: options.mode,
      sourceFingerprint: fingerprint,
      issues,
      tables,
      rollback: "PostgreSQL remains authoritative; no automatic delete or route switch.",
    };
  } finally {
    await source.close();
  }
}

export type { MigrationCheckpoint, MigrationRecord };
