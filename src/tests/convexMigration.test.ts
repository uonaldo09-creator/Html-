import { describe, expect, it } from "vitest";
import {
  assertMigrationPreflightClear,
  MigrationError,
  MigrationPreflightError,
  expectedSourceTables,
  migrationTables,
  runBatchedMigration,
  validateMigrationSnapshot,
  type MigrationAdapter,
  type MigrationBatch,
  type MigrationCheckpoint,
  type MigrationRecord,
  type MigrationSnapshot,
  type SourceTable,
} from "../server/convexMigration";
import { transformPostgresMigrationRecord } from "../server/convexMigrationTransform";
import { assertMigrationTableCoverage } from "../server/convexMigrationTransform";
import { runConvexMigration, type MigrationSource } from "../server/convexMigrationOrchestrator";
import { assertUniqueMigrationKeys, tableNames } from "../../convex/migration";

function emptySnapshot(): Record<SourceTable, unknown[]> {
  return Object.fromEntries(migrationTables.map(({ source }) => [source, []])) as Record<
    SourceTable,
    unknown[]
  >;
}

function validSnapshot(): Record<SourceTable, unknown[]> {
  return {
    ...emptySnapshot(),
    users: [{
      id: 1,
      email: "student@example.test",
      password: "pbkdf2-hash",
      role: "Student",
      loginFailures: 0,
      lockedUntil: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      emailVerified: true,
      authSubject: "synthetic-subject-1",
      tokenVersion: 0,
      disabled: false,
    }],
    universities: [{
      id: 10,
      name: "Synthetic University",
      location: "Test City",
      state: "TS",
      type: "Public",
      fee: 100,
      rating: 4,
      students: "1000",
      courses: 10,
      image: "synthetic.jpg",
      categories: [],
      stream: [],
      degrees: [],
      majors: [],
      popularCourses: [],
      phone: "0000000000",
      competitiveExams: [],
      min10th: 50,
      min12th: 50,
      naacGrade: "A",
      nirfRank: 1,
      aicteApproved: true,
      nbaAccredited: false,
      nmcRecognized: false,
      avgPlacementLPA: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }],
    reviews: [{
      id: 20,
      universityId: 10,
      userEmail: "student@example.test",
      userName: "Synthetic User",
      rating: 4,
      comment: "Synthetic review",
      reviewDate: "2026-01-01",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }],
    bookmarks: [{
      id: 30,
      userEmail: "student@example.test",
      universityId: 10,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }],
    sessions: [{
      token: "opaque-session-token",
      email: "student@example.test",
      expiresAt: Date.now() + 60_000,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
      absoluteExpiresAt: Date.now() + 120_000,
    }],
    studentProfiles: [{
      id: 40,
      userEmail: "student@example.test",
      hostelPreference: false,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }],
    notifications: [{
      id: 50,
      userEmail: "student@example.test",
      title: "Synthetic notification",
      message: "Test only",
      type: "announcement",
      read: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }],
    universityReviewsAgg: [{
      universityId: 10,
      reviewCount: 1,
      avgRating: 4,
    }],
    analyticsEvents: [{
      id: 60,
      eventType: "synthetic.view",
      details: null,
      userEmail: null,
      ipAddress: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }],
  };
}

class MemoryMigrationAdapter implements MigrationAdapter {
  readonly sourceRecords = new Map<SourceTable, MigrationRecord[]>();
  readonly destination = new Map<SourceTable, Map<string, unknown>>();
  readonly checkpoints = new Map<SourceTable, MigrationCheckpoint>();
  insertCalls = 0;
  failAfterFirstInsert = false;
  pretendInsertSucceeded = false;
  reportedCountOffset = 0;

  async sourceFingerprint() {
    return "synthetic-snapshot-v1";
  }

  async countSource(table: SourceTable) {
    return (this.sourceRecords.get(table) ?? []).length + this.reportedCountOffset;
  }

  async readBatch(
    table: SourceTable,
    cursor: string | null,
    limit: number,
  ): Promise<MigrationBatch> {
    const records = this.sourceRecords.get(table) ?? [];
    const start = cursor === null ? 0 : Number(cursor);
    const page = records.slice(start, start + limit);
    const next = start + page.length;
    return { records: page, nextCursor: next < records.length ? String(next) : null, done: next >= records.length };
  }

