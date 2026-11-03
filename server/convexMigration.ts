export const migrationTables = [
  { source: "universities", destination: "universities", key: "id" },
  { source: "users", destination: "users", key: "id" },
  { source: "studentProfiles", destination: "studentProfiles", key: "id" },
  { source: "parentProfiles", destination: "parentProfiles", key: "id" },
  { source: "reviews", destination: "reviews", key: "id" },
  { source: "bookmarks", destination: "bookmarks", key: "id" },
  { source: "notifications", destination: "notifications", key: "id" },
  { source: "chatHistory", destination: "chatHistory", key: "id" },
  { source: "sessions", destination: "sessions", key: "token" },
  { source: "auditLogs", destination: "auditLogs", key: "id" },
  { source: "loginAttempts", destination: "loginAttempts", key: "id" },
  { source: "universityReviewsAgg", destination: "universityReviewsAgg", key: "universityId" },
  { source: "analyticsEvents", destination: "analyticsEvents", key: "id" },
] as const;

export const expectedSourceTables = [
  "analyticsEvents",
  "auditLogs",
  "bookmarks",
  "chatHistory",
  "loginAttempts",
  "notifications",
  "parentProfiles",
  "reviews",
  "sessions",
  "studentProfiles",
  "universities",
  "universityReviewsAgg",
  "users",
] as const satisfies readonly SourceTable[];

export type SourceTable = (typeof migrationTables)[number]["source"];
export type MigrationSnapshot = Partial<Record<SourceTable, readonly unknown[]>>;
const MAX_MIGRATION_BATCH_SIZE = 100;

export interface MigrationIssue {
  severity: "error" | "warning";
  table: SourceTable;
  row: number;
  code: string;
  field?: string;
}

export class MigrationPreflightError extends Error {
  constructor(public readonly issueCodes: readonly string[]) {
    super("Migration preflight has unapproved errors or warnings.");
    this.name = "MigrationPreflightError";
  }
}

export function assertMigrationPreflightClear(
  issues: readonly MigrationIssue[],
  approvedWarningCodes: readonly string[] = [],
): void {
  const blocking = issues.filter(
    (issue) => issue.severity === "error" || !approvedWarningCodes.includes(issue.code),
  );
  if (blocking.length > 0) {
    throw new MigrationPreflightError([...new Set(blocking.map((issue) => issue.code))]);
  }
}

const requiredFields: Record<SourceTable, readonly string[]> = {
  universities: [
    "id", "name", "location", "state", "type", "fee", "rating", "students",
    "courses", "image", "categories", "stream", "degrees", "majors",
    "popularCourses", "phone", "competitiveExams", "min10th", "min12th",
    "naacGrade", "nirfRank", "aicteApproved", "nbaAccredited", "nmcRecognized",
    "avgPlacementLPA", "createdAt",
  ],
  users: [
    "id", "email", "password", "role", "loginFailures", "lockedUntil",
    "createdAt", "emailVerified", "authSubject", "tokenVersion", "disabled",
  ],
  studentProfiles: ["id", "userEmail", "hostelPreference", "updatedAt"],
  parentProfiles: ["id", "userEmail", "updatedAt"],
  reviews: [
    "id", "universityId", "userEmail", "userName", "rating", "comment",
    "reviewDate", "createdAt",
  ],
  bookmarks: ["id", "userEmail", "universityId", "createdAt"],
  notifications: ["id", "userEmail", "title", "message", "type", "read", "createdAt"],
  chatHistory: ["id", "role", "content", "createdAt"],
  sessions: ["token", "email", "expiresAt", "createdAt", "lastUsedAt", "absoluteExpiresAt"],
  auditLogs: ["id", "action", "details", "createdAt"],
  loginAttempts: ["id", "ip", "success", "attemptTime"],
  universityReviewsAgg: ["universityId", "reviewCount"],
  analyticsEvents: ["id", "eventType", "createdAt"],
};

