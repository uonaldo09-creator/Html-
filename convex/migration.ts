import { ConvexError, v } from "convex/values";
import type { Validator } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const nullableString = v.union(v.string(), v.null());
const optionalNullableString = v.optional(nullableString);
const nullableNumber = v.union(v.number(), v.null());
const optionalNullableNumber = v.optional(nullableNumber);
const jsonValue = v.any();
const roles = v.union(
  v.literal("Student"),
  v.literal("Parent"),
  v.literal("Counselor"),
  v.literal("Admin"),
);
const migrationTables = [
  "universities",
  "users",
  "studentProfiles",
  "parentProfiles",
  "reviews",
  "bookmarks",
  "notifications",
  "chatHistory",
  "sessions",
  "auditLogs",
  "loginAttempts",
  "universityReviewsAgg",
  "analyticsEvents",
] as const;
type MigrationTable = (typeof migrationTables)[number];

function fail(code: string): never {
  throw new ConvexError(`MIGRATION_${code}`);
}

/**
 * The identity subject is owned by the PostgreSQL source of truth, not by this
 * migration. Convex must store exactly the value the Express server puts in the
 * JWT, so a missing or blank subject stops the record instead of silently
 * inventing a different identity for that account.
 */
export function requireStoredAuthSubject(authSubject: unknown): string {
  if (typeof authSubject !== "string" || !authSubject.trim()) {
    fail("MISSING_AUTH_SUBJECT");
  }
  return authSubject.trim();
}

function stable(value: unknown): string {
  if (value instanceof Array) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([key, child]) => !key.startsWith("_") && child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueDocuments<T extends { _id: string }>(documents: T[]): T[] {
  return [...new Map(documents.map((document) => [document._id, document])).values()];
}

function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(omitUndefined) as T;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, omitUndefined(child)]),
  ) as T;
}

async function classifyBatch<T, D extends object>(
  ctx: MutationCtx,
  records: readonly T[],
  write: boolean,
  keyOf: (record: T) => string,
  logicalKeyOf: ((doc: D) => string) | undefined,
  lookup: (ctx: MutationCtx, record: T) => Promise<unknown[]>,
  prepare: (ctx: MutationCtx, record: T) => Promise<D>,
  insert: (ctx: MutationCtx, doc: D) => Promise<unknown>,
) {
  if (records.length > 100) fail("BATCH_TOO_LARGE");
  assertUniqueMigrationKeys(records, keyOf);
  const seenLogicalKeys = new Set<string>();
  const identical: string[] = [];
  const missing: string[] = [];
  const conflicting: string[] = [];
  const pending: D[] = [];

  for (const record of records) {
    const key = keyOf(record);
    const doc = omitUndefined(await prepare(ctx, record));
    const logicalKey = logicalKeyOf?.(doc);
    if (logicalKey !== undefined) {
      if (seenLogicalKeys.has(logicalKey)) {
        conflicting.push(key);
        continue;
      }
      seenLogicalKeys.add(logicalKey);
    }
    const matches = await lookup(ctx, record);
    if (matches.length > 1) {
      conflicting.push(key);
      continue;
    }
    if (matches.length === 0) {
      missing.push(key);
      pending.push(doc);
      continue;
    }

    const existing = matches[0] as Record<string, unknown>;
    if (stable(existing) === stable(doc)) identical.push(key);
    else conflicting.push(key);
  }
  if (write && conflicting.length === 0) {
    for (const doc of pending) await insert(ctx, doc);
  }
  return {
    inserted: write && conflicting.length === 0 ? missing.length : 0,
    identical: identical.length,
    missing: missing.length,
    conflicting: conflicting.length,
    identicalKeys: identical,
    missingKeys: missing,
    conflictingKeys: conflicting,
  };
}

