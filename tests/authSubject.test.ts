import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requireStoredAuthSubject } from "../../convex/migration";
import { migrationTables, validateMigrationSnapshot, type MigrationSnapshot } from "../server/convexMigration";
import { transformPostgresMigrationRecord } from "../server/convexMigrationTransform";
import { DatabaseService } from "../db/dbService";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const journal = JSON.parse(
  readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: { idx: number; when: number; tag: string }[] };
const migrationSql = readFileSync(
  new URL("../../drizzle/0003_identity_subjects.sql", import.meta.url),
  "utf8",
);

/** A row shaped like the PostgreSQL source the migration actually reads. */
function pgUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1101,
    email: "student@example.test",
    password: "pbkdf2-hash",
    role: "Student",
    name: null,
    loginFailures: 0,
    lockedUntil: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    emailVerified: true,
    verificationToken: null,
    verificationExpires: null,
    authSubject: "11111111-1111-4111-8111-111111111101",
    tokenVersion: 0,
    disabled: false,
    ...overrides,
  };
}

function emptySnapshot(): Record<string, unknown[]> {
  return Object.fromEntries(migrationTables.map(({ source }) => [source, []]));
}

function inMemoryService(): DatabaseService {
  const service = Object.create(DatabaseService.prototype) as DatabaseService;
  Object.assign(service, { isPostgres: false, drizzleDb: null, mockSessions: [], mockUsers: [], mockBookmarks: [] });
  return service;
}

/** The subject Convex would look a presented token up by, built the way the migration writes it. */
function convexIndexBySubject(rows: Record<string, unknown>[]) {
  const index = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const record = transformPostgresMigrationRecord("users", row);
    const doc = record.value as Record<string, unknown>;
    index.set(String(doc.authSubject), doc);
  }
  return index;
}