  async classify(table: SourceTable, records: readonly MigrationRecord[]) {
    const existing = this.destination.get(table) ?? new Map<string, unknown>();
    const identical: string[] = [];
    const missing: string[] = [];
    const conflicting: string[] = [];
    for (const record of records) {
      if (!existing.has(record.key)) missing.push(record.key);
      else if (JSON.stringify(existing.get(record.key)) === JSON.stringify(record.value)) identical.push(record.key);
      else conflicting.push(record.key);
    }
    return { identical, missing, conflicting };
  }

  async insertBatch(table: SourceTable, records: readonly MigrationRecord[]) {
    this.insertCalls += 1;
    const existing = this.destination.get(table) ?? new Map<string, unknown>();
    this.destination.set(table, existing);
    for (const [index, record] of records.entries()) {
      if (!this.pretendInsertSucceeded) existing.set(record.key, record.value);
      if (this.failAfterFirstInsert && index === 0) {
        this.failAfterFirstInsert = false;
        throw new Error("synthetic partial write");
      }
    }
  }

  async loadCheckpoint(table: SourceTable) {
    return this.checkpoints.get(table) ?? null;
  }

  async saveCheckpoint(table: SourceTable, checkpoint: MigrationCheckpoint) {
    this.checkpoints.set(table, checkpoint);
  }
}

