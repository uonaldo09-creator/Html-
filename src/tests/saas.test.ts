import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Import modules under test
import { logger } from "../server/logger";
import { BackupService } from "../server/backup";
import { MigrationManager, DbState } from "../server/migration";
import { AppError, errorHandler } from "../server/error";
import {
  AccountLockoutService,
  csrfProtection,
  getSessionToken,
  isDevEnvironment,
  resolveCorsOrigin,
} from "../server/security";
import { MonitoringService } from "../server/monitoring";

// Mock PBKDF2 Hashing helpers from server.ts for test isolation
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, hash] = storedHash.split(":");
  const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return hash === testHash;
}

// Full deep sanitization check to reject malformed parameters or scripts
function sanitizeValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 5000) {
      throw new AppError("Input payload text exceeds safe lengths limit.", 400, "BAD_REQUEST_SIZE");
    }
    let clean = value.replace(/<[^>]*>/gi, "");
    clean = clean.replace(/javascript\s*:/gi, "");
    clean = clean.replace(/on\w+\s*=/gi, "");
    return clean;
  } else if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new AppError("Input array exceeds safe collection bounds.", 400, "BAD_REQUEST_ARRAY_SIZE");
    }
    return value.map(item => sanitizeValue(item));
  } else if (typeof value === "object") {
    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.length > 120 || key.includes("__proto__") || key === "constructor" || key === "prototype") {
        throw new AppError("Inadmissible request parameter key.", 400, "BAD_REQUEST_PROTOTYPE_POLLUTION");
      }
      cleanObj[key] = sanitizeValue(val);
    }
    return cleanObj;
  }
  return value;
}

describe("1. Password Hashing & Validation Unit Tests", () => {
  it("should generate salt-separated hashes for a password", () => {
    const password = "StrongPassword123!";
    const hashed = hashPassword(password);
    expect(hashed).toContain(":");
    const parts = hashed.split(":");
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(32); // Hex representation of 16-bytes salt
  });

  it("should successfully verify valid passwords and reject invalid ones", () => {
    const password = "StrongPassword123!";
    const hashed = hashPassword(password);
    expect(verifyPassword(password, hashed)).toBe(true);
    expect(verifyPassword("WrongPassword!", hashed)).toBe(false);
  });
});

describe("2. Account Lockout Protection Unit Tests", () => {
  let mockUser: any;

  beforeEach(() => {
    mockUser = {
      email: "student@uniinfo.edu",
      loginFailures: 0,
      lockedUntil: 0,
    };
  });

  it("should not throw lockout error on initialization", () => {
    expect(() => AccountLockoutService.checkLockout(mockUser)).not.toThrow();
  });

  it("should lock account after 5 consecutive login failures", () => {
    // 4 consecutive failures
    for (let i = 0; i < 4; i++) {
      const isLocked = AccountLockoutService.handleFailure(mockUser);
      expect(isLocked).toBe(false);
      expect(mockUser.loginFailures).toBe(i + 1);
    }

    // 5th failure
    const isLockedOn5th = AccountLockoutService.handleFailure(mockUser);
    expect(isLockedOn5th).toBe(true);
    expect(mockUser.loginFailures).toBe(5);
    expect(mockUser.lockedUntil).toBeGreaterThan(Date.now());

    // checkLockout should now throw a 423 Account Locked error
    expect(() => AccountLockoutService.checkLockout(mockUser)).toThrowError(
      /Account is locked due to consecutive login failures/
    );
  });

  it("should reset login failures counter on successful authentication", () => {
    mockUser.loginFailures = 3;
    AccountLockoutService.handleSuccess(mockUser);
    expect(mockUser.loginFailures).toBe(0);
    expect(mockUser.lockedUntil).toBe(0);
  });
});

