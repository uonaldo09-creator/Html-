import { describe, expect, it } from "vitest";
import * as migration from "../../convex/migration";
import type { MutationCtx, QueryCtx } from "../../convex/_generated/server";
import { fakeConvexCtx, FakeConvexDb } from "./helpers/fakeConvexCtx";
import {
  migrationTables,
  type MigrationBatch,
  type MigrationCheckpoint,
  type MigrationRecord,
  type SourceTable,
} from "../server/convexMigration";
import {
  runConvexMigration,
  type MigrationSource,
} from "../server/convexMigrationOrchestrator";
import type { MigrationDestination } from "../server/convexMigrationDestination";
import { transformPostgresMigrationRecord } from "../server/convexMigrationTransform";

type KingSnapshot = Record<SourceTable, Record<string, unknown>[]>;

function emptySnapshot(): KingSnapshot {
  return Object.fromEntries(
    migrationTables.map(({ source }) => [source, [] as Record<string, unknown>[]]),
  ) as KingSnapshot;
}

const createdAt = new Date("2026-01-05T10:00:00.000Z");

/**
 * A King-shaped fixture: 1 university, 2 users, 3 reviews (2 of which are an
 * exact duplicate pair that must both survive), and 2 chat rows whose email
 * matches no user (guest records that must stay unlinked).
 */
function kingSnapshot(): KingSnapshot {
  return {
    ...emptySnapshot(),
    universities: [{
      id: 1,
      name: "King University",
      location: "Dehradun",
      state: "Uttarakhand",
      type: "Public",
      fee: 50000,
      rating: 4.2,
      students: "1200",
      courses: 12,
      image: "king.jpg",
      categories: ["Engineering"],
      stream: ["Science"],
      degrees: ["BTech"],
      majors: ["CSE"],
      popularCourses: ["BTech CSE"],
      phone: "0135-0000000",
      competitiveExams: ["JEE"],
      min10th: 60,
      min12th: 60,
      naacGrade: "A",
      nirfRank: 50,
      aicteApproved: true,
      nbaAccredited: true,
      nmcRecognized: false,
      avgPlacementLPA: 6.5,
      createdAt,
    }],
    users: [
      {
        id: 10,
        email: "student@king.test",
        password: "pbkdf2:hash:value",
        role: "Student",
        loginFailures: 0,
        lockedUntil: 0,
        createdAt,
        emailVerified: true,
        authSubject: "sub-student-10",
        tokenVersion: 0,
        disabled: false,
      },
      {
        id: 11,
        email: "parent@king.test",
        password: "pbkdf2:hash:value2",
        role: "Parent",
        loginFailures: 0,
        lockedUntil: 0,
        createdAt,
        emailVerified: false,
        authSubject: "sub-parent-11",
        tokenVersion: 2,
        disabled: false,
      },
    ],
    reviews: [
      {
        id: 100,
        universityId: 1,
        userEmail: "student@king.test",
        userName: "Student",
        rating: 5,
        comment: "Great campus",
        reviewDate: "2026-01-03",
        createdAt,
      },
      {
        id: 101,
        universityId: 1,
        userEmail: "student@king.test",
        userName: "Student",
        rating: 4,
        comment: "Repeated review body",
        reviewDate: "2026-01-04",
        createdAt,
      },
      {
        id: 102,
        universityId: 1,
        userEmail: "student@king.test",
        userName: "Student",
        rating: 4,
        comment: "Repeated review body",
        reviewDate: "2026-01-04",
        createdAt,
      },
    ],
    chatHistory: [
      {
        id: 200,
        userEmail: "student@king.test",
        role: "user",
        content: "Linked chat",
        createdAt,
      },
      {
        id: 201,
        userEmail: "legacy-guest@king.test",
        role: "user",
        content: "Unlinked chat one",
        createdAt,
      },
      {
        id: 202,
        userEmail: "legacy-guest@king.test",
        role: "assistant",
        content: "Unlinked chat two",
        createdAt,
      },
    ],
    notifications: [{
      id: 300,
      userEmail: "student@king.test",
      title: "Welcome",
      message: "Hello",
      type: "info",
      read: false,
      createdAt,
    }],
  };
}

class KingSource implements MigrationSource {
  readonly kind = "postgres" as const;
  private active = false;
  private reads = 0;

  constructor(private snapshot: KingSnapshot) {}

  async beginReadOnlySnapshot() {
    if (this.active) throw new Error("KingSource snapshot already active.");
    this.active = true;
  }