export function assertUniqueMigrationKeys<T>(
  records: readonly T[],
  keyOf: (record: T) => string,
): void {
  const keys = new Set<string>();
  for (const record of records) {
    const key = keyOf(record);
    if (!key || keys.has(key)) fail("INVALID_BATCH");
    keys.add(key);
  }
}

async function byLegacyId(ctx: QueryCtx | MutationCtx, table: MigrationTable, legacyId: number) {
  if (!Number.isSafeInteger(legacyId)) fail("INVALID_RECORD");
  switch (table) {
    case "universities": return ctx.db.query("universities").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "users": return ctx.db.query("users").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "studentProfiles": return ctx.db.query("studentProfiles").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "parentProfiles": return ctx.db.query("parentProfiles").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "reviews": return ctx.db.query("reviews").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "bookmarks": return ctx.db.query("bookmarks").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "notifications": return ctx.db.query("notifications").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "chatHistory": return ctx.db.query("chatHistory").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "auditLogs": return ctx.db.query("auditLogs").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "loginAttempts": return ctx.db.query("loginAttempts").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "analyticsEvents": return ctx.db.query("analyticsEvents").withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId)).collect();
    case "universityReviewsAgg":
    case "sessions":
      return fail("INVALID_RECORD");
  }
}

async function universityByLegacyId(ctx: MutationCtx, legacyId: number) {
  const result = await ctx.db
    .query("universities")
    .withIndex("by_legacy_id", (query) => query.eq("legacyId", legacyId))
    .unique();
  if (!result) fail("MISSING_UNIVERSITY");
  return result;
}

async function userByEmail(ctx: MutationCtx, email: string) {
  const result = await ctx.db
    .query("users")
    .withIndex("by_email", (query) => query.eq("email", email.trim().toLowerCase()))
    .unique();
  if (!result) fail("MISSING_USER");
  return result;
}

async function optionalUserByEmail(ctx: MutationCtx, email: string) {
  return ctx.db
    .query("users")
    .withIndex("by_email", (query) => query.eq("email", email.trim().toLowerCase()))
    .unique();
}

function ms(value: number): number {
  if (!Number.isFinite(value)) fail("INVALID_RECORD");
  return value;
}

function validateJson(value: unknown): void {
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): void => {
    if (depth > 40) fail("INVALID_JSON_FIELD");
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number" && Number.isFinite(current)) return;
    if (Array.isArray(current)) {
      if (seen.has(current)) fail("INVALID_JSON_FIELD");
      seen.add(current);
      current.forEach((item) => visit(item, depth + 1));
      seen.delete(current);
      return;
    }
    if (typeof current === "object") {
      if (seen.has(current)) fail("INVALID_JSON_FIELD");
      seen.add(current);
      for (const [key, child] of Object.entries(current)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") fail("INVALID_JSON_FIELD");
        visit(child, depth + 1);
      }
      seen.delete(current);
      return;
    }
    fail("INVALID_JSON_FIELD");
  };
  visit(value, 0);
}

const universityRecord = v.object({
  legacyId: v.number(),
  name: v.string(),
  location: v.string(),
  state: v.string(),
  type: v.string(),
  fee: v.number(),
  rating: v.number(),
  students: v.string(),
  courses: v.number(),
  image: v.string(),
  logo: optionalNullableString,
  categories: v.array(v.string()),
  stream: v.array(v.string()),
  degrees: v.array(v.string()),
  majors: v.array(v.string()),
  popularCourses: v.array(v.string()),
  phone: v.string(),
  competitiveExams: v.array(v.string()),
  min10th: v.number(),
  min12th: v.number(),
  naacGrade: v.string(),
  nirfRank: v.number(),
  aicteApproved: v.boolean(),
  nbaAccredited: v.boolean(),
  nmcRecognized: v.boolean(),
  avgPlacementLPA: v.number(),
  website: optionalNullableString,
  virtualTourUrl: optionalNullableString,
  expertInsight: optionalNullableString,
  alumniStories: v.optional(jsonValue),
  campusMap: v.optional(jsonValue),
  directoryProfile: v.optional(jsonValue),
  createdAt: v.number(),
});