describe("Convex migration preflight and batch runner", () => {
  it("requires and validates all thirteen source tables and their relationships", () => {
    expect(validateMigrationSnapshot(validSnapshot())).toEqual([]);
    expect(migrationTables.map(({ source }) => source).sort()).toEqual([...expectedSourceTables].sort());
    expect(tableNames.slice().sort()).toEqual([...expectedSourceTables].sort());
    expect(migrationTables).toHaveLength(13);
    expect(() => assertMigrationTableCoverage()).not.toThrow();

    const missingTable = validSnapshot();
    delete missingTable.auditLogs;
    expect(validateMigrationSnapshot(missingTable)).toContainEqual(
      expect.objectContaining({ table: "auditLogs", row: -1, code: "missing_table" }),
    );

    const snapshot = validSnapshot();
    snapshot.bookmarks = [{
      id: 30,
      userEmail: "missing@example.test",
      universityId: 999,
      createdAt: new Date(),
    }];
    const issues = validateMigrationSnapshot(snapshot);
    expect(issues.map(({ code, table }) => [code, table])).toEqual([
      ["missing_relationship", "bookmarks"],
      ["missing_relationship", "bookmarks"],
    ]);
    expect(JSON.stringify(issues)).not.toContain("missing@example.test");
    expect(() => assertMigrationPreflightClear(issues)).toThrow(MigrationPreflightError);
  });

  it("requires explicit approval for optional relationship warnings", () => {
    const snapshot = validSnapshot();
    snapshot.reviews = [{
      id: 20,
      universityId: 10,
      userEmail: "unlinked@example.test",
      userName: "Synthetic User",
      rating: 4,
      comment: "Synthetic review",
      reviewDate: "2026-01-01",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    const issues = validateMigrationSnapshot(snapshot);

    expect(issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        table: "reviews",
        code: "unresolved_optional_relationship",
      }),
    ]);
    expect(() => assertMigrationPreflightClear(issues)).toThrow(MigrationPreflightError);
    expect(() => assertMigrationPreflightClear(issues, ["unresolved_optional_relationship"])).not.toThrow();
  });

  it("does not warn for unlinked guest chat history", () => {
    const snapshot = validSnapshot();

    snapshot.chatHistory.push({
      id: 999,
      role: "user",
      content: "guest chat",
      createdAt: 1,
      userEmail: "guest@uniinfo.edu",
    });

    const issues = validateMigrationSnapshot(snapshot);

    expect(
      issues.some(
        (issue) =>
          issue.table === "chatHistory" &&
          issue.code === "unresolved_optional_relationship",
      ),
    ).toBe(false);
  });
  it("rejects duplicate source IDs and normalized email collisions", () => {
    const snapshot = validSnapshot();
    snapshot.users = [
      ...(snapshot.users as unknown[]),
      {
        id: 2,
        email: " STUDENT@example.test ",
        password: "another-hash",
        role: "Student",
        loginFailures: 0,
        lockedUntil: 0,
        createdAt: new Date(),
        emailVerified: true,
        authSubject: "synthetic-subject-2",
        tokenVersion: 0,
        disabled: false,
      },
    ];
    snapshot.universities = [...(snapshot.universities as unknown[]), ...(snapshot.universities as unknown[])];

    const issues = validateMigrationSnapshot(snapshot);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "users", code: "duplicate_logical_key", field: "email" }),
      expect.objectContaining({ table: "universities", code: "duplicate_key", field: "id" }),
    ]));
  });

  it("rejects duplicate session-token primary keys without exposing the token", () => {
    const snapshot = validSnapshot();
    snapshot.sessions = [
      ...(snapshot.sessions as Record<string, unknown>[]),
      { ...(snapshot.sessions as Record<string, unknown>[])[0] },
    ];

    const issues = validateMigrationSnapshot(snapshot);
    expect(issues).toContainEqual(expect.objectContaining({
      table: "sessions",
      code: "duplicate_key",
      field: "token",
    }));
    expect(JSON.stringify(issues)).not.toContain("opaque-session-token");
  });

  it("rejects every confirmed source unique key collision", () => {
    const snapshot = validSnapshot();
    snapshot.users = [
      ...(snapshot.users as Record<string, unknown>[]),
      { ...(snapshot.users as Record<string, unknown>[])[0], id: 2, email: " STUDENT@example.test ", authSubject: "synthetic-subject-2" },
      {
        id: 3,
        email: "parent@example.test",
        password: "pbkdf2-hash",
        role: "Parent",
        loginFailures: 0,
        lockedUntil: 0,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        emailVerified: true,
        authSubject: "synthetic-subject-3",
        tokenVersion: 0,
        disabled: false,
      },
    ];
    snapshot.bookmarks = [
      ...(snapshot.bookmarks as Record<string, unknown>[]),
      { ...(snapshot.bookmarks as Record<string, unknown>[])[0], id: 31 },
    ];
    snapshot.studentProfiles = [
      ...(snapshot.studentProfiles as Record<string, unknown>[]),
      { ...(snapshot.studentProfiles as Record<string, unknown>[])[0], id: 41 },
    ];
    snapshot.parentProfiles = [
      {
        id: 42,
        userEmail: "parent@example.test",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: 43,
        userEmail: " PARENT@example.test ",
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ];

    const issues = validateMigrationSnapshot(snapshot);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "users", code: "duplicate_logical_key", field: "email" }),
      expect.objectContaining({ table: "bookmarks", code: "duplicate_logical_key" }),
      expect.objectContaining({ table: "studentProfiles", code: "duplicate_logical_key", field: "userEmail" }),
      expect.objectContaining({ table: "parentProfiles", code: "duplicate_logical_key", field: "userEmail" }),
    ]));
  });

  it("rejects missing references for every confirmed foreign key", () => {
    const snapshot = validSnapshot();
    snapshot.bookmarks = [{
      id: 30,
      userEmail: "missing@example.test",
      universityId: 999,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    snapshot.studentProfiles = [{
      id: 40,
      userEmail: "missing@example.test",
      hostelPreference: false,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    snapshot.parentProfiles = [{
      id: 41,
      userEmail: "missing@example.test",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    snapshot.reviews = [{
      id: 20,
      universityId: 999,
      userEmail: "student@example.test",
      userName: "Synthetic User",
      rating: 4,
      comment: "Synthetic review",
      reviewDate: "2026-01-01",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    snapshot.universityReviewsAgg = [{ universityId: 999, reviewCount: 1 }];

    const relationships = validateMigrationSnapshot(snapshot)
      .filter(({ code }) => code === "missing_relationship");
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "bookmarks", field: "userEmail" }),
      expect.objectContaining({ table: "bookmarks", field: "universityId" }),
      expect.objectContaining({ table: "studentProfiles", field: "userEmail" }),
      expect.objectContaining({ table: "parentProfiles", field: "userEmail" }),
      expect.objectContaining({ table: "reviews", field: "universityId" }),
      expect.objectContaining({ table: "universityReviewsAgg", field: "universityId" }),
    ]));
    expect(relationships).toHaveLength(6);
  });

  it("keeps relationship parents ahead of children and verifies session and aggregate keys", () => {
    const ordered = migrationTables.map(({ source }) => source);
    expect(ordered.indexOf("universities")).toBeLessThan(ordered.indexOf("reviews"));
    expect(ordered.indexOf("universities")).toBeLessThan(ordered.indexOf("bookmarks"));
    expect(ordered.indexOf("universities")).toBeLessThan(ordered.indexOf("universityReviewsAgg"));
    expect(ordered.indexOf("users")).toBeLessThan(ordered.indexOf("sessions"));
    expect(ordered.indexOf("users")).toBeLessThan(ordered.indexOf("studentProfiles"));
    expect(ordered.indexOf("users")).toBeLessThan(ordered.indexOf("parentProfiles"));

    const session = transformPostgresMigrationRecord("sessions", {
      token: "synthetic-session-token",
      email: "student@example.test",
      expiresAt: 1_800_000_000_000,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-01-02T00:00:00.000Z"),
      absoluteExpiresAt: 1_900_000_000_000,
    });
    expect(session.key).toMatch(/^[a-f0-9]{64}$/);
    expect(session.value).not.toHaveProperty("token");
    expect(session.value).toHaveProperty("sessionTokenHash", session.key);

    expect(transformPostgresMigrationRecord("universityReviewsAgg", {
      universityId: 10,
      reviewCount: 2,
      avgRating: 4.5,
    })).toEqual({
      key: "10",
      value: { reviewCount: 2, avgRating: 4.5, legacyUniversityId: 10 },
    });
  });

  it("rejects JSONB arrays that do not match Convex string-array fields", () => {
    const snapshot = validSnapshot();
    (snapshot.universities as Record<string, unknown>[])[0]!.categories = ["Engineering", 1];

    expect(validateMigrationSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({
        table: "universities",
        code: "invalid_field_type",
        field: "categories",
      }),
    );
  });

  it("keeps analytics event legacy IDs, nullable JSON and PII fields, and UTC wall-time milliseconds", () => {
    const createdAt = "2026-10-13 19:34:56.123";
    const transformed = transformPostgresMigrationRecord("analyticsEvents", {
      id: 1_234,
      eventType: "synthetic.page_view",
      details: { page: "/synthetic" },
      userEmail: "synthetic@example.test",
      ipAddress: "192.0.2.20",
      createdAt,
    });
    expect(transformed).toEqual({
      key: "1234",
      value: {
        legacyId: 1_234,
        eventType: "synthetic.page_view",
        details: { page: "/synthetic" },
        userEmail: "synthetic@example.test",
        ipAddress: "192.0.2.20",
        createdAt: Date.parse("2026-10-13T19:34:56.123Z"),
      },
    });

    const nullable = transformPostgresMigrationRecord("analyticsEvents", {
      id: 0,
      eventType: "synthetic.nulls",
      details: null,
      userEmail: null,
      ipAddress: null,
      createdAt: new Date("2026-10-13T19:34:56.000Z"),
    });
    expect(nullable.value).toMatchObject({
      legacyId: 0,
      details: null,
      userEmail: null,
      ipAddress: null,
      createdAt: Date.parse("2026-10-13T19:34:56.000Z"),
    });
  });

  it("rejects missing nullable columns, malformed analytics values, and unsafe IDs", () => {
    const snapshot = validSnapshot();
    const row = (snapshot.analyticsEvents as Record<string, unknown>[])[0]!;
    delete row.details;
    expect(validateMigrationSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({
        table: "analyticsEvents",
        code: "missing_source_field",
        field: "details",
      }),
    );
    const missingRequired = validSnapshot();
    const event = (missingRequired.analyticsEvents as Record<string, unknown>[])[0]!;
    delete event.eventType;
    delete event.createdAt;
    expect(validateMigrationSnapshot(missingRequired)).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "analyticsEvents", code: "missing_required_field", field: "eventType" }),
      expect.objectContaining({ table: "analyticsEvents", code: "missing_required_field", field: "createdAt" }),
    ]));

    const valid = {
      id: 70,
      eventType: "synthetic.event",
      details: null,
      userEmail: null,
      ipAddress: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    for (const invalid of [
      { ...valid, id: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, id: 2_147_483_648 },
      { ...valid, id: 1.5 },
      { ...valid, eventType: 123 },
      { ...valid, details: { nested: Number.POSITIVE_INFINITY } },
      { ...valid, userEmail: 123 },
      { ...valid, ipAddress: false },
      { ...valid, createdAt: "not-a-timestamp" },
    ]) {
      expect(() => transformPostgresMigrationRecord("analyticsEvents", invalid)).toThrow();
    }
    for (const id of [Number.MAX_SAFE_INTEGER + 1, 2_147_483_648, 1.5]) {
      const invalidSnapshot = validSnapshot();
      (invalidSnapshot.analyticsEvents as Record<string, unknown>[])[0]!.id = id;
      expect(validateMigrationSnapshot(invalidSnapshot)).toContainEqual(
        expect.objectContaining({
          table: "analyticsEvents",
          code: "invalid_field_type",
          field: "id",
        }),
      );
    }

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => transformPostgresMigrationRecord("analyticsEvents", {
      ...valid,
      details: cyclic,
    })).toThrow(/details is invalid/);
  });

  it("rejects duplicate analytics event IDs during preflight and destination preparation", () => {
    const snapshot = validSnapshot();
    snapshot.analyticsEvents = [
      ...(snapshot.analyticsEvents as unknown[]),
      ...(snapshot.analyticsEvents as unknown[]),
    ];
    expect(validateMigrationSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ table: "analyticsEvents", code: "duplicate_key", field: "id" }),
    );
    expect(() => assertUniqueMigrationKeys(
      [{ legacyId: 91 }, { legacyId: 91 }],
      (record) => String(record.legacyId),
    )).toThrow();
  });

  it("preflights every registered source table in the orchestrator", async () => {
    const counted = new Set<SourceTable>();
    const source: MigrationSource = {
      kind: "postgres",
      beginReadOnlySnapshot: async () => {},
      close: async () => {},
      sourceFingerprint: async () => "synthetic-empty-snapshot",
      countSource: async (table) => {
        counted.add(table);
        return 0;
      },
      readBatch: async () => ({ records: [], nextCursor: null, done: true }),
    };

    const result = await runConvexMigration(source, null, {
      mode: "validate-only",
      batchSize: 10,
      maxRetries: 1,
    });

    expect(result.issues).toEqual([]);
    expect([...counted].sort()).toEqual([...expectedSourceTables].sort());
  });

  it("preserves only a hash of active verification tokens and rejects unsafe BIGINTs", () => {
    const result = transformPostgresMigrationRecord("users", {
      id: 1,
      email: "student@example.test",
      password: "pbkdf2-hash",
      role: "Student",
      loginFailures: 0,
      lockedUntil: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      emailVerified: false,
      verificationToken: "private-verification-token",
      verificationExpires: new Date("2027-01-01T00:00:00.000Z"),
      authSubject: "synthetic-subject-1",
      tokenVersion: 3,
      disabled: true,
    }, Date.parse("2026-06-01T00:00:00.000Z"));

    expect(result.value).toMatchObject({
      authSubject: "synthetic-subject-1",
      tokenVersion: 3,
      disabled: true,
    });
    expect(result.value).not.toHaveProperty("verificationToken");
    expect(result.value).toMatchObject({
      verificationTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      verificationExpires: Date.parse("2027-01-01T00:00:00.000Z"),
    });
    expect(JSON.stringify(result.value)).not.toContain("private-verification-token");
    expect(() => transformPostgresMigrationRecord("sessions", {
      token: "opaque-session-token",
      email: "student@example.test",
      expiresAt: Number.MAX_SAFE_INTEGER + 1,
      absoluteExpiresAt: Number.MAX_SAFE_INTEGER + 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
    })).toThrow(/expiresAt is invalid/);
  });

  it("dry-runs all rows without writing or advancing checkpoints", async () => {
    const adapter = new MemoryMigrationAdapter();
    adapter.sourceRecords.set("universities", [
      { key: "10", value: { name: "Synthetic University" } },
    ]);

    const result = await runBatchedMigration(adapter, { batchSize: 1, maxRetries: 2, dryRun: true });

    expect(result.universities).toEqual({
      sourceCount: 1,
      inserted: 0,
      plannedInsert: 1,
      alreadyPresent: 0,
      verified: 0,
    });
    expect(adapter.insertCalls).toBe(0);
    expect(adapter.checkpoints.size).toBe(0);
  });

  it("rejects unbounded batch sizes", async () => {
    await expect(
      runBatchedMigration(new MemoryMigrationAdapter(), { batchSize: 101, maxRetries: 1 }),
    ).rejects.toThrow(/from 1 to 100/);
  });

  it("retries a partially failed batch and verifies every source record", async () => {
    const adapter = new MemoryMigrationAdapter();
    adapter.sourceRecords.set("universities", [
      { key: "10", value: { name: "Synthetic A" } },
      { key: "11", value: { name: "Synthetic B" } },
    ]);
    adapter.failAfterFirstInsert = true;

    const result = await runBatchedMigration(adapter, { batchSize: 10, maxRetries: 2 });

    expect(adapter.insertCalls).toBe(2);
    expect(result.universities).toEqual({
      sourceCount: 2,
      inserted: 2,
      plannedInsert: 0,
      alreadyPresent: 0,
      verified: 2,
    });
    expect(adapter.destination.get("universities")?.size).toBe(2);
  });

  it("treats identical duplicates as already present and never overwrites conflicts", async () => {
    const adapter = new MemoryMigrationAdapter();
    const matching = { key: "10", value: { name: "Synthetic University" } };
    adapter.sourceRecords.set("universities", [matching]);
    adapter.destination.set("universities", new Map([["10", matching.value]]));

    const result = await runBatchedMigration(adapter, { batchSize: 1, maxRetries: 1 });
    expect(result.universities.alreadyPresent).toBe(1);
    expect(adapter.insertCalls).toBe(0);

    adapter.checkpoints.delete("universities");
    adapter.destination.set("universities", new Map([["10", { name: "Conflicting value" }]]));
    await expect(runBatchedMigration(adapter, { batchSize: 1, maxRetries: 1 })).rejects.toMatchObject({
      name: "MigrationError",
      code: "conflict",
    } satisfies Partial<MigrationError>);
    expect(adapter.destination.get("universities")?.get("10")).toEqual({ name: "Conflicting value" });
  });

  it("fails count verification instead of advancing when writes are not durable", async () => {
    const adapter = new MemoryMigrationAdapter();
    adapter.sourceRecords.set("universities", [
      { key: "10", value: { name: "Synthetic University" } },
    ]);
    adapter.pretendInsertSucceeded = true;

    await expect(runBatchedMigration(adapter, { batchSize: 1, maxRetries: 2 })).rejects.toMatchObject({
      name: "MigrationError",
      code: "verification_failed",
    } satisfies Partial<MigrationError>);
    expect(adapter.checkpoints.size).toBe(0);
  });

  it("blocks a streamed-count mismatch without checkpointing the incomplete table", async () => {
    const adapter = new MemoryMigrationAdapter();
    adapter.sourceRecords.set("universities", [
      { key: "10", value: { name: "Synthetic University" } },
    ]);
    adapter.reportedCountOffset = 1;

    await expect(runBatchedMigration(adapter, { batchSize: 1, maxRetries: 1 })).rejects.toMatchObject({
      name: "MigrationError",
      code: "verification_failed",
    } satisfies Partial<MigrationError>);
    expect(adapter.checkpoints.size).toBe(0);
  });

  it("rejects empty non-final pages rather than silently skipping source rows", async () => {
    const adapter = new MemoryMigrationAdapter();
    adapter.sourceRecords.set("universities", [
      { key: "10", value: { name: "Synthetic University" } },
    ]);
    adapter.readBatch = async (table, cursor, limit) => {
      if (table === "universities" && cursor === null) {
        return { records: [], nextCursor: "1", done: false };
      }
      return MemoryMigrationAdapter.prototype.readBatch.call(adapter, table, cursor, limit);
    };

    await expect(runBatchedMigration(adapter, { batchSize: 1, maxRetries: 1 })).rejects.toMatchObject({
      name: "MigrationError",
      code: "invalid_batch",
    } satisfies Partial<MigrationError>);
    expect(adapter.checkpoints.size).toBe(0);
  });

  it("resumes from a saved source cursor", async () => {
    const adapter = new MemoryMigrationAdapter();
    adapter.sourceRecords.set("universities", [
      { key: "10", value: { name: "Synthetic A" } },
      { key: "11", value: { name: "Synthetic B" } },
    ]);
    adapter.destination.set("universities", new Map([["10", { name: "Synthetic A" }]]));
    adapter.checkpoints.set("universities", {
      sourceFingerprint: "synthetic-snapshot-v1",
      cursor: "1",
      sourceCount: 1,
      inserted: 1,
      plannedInsert: 0,
      alreadyPresent: 0,
      verified: 1,
      done: false,
    });

    const result = await runBatchedMigration(adapter, { batchSize: 1, maxRetries: 1 });

    expect(result.universities.sourceCount).toBe(2);
    expect(result.universities.verified).toBe(2);
    expect(adapter.destination.get("universities")?.has("10")).toBe(true);
    expect(adapter.destination.get("universities")?.has("11")).toBe(true);
    expect(adapter.checkpoints.get("universities")?.done).toBe(true);
  });
});