  async close() {
    this.active = false;
  }

  async sourceFingerprint() {
    this.assertActive();
    return `king-fingerprint-${this.reads === 0 ? "v1" : "v1"}`;
  }

  async countSource(table: SourceTable) {
    this.assertActive();
    return this.snapshot[table].length;
  }

  async readBatch(table: SourceTable, cursor: string | null, limit: number): Promise<MigrationBatch> {
    this.assertActive();
    const rows = this.snapshot[table];
    const start = cursor === null ? 0 : Number(cursor);
    const page = rows.slice(start, start + limit);
    const next = start + page.length;
    return {
      records: page.map((value) => ({
        key: transformPostgresMigrationRecord(table, value).key,
        value,
      })),
      nextCursor: next < rows.length ? String(next) : null,
      done: next >= rows.length,
    };
  }

  private assertActive() {
    if (!this.active) throw new Error("KingSource snapshot is not active.");
  }
}

class StagingDestination implements MigrationDestination {
  readonly rows = new Map<SourceTable, Map<string, unknown>>();
  readonly checkpoints = new Map<SourceTable, MigrationCheckpoint>();
  readonly counters = new Map<SourceTable, number>();
  insertCalls = 0;
  insertBatches = 0;
  /** When set, every insertBatch call after this many committed batches fails. */
  interruptAfterBatches: number | null = null;
  /** Fails the next N insertBatch calls transiently before letting them succeed. */
  transientFailures = 0;

  async classify(table: SourceTable, records: readonly MigrationRecord[]) {
    const existing = this.rows.get(table) ?? new Map<string, unknown>();
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
    if (this.transientFailures > 0) {
      this.transientFailures -= 1;
      throw new Error("Simulated transient write failure.");
    }
    this.insertBatches += 1;
    if (this.interruptAfterBatches !== null && this.insertBatches > this.interruptAfterBatches) {
      throw new Error("Simulated interruption before a committed batch.");
    }
    const existing = this.rows.get(table) ?? new Map<string, unknown>();
    this.rows.set(table, existing);
    for (const record of records) {
      existing.set(record.key, record.value);
      this.insertCalls += 1;
    }
  }

  async loadCheckpoint(table: SourceTable) {
    return this.checkpoints.get(table) ?? null;
  }

  async saveCheckpoint(table: SourceTable, checkpoint: MigrationCheckpoint) {
    this.checkpoints.set(table, checkpoint);
  }

  async listKeys(table: SourceTable) {
    return [...(this.rows.get(table)?.keys() ?? [])];
  }

  async reserveIdCounterFloor(table: SourceTable, nextId: number) {
    const current = this.counters.get(table) ?? 0;
    this.counters.set(table, Math.max(current, nextId));
  }

  async listMissingKeys(table: SourceTable, keys: readonly string[]) {
    const existing = this.rows.get(table) ?? new Map();
    return keys.filter((key) => !existing.has(key));
  }
}

const IMPORT_OPTIONS = {
  mode: "postgres-import" as const,
  batchSize: 2,
  maxRetries: 3,
  approvedWarningCodes: ["unresolved_optional_relationship"] as const,
  isolatedStagingDeployment: "staging-target",
  confirmPostgresImport: true,
};