const userRecord = v.object({
  legacyId: v.number(),
  email: v.string(),
  passwordHash: v.string(),
  role: roles,
  name: optionalNullableString,
  loginFailures: v.number(),
  lockedUntil: v.number(),
  createdAt: v.number(),
  emailVerified: v.boolean(),
  verificationTokenHash: optionalNullableString,
  verificationExpires: optionalNullableNumber,
  // Authoritative subject copied from PostgreSQL; never derived in Convex.
  authSubject: v.string(),
  tokenVersion: v.number(),
  disabled: v.boolean(),
});

const studentProfileRecord = v.object({
  legacyId: v.number(),
  userEmail: v.string(),
  stream: optionalNullableString,
  budget: optionalNullableNumber,
  preferredLocation: optionalNullableString,
  preferredCourse: optionalNullableString,
  entranceExams: v.optional(jsonValue),
  hostelPreference: v.boolean(),
  placementPriority: optionalNullableString,
  academicScores: v.optional(jsonValue),
  careerGoals: optionalNullableString,
  updatedAt: v.number(),
});

const parentProfileRecord = v.object({
  legacyId: v.number(),
  userEmail: v.string(),
  budget: optionalNullableNumber,
  preferredStateCity: optionalNullableString,
  safetyPreference: optionalNullableString,
  roiPreference: optionalNullableString,
  scholarshipPreference: optionalNullableString,
  distancePreference: optionalNullableString,
  accommodationPreference: optionalNullableString,
  updatedAt: v.number(),
});

const reviewRecord = v.object({
  legacyId: v.number(),
  legacyUniversityId: v.number(),
  userEmail: v.string(),
  userName: v.string(),
  rating: v.number(),
  comment: v.string(),
  avatar: optionalNullableString,
  reviewDate: v.string(),
  createdAt: v.number(),
});

const bookmarkRecord = v.object({
  legacyId: v.number(),
  userEmail: v.string(),
  legacyUniversityId: v.number(),
  createdAt: v.number(),
});

const notificationRecord = v.object({
  legacyId: v.number(),
  userEmail: v.string(),
  title: v.string(),
  message: v.string(),
  type: v.string(),
  read: v.boolean(),
  createdAt: v.number(),
});

const chatRecord = v.object({
  legacyId: v.number(),
  userEmail: optionalNullableString,
  role: v.string(),
  content: v.string(),
  correlationId: optionalNullableString,
  createdAt: v.number(),
});

const sessionRecord = v.object({
  sessionTokenHash: v.string(),
  email: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  lastUsedAt: v.number(),
  absoluteExpiresAt: v.number(),
});

const auditRecord = v.object({
  legacyId: v.number(),
  action: v.string(),
  details: jsonValue,
  userEmail: optionalNullableString,
  ip: optionalNullableString,
  status: optionalNullableString,
  correlationId: optionalNullableString,
  createdAt: v.number(),
});

const analyticsEventRecord = v.object({
  legacyId: v.number(),
  eventType: v.string(),
  details: v.any(),
  userEmail: nullableString,
  ipAddress: nullableString,
  createdAt: v.number(),
});

const loginAttemptRecord = v.object({
  legacyId: v.number(),
  ip: v.string(),
  email: optionalNullableString,
  success: v.boolean(),
  attemptTime: v.number(),
});

const aggregateRecord = v.object({
  legacyUniversityId: v.number(),
  avgRating: optionalNullableNumber,
  reviewCount: v.number(),
});