describe("authoritative auth subject", () => {
  it("stores exactly the PostgreSQL subject in Convex for an existing user", () => {
    const existing = pgUser();
    const imported = transformPostgresMigrationRecord("users", existing).value as Record<string, unknown>;

    expect(imported.authSubject).toBe(existing.authSubject);
    // The Convex side copies the stored value; it must not derive one of its own.
    expect(requireStoredAuthSubject(imported.authSubject)).toBe(existing.authSubject);
    expect(imported.authSubject).not.toBe(`legacy:${existing.id}`);
    expect(imported.authSubject).not.toBe(existing.email);

    const other = pgUser({
      id: 1209,
      email: "parent@example.test",
      role: "Parent",
      authSubject: "11111111-1111-4111-8111-111111111209",
    });
    const otherImported = transformPostgresMigrationRecord("users", other).value as Record<string, unknown>;
    expect(otherImported.authSubject).toBe(other.authSubject);
    expect(otherImported.authSubject).not.toBe(imported.authSubject);
  });

  it("copies a persisted deterministic subject for a legacy account", () => {
    const legacy = pgUser({ authSubject: "uniinfo-user:1101" });
    const imported = transformPostgresMigrationRecord("users", legacy).value as Record<string, unknown>;

    expect(imported.authSubject).toBe("uniinfo-user:1101");
    expect(requireStoredAuthSubject(imported.authSubject)).toBe("uniinfo-user:1101");
  });
  it("generates and persists the subject exactly once for a newly registered user", async () => {
    const service = inMemoryService();
    const created = await service.createUser({ email: "new@example.test", password: "hash", role: "Student" });

    expect(created.authSubject).toMatch(UUID_V4);
    expect(created.tokenVersion).toBe(0);
    expect(created.disabled).toBe(false);

    // The persisted value is stable: it is never regenerated on later reads.
    const firstRead = await service.getUserByEmail("new@example.test");
    const secondRead = await service.getUserByEmail("new@example.test");
    expect(firstRead?.authSubject).toBe(created.authSubject);
    expect(secondRead?.authSubject).toBe(created.authSubject);

    const second = await service.createUser({ email: "second@example.test", password: "hash" });
    expect(second.authSubject).toMatch(UUID_V4);
    expect(second.authSubject).not.toBe(created.authSubject);

    await expect(service.createUser({ email: "new@example.test", password: "hash" })).rejects.toThrow(/already exists/);
  });

  it("increments the token version when an account role changes", async () => {
    const service = inMemoryService();
    const created = await service.createUser({ email: "role@example.test", password: "hash", role: "Student" });
    await service.updateUserRole(created.email, "Parent");

    const updated = await service.getUserByEmail(created.email);
    expect(updated?.role).toBe("Parent");
    expect(updated?.tokenVersion).toBe(1);
  });

  it("stops the migration when the source subject is missing, blank or email-shaped", () => {
    expect(() => transformPostgresMigrationRecord("users", pgUser({ authSubject: undefined })))
      .toThrow(/authSubject is missing/);
    expect(() => transformPostgresMigrationRecord("users", pgUser({ authSubject: "   " })))
      .toThrow(/authSubject is missing/);
    expect(() => transformPostgresMigrationRecord("users", pgUser({ authSubject: " Student@Example.test " })))
      .toThrow(/must not be the account email/);
    expect(() => requireStoredAuthSubject(undefined)).toThrow(/MIGRATION_MISSING_AUTH_SUBJECT/);
    expect(() => requireStoredAuthSubject("")).toThrow(/MIGRATION_MISSING_AUTH_SUBJECT/);
    expect(() => transformPostgresMigrationRecord("users", pgUser({ tokenVersion: -1 })))
      .toThrow(/tokenVersion must not be negative/);
  });

  it("rejects conflicting subject values before any record is written", () => {
    const shared = pgUser().authSubject;

    const conflicting = { ...emptySnapshot(), users: [pgUser(), pgUser({ id: 1209, email: "other@example.test" })] };
    expect(validateMigrationSnapshot(conflicting as MigrationSnapshot)).toContainEqual(
      expect.objectContaining({ table: "users", code: "duplicate_auth_subject", field: "authSubject" }),
    );

    const missing = { ...emptySnapshot(), users: [pgUser({ authSubject: null })] };
    expect(validateMigrationSnapshot(missing as MigrationSnapshot)).toContainEqual(
      expect.objectContaining({ table: "users", code: "missing_required_field", field: "authSubject" }),
    );

    const blank = { ...emptySnapshot(), users: [pgUser({ authSubject: "  " })] };
    expect(validateMigrationSnapshot(blank as MigrationSnapshot)).toContainEqual(
      expect.objectContaining({ table: "users", code: "invalid_auth_subject", field: "authSubject" }),
    );

    const invalidTokenVersion = { ...emptySnapshot(), users: [pgUser({ tokenVersion: -1 })] };
    expect(validateMigrationSnapshot(invalidTokenVersion as MigrationSnapshot)).toContainEqual(
      expect.objectContaining({ table: "users", code: "invalid_field_type", field: "tokenVersion" }),
    );

    const emailShaped = { ...emptySnapshot(), users: [pgUser({ authSubject: "student@example.test" })] };
    expect(validateMigrationSnapshot(emailShaped as MigrationSnapshot)).toContainEqual(
      expect.objectContaining({ table: "users", code: "subject_is_email", field: "authSubject" }),
    );

    // A clean snapshot of the same shape must stay clean.
    expect(validateMigrationSnapshot({ ...emptySnapshot(), users: [pgUser()] } as MigrationSnapshot)).toEqual([]);
    expect(shared).toBe("11111111-1111-4111-8111-111111111101");
  });

  it("resolves a token subject to its account and rejects a mismatched identity", () => {
    const rows = [
      pgUser(),
      pgUser({ id: 1209, email: "parent@example.test", role: "Parent", authSubject: "11111111-1111-4111-8111-111111111209" }),
    ];
    const index = convexIndexBySubject(rows);

    // What the server would place in the token resolves back to the same account.
    expect(index.get(rows[0].authSubject as string)?.email).toBe("student@example.test");
    expect(requireStoredAuthSubject(rows[0].authSubject)).toBe(rows[0].authSubject);

    // A subject belonging to someone else, or to nobody, must not resolve.
    expect(index.get(rows[1].authSubject as string)?.email).not.toBe("student@example.test");
    expect(index.get("not-a-known-subject")).toBeUndefined();
    expect(index.get(`legacy:${rows[0].id}`)).toBeUndefined();
  });

  it("keeps the identity migration additive, idempotent and registered in the journal", () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "auth_subject"');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "token_version"');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "disabled"');
    expect(migrationSql).toMatch(/UPDATE\s+"users"\s+SET\s+"auth_subject"\s*=\s*'uniinfo-user:'\s*\|\|\s*"id"::text\s+WHERE\s+"auth_subject"\s+IS\s+NULL/i);
    // Idempotent backfill: an existing subject is never regenerated on a re-run.
    expect(migrationSql).toContain('WHERE "auth_subject" IS NULL');
    // Additive only, so there is no data-destructive rollback path to run. Comments are
    // stripped first so the check runs against executable SQL rather than the prose above.
    expect(migrationSql.replace(/--[^\n]*/g, "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/i);
    // Recovery limitations are documented rather than automated away.
    expect(migrationSql).toMatch(/Rollback \/ recovery limitations/);

    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags).toContain("0003_identity_subjects");
    expect(new Set(tags).size).toBe(tags.length);
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, index) => index));
    const orderedByTime = [...journal.entries].sort((left, right) => left.when - right.when).map((entry) => entry.tag);
    expect(orderedByTime).toEqual(tags);
    expect(() => readFileSync(new URL("../../drizzle/0003_identity_subjects.sql", import.meta.url), "utf8")).not.toThrow();
  });
});
