import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { migrationTables } from "../src/server/convexMigration";
import {
  ConvexInternalHttpTransport,
  ConvexMigrationDestination,
} from "../src/server/convexMigrationDestination";

async function main() {
  config({ path: ".env", quiet: true });

  const tempDir = process.env.TEMP;
  if (!tempDir) throw new Error("Temporary directory is unavailable.");

  const keyFile = join(tempDir, "uniinfo-migration-rehearsal.env");
  if (!existsSync(keyFile)) throw new Error("Rehearsal key file not found.");

  const loaded = config({ path: keyFile, override: true, quiet: true });
  if (loaded.error || !process.env.CONVEX_DEPLOY_KEY) {
    throw new Error("Could not load rehearsal credentials.");
  }

  const transport = ConvexInternalHttpTransport.create({
    url: "https://groovy-zebra-380.ap-southeast-2.convex.cloud",
    deploymentName: "groovy-zebra-380",
    adminKey: process.env.CONVEX_DEPLOY_KEY,
    isolatedSyntheticConfirmed: true,
  });

  const destination = new ConvexMigrationDestination(
    transport,
    "groovy-zebra-380",
  );

  const results = [];

  for (const { source: table } of migrationTables) {
    const keys = await destination.listKeys(table);
    const checkpoint = await destination.loadCheckpoint(table);

    results.push({
      table,
      destinationRecordCount: keys.length,
      checkpointPresent: checkpoint !== null,
      checkpointDone: checkpoint?.done ?? false,
      sourceCount: checkpoint?.sourceCount ?? null,
      inserted: checkpoint?.inserted ?? null,
      verified: checkpoint?.verified ?? null,
    });
  }

  console.log(JSON.stringify({
    target: "groovy-zebra-380",
    mode: "read-only inspection",
    tables: results,
    totalDestinationRecords: results.reduce(
      (sum, row) => sum + row.destinationRecordCount, 0,
    ),
    completedCheckpoints: results.filter(
      row => row.checkpointDone,
    ).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(
    "Inspection failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});