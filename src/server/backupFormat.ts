import { createHash, timingSafeEqual } from "node:crypto";
import {
  assertMigrationPreflightClear,
  migrationTables,
  validateMigrationSnapshot,
  type MigrationSnapshot,
  type SourceTable,
} from "./convexMigration";

const BACKUP_FORMAT = "uniinfo-postgres-backup";
const BACKUP_SCHEMA_VERSION = 2;
const tableNames = migrationTables.map(({ source }) => source);

export interface PostgresBackupEnvelope {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  counts: Record<SourceTable, number>;
  tables: Record<SourceTable, unknown[]>;
  payloadSha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadDigest(tables: Record<SourceTable, unknown[]>): string {
  return createHash("sha256").update(JSON.stringify(tables)).digest("hex");
}

function validateTables(value: unknown): Record<SourceTable, unknown[]> {
  if (!isRecord(value)) throw new Error("Backup tables must be an object.");
  const keys = Object.keys(value);
  if (
    keys.length !== tableNames.length ||
    keys.some((key) => !tableNames.includes(key as SourceTable))
  ) {
    throw new Error("Backup must contain exactly the thirteen supported tables.");
  }
  for (const table of tableNames) {
    if (!Array.isArray(value[table])) {
      throw new Error(`Backup table ${table} is missing or invalid.`);
    }
  }
  const tables = value as Record<SourceTable, unknown[]>;
  const issues = validateMigrationSnapshot(tables as MigrationSnapshot);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Backup data validation failed (${errors.length} redacted issue(s)).`);
  }
  return tables;
}

export function createPostgresBackupEnvelope(
  sourceTables: unknown,
  createdAt = new Date().toISOString(),
): PostgresBackupEnvelope {
  const tables = validateTables(sourceTables);
  assertMigrationPreflightClear(
    validateMigrationSnapshot(tables as MigrationSnapshot),
    ["unresolved_optional_relationship", "legacy_id_not_publicly_addressable"],
  );
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Backup creation time is invalid.");
  const counts = Object.fromEntries(
    tableNames.map((table) => [table, tables[table].length]),
  ) as Record<SourceTable, number>;

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt,
    counts,
    tables,
    payloadSha256: payloadDigest(tables),
  };
}

export function parsePostgresBackupEnvelope(serialized: string): PostgresBackupEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Backup payload is not valid JSON.");
  }
  if (
    !isRecord(value) ||
    value.format !== BACKUP_FORMAT ||
    value.schemaVersion !== BACKUP_SCHEMA_VERSION ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.payloadSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.payloadSha256)
  ) {
    throw new Error("Backup metadata is missing or unsupported.");
  }

  const tables = validateTables(value.tables);
  if (
    !isRecord(value.counts) ||
    Object.keys(value.counts).length !== tableNames.length ||
    Object.keys(value.counts).some((table) => !tableNames.includes(table as SourceTable))
  ) {
    throw new Error("Backup table counts are missing or invalid.");
  }
  for (const table of tableNames) {
    if (value.counts[table] !== tables[table].length) {
      throw new Error(`Backup count verification failed for table ${table}.`);
    }
  }

  const actualDigest = Buffer.from(payloadDigest(tables), "hex");
  const expectedDigest = Buffer.from(value.payloadSha256, "hex");
  if (!timingSafeEqual(actualDigest, expectedDigest)) {
    throw new Error("Backup payload integrity verification failed.");
  }
  return value as unknown as PostgresBackupEnvelope;
}
