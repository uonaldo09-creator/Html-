import { Request, Response } from "express";
import { dbService } from "../db/dbService";
import { maintenanceService } from "./maintenance";

export class MonitoringService {
  private static startTime = Date.now();

  /**
   * Run full health check diagnostics.
   * Leverages real PostgreSQL status checks.
   */
  public static async getHealthDiagnostics(db?: any) {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const memory = process.memoryUsage();

    // Check DB status
    let dbStatus = "healthy";
    let dbError = undefined;

    if (db || dbService.isUsingPostgres()) {
      dbStatus = "healthy";
    } else {
      dbStatus = "unhealthy";
      dbError = "PostgreSQL database is offline or not configured.";
    }

    // Check AI status
    const groqKey = process.env.GROQ_API_KEY;
    const groqConfigured = !!groqKey &&
      groqKey.trim() !== "" &&
      groqKey.trim() !== "undefined" &&
      groqKey.trim() !== "null" &&
      !groqKey.trim().startsWith("YOUR_") &&
      !groqKey.trim().startsWith("MY_") &&
      !groqKey.trim().includes("INSERT_") &&
      !groqKey.trim().includes("API_KEY_HERE");

    const aiProviderStatus = groqConfigured ? "available" : "unavailable";

    let uniCount = dbService.mockUniversities?.length ?? 0;
    let userCount: any = "managed";
    let sessionCount: any = "active";

    if (db) {
      uniCount = Array.isArray(db.universities) ? db.universities.length : 0;
      userCount = Array.isArray(db.users) ? db.users.length : 0;
      sessionCount = db.sessions ? Object.keys(db.sessions).length : 0;
    } else if (dbService.isUsingPostgres()) {
      try {
        const unis = await dbService.getUniversities({});
        uniCount = unis.length;
      } catch (err: any) {
        dbStatus = "unhealthy";
        dbError = `PostgreSQL query error: ${err.message}`;
        uniCount = dbService.mockUniversities?.length ?? 0;
      }
    } else {
      uniCount = dbService.mockUniversities?.length ?? 0;
      userCount = dbService.mockUsers?.length ?? 0;
      sessionCount = dbService.mockSessions?.length ?? 0;
    }

    const dbType = dbService.isUsingPostgres() ? "postgresql" : "in-memory";

    return {
      status: dbStatus === "unhealthy" ? "degraded" : "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      engine: dbType,
      components: {
        database: {
          status: dbStatus,
          error: dbError,
          recordCounts: {
            universities: uniCount,
            users: userCount,
            sessions: sessionCount,
          },
        },
        aiProviders: {
          status: aiProviderStatus,
          groqConfigured,
        },
        maintenance: maintenanceService.getMetrics(),
        system: {
          memoryHeapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
          memoryHeapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
          memoryRssMB: Math.round(memory.rss / 1024 / 1024),
          nodeVersion: process.version,
        },
      },
    };
  }

