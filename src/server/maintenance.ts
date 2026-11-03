import fs from "fs";
import path from "path";
import { dbService } from "../db/dbService";
import { logger } from "./logger";
import { BackupService } from "./backup";
import { backgroundQueue } from "./queue";
import { pruneExpiredCacheEntries, enforceLocalCacheEviction, getLocalCacheSize } from "./redis";

export interface MaintenanceMetrics {
  lastRun: string | null;
  durationMs: number | null;
  expiredSessionsRemoved: number;
  expiredTokensRemoved: number;
  notificationsRemoved: number;
  cacheEntriesRemoved: number;
  temporaryFilesRemoved: number;
  failureCount: number;
  dbHealth: string;
  queueHealth: string;
}

class MaintenanceService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Metrics
  private metrics: MaintenanceMetrics = {
    lastRun: null,
    durationMs: null,
    expiredSessionsRemoved: 0,
    expiredTokensRemoved: 0,
    notificationsRemoved: 0,
    cacheEntriesRemoved: 0,
    temporaryFilesRemoved: 0,
    failureCount: 0,
    dbHealth: "healthy",
    queueHealth: "healthy",
  };

  /**
   * Start the centralized Maintenance Service scheduler
   */
  public start() {
    if (this.schedulerInterval) {
      logger.warn("Centralized Maintenance Service is already running.");
      return;
    }

    const intervalMinutes = parseInt(process.env.MAINTENANCE_INTERVAL_MINUTES || "15", 10);
    logger.info({ intervalMinutes }, "Initializing Centralized Maintenance Service...");

    // Run once initially in background to clean up startup state
    this.runMaintenance().catch((err) => {
      logger.error({ error: err.message }, "Initial maintenance run failed.");
    });

    // Schedule check
    this.schedulerInterval = setInterval(async () => {
      try {
        await this.runMaintenance();
      } catch (err: any) {
        logger.error({ error: err.message }, "Error during scheduled maintenance run.");
      }
    }, intervalMinutes * 60 * 1000);

    if (this.schedulerInterval && typeof this.schedulerInterval.unref === "function") {
      this.schedulerInterval.unref();
    }
  }

  /**
   * Stop the centralized Maintenance Service scheduler
   */
  public async stop() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      logger.info("Centralized Maintenance Service scheduler stopped.");
    }

    // If currently running, wait for it to complete
    if (this.isRunning) {
      logger.info("Maintenance is currently running, waiting for completion before stopping...");
      while (this.isRunning) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Get current maintenance metrics
   */
  public getMetrics(): MaintenanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Run the full maintenance cycle
   */
  public async runMaintenance(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Maintenance cycle is already in progress. Skipping execution.");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    logger.info("Starting Centralized Maintenance cycle...");

    // Read configuration from env
    const sessionRetentionHours = parseInt(process.env.SESSION_RETENTION_HOURS || "24", 10);
    const notificationRetentionDays = parseInt(process.env.NOTIFICATION_RETENTION_DAYS || "90", 10);
    const cacheMaxItems = parseInt(process.env.CACHE_MAX_ITEMS || "1000", 10);
    const tempFileRetentionDays = parseInt(process.env.TEMP_FILE_RETENTION_DAYS || "7", 10);

    let sessionsCleaned = 0;
    let tokensCleaned = 0;
    let loginAttemptsCleaned = 0;
    let notificationsCleaned = 0;
    let cachePruned = 0;
    let tempFilesCleaned = 0;
    let hadFailures = false;

    // 1. Session Cleanup
    try {
      sessionsCleaned = await dbService.cleanupExpiredSessions();
      logger.info({ sessionsCleaned }, "Maintenance: Expired sessions cleaned up.");
    } catch (err: any) {
      hadFailures = true;
      logger.error({ error: err.message }, "Maintenance task failed: cleanupExpiredSessions");
    }

    // 2. Token Cleanup
    try {
      tokensCleaned = await dbService.cleanupExpiredTokens();
      logger.info({ tokensCleaned }, "Maintenance: Expired verification tokens cleaned up.");
    } catch (err: any) {
      hadFailures = true;
      logger.error({ error: err.message }, "Maintenance task failed: cleanupExpiredTokens");
    }

    // 3. Login Attempt Cleanup
    try {
      loginAttemptsCleaned = await dbService.cleanupExpiredLoginAttempts(sessionRetentionHours);
      logger.info({ loginAttemptsCleaned }, "Maintenance: Expired login attempts cleaned up.");
    } catch (err: any) {
      hadFailures = true;
      logger.error({ error: err.message }, "Maintenance task failed: cleanupExpiredLoginAttempts");
    }

    // 4. Notification Cleanup
    try {
      notificationsCleaned = await dbService.cleanupExpiredNotifications(notificationRetentionDays);
      logger.info({ notificationsCleaned }, "Maintenance: Expired notifications cleaned up.");
    } catch (err: any) {
      hadFailures = true;
      logger.error({ error: err.message }, "Maintenance task failed: cleanupExpiredNotifications");
    }

    // 5. Cache Maintenance
    try {
      const expiredCacheRemoved = pruneExpiredCacheEntries();
      const evictedCacheRemoved = enforceLocalCacheEviction(cacheMaxItems);
      cachePruned = expiredCacheRemoved + evictedCacheRemoved;
      logger.info({ cachePruned, currentCacheSize: getLocalCacheSize() }, "Maintenance: Cache pruned and evicted.");
    } catch (err: any) {
      hadFailures = true;
      logger.error({ error: err.message }, "Maintenance task failed: Cache pruning");
    }

    // 6. Temporary File Cleanup
    try {
      tempFilesCleaned = this.cleanupTempFiles(tempFileRetentionDays);
      logger.info({ tempFilesCleaned }, "Maintenance: Temporary files cleaned up.");
    } catch (err: any) {
      hadFailures = true;
      logger.error({ error: err.message }, "Maintenance task failed: cleanupTempFiles");
    }

    // 7. Schedulers & Backup retention checks
    try {
      BackupService.enforceRetention();
    } catch (err: any) {
      logger.error({ error: err.message }, "Maintenance check failed: BackupService.enforceRetention");
    }

    // 8. DB & Queue Health status collection
    let dbHealthStatus = "healthy";
    try {
      const dbStatus = dbService.getPoolDiagnostics();
      if (dbStatus.status !== "online" && dbStatus.status !== "in-memory-active") {
        dbHealthStatus = "unhealthy";
      }
    } catch (err: any) {
      dbHealthStatus = "unhealthy";
    }

    let queueHealthStatus = "healthy";
    try {
      const queueStatus = backgroundQueue.getQueueStatus();
      if (queueStatus.enabled && !queueStatus.workerActive) {
        queueHealthStatus = "degraded";
      }
    } catch (err: any) {
      queueHealthStatus = "unhealthy";
    }

    const duration = Date.now() - startTime;
    logger.info({ durationMs: duration, hadFailures }, "Centralized Maintenance cycle completed.");

    // Update metrics
    this.metrics = {
      lastRun: new Date().toISOString(),
      durationMs: duration,
      expiredSessionsRemoved: this.metrics.expiredSessionsRemoved + sessionsCleaned,
      expiredTokensRemoved: this.metrics.expiredTokensRemoved + tokensCleaned,
      notificationsRemoved: this.metrics.notificationsRemoved + notificationsCleaned,
      cacheEntriesRemoved: this.metrics.cacheEntriesRemoved + cachePruned,
      temporaryFilesRemoved: this.metrics.temporaryFilesRemoved + tempFilesCleaned,
      failureCount: this.metrics.failureCount + (hadFailures ? 1 : 0),
      dbHealth: dbHealthStatus,
      queueHealth: queueHealthStatus,
    };

    this.isRunning = false;
  }

  /**
   * Helper to clean up temporary files (e.g., pre-restore safety backups, scheduler_init backups, etc.) older than retention.
   */
  private cleanupTempFiles(retentionDays: number): number {
    const BACKUP_DIR = path.join(process.cwd(), "backups");
    if (!fs.existsSync(BACKUP_DIR)) {
      return 0;
    }

    let deletedCount = 0;
    try {
      const files = fs.readdirSync(BACKUP_DIR);
      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        // We only prune temp files like safety backups, scheduler_init backups, or hourly_check backups.
        // Standard daily backups are preserved up to BackupService retention (7 days).
        const isTempFile = file.includes("pre_restore_safety") ||
                           file.includes("scheduler_init") ||
                           file.includes("hourly_check") ||
                           file.endsWith(".tmp") ||
                           file.endsWith(".temp");

        if (isTempFile) {
          const filePath = path.join(BACKUP_DIR, file);
          const stats = fs.statSync(filePath);
          const ageMs = now - stats.mtimeMs;

          if (ageMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
            logger.info({ filename: file }, "Pruned stale temporary backup file.");
          }
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "Error during cleanupTempFiles");
    }

    return deletedCount;
  }
}

export const maintenanceService = new MaintenanceService();
