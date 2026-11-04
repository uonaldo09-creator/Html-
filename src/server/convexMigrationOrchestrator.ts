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

export type MigrationMode =
  | "validate-only"
  | "dry-run"
  | "synthetic"
  | "postgres-import"
  | "verify";

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
  /** Positively identified isolated staging deployment receiving real data. */
  isolatedStagingDeployment?: string;
  /** Explicit acknowledgement that this run writes real source records. */
  confirmPostgresImport?: boolean;
}

/**
 * Tables whose legacy IDs must be reserved in the durable Convex ID counter so
 * future allocations can never collide with imported rows. `sessions` is keyed
 * by a token hash and `universityReviewsAgg` by a foreign university id, so
 * neither owns an independent ID sequence.
 */
const counterBackedTables = new Set<SourceTable>([
  "universities",
  "users",
  "reviews",
  "bookmarks",
  "chatHistory",
  "auditLogs",
  "loginAttempts",
  "studentProfiles",
  "parentProfiles",
  "notifications",
  "analyticsEvents",
]);

export interface MigrationExecutionResult {
  mode: MigrationMode;
  sourceFingerprint: string;
  issues: ReturnType<typeof validateMigrationSnapshot>;
  sourceCounts?: Record<SourceTable, number>;
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
  if (
    options.mode === "postgres-import" &&
    (source.kind !== "postgres" ||
      !destination ||
      !options.confirmPostgresImport ||
      !options.isolatedStagingDeployment ||
      options.isolatedStagingDeployment === CURRENT_DEVELOPMENT_DEPLOYMENT ||
      options.isolatedStagingDeployment === "clear-gopher-925" ||
      options.isolatedStagingDeployment === "prod")
  ) {
    throw new Error("Real-data imports require a confirmed read-only PostgreSQL source and isolated staging destination.");
  }
  if (
    options.mode === "verify" &&
    (!destination || (source.kind !== "synthetic" && source.kind !== "postgres"))
  ) {
    throw new Error("Verification mode requires an isolated destination and a synthetic or PostgreSQL source.");
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
        sourceCounts: Object.fromEntries(
          migrationTables.map(({ source: table }) => [table, snapshot[table].length]),
        ) as Record<SourceTable, number>,
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

    // An empty staging destination needs no relationship lookups during dry-run.
    // Validate transformed source keys and inspect every destination table first.
    if (options.mode === "dry-run") {
      const destinationKeyPages = await Promise.all(
        migrationTables.map(async ({ source: table }) => ({
          table,
          keys: await destination.listKeys(table),
        })),
      );

      const populated = destinationKeyPages.filter(({ keys }) => keys.length > 0);
      if (populated.length > 0) {
        throw new Error(
          `Safe empty-destination dry-run refused: existing staging keys found: ${
            populated.map(({ table, keys }) => `${table}=${keys.length}`).join(", ")
          }.`,
        );
      }

      const tables = Object.fromEntries(
        migrationTables.map(({ source: table }) => {
          const transformedKeys = snapshot[table].map(
            (value) => transformPostgresMigrationRecord(table, value).key,
          );

          if (new Set(transformedKeys).size !== transformedKeys.length) {
            throw new Error(`Transformed source contains duplicate keys for ${table}.`);
          }

          return [table, {
            sourceCount: snapshot[table].length,
            inserted: 0,
            plannedInsert: snapshot[table].length,
            alreadyPresent: 0,
            verified: 0,
          }];
        }),
      ) as MigrationRunResult;

      if (await source.sourceFingerprint() !== fingerprint) {
        throw new Error("Migration source changed during dry-run.");
      }

      return {
        mode: options.mode,
        sourceFingerprint: fingerprint,
        issues,
        tables,
        rollback: "PostgreSQL remains authoritative; no automatic delete or route switch.",
      };
    }

    // Raise each counter-backed table's floor before any write, so an ID handed
    // out while the import is running can never collide with a legacy ID that is
    // still being streamed in.
    if (options.mode === "postgres-import") {
      if (!destination.reserveIdCounterFloor) {
        throw new Error("Real-data destination cannot reserve ID counters.");
      }
      for (const { source: table } of migrationTables) {
        if (!counterBackedTables.has(table)) continue;
        let maxLegacyId = 0;
        for (const value of snapshot[table]) {
          const transformed = transformPostgresMigrationRecord(table, value).value as
            | Record<string, unknown>
            | undefined;
          const id = transformed?.legacyId;
          if (typeof id === "number" && Number.isSafeInteger(id) && id > maxLegacyId) {
            maxLegacyId = id;
          }
        }
        await destination.reserveIdCounterFloor(table, maxLegacyId + 1);
      }
    }

    const tables = await runBatchedMigration(composeAdapter(source, destination), {
      batchSize: options.batchSize,
      maxRetries: options.maxRetries,
      dryRun: options.mode === "verify",
    });
    if (
      options.mode === "verify" &&
      migrationTables.some(({ source: table }) => tables[table].plannedInsert > 0)
    ) {
      throw new Error("Destination verification found source records missing from Convex.");
    }
    if (options.mode === "postgres-import") {
      if (!destination.listMissingKeys) {
        throw new Error("Real-data destination cannot verify destination keys.");
      }
      for (const { source: table } of migrationTables) {
        const expected = snapshot[table]
          .map((value) => transformPostgresMigrationRecord(table, value).key)
          .sort();
        const actual = (await destination.listKeys(table)).sort();
        if (
          expected.length !== actual.length ||
          expected.some((key, index) => key !== actual[index])
        ) {
          throw new Error(`Destination key verification failed for table ${table}.`);
        }
        const missing = await destination.listMissingKeys(table, expected);
        if (missing.length > 0) {
          throw new Error(`Destination is missing ${missing.length} expected key(s) for table ${table}.`);
        }
      }
      if (await source.sourceFingerprint() !== fingerprint) {
        throw new Error("Migration source changed during reconciliation.");
      }
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