function batchMutation<T extends object, D extends object>(
  validator: Validator<T, any, any>,
  keyOf: (record: T) => string,
  lookup: (ctx: MutationCtx, record: T) => Promise<unknown[]>,
  prepare: (ctx: MutationCtx, record: T) => Promise<D>,
  insert: (ctx: MutationCtx, doc: D) => Promise<unknown>,
  logicalKeyOf?: (doc: D) => string,
) {
  return internalMutation({
    args: { records: v.array(validator), write: v.boolean() },
    handler: async (ctx, { records, write }) =>
      classifyBatch(ctx, records, write, keyOf, logicalKeyOf, lookup, prepare, insert),
  });
}

export const migrateUniversities = batchMutation(
  universityRecord,
  (row) => String(row.legacyId),
  (ctx, row) => byLegacyId(ctx, "universities", row.legacyId),
  async (_ctx, row) => {
    for (const value of [row.alumniStories, row.campusMap, row.directoryProfile]) {
      if (value !== undefined) validateJson(value);
    }
    return {
      ...row,
      searchText: [row.name, row.location, row.state, row.type].join(" ").toLowerCase(),
    };
  },
  (ctx, doc) => ctx.db.insert("universities", doc),
);

export const migrateUsers = batchMutation(
  userRecord,
  (row) => String(row.legacyId),
  async (ctx, row) => {
    const byId = await byLegacyId(ctx, "users", row.legacyId);
    const byEmail = await ctx.db.query("users").withIndex("by_email", (query) =>
      query.eq("email", row.email.trim().toLowerCase())).collect();
    return uniqueDocuments([...byId, ...byEmail]);
  },
  async (_ctx, row) => ({
    ...row,
    email: row.email.trim().toLowerCase(),
    authSubject: requireStoredAuthSubject(row.authSubject),
  }),
  (ctx, doc) => ctx.db.insert("users", doc),
  (doc) => doc.email,
);

export const migrateStudentProfiles = batchMutation(
  studentProfileRecord,
  (row) => String(row.legacyId),
  async (ctx, row) => {
    const user = await userByEmail(ctx, row.userEmail);
    if (user.role !== "Student") fail("PROFILE_ROLE_MISMATCH");
    const byId = await byLegacyId(ctx, "studentProfiles", row.legacyId);
    const byUser = await ctx.db.query("studentProfiles").withIndex("by_user", (query) =>
      query.eq("userId", user._id)).collect();
    return uniqueDocuments([...byId, ...byUser]);
  },
  async (ctx, row) => {
    const user = await userByEmail(ctx, row.userEmail);
    for (const value of [row.entranceExams, row.academicScores]) {
      if (value !== undefined) validateJson(value);
    }
    const { userEmail: _userEmail, ...profile } = row;
    return { ...profile, userId: user._id };
  },
  (ctx, doc) => ctx.db.insert("studentProfiles", doc),
  (doc) => String(doc.userId),
);

export const migrateParentProfiles = batchMutation(
  parentProfileRecord,
  (row) => String(row.legacyId),
  async (ctx, row) => {
    const user = await userByEmail(ctx, row.userEmail);
    if (user.role !== "Parent") fail("PROFILE_ROLE_MISMATCH");
    const byId = await byLegacyId(ctx, "parentProfiles", row.legacyId);
    const byUser = await ctx.db.query("parentProfiles").withIndex("by_user", (query) =>
      query.eq("userId", user._id)).collect();
    return uniqueDocuments([...byId, ...byUser]);
  },
  async (ctx, row) => {
    const user = await userByEmail(ctx, row.userEmail);
    const { userEmail: _userEmail, ...profile } = row;
    return { ...profile, userId: user._id };
  },
  (ctx, doc) => ctx.db.insert("parentProfiles", doc),
  (doc) => String(doc.userId),
);

export const migrateReviews = batchMutation(
  reviewRecord,
  (row) => String(row.legacyId),
  (ctx, row) => byLegacyId(ctx, "reviews", row.legacyId),
  async (ctx, row) => {
    const university = await universityByLegacyId(ctx, row.legacyUniversityId);
    const user = await optionalUserByEmail(ctx, row.userEmail);
    return {
      ...row,
      universityId: university._id,
      userId: user?._id,
    };
  },
  (ctx, doc) => ctx.db.insert("reviews", doc),
);