describe("3. Durable Backup Service Unit Tests", () => {
  const backupDir = path.join(process.cwd(), "backups");

  it("should list available backups and return array", () => {
    const backups = BackupService.listBackups();
    expect(Array.isArray(backups)).toBe(true);
  });

  it("should surface an error when trying to restore a non-existing file", async () => {
    await expect(BackupService.restoreBackup("non_existent_file.json")).rejects.toThrow();
  });
});

describe("4. Database Schema Migration Layer Unit Tests", () => {
  let mockDb: DbState;

  beforeEach(() => {
    mockDb = {
      universities: [{ id: 101, name: "Harvard University" }],
      users: [{ email: "alumni@uniinfo.com" }],
      sessions: {},
    };
  });

  it("should apply versioned migrations and update db.schemaVersion to 4", () => {
    expect(mockDb.schemaVersion).toBeUndefined();

    const migrated = MigrationManager.migrate(mockDb);
    expect(migrated).toBe(true);
    expect(mockDb.schemaVersion).toBe(4);

    // Verify User schema upgrades (bookmarks initialized)
    expect(mockDb.users[0].bookmarks).toEqual([]);
    expect(mockDb.users[0].loginFailures).toBe(0);
    expect(mockDb.users[0].lockedUntil).toBe(0);
    expect(mockDb.users[0].createdAt).toBeDefined();
    expect(mockDb.users[0].emailVerified).toBe(false);

    // Verify University upgrades (reviews array initialized)
    expect(mockDb.universities[0].reviews).toEqual([]);
    expect(mockDb.universities[0].rating).toBe(4.0);
  });

  it("should not apply migrations again if database schema is up-to-date", () => {
    mockDb.schemaVersion = 4;
    const migrated = MigrationManager.migrate(mockDb);
    expect(migrated).toBe(false);
  });
});

describe("5. Suspicious Payload Sanitization Unit Tests", () => {
  it("should recursively strip dangerous HTML and javascript tag blocks", () => {
    const dangerousInput = "<script>alert('hack')</script>Hello <img src='x' onerror='alert(1)'>World!";
    const clean = sanitizeValue(dangerousInput);
    expect(clean).toBe("alert('hack')Hello World!");
  });

  it("should clean javascript protocol prefixes in input parameters", () => {
    const dangerousInput = "javascript:void(0)";
    const clean = sanitizeValue(dangerousInput);
    expect(clean).toBe("void(0)");
  });

  it("should reject prototype pollution attempts", () => {
    const maliciousPayload = JSON.parse('{"__proto__": {"polluted": "true"}}');
    expect(() => sanitizeValue(maliciousPayload)).toThrowError(
      /Inadmissible request parameter key/
    );
  });

  it("should enforce text length limit restrictions", () => {
    const longString = "A".repeat(5001);
    expect(() => sanitizeValue(longString)).toThrowError(
      /Input payload text exceeds safe lengths limit/
    );
  });
});

describe("6. Standardized Error Handling Unit Tests", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {
      path: "/api/test",
      method: "POST",
      headers: {},
      query: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  it("should capture custom AppError attributes and send correlation ID in response", () => {
    const err = new AppError("Verification failure", 401, "UNAUTHORIZED_ACCESS");
    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Verification failure",
      status: "error",
      code: "UNAUTHORIZED_ACCESS",
      correlationId: "system",
    });
  });
});

describe("7. System Monitoring & Metrics Unit Tests", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      universities: [{ id: 1 }],
      users: [{ email: "test@gmail.com" }],
      sessions: { token123: {} },
    };
  });

  it("should generate full healthy healthcheck diagnostics info", async () => {
    const health = await MonitoringService.getHealthDiagnostics(mockDb);
    expect(health.status).toBe("ok");
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(health.components.database.recordCounts.universities).toBe(1);
    expect(health.components.database.recordCounts.users).toBe(1);
    expect(health.components.database.recordCounts.sessions).toBe(1);
    expect(health.components.aiProviders).toBeDefined();
  });

  it("should export Prometheus metrics structure", () => {
    const mockRes: any = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    MonitoringService.handleMetrics({} as any, mockRes, mockDb);

    expect(mockRes.set).toHaveBeenCalledWith("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    expect(mockRes.status).toHaveBeenCalledWith(200);

    const prometheusPayload = mockRes.send.mock.calls[0][0];
    expect(prometheusPayload).toContain("node_uptime_seconds");
    expect(prometheusPayload).toContain("db_universities_total 1");
    expect(prometheusPayload).toContain("db_users_total 1");
    expect(prometheusPayload).toContain("db_active_sessions_total 1");
  });
});

