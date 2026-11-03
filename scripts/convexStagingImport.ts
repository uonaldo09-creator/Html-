import assert from "node:assert/strict";
import { Client } from "pg";
import { migrationTables, type SourceTable } from "../src/server/convexMigration";
import { PostgresMigrationSource } from "../src/server/postgresMigrationSource";
import {
  ConvexInternalHttpTransport,
  ConvexMigrationDestination,
  type MigrationDestination,
} from "../src/server/convexMigrationDestination";
import {
  runConvexMigration,
  type MigrationExecutionOptions,
  type MigrationMode,
} from "../src/server/convexMigrationOrchestrator";

/**
 * Real-data import runner: reads the confirmed read-only PostgreSQL source
 * (`KING_DATABASE_URL`) and writes only to the isolated Convex staging
 * deployment identified by `CONVEX_STAGING_URL` + `CONVEX_STAGING_DEPLOY_KEY`.
 *
 * No credentials are ever printed. The source transaction is read-only and
 * repeatable-read; the destination is never the synthetic, development, or
 * production deployment.
 */

type RunnerMode = "preflight" | "dry-run" | "import" | "verify";

const CONFIRMATION = "IMPORT_KING_INTO_ISOLATED_CONVEX_STAGING";
const PROTECTED_DEPLOYMENTS = new Set([
  "prod",
  "graceful-kangaroo-272",
  "clear-gopher-925",
]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Environment variable ${name} is required.`);
  return value;
}

function redact(value: string): string {
  return value.replace(/\/\/[^@/]+@/, "//[redacted]@");
}

function parseStagingTarget(): { deploymentName: string; url: string } {
  const raw = requiredEnv("CONVEX_STAGING_URL");
  const parsed = new URL(raw);
  const hostname = parsed.hostname.split(".");
  const deploymentName = hostname[0] ?? "";
  const matchesDeployment =
    (hostname.length === 3 &&
      hostname[1] === "convex" &&
      hostname[2] === "cloud") ||
    (hostname.length === 4 &&
      /^[a-z]{2,}(?:-[a-z0-9]+)+$/.test(hostname[1] ?? "") &&
      hostname[2] === "convex" &&
      hostname[3] === "cloud");
  if (
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !matchesDeployment ||
    !deploymentName ||
    PROTECTED_DEPLOYMENTS.has(deploymentName)
  ) {
    throw new Error("CONVEX_STAGING_URL is not an isolated, positively identified staging deployment.");
  }
  return { deploymentName, url: parsed.origin };
}

function parseMode(): RunnerMode {
  const mode = (process.env.MIGRATION_MODE ?? "preflight").trim() as RunnerMode;
  if (!["preflight", "dry-run", "import", "verify"].includes(mode)) {
    throw new Error("MIGRATION_MODE must be one of: preflight, dry-run, import, verify.");
  }
  return mode;
}

function modeToExecutionMode(mode: RunnerMode): MigrationMode {
  return mode === "preflight" ? "validate-only" : mode === "import" ? "postgres-import" : mode;
}

function summarizeIssues(
  issues: Awaited<ReturnType<typeof runConvexMigration>>["issues"],
) {
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
    if (existing) existing.count += 1;
    else grouped.set(key, { severity: issue.severity, table: issue.table, code: issue.code, field, count: 1 });
  }
  return [...grouped.values()];
}

async function main(): Promise<void> {
  const mode = parseMode();
  const sourceUrl = requiredEnv("KING_DATABASE_URL");
  const { deploymentName, url: targetUrl } = parseStagingTarget();
  const deployKey = requiredEnv("CONVEX_STAGING_DEPLOY_KEY");

  if (mode === "import" && process.env.ALLOW_STAGING_IMPORT !== CONFIRMATION) {
    throw new Error(`Real-data import requires ALLOW_STAGING_IMPORT=${CONFIRMATION}.`);
  }
  if (process.env.CONVEX_MIGRATION_ENABLED !== "false") {
    throw new Error("Safety check failed: CONVEX_MIGRATION_ENABLED must remain false.");
  }

  const sourceKind = new URL(sourceUrl).protocol;
  if (sourceKind !== "postgresql:" && sourceKind !== "postgres:") {
    throw new Error("KING_DATABASE_URL must be a PostgreSQL connection string.");
  }

  const transport = ConvexInternalHttpTransport.create({
    url: targetUrl,
    deploymentName,
    adminKey: deployKey,
    isolatedStagingConfirmed: true,
  });
  const destination: MigrationDestination = new ConvexMigrationDestination(transport, deploymentName);

  const client = new Client({
    connectionString: sourceUrl,
    application_name: "uniinfo_king_to_convex_staging_readonly",
  });

  const options: MigrationExecutionOptions = {
    mode: modeToExecutionMode(mode),
    batchSize: 50,
    maxRetries: 3,
    // Unlinked guest chat and optional author links are expected in King; both
    // are preserved verbatim rather than repaired. Every other code blocks.
    approvedWarningCodes: [
      "unresolved_optional_relationship",
      "legacy_id_not_publicly_addressable",
    ],
    isolatedStagingDeployment: deploymentName,
    confirmPostgresImport: mode === "import",
  };

  let connected = false;
  try {
    await client.connect();
    connected = true;

    const source = Object.assign(new PostgresMigrationSource(client), { kind: "postgres" as const });
    const result = await runConvexMigration(source, destination, options);

    // Preflight is source-only: it validates and fingerprints King without
    // reading the destination. Every other mode reconciles against the
    // destination key set.
    const perTable: Array<{
      table: SourceTable;
      sourceCount: number;
      inserted: number;
      plannedInsert: number;
      alreadyPresent: number;
      verified: number;
      destinationKeys: number | null;
    }> = [];
    for (const { source: table } of migrationTables) {
      const row = result.tables?.[table];
      const destinationKeys =
        mode === "preflight" ? null : (await destination.listKeys(table)).length;
      perTable.push({
        table,
        sourceCount: row?.sourceCount ?? 0,
        inserted: row?.inserted ?? 0,
        plannedInsert: row?.plannedInsert ?? 0,
        alreadyPresent: row?.alreadyPresent ?? 0,
        verified: row?.verified ?? 0,
        destinationKeys,
      });
    }

    const totals = perTable.reduce(
      (accumulator, row) => ({
        sourceCount: accumulator.sourceCount + row.sourceCount,
        inserted: accumulator.inserted + row.inserted,
        plannedInsert: accumulator.plannedInsert + row.plannedInsert,
        alreadyPresent: accumulator.alreadyPresent + row.alreadyPresent,
        verified: accumulator.verified + row.verified,
        destinationKeys: accumulator.destinationKeys + (row.destinationKeys ?? 0),
      }),
      { sourceCount: 0, inserted: 0, plannedInsert: 0, alreadyPresent: 0, verified: 0, destinationKeys: 0 },
    );

    if (mode === "import") {
      for (const row of perTable) {
        assert.equal(
          row.sourceCount,
          row.verified,
          `Table ${row.table} did not verify every source record.`,
        );
      }
      if (totals.sourceCount !== totals.destinationKeys) {
        throw new Error("Final key-set reconciliation failed: source and destination totals differ.");
      }
    }

    console.log(JSON.stringify({
      status: result.issues.some((issue) => issue.severity === "error")
        ? "ERRORS_REMAIN"
        : mode === "import"
          ? "STAGING_IMPORT_AND_RECONCILIATION_PASS"
          : mode === "dry-run"
            ? "DRY_RUN_PLAN_COMPLETE"
            : mode === "verify"
              ? "VERIFY_COMPLETE"
              : "PREFLIGHT_PASS",
      mode,
      source: {
        // Never print the connection string or its credentials.
        identified: redact(sourceUrl).replace(/[?#].*$/, ""),
        readOnlyRepeatableRead: true,
        fingerprint: result.sourceFingerprint,
        totalRows: totals.sourceCount,
        tables: migrationTables.length,
      },
      destination: { deployment: deploymentName, url: targetUrl, writesPerformed: mode === "import" },
      tables: perTable,
      totals,
      validation: {
        errors: result.issues.filter((issue) => issue.severity === "error").length,
        warnings: result.issues.filter((issue) => issue.severity === "warning").length,
        grouped: summarizeIssues(result.issues),
      },
      safety: {
        sourceWritesAttempted: false,
        productionTargetUsed: false,
        syntheticTargetUsed: false,
      },
      rollback: result.rollback,
    }, null, 2));
  } finally {
    if (connected) await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  const safe = process.env.KING_DATABASE_URL
    ? message.split(process.env.KING_DATABASE_URL).join("[KING_DATABASE_URL redacted]")
    : message;
  console.error(`King -> Convex staging runner stopped: ${safe}`);
  console.error("If the import stage had started, do not rerun blindly. Inspect the isolated staging target first.");
  process.exitCode = 1;
});