describe("real PostgreSQL-source staging import", () => {
  it("requires an explicit confirmation and an isolated staging destination", async () => {
    const source = new KingSource(kingSnapshot());
    const destination = new StagingDestination();
    await expect(
      runConvexMigration(source, destination, { ...IMPORT_OPTIONS, confirmPostgresImport: false }),
    ).rejects.toThrow(/Real-data imports require/);
    await expect(
      runConvexMigration(source, destination, { ...IMPORT_OPTIONS, isolatedStagingDeployment: "clear-gopher-925" }),
    ).rejects.toThrow(/Real-data imports require/);
    await expect(
      runConvexMigration(source, destination, { ...IMPORT_OPTIONS, isolatedStagingDeployment: "prod" }),
    ).rejects.toThrow(/Real-data imports require/);
    expect(destination.insertCalls).toBe(0);
  });

  it("imports every source record, preserves duplicate reviews and unlinked chat, and reserves ID counters", async () => {
    const snapshot = kingSnapshot();
    const source = new KingSource(snapshot);
    const destination = new StagingDestination();

    const result = await runConvexMigration(source, destination, IMPORT_OPTIONS);
    expect(result.tables).toBeTruthy();

    for (const { source: table } of migrationTables) {
      const expected = snapshot[table]
        .map((value) => transformPostgresMigrationRecord(table, value).key)
        .sort();
      const actual = (await destination.listKeys(table)).sort();
      expect(actual).toEqual(expected);
      expect(result.tables![table].sourceCount).toBe(snapshot[table].length);
      expect(result.tables![table].verified).toBe(snapshot[table].length);
    }

    // Both duplicate review rows survive with their own distinct legacy IDs.
    expect(await destination.listKeys("reviews")).toEqual(
      expect.arrayContaining(["101", "102"]),
    );
    const review101 = destination.rows.get("reviews")?.get("101") as Record<string, unknown>;
    const review102 = destination.rows.get("reviews")?.get("102") as Record<string, unknown>;
    const { legacyId: id101, ...content101 } = review101;
    const { legacyId: id102, ...content102 } = review102;
    expect(id101).toBe(101);
    expect(id102).toBe(102);
    expect(content101).toEqual(content102);

    // Unlinked chat rows keep their email and gain no invented user identity.
    for (const key of ["201", "202"]) {
      const chat = destination.rows.get("chatHistory")?.get(key) as Record<string, unknown>;
      expect(chat.userEmail).toBe("legacy-guest@king.test");
      expect(chat.userId).toBeUndefined();
    }

    // The durable counter floor is one past the highest imported legacy ID.
    expect(destination.counters.get("reviews")).toBe(103);
    expect(destination.counters.get("users")).toBe(12);
    expect(destination.counters.get("universities")).toBe(2);
  });

  it("is idempotent: a repeat import writes nothing and duplicates no records", async () => {
    const source = new KingSource(kingSnapshot());
    const destination = new StagingDestination();

    await runConvexMigration(source, destination, IMPORT_OPTIONS);
    const insertsAfterFirst = destination.insertCalls;
    const countsAfterFirst = Object.fromEntries(
      migrationTables.map(({ source: table }) => [table, destination.rows.get(table)?.size ?? 0]),
    );

    await runConvexMigration(new KingSource(kingSnapshot()), destination, IMPORT_OPTIONS);

    // No new writes, and no table grew, so nothing was duplicated.
    expect(destination.insertCalls).toBe(insertsAfterFirst);
    for (const { source: table } of migrationTables) {
      expect(destination.rows.get(table)?.size ?? 0).toBe(countsAfterFirst[table]);
      expect(destination.rows.get(table)?.size ?? 0).toBe(kingSnapshot()[table].length);
    }
  });

  it("retries a transient write failure within the batch and still imports every record", async () => {
    const snapshot = kingSnapshot();
    const destination = new StagingDestination();
    destination.transientFailures = 2;

    const result = await runConvexMigration(new KingSource(snapshot), destination, IMPORT_OPTIONS);

    for (const { source: table } of migrationTables) {
      expect(result.tables![table].sourceCount).toBe(snapshot[table].length);
      expect(result.tables![table].verified).toBe(snapshot[table].length);
    }
    // The first batch needed two failed attempts before it committed.
    expect(destination.rows.get("universities")?.size).toBe(1);
  });

  it("fails the batch when transient failures exceed the bounded retry budget", async () => {
    const destination = new StagingDestination();
    destination.transientFailures = 10;
    await expect(
      runConvexMigration(new KingSource(kingSnapshot()), destination, IMPORT_OPTIONS),
    ).rejects.toThrow(/bounded retries/);
    expect(destination.insertCalls).toBe(0);
  });

  it("recovers a checkpoint after a simulated interruption and completes on retry", async () => {
    const source = new KingSource(kingSnapshot());
    const destination = new StagingDestination();
    destination.interruptAfterBatches = 3;

    await expect(
      runConvexMigration(source, destination, IMPORT_OPTIONS),
    ).rejects.toBeTruthy();

    // Completed tables keep a durable done checkpoint; the interrupted table's
    // checkpoint is not marked done, so a resume continues from its cursor.
    expect((await destination.loadCheckpoint("universities"))?.done).toBe(true);
    expect((await destination.loadCheckpoint("reviews"))?.done).toBe(false);
    expect((await destination.loadCheckpoint("reviews"))?.verified).toBe(2);

    // Clear the fault and resume: the run continues from the saved cursor.
    destination.interruptAfterBatches = null;
    const resumed = await runConvexMigration(new KingSource(kingSnapshot()), destination, IMPORT_OPTIONS);
    for (const { source: table } of migrationTables) {
      expect(resumed.tables![table].sourceCount).toBe(kingSnapshot()[table].length);
      expect(resumed.tables![table].verified).toBe(kingSnapshot()[table].length);
      expect(destination.checkpoints.get(table)?.done).toBe(true);
    }
  });

  it("rejects invalid rows, missing relationships, and conflicting destinations before writing", async () => {
    const invalid = kingSnapshot();
    (invalid.universities[0] as Record<string, unknown>).rating = Number.NaN;
    await expect(
      runConvexMigration(new KingSource(invalid), new StagingDestination(), IMPORT_OPTIONS),
    ).rejects.toBeTruthy();

    const missingRelation = kingSnapshot();
    (missingRelation.notifications[0] as Record<string, unknown>).userEmail = "missing@king.test";
    const relationDestination = new StagingDestination();
    // notifications.userEmail is optional, so it becomes an approved warning;
    // bookmarks-style required relationships still fail. Verify the warning path.
    await expect(
      runConvexMigration(new KingSource(missingRelation), relationDestination, {
        ...IMPORT_OPTIONS,
        approvedWarningCodes: [],
      }),
    ).rejects.toBeTruthy();
    expect(relationDestination.insertCalls).toBe(0);

    const destination = new StagingDestination();
    destination.rows.set("universities", new Map([["1", { legacyId: 1, name: "Conflicting" }]]));
    await expect(
      runConvexMigration(new KingSource(kingSnapshot()), destination, IMPORT_OPTIONS),
    ).rejects.toMatchObject({ name: "MigrationError", code: "conflict" });
  });

  it("keeps an unlinked review author without inventing an identity", async () => {
    const snapshot = kingSnapshot();
    (snapshot.reviews[0] as Record<string, unknown>).userEmail = "unknown@king.test";
    const destination = new StagingDestination();

    // The optional author link surfaces as an approved warning, never as an
    // invented user; the review row itself is still preserved.
    const result = await runConvexMigration(new KingSource(snapshot), destination, IMPORT_OPTIONS);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          table: "reviews",
          code: "unresolved_optional_relationship",
        }),
      ]),
    );
    const review = destination.rows.get("reviews")?.get("100") as Record<string, unknown>;
    expect(review.userEmail).toBe("unknown@king.test");
    expect(review.userId).toBeUndefined();
  });

  it("refuses an unlinked required relationship before any write", async () => {
    const snapshot = kingSnapshot();
    snapshot.bookmarks = [{
      id: 400,
      userEmail: "missing@king.test",
      universityId: 1,
      createdAt,
    }];
    const destination = new StagingDestination();
    await expect(
      runConvexMigration(new KingSource(snapshot), destination, IMPORT_OPTIONS),
    ).rejects.toBeTruthy();
    expect(destination.insertCalls).toBe(0);
  });
});