export const migrateBookmarks = batchMutation(
  bookmarkRecord,
  (row) => String(row.legacyId),
  async (ctx, row) => {
    const user = await userByEmail(ctx, row.userEmail);
    const university = await universityByLegacyId(ctx, row.legacyUniversityId);
    const byId = await byLegacyId(ctx, "bookmarks", row.legacyId);
    const byPair = await ctx.db.query("bookmarks").withIndex("by_user_university", (query) =>
      query.eq("userId", user._id).eq("universityId", university._id)).collect();
    return uniqueDocuments([...byId, ...byPair]);
  },
  async (ctx, row) => {
    const user = await userByEmail(ctx, row.userEmail);
    const university = await universityByLegacyId(ctx, row.legacyUniversityId);
    return {
      legacyId: row.legacyId,
      userId: user._id,
      universityId: university._id,
      legacyUniversityId: row.legacyUniversityId,
      createdAt: ms(row.createdAt),
    };
  },
  (ctx, doc) => ctx.db.insert("bookmarks", doc),
  (doc) => `${doc.userId}:${doc.universityId}`,
);

export const migrateNotifications = batchMutation(
  notificationRecord,
  (row) => String(row.legacyId),
  (ctx, row) => byLegacyId(ctx, "notifications", row.legacyId),
  async (ctx, row) => {
    const user = await optionalUserByEmail(ctx, row.userEmail);
    return { ...row, userId: user?._id };
  },
  (ctx, doc) => ctx.db.insert("notifications", doc),
);

export const migrateChatHistory = batchMutation(
  chatRecord,
  (row) => String(row.legacyId),
  (ctx, row) => byLegacyId(ctx, "chatHistory", row.legacyId),
  async (ctx, row) => {
    const user = row.userEmail ? await optionalUserByEmail(ctx, row.userEmail) : null;
    return { ...row, userId: user?._id };
  },
  (ctx, doc) => ctx.db.insert("chatHistory", doc),
);

export const migrateSessions = batchMutation(
  sessionRecord,
  (row) => row.sessionTokenHash,
  async (ctx, row) => ctx.db.query("sessions").withIndex("by_token_hash", (query) =>
    query.eq("sessionTokenHash", row.sessionTokenHash)).collect(),
  async (ctx, row) => {
    const user = await userByEmail(ctx, row.email);
    const { email: _email, ...session } = row;
    return { ...session, userId: user._id };
  },
  (ctx, doc) => ctx.db.insert("sessions", doc),
);

export const migrateAuditLogs = batchMutation(
  auditRecord,
  (row) => String(row.legacyId),
  (ctx, row) => byLegacyId(ctx, "auditLogs", row.legacyId),
  async (_ctx, row) => {
    validateJson(row.details);
    return row;
  },
  (ctx, doc) => ctx.db.insert("auditLogs", doc),
);

export const migrateAnalyticsEvents = batchMutation(
  analyticsEventRecord,
  (row) => String(row.legacyId),
  (ctx, row) => byLegacyId(ctx, "analyticsEvents", row.legacyId),
  async (_ctx, row) => {
    validateJson(row.details);
    return row;
  },
  (ctx, doc) => ctx.db.insert("analyticsEvents", doc),
);

export const migrateLoginAttempts = batchMutation(
  loginAttemptRecord,
  (row) => String(row.legacyId),
  (ctx, row) => byLegacyId(ctx, "loginAttempts", row.legacyId),
  async (_ctx, row) => row,
  (ctx, doc) => ctx.db.insert("loginAttempts", doc),
);