describe("8. Session Credential Extraction Unit Tests", () => {
  it("should read the HttpOnly session cookie used by cookie-only auth", () => {
    const token = getSessionToken({
      headers: { cookie: "csrf_token=abc123; session_token=deadbeef; theme=dark" },
    });
    expect(token).toBe("deadbeef");
  });

  it("should prefer an Authorization Bearer header over the cookie", () => {
    const token = getSessionToken({
      headers: { authorization: "Bearer header-token", cookie: "session_token=cookie-token" },
    });
    expect(token).toBe("header-token");
  });

  it("should return an empty string when no credential is present", () => {
    expect(getSessionToken({ headers: {} })).toBe("");
    expect(getSessionToken({ headers: { cookie: "csrf_token=abc123" } })).toBe("");
  });

  it("should not match look-alike cookie names", () => {
    const token = getSessionToken({
      headers: { cookie: "not_session_token=nope; session_token_user=nope2" },
    });
    expect(token).toBe("");
  });

  it("should fall back to the cookie when Authorization uses a non-Bearer scheme", () => {
    const token = getSessionToken({
      headers: { authorization: "Basic dXNlcjpwYXNz", cookie: "session_token=cookie-token" },
    });
    expect(token).toBe("cookie-token");
  });
});

describe("9. Development Gate Unit Tests", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("should treat production as production", () => {
    process.env.NODE_ENV = "production";
    expect(isDevEnvironment()).toBe(false);
  });

  it("should treat unset and development environments as development", () => {
    delete process.env.NODE_ENV;
    expect(isDevEnvironment()).toBe(true);
    process.env.NODE_ENV = "development";
    expect(isDevEnvironment()).toBe(true);
  });
});

describe("10. Credentialed CORS Origin Resolution Tests", () => {
  it("should reflect the request's own origin", () => {
    expect(resolveCorsOrigin("https://app.example.com", { host: "app.example.com" })).toBe(
      "https://app.example.com"
    );
  });

  it("should honour the proxy forwarded host", () => {
    expect(
      resolveCorsOrigin("https://app.example.com", { host: "127.0.0.1:3000", forwardedHost: "app.example.com" })
    ).toBe("https://app.example.com");
  });

  it("should reject a foreign origin instead of reflecting it", () => {
    expect(resolveCorsOrigin("https://evil.example", { host: "app.example.com" })).toBeNull();
  });

  it("should never return a wildcard, even for an opaque origin", () => {
    expect(resolveCorsOrigin(undefined, { host: "app.example.com" })).toBeNull();
    expect(resolveCorsOrigin("null", { host: "app.example.com" })).toBeNull();
  });

  it("should allow explicitly allow-listed origins, ignoring case and trailing slashes", () => {
    const allowlist = ["https://preview.example.com/"];
    expect(
      resolveCorsOrigin("https://preview.example.com", { host: "app.example.com", allowlist })
    ).toBe("https://preview.example.com");
    expect(
      resolveCorsOrigin("https://PREVIEW.example.com", { host: "app.example.com", allowlist })
    ).toBe("https://PREVIEW.example.com");
  });

  it("should only permit localhost origins when explicitly enabled", () => {
    expect(
      resolveCorsOrigin("http://localhost:5173", { host: "app.example.com", allowLocalhost: true })
    ).toBe("http://localhost:5173");
    expect(
      resolveCorsOrigin("http://localhost:5173", { host: "app.example.com", allowLocalhost: false })
    ).toBeNull();
  });
});