/** Invokes a registered internal Convex function through its raw handler. */
function invokeInternal<TResult>(
  registered: unknown,
  ctx: MutationCtx & QueryCtx,
  args: Record<string, unknown>,
): Promise<TResult> {
  const handler = (registered as { _handler: (ctx: unknown, args: unknown) => Promise<TResult> })._handler;
  return handler(ctx, args);
}

describe("ID counter collision safety", () => {
  it("never allocates an ID at or below a reserved legacy ID and does not repeat across runs", async () => {
    const db = new FakeConvexDb();
    const ctx = fakeConvexCtx(db);

    // Imported reviews have legacy IDs up to 102; the orchestrator reserves 103.
    await invokeInternal(migration.reserveIdCounterFloor, ctx, { tableName: "reviews", nextId: 103 });
    // A lower or equal floor must not move the counter backwards.
    await invokeInternal(migration.reserveIdCounterFloor, ctx, { tableName: "reviews", nextId: 50 });

    const first = await invokeInternal<{ id: number }>(migration.allocateNextLegacyId, ctx, { tableName: "reviews" });
    const second = await invokeInternal<{ id: number }>(migration.allocateNextLegacyId, ctx, { tableName: "reviews" });
    expect(first.id).toBe(103);
    expect(second.id).toBe(104);
    expect(first.id).toBeGreaterThan(102);
    expect(second.id).toBeGreaterThan(first.id);
  });

  it("starts a fresh counter at 1 and never collides with imported IDs", async () => {
    const db = new FakeConvexDb();
    const ctx = fakeConvexCtx(db);
    const first = await invokeInternal<{ id: number }>(migration.allocateNextLegacyId, ctx, { tableName: "users" });
    expect(first.id).toBe(1);
  });
});