export const migrateUniversityReviewsAgg = batchMutation(
  aggregateRecord,
  (row) => String(row.legacyUniversityId),
  async (ctx, row) => {
    const university = await universityByLegacyId(ctx, row.legacyUniversityId);
    const byLegacy = await ctx.db.query("universityReviewsAgg").withIndex("by_legacy_university", (query) =>
      query.eq("legacyUniversityId", row.legacyUniversityId)).collect();
    const byUniversity = await ctx.db.query("universityReviewsAgg").withIndex("by_university", (query) =>
      query.eq("universityId", university._id)).collect();
    return uniqueDocuments([...byLegacy, ...byUniversity]);
  },
  async (ctx, row) => {
    const university = await universityByLegacyId(ctx, row.legacyUniversityId);
    return { ...row, universityId: university._id };
  },
  (ctx, doc) => ctx.db.insert("universityReviewsAgg", doc),
  (doc) => String(doc.universityId),
);

const counterTable = v.union(
  v.literal("universities"),
  v.literal("users"),
  v.literal("reviews"),
  v.literal("bookmarks"),
  v.literal("chatHistory"),
  v.literal("auditLogs"),
  v.literal("loginAttempts"),
  v.literal("studentProfiles"),
  v.literal("parentProfiles"),
  v.literal("notifications"),
  v.literal("analyticsEvents"),
);

/**
 * Raises the durable ID counter for a table so it can never hand out a value at
 * or below an imported legacy ID. The counter only ever moves forward, so a
 * repeated import is a no-op. `nextId` is the value to be returned by the next
 * allocation, so a table whose maximum legacy ID is N is reserved as N + 1.
 */
export const reserveIdCounterFloor = internalMutation({
  args: { tableName: counterTable, nextId: v.number() },
  handler: async (ctx, { tableName, nextId }) => {
    if (!Number.isSafeInteger(nextId) || nextId < 1) fail("INVALID_COUNTER");
    const existing = await ctx.db.query("idCounters").withIndex("by_table_name", (query) =>
      query.eq("tableName", tableName)).unique();
    if (!existing) {
      await ctx.db.insert("idCounters", { tableName, nextId });
      return { nextId, advanced: true };
    }
    if (nextId > existing.nextId) {
      await ctx.db.patch(existing._id, { nextId });
      return { nextId, advanced: true };
    }
    return { nextId: existing.nextId, advanced: false };
  },
});

/**
 * Allocates the next legacy-style integer ID for a table. It only ever returns
 * values strictly above the reserved floor, so a freshly imported row can never
 * be handed out twice. Internal-only; ordinary clients cannot reach it.
 */
export const allocateNextLegacyId = internalMutation({
  args: { tableName: counterTable },
  handler: async (ctx, { tableName }) => {
    const existing = await ctx.db.query("idCounters").withIndex("by_table_name", (query) =>
      query.eq("tableName", tableName)).unique();
    if (!existing) {
      await ctx.db.insert("idCounters", { tableName, nextId: 2 });
      return { id: 1 };
    }
    const id = existing.nextId;
    if (!Number.isSafeInteger(id) || id < 1) fail("INVALID_COUNTER");
    await ctx.db.patch(existing._id, { nextId: id + 1 });
    return { id };
  },
});

/**
 * Reports which of the supplied legacy keys are absent from a table. Used only
 * for bounded read-only key verification; it never writes.
 */
export const listMissingKeys = internalQuery({
  args: {
    tableName: v.union(...migrationTables.map((table) => v.literal(table))),
    keys: v.array(v.string()),
  },
  handler: async (ctx, { tableName, keys }) => {
    if (keys.length > 100) fail("BATCH_TOO_LARGE");
    const missing: string[] = [];
    for (const key of keys) {
      const exists = await (async () => {
        if (tableName === "sessions") {
          return !!await ctx.db.query("sessions").withIndex("by_token_hash", (query) =>
            query.eq("sessionTokenHash", key)).unique();
        }
        const legacyId = Number(key);
        if (!Number.isSafeInteger(legacyId)) fail("INVALID_RECORD");
        if (tableName === "universityReviewsAgg") {
          return !!await ctx.db.query("universityReviewsAgg").withIndex("by_legacy_university", (query) =>
            query.eq("legacyUniversityId", legacyId)).unique();
        }
        return (await byLegacyId(ctx, tableName, legacyId)).length > 0;
      })();
      if (!exists) missing.push(key);
    }
    return { missing };
  },
});

