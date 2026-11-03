import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrationTables, runBatchedMigration, type MigrationAdapter, type MigrationCheckpoint, type MigrationRecord, type SourceTable } from "../src/server/convexMigration";
import { PostgresMigrationSource } from "../src/server/postgresMigrationSource";
import { transformPostgresMigrationRecord } from "../src/server/convexMigrationTransform";
import * as schema from "../src/db/schema";

const configFile = path.resolve(".env.pg-migration-test.local");
const config = fs.existsSync(configFile)
  ? (await import("dotenv")).parse(fs.readFileSync(configFile, "utf8"))
  : {};

function required(name: string): string {
  const value = config[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing isolated test setting: ${name}.`);
  return value;
}

function assertLocalDatabaseUrl(value: string, database: string, port: string): URL {
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, port);
  assert.equal(decodeURIComponent(url.pathname.slice(1)), database);
  assert.ok(url.username && url.password);
  return url;
}

const sourceUrl = required("DATABASE_URL");
const sourceReadOnlyUrl = required("SOURCE_READONLY_DATABASE_URL");
const restoreUrl = required("RESTORE_DATABASE_URL");
const sourceDatabase = required("SOURCE_DB");
const restoreDatabase = required("RESTORE_DB");
assert.equal(sourceDatabase, "uniinfo_migration_source_test");
assert.equal(restoreDatabase, "uniinfo_migration_restore_test");
assert.notEqual(sourceDatabase, restoreDatabase);
const sourceIdentity = assertLocalDatabaseUrl(sourceUrl, sourceDatabase, required("SOURCE_PORT"));
const readerIdentity = assertLocalDatabaseUrl(sourceReadOnlyUrl, sourceDatabase, required("SOURCE_PORT"));
assert.equal(readerIdentity.username, required("SOURCE_READER_USER"));
assert.equal(sourceIdentity.username, required("SOURCE_ADMIN_USER"));
assert.notEqual(readerIdentity.username, sourceIdentity.username);
const restoreIdentity = assertLocalDatabaseUrl(restoreUrl, restoreDatabase, required("RESTORE_PORT"));
assert.equal(restoreIdentity.username, required("RESTORE_ADMIN_USER"));
assert.ok(sourceIdentity.password !== restoreIdentity.password);
if (process.env.SUPABASE_DB_URL || process.env.SQL_HOST || process.env.SQL_DB_NAME) {
  throw new Error("External database settings are present; refusing the rehearsal.");
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = sourceUrl;
process.env.SOURCE_READONLY_DATABASE_URL = sourceReadOnlyUrl;
process.env.RESTORE_DATABASE_URL = restoreUrl;
process.env.BACKUP_ENCRYPTION_KEY = required("BACKUP_ENCRYPTION_KEY");
process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "uniinfo-pg-rehearsal-backups-"));

const sourceAdmin = new Pool({ connectionString: sourceUrl, max: 3 });
const sourceReader = new Pool({ connectionString: sourceReadOnlyUrl, max: 2 });
const restorePool = new Pool({ connectionString: restoreUrl, max: 3 });
const createdAt = new Date("2026-10-01T12:34:56.000Z");
const universitiesFixture = [
  {
    id: 700001, name: "Synthetic North Institute", location: "Test City North", state: "TS",
    type: "Public", fee: 42000, rating: 4.2, students: "12000", courses: 40,
    image: "https://example.test/north.png", logo: null, categories: ["Synthetic"],
    stream: ["Engineering"], degrees: ["B.Tech"], majors: ["Computer Science"],
    popularCourses: ["Synthetic Systems"], phone: "+910000000001", competitiveExams: ["SYNTHETIC-1"],
    min10th: 60, min12th: 65, naacGrade: "A", nirfRank: 41, aicteApproved: true,
    nbaAccredited: false, nmcRecognized: false, avgPlacementLPA: 6.5, website: null,
    virtualTourUrl: null, expertInsight: null, alumniStories: null, campusMap: null,
    directoryProfile: null, createdAt,
  },
  {
    id: 700009, name: "Synthetic South Institute", location: "Test City South", state: "TS",
    type: "Private", fee: 85000, rating: 4.6, students: "8000", courses: 28,
    image: "https://example.test/south.png", logo: "https://example.test/south-logo.png",
    categories: ["Synthetic", "Research"], stream: ["Science"], degrees: ["B.Sc"],
    majors: ["Synthetic Biology"], popularCourses: ["Synthetic Analytics"],
    phone: "+910000000002", competitiveExams: ["SYNTHETIC-2"], min10th: 70, min12th: 72,
    naacGrade: "A+", nirfRank: 72, aicteApproved: true, nbaAccredited: true,
    nmcRecognized: true, avgPlacementLPA: 8.1, website: "https://example.test/south",
    virtualTourUrl: null, expertInsight: "Synthetic insight", alumniStories: [{ name: "Synthetic Alum" }],
    campusMap: { zones: ["Synthetic Zone"] }, directoryProfile: { source: "synthetic" }, createdAt,
  },
];
const usersFixture = [
  { id: 1101, email: "synthetic-student-1101@example.test", password: "synthetic-hash-1101", role: "Student", name: null, loginFailures: 0, lockedUntil: 0, createdAt, emailVerified: true, verificationToken: null, verificationExpires: null, authSubject: "11111111-1111-4111-8111-111111111101", tokenVersion: 0, disabled: false },
  { id: 1209, email: "synthetic-parent-1209@example.test", password: "synthetic-hash-1209", role: "Parent", name: "Synthetic Parent", loginFailures: 1, lockedUntil: 0, createdAt, emailVerified: false, verificationToken: "synthetic-verification-token", verificationExpires: new Date("2030-01-01T00:00:00.000Z"), authSubject: "11111111-1111-4111-8111-111111111209", tokenVersion: 0, disabled: false },
];

function fixtures() {
  return {
    universities: universitiesFixture,
    users: usersFixture,
    studentProfiles: [{ id: 3101, userEmail: usersFixture[0].email, stream: "Synthetic Engineering", budget: 50000, preferredLocation: null, preferredCourse: "Synthetic Systems", entranceExams: ["SYNTHETIC-1"], hostelPreference: true, placementPriority: null, academicScores: { tenth: 80, twelfth: 82 }, careerGoals: null, updatedAt: createdAt }],
    parentProfiles: [{ id: 3209, userEmail: usersFixture[1].email, budget: 100000, preferredStateCity: "Synthetic Test City", safetyPreference: "High", roiPreference: null, scholarshipPreference: "Yes", distancePreference: "Close", accommodationPreference: null, updatedAt: createdAt }],
    reviews: [
      { id: 4201, universityId: 700001, userEmail: usersFixture[0].email, userName: "Synthetic Student", rating: 4, comment: "Synthetic review one.", avatar: null, reviewDate: "2026-10-01", createdAt },
      { id: 4299, universityId: 700009, userEmail: usersFixture[1].email, userName: "Synthetic Parent", rating: 5, comment: "Synthetic review two.", avatar: null, reviewDate: "2026-10-02", createdAt },
    ],
    bookmarks: [
      { id: 5101, userEmail: usersFixture[0].email, universityId: 700001, createdAt },
      { id: 5199, userEmail: usersFixture[1].email, universityId: 700009, createdAt },
    ],
    notifications: [
      { id: 6101, userEmail: usersFixture[0].email, title: "Synthetic notification one", message: "Synthetic message.", type: "announcement", read: false, createdAt },
      { id: 6199, userEmail: usersFixture[1].email, title: "Synthetic notification two", message: "Synthetic message.", type: "review_status", read: true, createdAt },
    ],
    chatHistory: [
      { id: 7101, userEmail: usersFixture[0].email, role: "user", content: "Synthetic chat question.", correlationId: "synthetic-correlation-1", createdAt },
      { id: 7199, userEmail: null, role: "assistant", content: "Synthetic chat response.", correlationId: null, createdAt },
    ],
    sessions: [
      { token: "synthetic-session-a", email: usersFixture[0].email, expiresAt: 1_798_800_000_000, createdAt, lastUsedAt: createdAt, absoluteExpiresAt: 1_799_000_000_000 },
      { token: "synthetic-session-z", email: usersFixture[1].email, expiresAt: 1_798_800_000_000, createdAt, lastUsedAt: createdAt, absoluteExpiresAt: 1_799_000_000_000 },
    ],
    auditLogs: [
      { id: 8101, action: "synthetic.test.one", details: { source: "synthetic" }, userEmail: usersFixture[0].email, ip: "192.0.2.10", status: "success", correlationId: "synthetic-audit-1", createdAt },
      { id: 8199, action: "synthetic.test.two", details: {}, userEmail: null, ip: null, status: null, correlationId: null, createdAt },
    ],
    loginAttempts: [
      { id: 9101, ip: "192.0.2.11", email: usersFixture[0].email, success: false, attemptTime: createdAt },
      { id: 9199, ip: "192.0.2.12", email: null, success: true, attemptTime: createdAt },
    ],
    universityReviewsAgg: [
      { universityId: 700001, avgRating: 4, reviewCount: 1 },
      { universityId: 700009, avgRating: 5, reviewCount: 1 },
    ],
    analyticsEvents: [{
      id: 10101,
      eventType: "synthetic.rehearsal",
      details: null,
      userEmail: null,
      ipAddress: null,
      createdAt,
    }],
  } satisfies Record<SourceTable, readonly unknown[]>;
}

const tableMeta: Record<SourceTable, { sql: string; key: string }> = {
  universities: { sql: "universities", key: "id" },
  users: { sql: "users", key: "id" },
  studentProfiles: { sql: "student_profiles", key: "id" },
  parentProfiles: { sql: "parent_profiles", key: "id" },
  reviews: { sql: "reviews", key: "id" },
  bookmarks: { sql: "bookmarks", key: "id" },
  notifications: { sql: "notifications", key: "id" },
  chatHistory: { sql: "chat_history", key: "id" },
  sessions: { sql: "sessions", key: "token" },
  auditLogs: { sql: "audit_logs", key: "id" },
  loginAttempts: { sql: "login_attempts", key: "id" },
  universityReviewsAgg: { sql: "university_reviews_agg", key: "university_id" },
  analyticsEvents: { sql: "analytics_events", key: "id" },
};

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, normalize(nested)]));
  }
  return value;
}

function rollbackProbe(tables: Record<SourceTable, unknown[]>): Record<SourceTable, unknown[]> {
  const probe = structuredClone(tables) as Record<SourceTable, Record<string, unknown>[]>;
  const users = probe.users;
  const emailMap = new Map(users.map((row) => [String(row.email), `rollback-${String(row.email)}`]));
  const universityIdMap = new Map(
    probe.universities.map((row) => [Number(row.id), Number(row.id) + 1_000_000]),
  );
  for (const row of probe.universities) row.id = universityIdMap.get(Number(row.id));
  for (const row of users) {
    row.id = Number(row.id) + 1_000_000;
    row.email = emailMap.get(String(row.email));
    // The subject is unique per account, so duplicates must be remapped too.
    row.authSubject = `rollback-${String(row.authSubject)}`;
  }
  for (const table of ["studentProfiles", "parentProfiles"] as const) {
    for (const row of probe[table]) {
      row.id = Number(row.id) + 1_000_000;
      row.userEmail = emailMap.get(String(row.userEmail));
    }
  }
  for (const table of ["reviews", "bookmarks"] as const) {
    for (const row of probe[table]) {
      row.id = Number(row.id) + 1_000_000;
      row.universityId = universityIdMap.get(Number(row.universityId));
      row.userEmail = emailMap.get(String(row.userEmail));
    }
  }
  for (const row of probe.universityReviewsAgg) {
    row.universityId = universityIdMap.get(Number(row.universityId));
  }
  for (const row of probe.notifications) {
    row.id = Number(row.id) + 1_000_000;
    row.userEmail = emailMap.get(String(row.userEmail));
  }
  for (const row of probe.chatHistory) {
    row.id = Number(row.id) + 1_000_000;
    if (row.userEmail != null) row.userEmail = emailMap.get(String(row.userEmail));
  }
  for (const row of probe.sessions) {
    row.token = `rollback-${String(row.token)}`;
    row.email = emailMap.get(String(row.email));
  }
  for (const table of ["auditLogs", "loginAttempts"] as const) {
    for (const row of probe[table]) {
      row.id = Number(row.id) + 1_000_000;
      if (row.userEmail != null) row.userEmail = emailMap.get(String(row.userEmail));
      if (table === "loginAttempts" && row.email != null) row.email = emailMap.get(String(row.email));
    }
  }
  return probe;
}

async function counts(pool: Pool) {
  const result = {} as Record<SourceTable, number>;
  for (const { source } of migrationTables) {
    const table = tableMeta[source].sql;
    const response = await pool.query(`SELECT COUNT(*)::int AS count FROM public."${table}"`);
    result[source] = response.rows[0].count as number;
  }
  return result;
}

async function assertRowsEqual(source: Pool, target: Pool) {
  for (const { source: table } of migrationTables) {
    const { sql: sqlTable, key } = tableMeta[table];
    const left = await source.query(`SELECT * FROM public."${sqlTable}" ORDER BY "${key}"`);
    const right = await target.query(`SELECT * FROM public."${sqlTable}" ORDER BY "${key}"`);
    assert.deepEqual(normalize(left.rows), normalize(right.rows), `${table} rows differ`);
  }
}

async function seed(pool: Pool) {
  const data = fixtures();
  const db = drizzle(pool, { schema });
  await db.transaction(async (tx) => {
    await tx.insert(schema.universities).values(data.universities);
    await tx.insert(schema.users).values(data.users);
    await tx.insert(schema.studentProfiles).values(data.studentProfiles);
    await tx.insert(schema.parentProfiles).values(data.parentProfiles);
    await tx.insert(schema.reviews).values(data.reviews);
    await tx.insert(schema.bookmarks).values(data.bookmarks);
    await tx.insert(schema.notifications).values(data.notifications);
    await tx.insert(schema.chatHistory).values(data.chatHistory);
    await tx.insert(schema.sessions).values(data.sessions);
    await tx.insert(schema.auditLogs).values(data.auditLogs);
    await tx.insert(schema.loginAttempts).values(data.loginAttempts);
    await tx.insert(schema.universityReviewsAgg).values(data.universityReviewsAgg);
    await tx.insert(schema.analyticsEvents).values(data.analyticsEvents);
  });
  return data;
}

async function readCurrentSchemaSnapshot(pool: Pool) {
  const db = drizzle(pool, { schema });
  return {
    universities: await db.select().from(schema.universities).orderBy(schema.universities.id),
    users: await db.select().from(schema.users).orderBy(schema.users.id),
    sessions: await db.select().from(schema.sessions).orderBy(schema.sessions.token),
    reviews: await db.select().from(schema.reviews).orderBy(schema.reviews.id),
    bookmarks: await db.select().from(schema.bookmarks).orderBy(schema.bookmarks.id),
    chatHistory: await db.select().from(schema.chatHistory).orderBy(schema.chatHistory.id),
    auditLogs: await db.select().from(schema.auditLogs).orderBy(schema.auditLogs.id),
    loginAttempts: await db.select().from(schema.loginAttempts).orderBy(schema.loginAttempts.id),
    studentProfiles: await db.select().from(schema.studentProfiles).orderBy(schema.studentProfiles.id),
    parentProfiles: await db.select().from(schema.parentProfiles).orderBy(schema.parentProfiles.id),
    notifications: await db.select().from(schema.notifications).orderBy(schema.notifications.id),
    universityReviewsAgg: await db.select().from(schema.universityReviewsAgg).orderBy(schema.universityReviewsAgg.universityId),
    analyticsEvents: await db.select().from(schema.analyticsEvents).orderBy(schema.analyticsEvents.id),
  } satisfies Record<SourceTable, readonly unknown[]>;
}

async function verifyCatalog(pool: Pool) {
  const rows = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  const names = rows.rows.map((row) => row.table_name).sort();
  const expected = Object.values(tableMeta).map(({ sql }) => sql).sort();
  assert.deepEqual(names, expected, "public table set differs from current schema");
}

async function main() {
  const sourceIdentityResult = await sourceAdmin.query("SELECT current_database() AS db, current_user AS role");
  const restoreIdentityResult = await restorePool.query("SELECT current_database() AS db, current_user AS role");
  assert.equal(sourceIdentityResult.rows[0].db, sourceDatabase);
  assert.equal(sourceIdentityResult.rows[0].role, sourceIdentity.username);
  assert.equal(restoreIdentityResult.rows[0].db, restoreDatabase);
  assert.equal(restoreIdentityResult.rows[0].role, restoreIdentity.username);
  await verifyCatalog(sourceAdmin);
  await verifyCatalog(restorePool);

  const expectedData = fixtures();
  const expectedCounts = Object.fromEntries(
    migrationTables.map(({ source }) => [source, expectedData[source].length]),
  ) as Record<SourceTable, number>;
  const sourceCountsBefore = await counts(sourceAdmin);
  const targetCountsBefore = await counts(restorePool);
  assert.deepEqual(sourceCountsBefore, expectedCounts, "source is not the expected complete synthetic fixture");
  const emptyTargetCounts = Object.fromEntries(migrationTables.map(({ source }) => [source, 0]));
  const targetIsEmpty = JSON.stringify(targetCountsBefore) === JSON.stringify(emptyTargetCounts);
  assert.ok(
    targetIsEmpty || JSON.stringify(targetCountsBefore) === JSON.stringify(expectedCounts),
    "restore target contains partial or unexpected rows",
  );
  if (!targetIsEmpty) await assertRowsEqual(sourceAdmin, restorePool);

  const adminUser = required("SOURCE_ADMIN_USER");
  const readerUser = required("SOURCE_READER_USER");
  const readerPassword = required("SOURCE_READER_PASSWORD");
  assert.match(readerUser, /^[a-z_][a-z0-9_]*$/);
  assert.match(readerPassword, /^[a-f0-9]{64}$/);
  const existingReader = await sourceAdmin.query(
    "SELECT rolsuper, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname=$1",
    [readerUser],
  );
  if (existingReader.rowCount === 0) {
    await sourceAdmin.query(`CREATE ROLE "${readerUser}" LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  } else {
    assert.deepEqual(existingReader.rows[0], {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolcanlogin: true,
    });
  }
  await sourceAdmin.query(`GRANT CONNECT ON DATABASE "${sourceDatabase}" TO "${readerUser}"`);
  await sourceAdmin.query(`GRANT USAGE ON SCHEMA public TO "${readerUser}"`);
  await sourceAdmin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${readerUser}"`);
  await sourceAdmin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${readerUser}"`);
  const writePrivilege = await sourceAdmin.query(
    "SELECT has_table_privilege($1, 'public.users', 'INSERT') AS can_insert",
    [readerUser],
  );
  assert.equal(writePrivilege.rows[0].can_insert, false);
  assert.notEqual(adminUser, readerUser);

  const { dbService } = await import("../src/db/dbService");
  const { BackupService } = await import("../src/server/backup");
  const { decryptBackup, encryptBackup } = await import("../src/server/backupEncryption");
  const { parsePostgresBackupEnvelope } = await import("../src/server/backupFormat");
  const sourceDrizzle = drizzle(sourceAdmin, { schema });
  const restoreDrizzle = drizzle(restorePool, { schema });
  Reflect.set(dbService, "isPostgres", true);
  Reflect.set(dbService, "drizzleDb", sourceDrizzle);
  assert.equal(dbService.isUsingPostgres(), true);
  delete process.env.BACKUP_ENCRYPTION_KEY;
  await assert.rejects(BackupService.createBackup("expected-encryption-failure"));
  assert.deepEqual(fs.readdirSync(process.env.BACKUP_DIR!), []);
  process.env.BACKUP_ENCRYPTION_KEY = required("BACKUP_ENCRYPTION_KEY");
  const backupFilename = await BackupService.createBackup("local_synthetic_rehearsal");
  const backupPath = path.join(process.env.BACKUP_DIR!, backupFilename);
  const encryptedBackup = fs.readFileSync(backupPath, "utf8");
  assert.ok(!encryptedBackup.includes("synthetic-student-1101@example.test"));
  const envelope = parsePostgresBackupEnvelope(decryptBackup(encryptedBackup));
  assert.deepEqual(envelope.counts, expectedCounts);
  assert.equal(Object.keys(envelope.tables).length, 13);

  Reflect.set(dbService, "drizzleDb", restoreDrizzle);
  const invalidRestore = rollbackProbe(envelope.tables);
  (invalidRestore.loginAttempts as Record<string, unknown>[])[0].ip = null;
  await assert.rejects(dbService.importPostgresData(invalidRestore));
  assert.deepEqual(await counts(restorePool), targetCountsBefore);

  if (targetIsEmpty) {
    try {
      assert.equal(await BackupService.restoreBackup(backupFilename), true);
    } catch (error) {
      const code = error instanceof Error && "cause" in error
        ? (error.cause as { code?: string } | undefined)?.code
        : undefined;
      throw new Error(`Synthetic restore failed (PostgreSQL code: ${code ?? "unavailable"}).`);
    }
  } else {
    console.log("PASS: restore target already matches the expected fixture; no duplicate restore attempted.");
  }
  assert.deepEqual(await counts(sourceAdmin), expectedCounts);
  assert.deepEqual(await counts(restorePool), expectedCounts);
  await assertRowsEqual(sourceAdmin, restorePool);

  const corruptFilename = backupFilename.replace(".json.enc", "_corrupt.json.enc");
  const corrupted = JSON.parse(encryptedBackup) as { ciphertext: string };
  // Change a significant base64 character. Mutating the final character can
  // affect only unused padding bits and leave the decoded ciphertext intact.
  corrupted.ciphertext = `${corrupted.ciphertext[0] === "A" ? "B" : "A"}${corrupted.ciphertext.slice(1)}`;
  fs.writeFileSync(path.join(process.env.BACKUP_DIR!, corruptFilename), JSON.stringify(corrupted), { flag: "wx" });
  const backupFilesBeforeReject = fs.readdirSync(process.env.BACKUP_DIR!);
  await assert.rejects(BackupService.restoreBackup(corruptFilename), /decryption failed/);
  assert.deepEqual(fs.readdirSync(process.env.BACKUP_DIR!), backupFilesBeforeReject);
  const invalidDigestFilename = backupFilename.replace(".json.enc", "_invalid_digest.json.enc");
  const invalidDigestEnvelope = JSON.parse(decryptBackup(encryptedBackup)) as { counts: Record<string, number> };
  invalidDigestEnvelope.counts.users += 1;
  fs.writeFileSync(
    path.join(process.env.BACKUP_DIR!, invalidDigestFilename),
    encryptBackup(JSON.stringify(invalidDigestEnvelope)),
    { flag: "wx" },
  );
  const filesBeforeDigestReject = fs.readdirSync(process.env.BACKUP_DIR!);
  await assert.rejects(BackupService.restoreBackup(invalidDigestFilename), /count verification failed/);
  assert.deepEqual(fs.readdirSync(process.env.BACKUP_DIR!), filesBeforeDigestReject);
  assert.deepEqual(await counts(restorePool), expectedCounts);

  const pkColumns = await sourceAdmin.query(
    "SELECT tc.table_name, kcu.column_name, kcu.ordinal_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu USING (constraint_catalog, constraint_schema, constraint_name, table_name) WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' ORDER BY tc.table_name, kcu.ordinal_position",
  );
  const targetPkColumns = await restorePool.query(
    "SELECT tc.table_name, kcu.column_name, kcu.ordinal_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu USING (constraint_catalog, constraint_schema, constraint_name, table_name) WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' ORDER BY tc.table_name, kcu.ordinal_position",
  );
  assert.deepEqual(pkColumns.rows, targetPkColumns.rows);
  assert.equal(pkColumns.rows.length, 13);
  const columns = async (pool: Pool) => (await pool.query(
    "SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position",
  )).rows;
  assert.deepEqual(await columns(sourceAdmin), await columns(restorePool));
  const constraints = async (pool: Pool) => (await pool.query(
    "SELECT conname, contype, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname",
  )).rows;
  assert.deepEqual(await constraints(sourceAdmin), await constraints(restorePool));
  assert.equal((await constraints(sourceAdmin)).filter((constraint) => constraint.contype === "f").length, 6);
  const indexes = async (pool: Pool) => (await pool.query(
    "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname",
  )).rows;
  assert.deepEqual(await indexes(sourceAdmin), await indexes(restorePool));

  for (const table of ["users", "reviews", "bookmarks", "chat_history", "audit_logs", "login_attempts", "student_profiles", "parent_profiles", "notifications"]) {
    const next = await restorePool.query(
      "SELECT nextval(pg_get_serial_sequence($1, 'id')) AS next_id, (SELECT MAX(id) FROM public." + `"${table}"` + ") AS max_id",
      [`public.${table}`],
    );
    assert.ok(Number(next.rows[0].next_id) > Number(next.rows[0].max_id), `${table} sequence is not ahead of max id`);
  }

  const duplicateUser = await restorePool.query(
    "INSERT INTO users (id, email, password) VALUES (999999, $1, 'synthetic')",
    [usersFixture[0].email],
  ).then(() => null, (error: { code?: string }) => error);
  assert.equal(duplicateUser?.code, "23505");
  const orphanReview = await restorePool.query(
    "INSERT INTO reviews (id, university_id, user_email, rating, comment, review_date) VALUES (999999, 999999, 'synthetic@example.test', 1, 'synthetic', '2026-10-01')",
  ).then(() => null, (error: { code?: string }) => error);
  assert.equal(orphanReview?.code, "23503");
  const duplicateBookmark = await restorePool.query(
    "INSERT INTO bookmarks (id, user_email, university_id) VALUES (999998, $1, $2)",
    [usersFixture[0].email, 700001],
  ).then(() => null, (error: { code?: string }) => error);
  assert.equal(duplicateBookmark?.code, "23505");

  const readerPool = new Pool({ connectionString: sourceReadOnlyUrl, max: 1 });
  const client = await readerPool.connect();
  const statements: string[] = [];
  const source = new PostgresMigrationSource({
    query: async (text, values) => {
      statements.push(text);
      const result = await client.query(text, values as (string | number)[] | undefined);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  });
  const checkpoints = new Map<SourceTable, MigrationCheckpoint>();
  const destination = new Map<SourceTable, Map<string, MigrationRecord>>();
  try {
    await source.beginReadOnlySnapshot();
    const fingerprint = await source.sourceFingerprint();
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(await source.sourceFingerprint(), fingerprint);
    for (const { source: table } of migrationTables) {
      assert.equal(await source.countSource(table), expectedCounts[table]);
      const keys: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await source.readBatch(table, cursor, 1);
        assert.ok(page.records.length <= 1);
        keys.push(...page.records.map((record) => record.key));
        cursor = page.nextCursor;
        assert.equal(page.done, cursor === null);
      } while (cursor !== null);
      assert.equal(keys.length, expectedCounts[table]);
      assert.deepEqual(keys, [...keys].sort((a, b) => (table === "sessions" ? a.localeCompare(b) : Number(a) - Number(b))));
      await assert.rejects(source.readBatch(table, null, 101), /between 1 and 100/);
      const transformed = await source.readBatch(table, null, 1);
      for (const record of transformed.records) transformPostgresMigrationRecord(table, record.value);
    }
    const wrongTableCursor = (await source.readBatch("users", null, 1)).nextCursor;
    if (wrongTableCursor) await assert.rejects(source.readBatch("sessions", wrongTableCursor, 1), /does not match its table/);
    const sourceBacked: MigrationAdapter = {
      sourceFingerprint: () => source.sourceFingerprint(),
      countSource: (table) => source.countSource(table),
      readBatch: (table, cursor, limit) => source.readBatch(table, cursor, limit),
      classify: async (table, records) => {
        const rows = destination.get(table) ?? new Map();
        return {
          identical: records.filter(({ key }) => rows.has(key)).map(({ key }) => key),
          missing: records.filter(({ key }) => !rows.has(key)).map(({ key }) => key),
          conflicting: [],
        };
      },
      insertBatch: async (table, records) => {
        const rows = destination.get(table) ?? new Map<string, MigrationRecord>();
        for (const record of records) {
          const mapped = transformPostgresMigrationRecord(table, record.value);
          rows.set(record.key, mapped);
        }
        destination.set(table, rows);
      },
      loadCheckpoint: async (table) => checkpoints.get(table) ?? null,
      saveCheckpoint: async (table, checkpoint) => { checkpoints.set(table, checkpoint); },
    };
    const firstRun = await runBatchedMigration(sourceBacked, { batchSize: 1, maxRetries: 2 });
    for (const { source: table } of migrationTables) {
      assert.equal(firstRun[table].verified, expectedCounts[table]);
      assert.equal(checkpoints.get(table)?.done, true);
      assert.equal(destination.get(table)?.size, expectedCounts[table]);
    }
    const repeated = await runBatchedMigration(sourceBacked, { batchSize: 1, maxRetries: 2 });
    assert.deepEqual(repeated, firstRun);
    assert.ok(statements.every((statement) => /^(BEGIN|COMMIT|SELECT)\b/i.test(statement.trim())));
    await source.close();
  } finally {
    if (client) client.release();
    await readerPool.end();
  }

  const deniedWrite = await sourceReader.query("INSERT INTO users (id,email,password) VALUES (999998,'blocked@example.test','synthetic')").then(
    () => null,
    (error: { code?: string }) => error,
  );
  assert.equal(deniedWrite?.code, "42501");
  assert.deepEqual(await counts(sourceAdmin), expectedCounts);

  console.log("PASS: source/restore databases are distinct loopback-only PostgreSQL 16 instances.");
  console.log("PASS: real application encrypted backup, integrity rejection, and transactional rollback checks.");
  console.log(
    targetIsEmpty
      ? "PASS: this run restored the encrypted source backup into the separate target."
      : "PASS: restore target already contained the exact verified fixture; this rerun made no duplicate restore.",
  );
  console.log("PASS: rows, keys, constraints, indexes, nullable fields, timestamps, and serial sequences verified.");
  console.log("PASS: read-only PostgreSQL source pagination, fingerprints, transforms, and in-memory checkpoints.");
  console.log(`SOURCE_COUNTS=${JSON.stringify(expectedCounts)}`);
  console.log(`RESTORE_COUNTS=${JSON.stringify(await counts(restorePool))}`);
  const fixtureKeyField: Record<SourceTable, string> = {
    universities: "id", users: "id", studentProfiles: "id", parentProfiles: "id",
    reviews: "id", bookmarks: "id", notifications: "id", chatHistory: "id",
    sessions: "token", auditLogs: "id", loginAttempts: "id", universityReviewsAgg: "universityId",
    analyticsEvents: "id",
  };
  console.log(`SYNTHETIC_PRIMARY_KEYS=${JSON.stringify(Object.fromEntries(migrationTables.map(({ source: table }) => [
    table,
    expectedData[table].map((row) => (row as Record<string, unknown>)[fixtureKeyField[table]]),
  ])))}`);
  console.log(`BACKUP_FILE=${backupFilename}`);
  console.log(`BACKUP_DIR=${process.env.BACKUP_DIR}`);
}

try {
  const sourceTables = await sourceAdmin.query(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
  );
  const targetTables = await restorePool.query(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
  );
  assert.equal(sourceTables.rows[0].count, 13);
  assert.equal(targetTables.rows[0].count, 13);
  const initialSourceCounts = await counts(sourceAdmin);
  const expectedData = fixtures();
  const expectedCounts = Object.fromEntries(
    migrationTables.map(({ source }) => [source, expectedData[source].length]),
  );
  const emptyCounts = Object.fromEntries(migrationTables.map(({ source }) => [source, 0]));
  if (JSON.stringify(initialSourceCounts) === JSON.stringify(emptyCounts)) {
    await seed(sourceAdmin);
  } else {
    assert.deepEqual(initialSourceCounts, expectedCounts, "source contains partial or unexpected rows; refusing to continue");
    assert.deepEqual(
      normalize(await readCurrentSchemaSnapshot(sourceAdmin)),
      normalize(expectedData),
      "source is populated with data that differs from the expected synthetic fixture",
    );
  }
  await main();
} finally {
  await sourceAdmin.end();
  await sourceReader.end();
  await restorePool.end();
}
