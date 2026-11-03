import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";
import { api } from "../convex/_generated/api";
import {
  migrationTables,
  type MigrationBatch,
  type SourceTable,
} from "../src/server/convexMigration";
import {
  ConvexInternalHttpTransport,
  ConvexMigrationDestination,
  type MigrationDestination,
} from "../src/server/convexMigrationDestination";
import {
  runConvexMigration,
  type MigrationSource,
} from "../src/server/convexMigrationOrchestrator";
import { transformPostgresMigrationRecord } from "../src/server/convexMigrationTransform";

const TEST_DEPLOYMENT = "clear-gopher-925";
const TEST_PROJECT = "uniinfo-migration-dev-20261013";
const PROTECTED_DEPLOYMENTS = [
  "original-jay-387",
  "graceful-kangaroo-272",
  "first-mastiff-578",
] as const;
const TEST_ENV_FILE = path.resolve(".env.uniinfo-convex.local");

config({ path: TEST_ENV_FILE, override: true, quiet: true });

type Snapshot = Record<SourceTable, unknown[]>;

function makeUniversity(id: number, name: string) {
  return {
    id,
    name,
    location: "Synthetic Test City",
    state: "TS",
    type: "Public",
    fee: 1000,
    rating: 4.5,
    students: "100",
    courses: 4,
    image: "synthetic-test-image",
    categories: ["Synthetic"],
    stream: ["Science"],
    degrees: ["BSc"],
    majors: ["Testing"],
    popularCourses: ["Synthetic Testing"],
    phone: "0000000000",
    competitiveExams: ["SYNTHETIC"],
    min10th: 50,
    min12th: 50,
    naacGrade: "A",
    nirfRank: 1,
    aicteApproved: true,
    nbaAccredited: false,
    nmcRecognized: false,
    avgPlacementLPA: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function syntheticSnapshot(): Snapshot {
  const createdAt = new Date("2026-01-02T00:00:00.000Z");
  return {
    universities: [
      makeUniversity(880001, "Synthetic Integration University A"),
      makeUniversity(880002, "Synthetic Integration University B"),
    ],
    users: [
      {
        id: 880010,
        email: "migration-student@example.test",
        password: "synthetic-pbkdf2-test-value",
        role: "Student",
        loginFailures: 0,
        lockedUntil: 0,
        createdAt,
        emailVerified: true,
        authSubject: "880010-synthetic-subject",
        tokenVersion: 0,
        disabled: false,
      },
      {
        id: 880011,
        email: "migration-parent@example.test",
        password: "synthetic-pbkdf2-test-value",
        role: "Parent",
        loginFailures: 0,
        lockedUntil: 0,
        createdAt,
        emailVerified: true,
        authSubject: "880011-synthetic-subject",
        tokenVersion: 0,
        disabled: false,
      },
    ],
    studentProfiles: [{
      id: 880020,
      userEmail: "migration-student@example.test",
      stream: "Science",
      hostelPreference: false,
      updatedAt: createdAt,
    }],
    parentProfiles: [{
      id: 880021,
      userEmail: "migration-parent@example.test",
      preferredStateCity: "Synthetic City",
      updatedAt: createdAt,
    }],
    reviews: [{
      id: 880030,
      universityId: 880001,
      userEmail: "migration-student@example.test",
      userName: "Synthetic Student",
      rating: 4,
      comment: "Synthetic integration review.",
      reviewDate: "2026-01-02",
      createdAt,
    }],
    bookmarks: [{
      id: 880040,
      userEmail: "migration-student@example.test",
      universityId: 880002,
      createdAt,
    }],
    notifications: [{
      id: 880050,
      userEmail: "migration-parent@example.test",
      title: "Synthetic notice",
      message: "Synthetic integration notification.",
      type: "synthetic",
      read: false,
      createdAt,
    }],
    chatHistory: [
      {
        id: 880060,
        userEmail: "migration-student@example.test",
        role: "user",
        content: "Synthetic account chat.",
        createdAt,
      },
      {
        id: 880061,
        userEmail: null,
        role: "assistant",
        content: "Synthetic guest chat.",
        createdAt,
      },
    ],
    sessions: [{
      token: "synthetic-session-token-for-integration-only",
      email: "migration-student@example.test",
      expiresAt: Date.parse("2030-01-01T00:00:00.000Z"),
      createdAt,
      lastUsedAt: createdAt,
      absoluteExpiresAt: Date.parse("2030-02-01T00:00:00.000Z"),
    }],
    auditLogs: [{
      id: 880070,
      action: "synthetic.integration",
      details: { source: "synthetic-test" },
      userEmail: "migration-student@example.test",
      ip: "203.0.113.10",
      status: "success",
      correlationId: "synthetic-correlation-id",
      createdAt,
    }],
    loginAttempts: [{
      id: 880080,
      ip: "203.0.113.11",
      email: "migration-parent@example.test",
      success: false,
      attemptTime: createdAt,
    }],
    universityReviewsAgg: [{
      universityId: 880001,
      reviewCount: 1,
      avgRating: 4,
    }],
    analyticsEvents: [{
      id: 880090,
      eventType: "synthetic.integration",
      details: null,
      userEmail: null,
      ipAddress: null,
      createdAt,
    }],
  };
}

class SyntheticSource implements MigrationSource {
  readonly kind = "synthetic" as const;
  private active = false;

  constructor(
    readonly snapshot: Snapshot,
    private readonly countOffsetTable?: SourceTable,
  ) {}

  async beginReadOnlySnapshot() {
    if (this.active) throw new Error("Synthetic source snapshot already active.");
    this.active = true;
  }

  async close() {
    this.active = false;
  }

  async sourceFingerprint() {
    this.assertActive();
    return createHash("sha256").update(JSON.stringify(this.snapshot)).digest("hex");
  }

  async countSource(table: SourceTable) {
    this.assertActive();
    return this.snapshot[table].length + (table === this.countOffsetTable ? 1 : 0);
  }

  async readBatch(
    table: SourceTable,
    cursor: string | null,
    limit: number,
  ): Promise<MigrationBatch> {
    this.assertActive();
    const rows = this.snapshot[table];
    const start = cursor === null ? 0 : Number(cursor);
    const page = rows.slice(start, start + limit);
    const next = start + page.length;
    const records = page.map((value) => ({
      key: transformPostgresMigrationRecord(table, value).key,
      value,
    }));
    return {
      records,
      nextCursor: next < rows.length ? String(next) : null,
      done: next >= rows.length,
    };
  }

  private assertActive() {
    if (!this.active) throw new Error("Synthetic source snapshot is not active.");
  }
}

function assertTestDeploymentIdentity() {
  const deploymentSelection = process.env.CONVEX_DEPLOYMENT?.split("#", 1)[0]?.trim();
  const url = process.env.VITE_CONVEX_URL;
  const adminKey = process.env.CONVEX_DEPLOY_KEY;
  if (
    deploymentSelection !== `dev:${TEST_DEPLOYMENT}` ||
    !url ||
    new URL(url).hostname !== `${TEST_DEPLOYMENT}.ap-southeast-2.convex.cloud` ||
    !process.env.VITE_CONVEX_SITE_URL ||
    !new RegExp(`^${TEST_DEPLOYMENT}\\.[a-z0-9-]+\\.convex\\.site$`).test(
      new URL(process.env.VITE_CONVEX_SITE_URL).hostname,
    ) ||
    !adminKey
  ) {
    throw new Error("Migration integration target is not the approved isolated deployment.");
  }
}

function destinationWithLostWriteAcknowledgement(
  destination: ConvexMigrationDestination,
): MigrationDestination {
  let interrupted = false;
  return {
    classify: destination.classify.bind(destination),
    insertBatch: async (table, records) => {
      await destination.insertBatch(table, records);
      if (table === "universities" && !interrupted) {
        interrupted = true;
        throw new Error("Synthetic lost acknowledgement after a committed batch.");
      }
    },
    loadCheckpoint: destination.loadCheckpoint.bind(destination),
    saveCheckpoint: destination.saveCheckpoint.bind(destination),
    listKeys: destination.listKeys.bind(destination),
  };
}

async function assertPreflightRejects(
  snapshot: Snapshot,
  destination: ConvexMigrationDestination,
  message: string,
) {
  await assert.rejects(
    runConvexMigration(new SyntheticSource(snapshot), destination, {
      mode: "synthetic",
      batchSize: 10,
      maxRetries: 1,
      isolatedSyntheticDeployment: TEST_DEPLOYMENT,
      confirmSyntheticImport: true,
    }),
    undefined,
    message,
  );
}

async function run() {
  assertTestDeploymentIdentity();
  const envFile = readFileSync(TEST_ENV_FILE, "utf8");
  assert.equal(
    /^CONVEX_DEPLOYMENT=dev:clear-gopher-925(?:\s+#.*)?$/m.test(envFile),
    true,
    "Dedicated environment must select the new UniInfo development deployment.",
  );
  assert.equal(
    PROTECTED_DEPLOYMENTS.some((deployment) => envFile.includes(deployment)),
    false,
    "Dedicated environment must not reference a pre-existing deployment.",
  );
  assert.equal(
    envFile.includes(`project: ${TEST_PROJECT}`),
    true,
    "Dedicated environment must identify the new UniInfo project.",
  );

  const transport = ConvexInternalHttpTransport.create({
    url: process.env.VITE_CONVEX_URL!,
    deploymentName: TEST_DEPLOYMENT,
    adminKey: process.env.CONVEX_DEPLOY_KEY!,
    isolatedSyntheticConfirmed: true,
  });
  const destination = new ConvexMigrationDestination(transport, TEST_DEPLOYMENT);
  const publicClient = new ConvexHttpClient(process.env.VITE_CONVEX_URL!, { logger: false });
  const baseline = syntheticSnapshot();
  const initialKeys = await Promise.all(
    migrationTables.map(async ({ source }) => [source, await destination.listKeys(source)] as const),
  );
  const existingTables = initialKeys.filter(([, keys]) => keys.length > 0);
  const destinationWasEmpty = existingTables.length === 0;
  const initialKeyMap = new Map(initialKeys);
  if (!destinationWasEmpty) {
    for (const { source } of migrationTables) {
      const expectedKeys = baseline[source]
        .map((value) => transformPostgresMigrationRecord(source, value).key)
        .sort();
      assert.deepEqual([...(initialKeyMap.get(source) ?? [])].sort(), expectedKeys, source);
      const classification = await destination.classify(
        source,
        baseline[source].map((value) => transformPostgresMigrationRecord(source, value)),
      );
      assert.deepEqual([...classification.identical].sort(), expectedKeys, source);
      assert.deepEqual(classification.missing, [], source);
      assert.deepEqual(classification.conflicting, [], source);
    }
    console.log("PASS: existing destination records exactly match synthetic fixtures; no overwrite is needed.");
  } else {
    console.log("PASS: isolated destination is empty and correctly identified.");
  }

  const unauthenticated = new ConvexHttpClient(process.env.VITE_CONVEX_URL!, { logger: false });
  for (const { source } of migrationTables) {
    const functionName = `migration:migrate${source[0]!.toUpperCase()}${source.slice(1)}`;
    await assert.rejects(
      unauthenticated.function(functionName, undefined, { records: [], write: true }),
    );
  }
  await assert.rejects(
    unauthenticated.function("migration:getCheckpoint", undefined, { tableName: "universities" }),
  );
  await assert.rejects(
    unauthenticated.function("migration:verifyRecordRelations", undefined, { checks: [] }),
  );
  console.log("PASS: all 13 internal mutations and internal queries reject unauthenticated callers.");

  const invalid = structuredClone(baseline);
  (invalid.universities[0] as Record<string, unknown>).rating = Number.NaN;
  await assertPreflightRejects(invalid, destination, "Invalid data must fail preflight.");

  const missingRelation = structuredClone(baseline);
  (missingRelation.bookmarks[0] as Record<string, unknown>).universityId = 999999;
  await assertPreflightRejects(missingRelation, destination, "Missing relationships must fail preflight.");

  const duplicateId = structuredClone(baseline);
  duplicateId.universities.push(structuredClone(duplicateId.universities[0]));
  await assertPreflightRejects(duplicateId, destination, "Duplicate legacy IDs must fail preflight.");

  await assert.rejects(
    runConvexMigration(new SyntheticSource(baseline, "universities"), destination, {
      mode: "synthetic",
      batchSize: 10,
      maxRetries: 1,
      isolatedSyntheticDeployment: TEST_DEPLOYMENT,
      confirmSyntheticImport: true,
    }),
    undefined,
    "Source count mismatches must fail before writes.",
  );
  console.log("PASS: invalid rows, missing relationships, duplicate IDs, and source-count mismatch are rejected.");

  const universityProbe = transformPostgresMigrationRecord("universities", baseline.universities[0]!);
  const extraFields = {
    ...(universityProbe.value as Record<string, unknown>),
    unrecognizedMigrationField: "must be rejected",
  };
  await assert.rejects(
    transport.invoke("migration:migrateUniversities", {
      records: [extraFields],
      write: true,
    }),
  );

  const oversizedBatch = Array.from({ length: 101 }, (_, index) =>
    transformPostgresMigrationRecord(
      "universities",
      makeUniversity(881000 + index, `Synthetic oversized ${index}`),
    ).value);
  await assert.rejects(
    transport.invoke("migration:migrateUniversities", {
      records: oversizedBatch,
      write: true,
    }),
  );
  console.log("PASS: Convex rejects unknown fields and batches larger than 100.");

  await assert.rejects(
    transport.invoke("migration:migrateReviews", {
      records: [{
        legacyId: 889999,
        legacyUniversityId: 889999,
        userEmail: "missing@example.test",
        userName: "Synthetic",
        rating: 4,
        comment: "Synthetic missing university",
        reviewDate: "2026-01-01",
        createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      }],
      write: true,
    }),
  );

  const duplicateEmailResult = await transport.invoke<{
    inserted: number;
    conflicting: number;
  }>("migration:migrateUsers", {
    records: [880101, 880102].map((legacyId) => ({
      legacyId,
      email: "duplicate-batch@example.test",
      passwordHash: "synthetic-only",
      role: "Student",
      name: null,
      loginFailures: 0,
      lockedUntil: 0,
      createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      emailVerified: true,
      verificationTokenHash: null,
      verificationExpires: null,
    })),
    write: true,
  });
  assert.equal(duplicateEmailResult.inserted, 0);
  assert.equal(duplicateEmailResult.conflicting, 1);
  console.log("PASS: missing references and same-batch logical duplicates are rejected without writes.");

  if (destinationWasEmpty) {
    await assert.rejects(
      runConvexMigration(
        new SyntheticSource(structuredClone(baseline)),
        destinationWithLostWriteAcknowledgement(destination),
        {
          mode: "synthetic",
          batchSize: 1,
          maxRetries: 1,
          isolatedSyntheticDeployment: TEST_DEPLOYMENT,
          confirmSyntheticImport: true,
        },
      ),
    );
    assert.deepEqual(await destination.listKeys("universities"), ["880001"]);
    assert.equal(await destination.loadCheckpoint("universities"), null);
    console.log("PASS: interrupted acknowledgement leaves a committed idempotent row and no premature checkpoint.");

    const migrated = await runConvexMigration(new SyntheticSource(baseline), destination, {
      mode: "synthetic",
      batchSize: 2,
      maxRetries: 2,
      isolatedSyntheticDeployment: TEST_DEPLOYMENT,
      confirmSyntheticImport: true,
    });
    assert.ok(migrated.tables);
    const importedOnResume = migrationTables.reduce(
      (total, { source }) => total + migrated.tables![source].inserted,
      0,
    );
    assert.equal(importedOnResume, 15);
    for (const { source } of migrationTables) {
      const expectedCount = baseline[source].length;
      assert.equal(migrated.tables[source].sourceCount, expectedCount, source);
      assert.equal(migrated.tables[source].verified, expectedCount, source);
      const checkpoint = await destination.loadCheckpoint(source);
      assert.equal(checkpoint?.done, true, source);
      assert.equal(checkpoint?.verified, expectedCount, source);
      assert.equal((await destination.listKeys(source)).length, expectedCount, source);
    }
    console.log("PASS: retry imported remaining records and verified every row across all 13 tables.");
  } else {
    for (const { source } of migrationTables) {
      const checkpoint = await destination.loadCheckpoint(source);
      assert.equal(checkpoint?.done, true, source);
      assert.equal(checkpoint?.verified, baseline[source].length, source);
    }
    console.log("PASS: completed checkpoints cover the existing 16-record synthetic fixture.");
  }

  const relationshipChecks = [
    ...(baseline.studentProfiles as Array<{ id: number }>).map(({ id }) => ({ tableName: "studentProfiles", legacyKey: id })),
    ...(baseline.parentProfiles as Array<{ id: number }>).map(({ id }) => ({ tableName: "parentProfiles", legacyKey: id })),
    ...(baseline.reviews as Array<{ id: number }>).map(({ id }) => ({ tableName: "reviews", legacyKey: id })),
    ...(baseline.bookmarks as Array<{ id: number }>).map(({ id }) => ({ tableName: "bookmarks", legacyKey: id })),
    ...(baseline.notifications as Array<{ id: number }>).map(({ id }) => ({ tableName: "notifications", legacyKey: id })),
    ...(baseline.chatHistory as Array<{ id: number }>).map(({ id }) => ({ tableName: "chatHistory", legacyKey: id })),
    ...(baseline.sessions as Array<Record<string, unknown>>).map((row) => ({
      tableName: "sessions",
      legacyKey: transformPostgresMigrationRecord("sessions", row).key,
    })),
    ...(baseline.universityReviewsAgg as Array<{ universityId: number }>).map(({ universityId }) => ({
      tableName: "universityReviewsAgg",
      legacyKey: universityId,
    })),
  ];
  const relationResult = await transport.invoke<{ checked: number; invalid: number }>(
    "migration:verifyRecordRelations",
    { checks: relationshipChecks },
  );
  assert.equal(relationResult.checked, relationshipChecks.length);
  assert.equal(relationResult.invalid, 0);
  console.log("PASS: internal relationship verification found no broken references.");

  const repeated = await runConvexMigration(new SyntheticSource(baseline), destination, {
    mode: "synthetic",
    batchSize: 2,
    maxRetries: 2,
    isolatedSyntheticDeployment: TEST_DEPLOYMENT,
    confirmSyntheticImport: true,
  });
  assert.ok(repeated.tables);
  for (const { source } of migrationTables) {
    assert.equal((await destination.listKeys(source)).length, baseline[source].length, source);
  }
  console.log("PASS: repeated execution is idempotent and preserves the same 13-table key sets.");

  const verification = await runConvexMigration(new SyntheticSource(baseline), destination, {
    mode: "verify",
    batchSize: 2,
    maxRetries: 1,
  });
  assert.ok(verification.tables);
  for (const { source } of migrationTables) {
    assert.equal(verification.tables[source].plannedInsert, 0, source);
  }

  const conflictingUniversity = transformPostgresMigrationRecord("universities", {
    ...(baseline.universities[0] as Record<string, unknown>),
    name: "Conflicting synthetic university",
  });
  const conflict = await destination.classify("universities", [conflictingUniversity]);
  assert.deepEqual(conflict.conflicting, ["880001"]);

  const university = await publicClient.query(api.universities.getByLegacyId, {
    legacyId: 880001,
  });
  assert.ok(university);
  assert.equal(university.id, 880001);
  assert.equal(university.reviewCount, 1);
  assert.equal(university.averageReview, 4);
  const publicPayload = JSON.stringify(university);
  for (const privateField of [
    "_id",
    "userId",
    "userEmail",
    "email",
    "password",
    "passwordHash",
    "sessionTokenHash",
    "authSubject",
    "verificationTokenHash",
  ]) {
    assert.equal(publicPayload.includes(`"${privateField}"`), false, privateField);
  }
  assert.equal(university.name, "Synthetic Integration University A");
  console.log("PASS: conflicts do not overwrite; public catalog keeps legacy IDs and excludes private fields.");

  const totalRecords = migrationTables.reduce(
    (total, { source }) => total + baseline[source].length,
    0,
  );
  assert.equal(totalRecords, 16);
  assert.equal(migrationTables.length, 13);
  console.log(
    `RESULT: ${totalRecords} synthetic source records verified across ${migrationTables.length} tables; ` +
      `${destinationWasEmpty ? "16 records were written (one committed batch recovered on retry)." : "no writes were needed."}`,
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown integration failure";
  console.error(`Migration integration test failed: ${message}`);
  process.exitCode = 1;
});
