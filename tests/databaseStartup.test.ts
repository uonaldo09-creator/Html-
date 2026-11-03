import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseService, dbService } from "../db/dbService";
import { MonitoringService } from "../server/monitoring";
import { buildPostgresConnectionOptions } from "../db/postgresConnectionOptions";

type DatabaseServiceInternals = {
  initialize: () => Promise<void>;
  tryConnect: () => Promise<{ success: boolean; fatal: boolean }>;
  isPostgres: boolean;
  drizzleDb: unknown;
};

function createDatabaseServiceForInitializationTest(): {
  service: DatabaseService;
  internals: DatabaseServiceInternals;
} {
  const service = Object.create(DatabaseService.prototype) as DatabaseService;
  const internals = service as unknown as DatabaseServiceInternals;
  internals.isPostgres = false;
  internals.drizzleDb = null;
  return { service, internals };
}



describe("PostgreSQL connection TLS policy", () => {
  it("forces certificate verification for remote URLs even when sslmode=require is supplied", () => {
    const options = buildPostgresConnectionOptions(
      "postgresql://user:pass@example.supabase.co:5432/postgres?sslmode=require",
    );

    expect(options.ssl?.rejectUnauthorized).toBe(true);
    expect(options.connectionString).not.toContain("sslmode=");
    expect(options.connectionString).not.toContain("sslrootcert=");
  });

  it("rejects remote database URLs that explicitly disable SSL", () => {
    expect(() => buildPostgresConnectionOptions(
      "postgresql://user:pass@example.supabase.co:5432/postgres?sslmode=disable",
    )).toThrow(/must not disable SSL certificate verification/);
  });

  it("preserves unencrypted loopback behavior for isolated local PostgreSQL", () => {
    const options = buildPostgresConnectionOptions(
      "postgresql://user:pass@127.0.0.1:55432/uniinfo_test?sslmode=disable",
    );

    expect(options.ssl).toBeUndefined();
    expect(options.connectionString).not.toContain("sslmode=");
  });
});

describe("database startup and health", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("rejects production startup when PostgreSQL initialization fails", async () => {
    process.env.NODE_ENV = "production";
    const { internals } = createDatabaseServiceForInitializationTest();
    internals.tryConnect = vi.fn().mockResolvedValue({ success: false, fatal: true });

    await expect(internals.initialize()).rejects.toThrow(
      "PostgreSQL is unavailable in production; refusing to start with in-memory storage.",
    );
    expect(internals.isPostgres).toBe(false);
  });

  it("preserves non-production in-memory fallback when PostgreSQL is unavailable", async () => {
    process.env.NODE_ENV = "development";
    const { internals } = createDatabaseServiceForInitializationTest();
    internals.tryConnect = vi.fn().mockResolvedValue({ success: false, fatal: true });

    await expect(internals.initialize()).resolves.toBeUndefined();
    expect(internals.isPostgres).toBe(false);
  });

  it("reports an unavailable database as degraded for health checks", async () => {
    vi.spyOn(dbService, "isUsingPostgres").mockReturnValue(false);

    const health = await MonitoringService.getHealthDiagnostics();

    expect(health.status).toBe("degraded");
    expect(health.engine).toBe("in-memory");
    expect(health.components.database.status).toBe("unhealthy");
  });
});
