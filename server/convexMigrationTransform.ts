import { createHash } from "node:crypto";
import {
  expectedSourceTables,
  isMigrationJsonValue,
  migrationTables,
  type MigrationRecord,
  type SourceTable,
} from "./convexMigration";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Migration source row is invalid.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Migration field ${field} is invalid.`);
  return value;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Migration field ${field} is invalid.`);
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  const result = number(value, field);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Migration field ${field} is invalid.`);
  }
  return result;
}

function timestamp(value: unknown, field: string): number {
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? Date.parse(value)
        : typeof value === "number"
          ? value
          : Number.NaN;
  if (!Number.isFinite(milliseconds)) throw new Error(`Migration field ${field} is invalid.`);
  return milliseconds;
}

function timestampWithoutTimeZone(value: unknown, field: string): number {
  if (value instanceof Date) return timestamp(value, field);
  if (typeof value !== "string") throw new Error(`Migration field ${field} is invalid.`);
  const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value);
  const wallTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
  if (!hasTimezone && !wallTime) throw new Error(`Migration field ${field} is invalid.`);
  return timestamp(hasTimezone ? value : `${value.replace(" ", "T")}Z`, field);
}

function nullable(value: unknown): unknown {
  return value === undefined ? undefined : value;
}

function normalizeEmail(value: unknown, field: string): string {
  return text(value, field).trim().toLowerCase();
}

/**
 * Copies the authoritative subject PostgreSQL persists for the account. A missing,
 * blank or email-shaped subject stops the row rather than producing an identity that
 * the Express-issued JWT could never match.
 */
function storedAuthSubject(value: unknown, email: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Migration field authSubject is missing; refusing to invent an identity.");
  }
  const subject = value.trim();
  if (subject.toLowerCase() === email) {
    throw new Error("Migration field authSubject must not be the account email.");
  }
  return subject;
}

function stableRecordKey(table: SourceTable, raw: Record<string, unknown>): string {
  if (table === "sessions") {
    return createHash("sha256").update(text(raw.token, "token")).digest("hex");
  }
  const field = table === "universityReviewsAgg" ? "universityId" : "id";
  const key = number(raw[field], field);
  if (!Number.isSafeInteger(key)) throw new Error(`Migration field ${field} is invalid.`);
  return String(key);
}

function postgresInteger(value: unknown, field: string): number {
  const result = safeInteger(value, field);
  if (result < -2_147_483_648 || result > 2_147_483_647) {
    throw new Error(`Migration field ${field} is outside the PostgreSQL integer range.`);
  }
  return result;
}

function nonNegativePostgresInteger(value: unknown, field: string): number {
  const result = postgresInteger(value, field);
  if (result < 0) throw new Error(`Migration field ${field} must not be negative.`);
  return result;
}

export function transformPostgresMigrationRecord(
  table: SourceTable,
  value: unknown,
  now = Date.now(),
): MigrationRecord {
  const raw = record(value);
  const legacyKey = stableRecordKey(table, raw);
  let destination: Record<string, unknown>;

  switch (table) {
    case "universities": {
      const {
        id,
        searchText: _discardSearchText,
        ...fields
      } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        createdAt: timestamp(raw.createdAt, "createdAt"),
      };
      break;
    }
    case "users": {
      const id = number(raw.id, "id");
      const expiresAt = raw.verificationExpires == null
        ? null
        : timestamp(raw.verificationExpires, "verificationExpires");
      const verificationToken = raw.verificationToken;
      const email = normalizeEmail(raw.email, "email");
      destination = {
        legacyId: id,
        email,
        // The subject persisted by PostgreSQL is authoritative; Convex copies it verbatim.
        authSubject: storedAuthSubject(raw.authSubject, email),
        tokenVersion: nonNegativePostgresInteger(raw.tokenVersion, "tokenVersion"),
        disabled: raw.disabled,
        passwordHash: text(raw.password, "password"),
        role: text(raw.role, "role"),
        name: nullable(raw.name),
        loginFailures: number(raw.loginFailures, "loginFailures"),
        lockedUntil: safeInteger(raw.lockedUntil, "lockedUntil"),
        createdAt: timestamp(raw.createdAt, "createdAt"),
        emailVerified: raw.emailVerified,
        verificationTokenHash:
          typeof verificationToken === "string" && expiresAt !== null && expiresAt > now
            ? createHash("sha256").update(verificationToken).digest("hex")
            : null,
        verificationExpires: expiresAt !== null && expiresAt > now ? expiresAt : null,
      };
      break;
    }
    case "studentProfiles":
    case "parentProfiles": {
      const { id, userEmail, ...fields } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        userEmail: normalizeEmail(userEmail, "userEmail"),
        updatedAt: timestamp(raw.updatedAt, "updatedAt"),
      };
      break;
    }
    case "reviews": {
      const { id, universityId, userEmail, ...fields } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        legacyUniversityId: number(universityId, "universityId"),
        userEmail: normalizeEmail(userEmail, "userEmail"),
        createdAt: timestamp(raw.createdAt, "createdAt"),
      };
      break;
    }
    case "bookmarks": {
      const { id, universityId, userEmail, ...fields } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        legacyUniversityId: number(universityId, "universityId"),
        userEmail: normalizeEmail(userEmail, "userEmail"),
        createdAt: timestamp(raw.createdAt, "createdAt"),
      };
      break;
    }
    case "notifications": {
      const { id, userEmail, ...fields } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        userEmail: normalizeEmail(userEmail, "userEmail"),
        createdAt: timestamp(raw.createdAt, "createdAt"),
      };
      break;
    }
    case "chatHistory": {
      const { id, userEmail, ...fields } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        userEmail: userEmail == null ? null : normalizeEmail(userEmail, "userEmail"),
        createdAt: timestamp(raw.createdAt, "createdAt"),
      };
      break;
    }
    case "sessions": {
      const { token, email, ...fields } = raw;
      const expiresAt = safeInteger(raw.expiresAt, "expiresAt");
      const absoluteExpiresAt = safeInteger(raw.absoluteExpiresAt, "absoluteExpiresAt");
      destination = {
        ...fields,
        sessionTokenHash: legacyKey,
        email: normalizeEmail(email, "email"),
        expiresAt,
        absoluteExpiresAt,
        createdAt: timestamp(raw.createdAt, "createdAt"),
        lastUsedAt: timestamp(raw.lastUsedAt, "lastUsedAt"),
      };
      break;
    }
    case "auditLogs": {
      const { id, ...fields } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        createdAt: timestamp(raw.createdAt, "createdAt"),
      };
      break;
    }
    case "loginAttempts": {
      const { id, ...fields } = raw;
      destination = {
        ...fields,
        legacyId: number(id, "id"),
        email: raw.email == null ? null : normalizeEmail(raw.email, "email"),
        attemptTime: timestamp(raw.attemptTime, "attemptTime"),
      };
      break;
    }
    case "universityReviewsAgg": {
      const { universityId, ...fields } = raw;
      destination = {
        ...fields,
        legacyUniversityId: number(universityId, "universityId"),
      };
      break;
    }
    case "analyticsEvents": {
      const id = postgresInteger(raw.id, "id");
      if (raw.details !== null && !isMigrationJsonValue(raw.details)) {
        throw new Error("Migration field details is invalid.");
      }
      destination = {
        legacyId: id,
        eventType: text(raw.eventType, "eventType"),
        details: raw.details,
        userEmail: raw.userEmail === null ? null : text(raw.userEmail, "userEmail"),
        ipAddress: raw.ipAddress === null ? null : text(raw.ipAddress, "ipAddress"),
        createdAt: timestampWithoutTimeZone(raw.createdAt, "createdAt"),
      };
      break;
    }
  }

  return { key: legacyKey, value: destination };
}

export function assertMigrationTableCoverage(): void {
  const actual = migrationTables.map(({ source }) => source).sort();
  if (
    actual.length !== expectedSourceTables.length ||
    new Set(actual).size !== actual.length ||
    actual.some((table, index) => table !== [...expectedSourceTables].sort()[index])
  ) {
    throw new Error("Migration table definition is incomplete.");
  }
}