describe("Convex migration handlers on an in-memory context", () => {
  async function seedUniversity(db: FakeConvexDb, ctx: MutationCtx & QueryCtx, legacyId: number) {
    await (migration.migrateUniversities as unknown as { _handler: Function })._handler(ctx, {
      records: [{
        legacyId, name: "U", location: "L", state: "S", type: "T", fee: 1, rating: 4,
        students: "1", courses: 1, image: "i", categories: [], stream: [], degrees: [],
        majors: [], popularCourses: [], phone: "0", competitiveExams: [], min10th: 1,
        min12th: 1, naacGrade: "A", nirfRank: 1, aicteApproved: true, nbaAccredited: false,
        nmcRecognized: false, avgPlacementLPA: 1, createdAt: 1,
      }],
      write: true,
    });
  }

  it("writes a review batch once and reports it identical on repeat (idempotent)", async () => {
    const db = new FakeConvexDb();
    const ctx = fakeConvexCtx(db);
    await seedUniversity(db, ctx, 1);
    const review = {
      legacyId: 101,
      legacyUniversityId: 1,
      userEmail: "student@king.test",
      userName: "Student",
      rating: 4,
      comment: "Repeated review body",
      reviewDate: "2026-01-04",
      createdAt: 1,
    };
    const handler = (migration.migrateReviews as unknown as { _handler: Function })._handler;

    const first = await handler(ctx, { records: [review], write: true });
    expect(first.inserted).toBe(1);
    expect(first.conflicting).toBe(0);

    const repeat = await handler(ctx, { records: [review], write: true });
    expect(repeat.inserted).toBe(0);
    expect(repeat.identical).toBe(1);
    expect(db.rows("reviews")).toHaveLength(1);
  });

  it("stores two duplicate review rows with distinct legacy IDs", async () => {
    const db = new FakeConvexDb();
    const ctx = fakeConvexCtx(db);
    await seedUniversity(db, ctx, 1);
    const handler = (migration.migrateReviews as unknown as { _handler: Function })._handler;
    const base = {
      legacyUniversityId: 1,
      userEmail: "student@king.test",
      userName: "Student",
      rating: 4,
      comment: "Repeated review body",
      reviewDate: "2026-01-04",
      createdAt: 1,
    };

    const result = await handler(ctx, {
      records: [{ ...base, legacyId: 101 }, { ...base, legacyId: 102 }],
      write: true,
    });
    expect(result.inserted).toBe(2);
    const stored = db.rows("reviews").map((row) => row.legacyId).sort();
    expect(stored).toEqual([101, 102]);
  });

  it("refuses a review whose university is missing", async () => {
    const db = new FakeConvexDb();
    const ctx = fakeConvexCtx(db);
    const handler = (migration.migrateReviews as unknown as { _handler: Function })._handler;
    await expect(
      handler(ctx, {
        records: [{
          legacyId: 101,
          legacyUniversityId: 999,
          userEmail: "student@king.test",
          userName: "Student",
          rating: 4,
          comment: "Missing university",
          reviewDate: "2026-01-04",
          createdAt: 1,
        }],
        write: true,
      }),
    ).rejects.toBeTruthy();
    expect(db.rows("reviews")).toHaveLength(0);
  });

  it("reports missing legacy keys for final reconciliation", async () => {
    const db = new FakeConvexDb();
    const ctx = fakeConvexCtx(db);
    await seedUniversity(db, ctx, 1);
    const result = await (migration.listMissingKeys as unknown as { _handler: Function })._handler(ctx, {
      tableName: "universities",
      keys: ["1", "2"],
    });
    expect(result.missing).toEqual(["2"]);
  });
});

describe("migration functions stay internal-only", () => {
  it("marks every migration mutation and query as internal", () => {
    const exported = Object.values(migration) as Array<Record<string, unknown>>;
    const functions = exported.filter(
      (value) => value && (value.isMutation === true || value.isQuery === true),
    );
    expect(functions.length).toBeGreaterThan(0);
    for (const func of functions) {
      expect(func.isInternal).toBe(true);
      expect(func.isPublic).toBeUndefined();
    }
    expect(migration.tableNames).toHaveLength(13);
  });
});