export const getCheckpoint = internalQuery({
  args: { tableName: v.union(...migrationTables.map((table) => v.literal(table))) },
  handler: async (ctx: QueryCtx, { tableName }) =>
    ctx.db.query("migrationCheckpoints").withIndex("by_table_name", (query) =>
      query.eq("tableName", tableName)).unique(),
});

export const saveCheckpoint = internalMutation({
  args: {
    tableName: v.union(...migrationTables.map((table) => v.literal(table))),
    sourceFingerprint: v.string(),
    cursor: v.union(v.string(), v.null()),
    sourceCount: v.number(),
    inserted: v.number(),
    plannedInsert: v.number(),
    alreadyPresent: v.number(),
    verified: v.number(),
    done: v.boolean(),
  },
  handler: async (ctx, checkpoint) => {
    for (const count of [
      checkpoint.sourceCount,
      checkpoint.inserted,
      checkpoint.plannedInsert,
      checkpoint.alreadyPresent,
      checkpoint.verified,
    ]) {
      if (!Number.isSafeInteger(count) || count < 0) fail("INVALID_CHECKPOINT");
    }
    const existing = await ctx.db.query("migrationCheckpoints").withIndex("by_table_name", (query) =>
      query.eq("tableName", checkpoint.tableName)).unique();
    if (existing && existing.sourceFingerprint !== checkpoint.sourceFingerprint) {
      fail("CHECKPOINT_FINGERPRINT_MISMATCH");
    }
    if (existing && checkpoint.verified < existing.verified) fail("CHECKPOINT_REGRESSION");
    if (existing) await ctx.db.patch(existing._id, checkpoint);
    else await ctx.db.insert("migrationCheckpoints", checkpoint);
    return { saved: true };
  },
});