  /**
   * Express Handler for standard Prometheus Plain-Text metrics.
   */
  public static async handleMetrics(req: Request, res: Response, db?: any) {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const memory = process.memoryUsage();
    const maintenanceMetrics = maintenanceService.getMetrics();

    let uniCount = dbService.mockUniversities?.length ?? 0;
    let userCount = dbService.mockUsers?.length ?? 0;
    let sessionCount = dbService.mockSessions?.length ?? 0;

    if (db) {
      uniCount = Array.isArray(db.universities) ? db.universities.length : 0;
      userCount = Array.isArray(db.users) ? db.users.length : 0;
      sessionCount = db.sessions ? Object.keys(db.sessions).length : 0;
    } else if (dbService.isUsingPostgres()) {
      try {
        const unis = await dbService.getUniversities({});
        uniCount = unis.length;
      } catch {
        // Fallback to in-memory count if PostgreSQL query fails
        uniCount = dbService.mockUniversities?.length ?? 0;
      }
    } else {
      uniCount = dbService.mockUniversities?.length ?? 0;
      userCount = dbService.mockUsers?.length ?? 0;
      sessionCount = dbService.mockSessions?.length ?? 0;
    }

    const prometheusString = [
      `# HELP node_uptime_seconds Uptime of the node server in seconds`,
      `# TYPE node_uptime_seconds gauge`,
      `node_uptime_seconds ${uptimeSeconds}`,
      ``,
      `# HELP node_memory_rss_bytes Resident Set Size memory usage in bytes`,
      `# TYPE node_memory_rss_bytes gauge`,
      `node_memory_rss_bytes ${memory.rss}`,
      ``,
      `# HELP node_memory_heap_total_bytes Total allocated heap memory in bytes`,
      `# TYPE node_memory_heap_total_bytes gauge`,
      `node_memory_heap_total_bytes ${memory.heapTotal}`,
      ``,
      `# HELP node_memory_heap_used_bytes Used heap memory in bytes`,
      `# TYPE node_memory_heap_used_bytes gauge`,
      `node_memory_heap_used_bytes ${memory.heapUsed}`,
      ``,
      `# HELP db_universities_total Total number of universities in the database`,
      `# TYPE db_universities_total gauge`,
      `db_universities_total ${uniCount}`,
      ``,
      `# HELP db_users_total Total registered users`,
      `# TYPE db_users_total gauge`,
      `db_users_total ${userCount}`,
      ``,
      `# HELP db_active_sessions_total Total active login sessions`,
      `# TYPE db_active_sessions_total gauge`,
      `db_active_sessions_total ${sessionCount}`,
      ``,
      `# HELP maintenance_last_run_timestamp_ms Last maintenance run timestamp in milliseconds`,
      `# TYPE maintenance_last_run_timestamp_ms gauge`,
      `maintenance_last_run_timestamp_ms ${maintenanceMetrics.lastRun ? Date.parse(maintenanceMetrics.lastRun) : 0}`,
      ``,
      `# HELP maintenance_duration_ms Duration of the last maintenance run in milliseconds`,
      `# TYPE maintenance_duration_ms gauge`,
      `maintenance_duration_ms ${maintenanceMetrics.durationMs || 0}`,
      ``,
      `# HELP maintenance_expired_sessions_removed_total Total expired sessions removed since startup`,
      `# TYPE maintenance_expired_sessions_removed_total counter`,
      `maintenance_expired_sessions_removed_total ${maintenanceMetrics.expiredSessionsRemoved}`,
      ``,
      `# HELP maintenance_expired_tokens_removed_total Total expired tokens removed since startup`,
      `# TYPE maintenance_expired_tokens_removed_total counter`,
      `maintenance_expired_tokens_removed_total ${maintenanceMetrics.expiredTokensRemoved}`,
      ``,
      `# HELP maintenance_notifications_removed_total Total notifications removed since startup`,
      `# TYPE maintenance_notifications_removed_total counter`,
      `maintenance_notifications_removed_total ${maintenanceMetrics.notificationsRemoved}`,
      ``,
      `# HELP maintenance_cache_entries_removed_total Total cache entries removed since startup`,
      `# TYPE maintenance_cache_entries_removed_total counter`,
      `maintenance_cache_entries_removed_total ${maintenanceMetrics.cacheEntriesRemoved}`,
      ``,
      `# HELP maintenance_temporary_files_removed_total Total temporary files removed since startup`,
      `# TYPE maintenance_temporary_files_removed_total counter`,
      `maintenance_temporary_files_removed_total ${maintenanceMetrics.temporaryFilesRemoved}`,
      ``,
      `# HELP maintenance_failures_total Total maintenance run failures since startup`,
      `# TYPE maintenance_failures_total counter`,
      `maintenance_failures_total ${maintenanceMetrics.failureCount}`,
    ].join("\n");

    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send(prometheusString);
  }
}
