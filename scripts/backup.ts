import dotenv from "dotenv";
dotenv.config();

import { BackupService } from "../src/server/backup";
import { dbService } from "../src/db/dbService";
import { logger } from "../src/server/logger";

async function runBackup() {
  logger.info("Initializing backup via CLI...");

  // Wait for the connection attempt to finish; a fixed sleep can race slow DB startup.
  await dbService.waitUntilReady();

  const backupFilename = await BackupService.createBackup("cli_manual");
  if (backupFilename) {
    logger.info({ backupPath: `${BackupService.getBackupDirectory()}/${backupFilename}` }, "Backup completed successfully.");
    process.exit(0);
  } else {
    logger.error("Backup failed. Check logs for details.");
    process.exit(1);
  }
}

runBackup().catch((err) => {
  console.error("Unhandled exception during backup run:", err);
  process.exit(1);
});