const timestampFields: Partial<Record<SourceTable, readonly string[]>> = {
  universities: ["createdAt"],
  users: ["createdAt", "verificationExpires"],
  studentProfiles: ["updatedAt"],
  parentProfiles: ["updatedAt"],
  reviews: ["createdAt"],
  bookmarks: ["createdAt"],
  notifications: ["createdAt"],
  chatHistory: ["createdAt"],
  sessions: ["createdAt", "lastUsedAt"],
  auditLogs: ["createdAt"],
  loginAttempts: ["attemptTime"],
  analyticsEvents: ["createdAt"],
};

const fieldTypes: Partial<Record<SourceTable, Partial<Record<string, "string" | "number" | "boolean" | "array" | "string_array" | "safe_integer" | "postgres_integer" | "nonnegative_postgres_integer" | "nullable_string" | "json">>>> = {
  universities: {
    name: "string", location: "string", state: "string", type: "string", fee: "number",
    rating: "number", students: "string", courses: "number", image: "string",
    categories: "string_array", stream: "string_array", degrees: "string_array", majors: "string_array",
    popularCourses: "string_array", phone: "string", competitiveExams: "string_array",
    min10th: "number", min12th: "number", naacGrade: "string", nirfRank: "number",
    aicteApproved: "boolean", nbaAccredited: "boolean", nmcRecognized: "boolean",
    avgPlacementLPA: "number",
  },
  users: {
    email: "string", password: "string", role: "string", loginFailures: "number",
    lockedUntil: "safe_integer", emailVerified: "boolean", authSubject: "string",
    tokenVersion: "nonnegative_postgres_integer", disabled: "boolean",
  },
  studentProfiles: { userEmail: "string", hostelPreference: "boolean" },
  parentProfiles: { userEmail: "string" },
  reviews: {
    universityId: "number", userEmail: "string", userName: "string",
    rating: "number", comment: "string", reviewDate: "string",
  },
  bookmarks: { userEmail: "string", universityId: "number" },
  notifications: {
    userEmail: "string", title: "string", message: "string", type: "string", read: "boolean",
  },
  chatHistory: { role: "string", content: "string" },
  sessions: {
    token: "string", email: "string", expiresAt: "safe_integer", absoluteExpiresAt: "safe_integer",
  },
  auditLogs: { action: "string" },
  loginAttempts: { ip: "string", success: "boolean" },
  universityReviewsAgg: { universityId: "number", reviewCount: "number" },
  analyticsEvents: {
    id: "postgres_integer",
    eventType: "string",
    details: "json",
    userEmail: "nullable_string",
    ipAddress: "nullable_string",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFieldType(
  value: unknown,
  type: "string" | "number" | "boolean" | "array" | "string_array" | "safe_integer" | "postgres_integer" | "nonnegative_postgres_integer" | "nullable_string" | "json",
): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "string_array") {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
  if (type === "safe_integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (type === "postgres_integer") {
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= -2_147_483_648 &&
      value <= 2_147_483_647;
  }
  if (type === "nonnegative_postgres_integer") {
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 2_147_483_647;
  }
  if (type === "nullable_string") return value === null || typeof value === "string";
  if (type === "json") return isMigrationJsonValue(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

export function isMigrationJsonValue(value: unknown): boolean {
  const ancestors = new Set<object>();
  const visit = (current: unknown, depth: number): boolean => {
    if (depth > 40) return false;
    if (current === null || typeof current === "string" || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current !== "object") return false;
    if (ancestors.has(current)) return false;
    if (!Array.isArray(current)) {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return false;
    }
    ancestors.add(current);
    const valid = Array.isArray(current)
      ? current.every((item) => visit(item, depth + 1))
      : Object.entries(current).every(([key, item]) =>
          key !== "__proto__" &&
          key !== "constructor" &&
          key !== "prototype" &&
          visit(item, depth + 1),
        );
    ancestors.delete(current);
    return valid;
  };
  return visit(value, 0);
}

const presentFields: Partial<Record<SourceTable, readonly string[]>> = {
  analyticsEvents: ["details", "userEmail", "ipAddress"],
};

function isValidTimestamp(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length > 0 && Number.isFinite(Date.parse(value));
  return false;
}

function normalizedEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLocaleLowerCase("en-US")
    : null;
}

export function validateMigrationSnapshot(snapshot: MigrationSnapshot): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  const rows = {} as Record<SourceTable, Record<string, unknown>[]>;

  for (const { source, key } of migrationTables) {
    const sourceRows = snapshot[source];
    if (!Array.isArray(sourceRows)) {
      issues.push({ severity: "error", table: source, row: -1, code: "missing_table" });
      rows[source] = [];
      continue;
    }

    rows[source] = [];
    const seenKeys = new Set<string>();
    for (const [rowIndex, value] of sourceRows.entries()) {
      if (!isRecord(value)) {
        issues.push({ severity: "error", table: source, row: rowIndex, code: "invalid_row" });
        continue;
      }
      rows[source].push(value);

      for (const field of requiredFields[source]) {
        if (value[field] === undefined || value[field] === null) {
          issues.push({ severity: "error", table: source, row: rowIndex, code: "missing_required_field", field });
        }
      }
      for (const field of presentFields[source] ?? []) {
        if (value[field] === undefined) {
          issues.push({ severity: "error", table: source, row: rowIndex, code: "missing_source_field", field });
        }
      }
      for (const [field, type] of Object.entries(fieldTypes[source] ?? {})) {
        if (value[field] !== undefined && !hasFieldType(value[field], type!)) {
          issues.push({ severity: "error", table: source, row: rowIndex, code: "invalid_field_type", field });
        }
      }

      const keyValue = value[key];
      if (key === "token") {
        if (typeof keyValue !== "string" || !keyValue) {
          issues.push({ severity: "error", table: source, row: rowIndex, code: "invalid_key", field: key });
        } else if (seenKeys.has(keyValue)) {
          issues.push({ severity: "error", table: source, row: rowIndex, code: "duplicate_key", field: key });
        } else {
          seenKeys.add(keyValue);
        }
      } else if (
        typeof keyValue !== "number" ||
        !Number.isSafeInteger(keyValue) ||
        (source !== "universities" && source !== "universityReviewsAgg" && source !== "analyticsEvents" && keyValue <= 0)
      ) {
        issues.push({ severity: "error", table: source, row: rowIndex, code: "invalid_key", field: key });
      } else if (seenKeys.has(String(keyValue))) {
        issues.push({ severity: "error", table: source, row: rowIndex, code: "duplicate_key", field: key });
      } else {
        seenKeys.add(String(keyValue));
      }
      if (source === "universities" && typeof keyValue === "number" && keyValue <= 0) {
        issues.push({
          severity: "warning",
          table: source,
          row: rowIndex,
          code: "legacy_id_not_publicly_addressable",
          field: key,
        });
      }

      for (const field of timestampFields[source] ?? []) {
        const timestamp = value[field];
        if (timestamp !== null && timestamp !== undefined && !isValidTimestamp(timestamp)) {
          issues.push({ severity: "error", table: source, row: rowIndex, code: "invalid_timestamp", field });
        }
      }
    }
  }

  const universityIds = new Set(rows.universities.map((row) => row.id));
  const usersByEmail = new Map<string, Record<string, unknown>>();
  const usersBySubject = new Map<string, number>();
  for (const [row, user] of rows.users.entries()) {
    const email = normalizedEmail(user.email);
    if (!email) {
      issues.push({ severity: "error", table: "users", row, code: "invalid_email", field: "email" });
      continue;
    }
    if (usersByEmail.has(email)) {
      issues.push({ severity: "error", table: "users", row, code: "duplicate_logical_key", field: "email" });
    } else {
      usersByEmail.set(email, user);
    }
    if (!["Student", "Parent", "Counselor", "Admin"].includes(String(user.role))) {
      issues.push({ severity: "error", table: "users", row, code: "invalid_role", field: "role" });
    }
    // The subject is the JWT identity. A blank, email-shaped or duplicated subject would
    // let two accounts collapse onto one identity, so each one stops the migration.
    const subject = typeof user.authSubject === "string" ? user.authSubject.trim() : "";
    if (!subject) {
      // A missing field is already reported as missing_required_field; a blank string is not.
      if (typeof user.authSubject === "string") {
        issues.push({ severity: "error", table: "users", row, code: "invalid_auth_subject", field: "authSubject" });
      }
    } else if (subject.toLowerCase() === email) {
      issues.push({ severity: "error", table: "users", row, code: "subject_is_email", field: "authSubject" });
    } else if (usersBySubject.has(subject)) {
      issues.push({ severity: "error", table: "users", row, code: "duplicate_auth_subject", field: "authSubject" });
    } else {
      usersBySubject.set(subject, row);
    }
  }

  const checkUniversityReference = (table: SourceTable, field: string) => {
    for (const [row, record] of rows[table].entries()) {
      if (!universityIds.has(record[field])) {
        issues.push({ severity: "error", table, row, code: "missing_relationship", field });
      }
    }
  };
  const checkUserReference = (table: SourceTable, field: string, required: boolean) => {
    for (const [row, record] of rows[table].entries()) {
      const email = normalizedEmail(record[field]);
      if (!email) {
        if (required) issues.push({ severity: "error", table, row, code: "missing_relationship", field });
        continue;
      }
      if (!usersByEmail.has(email)) {
        // Guest chat history has no corresponding user by design.
        // Preserve userEmail during migration; never invent a userId.
        const isUnlinkedGuestChat =
          table === "chatHistory" && email.startsWith("guest@");

        if (isUnlinkedGuestChat) continue;

        issues.push({
          severity: required ? "error" : "warning",
          table,
          row,
          code: required ? "missing_relationship" : "unresolved_optional_relationship",
          field,
        });
      }
    }
  };

  checkUniversityReference("reviews", "universityId");
  checkUniversityReference("bookmarks", "universityId");
  checkUniversityReference("universityReviewsAgg", "universityId");
  checkUserReference("bookmarks", "userEmail", true);
  checkUserReference("sessions", "email", true);
  checkUserReference("studentProfiles", "userEmail", true);
  checkUserReference("parentProfiles", "userEmail", true);
  checkUserReference("reviews", "userEmail", false);
  checkUserReference("chatHistory", "userEmail", false);
  checkUserReference("auditLogs", "userEmail", false);
  checkUserReference("notifications", "userEmail", false);

  const profileKeys = new Set<string>();
  for (const table of ["studentProfiles", "parentProfiles"] as const) {
    for (const [row, profile] of rows[table].entries()) {
      const email = normalizedEmail(profile.userEmail);
      if (!email) continue;
      const key = `${table}:${email}`;
      if (profileKeys.has(key)) {
        issues.push({ severity: "error", table, row, code: "duplicate_logical_key", field: "userEmail" });
      }
      profileKeys.add(key);

      const userRole = usersByEmail.get(email)?.role;
      const expectedRole = table === "studentProfiles" ? "Student" : "Parent";
      if (userRole !== undefined && userRole !== expectedRole) {
        issues.push({ severity: "error", table, row, code: "relationship_role_mismatch", field: "userEmail" });
      }
    }
  }

  const bookmarks = new Set<string>();
  for (const [row, bookmark] of rows.bookmarks.entries()) {
    const email = normalizedEmail(bookmark.userEmail);
    const key = `${email}:${String(bookmark.universityId)}`;
    if (bookmarks.has(key)) {
      issues.push({ severity: "error", table: "bookmarks", row, code: "duplicate_logical_key" });
    }
    bookmarks.add(key);
  }

  return issues;
}

export interface MigrationRecord {
  key: string;
  value: unknown;
}

export interface MigrationBatch<T extends MigrationRecord = MigrationRecord> {
  records: T[];
  nextCursor: string | null;
  done: boolean;
}

export interface MigrationCheckpoint {
  sourceFingerprint: string;
  cursor: string | null;
  sourceCount: number;
  inserted: number;
  plannedInsert: number;
  alreadyPresent: number;
  verified: number;
  done: boolean;
}

export interface MigrationAdapter<T extends MigrationRecord = MigrationRecord> {
  sourceFingerprint(): Promise<string>;
  countSource(table: SourceTable): Promise<number>;
  readBatch(table: SourceTable, cursor: string | null, limit: number): Promise<MigrationBatch<T>>;
  classify(table: SourceTable, records: readonly T[]): Promise<{
    identical: readonly string[];
    missing: readonly string[];
    conflicting: readonly string[];
  }>;
  insertBatch(table: SourceTable, records: readonly T[]): Promise<void>;
  loadCheckpoint(table: SourceTable): Promise<MigrationCheckpoint | null>;
  saveCheckpoint(table: SourceTable, checkpoint: MigrationCheckpoint): Promise<void>;
}

export interface MigrationRunOptions {
  batchSize: number;
  maxRetries: number;
  dryRun?: boolean;
}

export interface MigrationTableResult {
  sourceCount: number;
  inserted: number;
  plannedInsert: number;
  alreadyPresent: number;
  verified: number;
}

export type MigrationRunResult = Record<SourceTable, MigrationTableResult>;

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly table: SourceTable,
    public readonly code: "conflict" | "invalid_batch" | "retry_exhausted" | "verification_failed" | "cursor_stalled",
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

function assertClassification(
  table: SourceTable,
  records: readonly MigrationRecord[],
  classification: Awaited<ReturnType<MigrationAdapter["classify"]>>,
): void {
  const sourceKeys = new Set(records.map((record) => record.key));
  if (sourceKeys.size !== records.length) {
    throw new MigrationError("Duplicate source key in migration batch.", table, "invalid_batch");
  }

  const classifiedKeys = [
    ...classification.identical,
    ...classification.missing,
    ...classification.conflicting,
  ];
  if (
    classifiedKeys.length !== sourceKeys.size ||
    new Set(classifiedKeys).size !== sourceKeys.size ||
    classifiedKeys.some((key) => !sourceKeys.has(key))
  ) {
    throw new MigrationError("Destination classification was incomplete.", table, "invalid_batch");
  }
}

export async function runBatchedMigration<T extends MigrationRecord>(
  adapter: MigrationAdapter<T>,
  options: MigrationRunOptions,
): Promise<MigrationRunResult> {
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > MAX_MIGRATION_BATCH_SIZE) {
    throw new RangeError(`batchSize must be an integer from 1 to ${MAX_MIGRATION_BATCH_SIZE}.`);
  }
  if (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 1) {
    throw new RangeError("maxRetries must be a positive safe integer.");
  }

  const results = Object.fromEntries(
    migrationTables.map(({ source }) => [
      source,
      { sourceCount: 0, inserted: 0, plannedInsert: 0, alreadyPresent: 0, verified: 0 },
    ]),
  ) as MigrationRunResult;
  const sourceFingerprint = await adapter.sourceFingerprint();
  if (!sourceFingerprint) throw new Error("Source fingerprint is required for resumable migration.");

  for (const { source: table } of migrationTables) {
    const expectedSourceCount = await adapter.countSource(table);
    if (!Number.isSafeInteger(expectedSourceCount) || expectedSourceCount < 0) {
      throw new MigrationError("Source count is invalid.", table, "verification_failed");
    }

    const checkpoint = options.dryRun ? null : await adapter.loadCheckpoint(table);
    if (checkpoint && checkpoint.sourceFingerprint !== sourceFingerprint) {
      throw new MigrationError("Checkpoint does not match the current source snapshot.", table, "invalid_batch");
    }
    if (checkpoint && checkpoint.sourceCount > expectedSourceCount) {
      throw new MigrationError("Checkpoint count exceeds the current source count.", table, "verification_failed");
    }
    if (checkpoint?.done) {
      if (checkpoint.sourceCount !== expectedSourceCount || checkpoint.verified !== expectedSourceCount) {
        throw new MigrationError("Completed checkpoint count does not match the source.", table, "verification_failed");
      }
      results[table] = {
        sourceCount: checkpoint.sourceCount,
        inserted: checkpoint.inserted,
        plannedInsert: checkpoint.plannedInsert,
        alreadyPresent: checkpoint.alreadyPresent,
        verified: checkpoint.verified,
      };
      continue;
    }

    let cursor = checkpoint?.cursor ?? null;
    const tableResult = results[table];
    if (checkpoint) {
      tableResult.sourceCount = checkpoint.sourceCount;
      tableResult.inserted = checkpoint.inserted;
      tableResult.plannedInsert = checkpoint.plannedInsert;
      tableResult.alreadyPresent = checkpoint.alreadyPresent;
      tableResult.verified = checkpoint.verified;
    }
    while (true) {
      const batch = await adapter.readBatch(table, cursor, options.batchSize);
      if (batch.records.length > options.batchSize) {
        throw new MigrationError("Source returned an oversized batch.", table, "invalid_batch");
      }
      if (batch.records.length === 0 && !batch.done) {
        throw new MigrationError("Source returned an empty non-final batch.", table, "invalid_batch");
      }

      if (batch.records.length > 0) {
        let firstClassification: Awaited<ReturnType<MigrationAdapter["classify"]>> | undefined;
        let verified = false;
        let lastError: unknown;

        for (let attempt = 0; attempt < options.maxRetries && !verified; attempt += 1) {
          try {
            const classification = await adapter.classify(table, batch.records);
            assertClassification(table, batch.records, classification);
            if (classification.conflicting.length > 0) {
              throw new MigrationError("Destination contains conflicting legacy keys.", table, "conflict");
            }
            firstClassification ??= classification;

            if (!options.dryRun && classification.missing.length > 0) {
              await adapter.insertBatch(
                table,
                batch.records.filter((record) => classification.missing.includes(record.key)),
              );
            }

            const finalClassification = options.dryRun
              ? classification
              : await adapter.classify(table, batch.records);
            assertClassification(table, batch.records, finalClassification);
            if (finalClassification.conflicting.length > 0) {
              throw new MigrationError("Destination contains conflicting legacy keys.", table, "conflict");
            }
            if (!options.dryRun && finalClassification.missing.length > 0) {
              throw new MigrationError("Written batch did not verify in the destination.", table, "verification_failed");
            }
            verified = true;
          } catch (error) {
            if (error instanceof MigrationError && error.code === "conflict") throw error;
            lastError = error;
          }
        }

        if (!verified) {
          throw new MigrationError(
            "Migration batch failed after bounded retries.",
            table,
            lastError instanceof MigrationError ? lastError.code : "retry_exhausted",
          );
        }

        tableResult.sourceCount += batch.records.length;
        if (!options.dryRun) tableResult.verified += batch.records.length;
        tableResult.alreadyPresent += firstClassification?.identical.length ?? 0;
        if (options.dryRun) {
          tableResult.plannedInsert += firstClassification?.missing.length ?? 0;
        } else {
          tableResult.inserted += firstClassification?.missing.length ?? 0;
        }

      }

      if (!batch.done && (batch.nextCursor === null || batch.nextCursor === cursor)) {
        throw new MigrationError("Source cursor did not advance.", table, "cursor_stalled");
      }
      if (batch.done && tableResult.sourceCount !== expectedSourceCount) {
        throw new MigrationError("Source and streamed record counts differ.", table, "verification_failed");
      }
      if (!options.dryRun) {
        await adapter.saveCheckpoint(table, {
          sourceFingerprint,
          cursor: batch.nextCursor,
          sourceCount: tableResult.sourceCount,
          inserted: tableResult.inserted,
          plannedInsert: tableResult.plannedInsert,
          alreadyPresent: tableResult.alreadyPresent,
          verified: tableResult.verified,
          done: batch.done,
        });
      }
      if (batch.done) break;
      cursor = batch.nextCursor;
    }

    if (!options.dryRun && tableResult.sourceCount !== tableResult.verified) {
      throw new MigrationError("Source and verified destination counts differ.", table, "verification_failed");
    }
  }

  return results;
}
