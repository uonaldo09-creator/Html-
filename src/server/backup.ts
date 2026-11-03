import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { dbService } from "../db/dbService";
import { decryptBackup, encryptBackup } from "./backupEncryption";
import { createPostgresBackupEnvelope, parsePostgresBackupEnvelope } from "./backupFormat";

const RETENTION_DAYS = 7;
const BACKUP_FILENAME = /^db_backup_[A-Za-z0-9._-]+\.json(?:\.enc)?$/;

export class BackupService {
  public static getBackupDirectory(): string {
    const directory = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups"));
    const publicDirectory = path.resolve(process.cwd(), "public");
    const relativeToPublic = path.relative(publicDirectory, directory);
    if (relativeToPublic === "" || (!relativeToPublic.startsWith(`..${path.sep}`) && relativeToPublic !== ".." && !path.isAbsolute(relativeToPublic))) {
      throw new Error("Backup storage must be outside the public directory.");
    }
    return directory;
  }

  private static ensureBackupDir() {
    fs.mkdirSync(this.getBackupDirectory(), { recursive: true });
  }

  private static getBackupPath(filename: string): string | null {
    if (!BACKUP_FILENAME.test(filename) || path.basename(filename) !== filename) return null;
    return path.join(this.getBackupDirectory(), filename);
  }

  /**
   * Run a full backup of the DB by exporting Postgres data.
   */
  public static async createBackup(reason = "automatic"): Promise<string> {
    try {
      this.ensureBackupDir();

      if (!dbService.isUsingPostgres()) {
        throw new Error("PostgreSQL database is offline; a complete backup cannot be created.");
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeReason = reason.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "automatic";
      const backupFilename = `db_backup_${timestamp}_${safeReason}.json.enc`;
      const backupPath = path.join(this.getBackupDirectory(), backupFilename);

      logger.info("Exporting PostgreSQL data for database backup...");
      const exportData = await dbService.exportPostgresData();
      const envelope = createPostgresBackupEnvelope(exportData);

      fs.writeFileSync(backupPath, encryptBackup(JSON.stringify(envelope)), { encoding: "utf-8", flag: "wx" });
      logger.info({ backupFilename, reason }, "PostgreSQL export backup created successfully.");

      // Run cleanup after creating a backup
      this.enforceRetention();

      return backupFilename;
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "Database backup failed.",
      );
      throw error;
    }
  }

  /**
   * List all available backups, sorted from newest to oldest.
   */
  public static listBackups() {
    try {
      this.ensureBackupDir();
      const backupDirectory = this.getBackupDirectory();
      const files = fs.readdirSync(backupDirectory);

      return files
        .filter((filename) => BACKUP_FILENAME.test(filename))
        .filter((filename) => fs.lstatSync(path.join(backupDirectory, filename)).isFile())
        .map(file => {
          const stats = fs.lstatSync(path.join(backupDirectory, file));
          return {
            filename: file,
            createdAt: stats.mtime,
            sizeBytes: stats.size,
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to list backups.");
      return [];
    }
  }

  /**
   * Restore the database from a given backup filename.
   */
  public static async restoreBackup(filename: string): Promise<boolean> {
    this.ensureBackupDir();
    const backupPath = this.getBackupPath(filename);

    if (!backupPath || !fs.existsSync(backupPath) || !fs.lstatSync(backupPath).isFile()) {
      throw new Error("Specified backup file does not exist.");
    }

    logger.info({ filename }, "Restoring database from backup file...");
    const raw = fs.readFileSync(backupPath, "utf-8");
    const isEncrypted = filename.endsWith(".json.enc");
    if (!isEncrypted && (process.env.NODE_ENV === "production" || process.env.ALLOW_LEGACY_UNENCRYPTED_BACKUPS !== "true")) {
      throw new Error("Plaintext backup restore is disabled.");
    }
    const envelope = parsePostgresBackupEnvelope(isEncrypted ? decryptBackup(raw) : raw);
    logger.info("Creating a pre-restore safety backup...");
    await this.createBackup("pre_restore_safety");
    await dbService.importPostgresData(envelope.tables);
    logger.info({ filename, schemaVersion: envelope.schemaVersion }, "Database successfully restored from backup.");
    return true;
  }

  public static deleteBackup(filename: string): boolean {
    try {
      const backupPath = this.getBackupPath(filename);
      if (!backupPath || !fs.existsSync(backupPath) || !fs.lstatSync(backupPath).isFile()) return false;
      fs.unlinkSync(backupPath);
      return true;
    } catch (error: any) {
      logger.error({ error: error.message, filename }, "Failed to delete backup.");
      return false;
    }
  }

  /**
   * Delete backups older than RETENTION_DAYS.
   */
  public static enforceRetention() {
    try {
      this.ensureBackupDir();
      const backups = this.listBackups();
      const now = new Date();
      const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

      backups.forEach(backup => {
        const ageMs = now.getTime() - backup.createdAt.getTime();
        if (ageMs > retentionMs) {
          const filePath = path.join(this.getBackupDirectory(), backup.filename);
          fs.unlinkSync(filePath);
          logger.info({ filename: backup.filename }, "Pruned old backup file due to retention policy.");
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, "Error during backup retention cleanup.");
    }
  }

  private static schedulerInterval: NodeJS.Timeout | null = null;

  /**
   * Set up a background worker checking to run automated backups.
   */
  public static async startScheduler() {
    if (this.schedulerInterval) {
      logger.warn("Daily Backup Scheduler is already running.");
      return;
    }
    logger.info("Initializing Daily Backup Scheduler...");

    // Check if we need an initial backup (e.g., if no backups exist or if last backup is > 24 hours ago)
    const backups = this.listBackups();
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;

    let shouldBackupNow = false;
    if (backups.length === 0) {
      shouldBackupNow = true;
    } else {
      const newestBackup = backups[0];
      const ageMs = now.getTime() - newestBackup.createdAt.getTime();
      if (ageMs >= oneDayMs) {
        shouldBackupNow = true;
      }
    }

    if (shouldBackupNow) {
      logger.info("No recent backup found on scheduler start. Running background backup...");
      await this.createBackup("scheduler_init");
    }

    // Schedule check every hour to see if a backup needs to be created
    this.schedulerInterval = setInterval(async () => {
      try {
        const currentBackups = this.listBackups();
        const currentDate = new Date();
        if (currentBackups.length === 0) {
          await this.createBackup("hourly_check");
          return;
        }

        const latest = currentBackups[0];
        const age = currentDate.getTime() - latest.createdAt.getTime();
        if (age >= oneDayMs) {
          logger.info("Last backup is over 24 hours old. Running scheduled daily backup.");
          await this.createBackup("daily_scheduled");
        }
      } catch (err: any) {
        logger.error({ error: err.message }, "Error in daily backup scheduler check.");
      }
    }, 60 * 60 * 1000); // Hourly check

    if (this.schedulerInterval && typeof this.schedulerInterval.unref === "function") {
      this.schedulerInterval.unref();
    }
  }

  /**
   * Stop the background automated backup check.
   */
  public static stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      logger.info("Daily Backup Scheduler stopped.");
    }
  }
}