export const listLegacyKeys = internalQuery({
  args: {
    tableName: v.union(...migrationTables.map((table) => v.literal(table))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { tableName, paginationOpts }) => {
    const page = await (async () => {
      switch (tableName) {
        case "universities": return ctx.db.query("universities").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "users": return ctx.db.query("users").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "studentProfiles": return ctx.db.query("studentProfiles").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "parentProfiles": return ctx.db.query("parentProfiles").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "reviews": return ctx.db.query("reviews").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "bookmarks": return ctx.db.query("bookmarks").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "notifications": return ctx.db.query("notifications").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "chatHistory": return ctx.db.query("chatHistory").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "auditLogs": return ctx.db.query("auditLogs").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "loginAttempts": return ctx.db.query("loginAttempts").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "analyticsEvents": return ctx.db.query("analyticsEvents").withIndex("by_legacy_id").order("asc").paginate(paginationOpts);
        case "sessions": return ctx.db.query("sessions").withIndex("by_token_hash").order("asc").paginate(paginationOpts);
        case "universityReviewsAgg": return ctx.db.query("universityReviewsAgg").withIndex("by_legacy_university").order("asc").paginate(paginationOpts);
      }
    })();

    const keys = page.page.map((document) => {
      const fields = document as {
        sessionTokenHash?: string;
        legacyUniversityId?: number;
        legacyId?: number;
      };
      const key = tableName === "sessions"
        ? fields.sessionTokenHash
        : tableName === "universityReviewsAgg"
          ? fields.legacyUniversityId
          : fields.legacyId;
      if (key === undefined) fail("INVALID_DESTINATION_KEY");
      return String(key);
    });
    return { keys, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

const relationTableName = v.union(
  v.literal("studentProfiles"),
  v.literal("parentProfiles"),
  v.literal("reviews"),
  v.literal("bookmarks"),
  v.literal("notifications"),
  v.literal("chatHistory"),
  v.literal("sessions"),
  v.literal("universityReviewsAgg"),
);

export const verifyRecordRelations = internalQuery({
  args: {
    checks: v.array(v.object({
      tableName: relationTableName,
      legacyKey: v.union(v.string(), v.number()),
    })),
  },
  handler: async (ctx, { checks }) => {
    if (checks.length > 100) fail("BATCH_TOO_LARGE");
    const valid = await Promise.all(checks.map(async ({ tableName, legacyKey }) => {
      if (tableName === "sessions") {
        if (typeof legacyKey !== "string") return false;
        const session = await ctx.db.query("sessions").withIndex("by_token_hash", (query) =>
          query.eq("sessionTokenHash", legacyKey)).unique();
        return !!session && !!await ctx.db.get(session.userId);
      }
      if (typeof legacyKey !== "number" || !Number.isSafeInteger(legacyKey)) return false;

      switch (tableName) {
        case "studentProfiles": {
          const profile = await ctx.db.query("studentProfiles").withIndex("by_legacy_id", (query) =>
            query.eq("legacyId", legacyKey)).unique();
          const user = profile ? await ctx.db.get(profile.userId) : null;
          return user?.role === "Student";
        }
        case "parentProfiles": {
          const profile = await ctx.db.query("parentProfiles").withIndex("by_legacy_id", (query) =>
            query.eq("legacyId", legacyKey)).unique();
          const user = profile ? await ctx.db.get(profile.userId) : null;
          return user?.role === "Parent";
        }
        case "reviews": {
          const review = await ctx.db.query("reviews").withIndex("by_legacy_id", (query) =>
            query.eq("legacyId", legacyKey)).unique();
          const university = review ? await ctx.db.get(review.universityId) : null;
          const user = review?.userId ? await ctx.db.get(review.userId) : undefined;
          return !!review &&
            university?.legacyId === review.legacyUniversityId &&
            (!review.userId || !!user);
        }
        case "bookmarks": {
          const bookmark = await ctx.db.query("bookmarks").withIndex("by_legacy_id", (query) =>
            query.eq("legacyId", legacyKey)).unique();
          const user = bookmark ? await ctx.db.get(bookmark.userId) : null;
          const university = bookmark ? await ctx.db.get(bookmark.universityId) : null;
          return !!bookmark &&
            !!user &&
            university?.legacyId === bookmark.legacyUniversityId;
        }
        case "notifications": {
          const notification = await ctx.db.query("notifications").withIndex("by_legacy_id", (query) =>
            query.eq("legacyId", legacyKey)).unique();
          const user = notification?.userId ? await ctx.db.get(notification.userId) : undefined;
          return !!notification &&
            (!notification.userId ||
              (user?.email === notification.userEmail.trim().toLowerCase()));
        }
        case "chatHistory": {
          const message = await ctx.db.query("chatHistory").withIndex("by_legacy_id", (query) =>
            query.eq("legacyId", legacyKey)).unique();
          const user = message?.userId ? await ctx.db.get(message.userId) : undefined;
          return !!message &&
            (!message.userId ||
              (user?.email === message.userEmail?.trim().toLowerCase()));
        }
        case "universityReviewsAgg": {
          const aggregate = await ctx.db.query("universityReviewsAgg").withIndex("by_legacy_university", (query) =>
            query.eq("legacyUniversityId", legacyKey)).unique();
          const university = aggregate ? await ctx.db.get(aggregate.universityId) : null;
          return !!aggregate &&
            university?.legacyId === aggregate.legacyUniversityId;
        }
      }
    }));
    return { checked: valid.length, invalid: valid.filter((isValid) => !isValid).length };
  },
});

export const tableNames = migrationTables;
