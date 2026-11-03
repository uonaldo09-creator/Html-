import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../db/dbService", () => ({
  dbService: {
    isUsingPostgres: vi.fn(),
    exportPostgresData: vi.fn(),
    importPostgresData: vi.fn(),
  },
}));

import { dbService } from "../db/dbService";
import { BackupService } from "../server/backup";
import { S3BackupService } from "../server/s3Backup";
import { decryptBackup, encryptBackup } from "../server/backupEncryption";
import { migrationTables } from "../server/convexMigration";

function syntheticSnapshot() {
  const tables = Object.fromEntries(migrationTables.map(({ source }) => [source, []])) as Record<string, unknown[]>;
  tables.users = [{
    id: 1,
    email: "sensitive@example.test",
    password: "synthetic-hash",
    role: "Student",
    loginFailures: 0,
    lockedUntil: 0,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    emailVerified: false,
    authSubject: "11111111-1111-4111-8111-111111111111",
    tokenVersion: 0,
    disabled: false,
  }];
  tables.analyticsEvents = [{
    id: 1001,
    eventType: "synthetic.page_view",
    details: null,
    userEmail: "event-user@example.test",
    ipAddress: "192.0.2.4",
    createdAt: new Date("2025-01-02T03:04:05.000Z"),
  }];
  return tables;
}

describe("backup hardening", () => {
  const originalEnv = {
    backupDir: process.env.BACKUP_DIR,
    encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
    legacy: process.env.ALLOW_LEGACY_UNENCRYPTED_BACKUPS,
    nodeEnv: process.env.NODE_ENV,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET,
  };
  const backupRoot = path.join(process.cwd(), "backups");
  let backupDir: string;

  beforeEach(() => {
    fs.mkdirSync(backupRoot, { recursive: true });
    backupDir = fs.mkdtempSync(path.join(backupRoot, "phase12-test-"));
    process.env.BACKUP_DIR = backupDir;
    process.env.BACKUP_ENCRYPTION_KEY = "a".repeat(64);
    delete process.env.ALLOW_LEGACY_UNENCRYPTED_BACKUPS;
    process.env.NODE_ENV = "test";
    vi.mocked(dbService.isUsingPostgres).mockReturnValue(true);
    vi.mocked(dbService.exportPostgresData).mockResolvedValue(syntheticSnapshot());
    vi.mocked(dbService.importPostgresData).mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(backupDir, { recursive: true, force: true });
    if (originalEnv.backupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originalEnv.backupDir;
    if (originalEnv.encryptionKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = originalEnv.encryptionKey;
    if (originalEnv.legacy === undefined) delete process.env.ALLOW_LEGACY_UNENCRYPTED_BACKUPS;
    else process.env.ALLOW_LEGACY_UNENCRYPTED_BACKUPS = originalEnv.legacy;
    if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv.nodeEnv;
    if (originalEnv.s3Endpoint === undefined) delete process.env.S3_ENDPOINT;
    else process.env.S3_ENDPOINT = originalEnv.s3Endpoint;
    if (originalEnv.s3AccessKeyId === undefined) delete process.env.S3_ACCESS_KEY_ID;
    else process.env.S3_ACCESS_KEY_ID = originalEnv.s3AccessKeyId;
    if (originalEnv.s3SecretAccessKey === undefined) delete process.env.S3_SECRET_ACCESS_KEY;
    else process.env.S3_SECRET_ACCESS_KEY = originalEnv.s3SecretAccessKey;
    if (originalEnv.s3Bucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = originalEnv.s3Bucket;
    vi.clearAllMocks();
  });

  it("encrypts backup files and decrypts them during restore", async () => {
    const filename = await BackupService.createBackup("phase12");

    expect(filename).toMatch(/^db_backup_.*\.json\.enc$/);
    const stored = fs.readFileSync(path.join(backupDir, filename!), "utf8");
    expect(stored).not.toContain("sensitive@example.test");
    expect(stored).not.toContain("event-user@example.test");
    expect(stored).not.toContain("192.0.2.4");
    const decoded = JSON.parse(decryptBackup(stored));
    expect(decoded.schemaVersion).toBe(2);
    expect(decoded.tables.users[0].email).toBe("sensitive@example.test");
    expect(decoded.tables.analyticsEvents[0]).toMatchObject({
      id: 1001,
      eventType: "synthetic.page_view",
      details: null,
      userEmail: "event-user@example.test",
      ipAddress: "192.0.2.4",
    });

    expect(await BackupService.restoreBackup(filename!)).toBe(true);
    expect(dbService.importPostgresData).toHaveBeenCalledWith(
      JSON.parse(JSON.stringify(syntheticSnapshot())),
    );
    expect(decoded.counts.users).toBe(1);
    expect(Object.keys(decoded.tables)).toHaveLength(13);
  });

  it("rejects traversal filenames for restore and delete", async () => {
    const outsideBackup = path.join(backupRoot, "phase12-outside.json.enc");
    fs.writeFileSync(outsideBackup, "must remain untouched");
    try {
      await expect(BackupService.restoreBackup("../phase12-outside.json.enc")).rejects.toThrow();
      expect(BackupService.deleteBackup("../phase12-outside.json.enc")).toBe(false);
      expect(fs.readFileSync(outsideBackup, "utf8")).toBe("must remain untouched");
      expect(dbService.importPostgresData).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(outsideBackup, { force: true });
    }
  });

  it("only lists regular files with valid backup basenames", () => {
    fs.writeFileSync(path.join(backupDir, "db_backup_2026-09-28_valid.json.enc"), "encrypted");
    fs.writeFileSync(path.join(backupDir, "not-a-backup.txt"), "ignored");

    expect(BackupService.listBackups().map((backup) => backup.filename)).toEqual([
      "db_backup_2026-09-28_valid.json.enc",
    ]);
  });

  it("deletes a valid backup by basename", () => {
    const filename = "db_backup_2026-09-28_delete.json.enc";
    fs.writeFileSync(path.join(backupDir, filename), "encrypted");

    expect(BackupService.deleteBackup(filename)).toBe(true);
    expect(fs.existsSync(path.join(backupDir, filename))).toBe(false);
  });

  it("requires an externally configured encryption key in production", async () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";

    await expect(BackupService.createBackup()).rejects.toThrow(/BACKUP_ENCRYPTION_KEY is required/);
  });

  it("does not fall back to ephemeral local storage for production S3 backups", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET;

    await expect(S3BackupService.runAndUploadBackup()).rejects.toThrow(
      /local backup fallback is disabled/,
    );
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it("rejects incomplete snapshots instead of writing partial backups", async () => {
    vi.mocked(dbService.exportPostgresData).mockResolvedValue({ users: [] });

    await expect(BackupService.createBackup("incomplete")).rejects.toThrow(/thirteen supported tables/);
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it("rejects tampered backup payloads before creating a safety backup or restoring", async () => {
    const filename = await BackupService.createBackup("tampered");
    const storedPath = path.join(backupDir, filename);
    const payload = JSON.parse(decryptBackup(fs.readFileSync(storedPath, "utf8")));
    payload.tables.users[0].email = "tampered@example.test";
    fs.writeFileSync(storedPath, encryptBackup(JSON.stringify(payload)));

    await expect(BackupService.restoreBackup(filename)).rejects.toThrow(/integrity/);
    expect(dbService.importPostgresData).not.toHaveBeenCalled();
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
  });

  it("rejects malformed backup metadata before restore", async () => {
    const filename = await BackupService.createBackup("malformed");
    const backupPath = path.join(backupDir, filename);
    const payload = JSON.parse(decryptBackup(fs.readFileSync(backupPath, "utf8")));
    payload.createdAt = "not-a-date";
    fs.writeFileSync(backupPath, encryptBackup(JSON.stringify(payload)));

    await expect(BackupService.restoreBackup(filename)).rejects.toThrow(/metadata/);
    expect(dbService.importPostgresData).not.toHaveBeenCalled();
  });

  it("propagates PostgreSQL export failures and restore failures", async () => {
    vi.mocked(dbService.exportPostgresData).mockRejectedValueOnce(new Error("synthetic export failure"));
    await expect(BackupService.createBackup("query-failure")).rejects.toThrow("synthetic export failure");

    const filename = await BackupService.createBackup("restore-failure");
    vi.mocked(dbService.importPostgresData).mockRejectedValueOnce(new Error("synthetic restore failure"));
    await expect(BackupService.restoreBackup(filename)).rejects.toThrow("synthetic restore failure");
  });

  it("does not restore unless the pre-restore safety backup succeeds", async () => {
    const filename = await BackupService.createBackup("source");
    vi.mocked(dbService.exportPostgresData).mockRejectedValueOnce(new Error("synthetic safety backup failure"));

    await expect(BackupService.restoreBackup(filename)).rejects.toThrow("synthetic safety backup failure");
    expect(dbService.importPostgresData).not.toHaveBeenCalled();
  });

  it("rejects legacy backup payloads even when plaintext restore is opted into", async () => {
    const filename = "db_backup_2026-09-28_legacy.json";
    fs.writeFileSync(path.join(backupDir, filename), JSON.stringify({ users: [], universities: [] }));
    process.env.ALLOW_LEGACY_UNENCRYPTED_BACKUPS = "true";

    await expect(BackupService.restoreBackup(filename)).rejects.toThrow(/metadata/);
    expect(dbService.importPostgresData).not.toHaveBeenCalled();
  });

  it("writes an encrypted complete local fallback when S3 is not configured", async () => {
    const originalCwd = process.cwd();
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uniinfo-s3-backup-"));
    const originalS3 = {
      endpoint: process.env.S3_ENDPOINT,
      accessKey: process.env.S3_ACCESS_KEY_ID,
      secretKey: process.env.S3_SECRET_ACCESS_KEY,
      bucket: process.env.S3_BUCKET,
    };
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET;
    process.chdir(localRoot);
    try {
      const filename = await S3BackupService.runAndUploadBackup();
      expect(filename).toMatch(/\.json\.enc$/);
      const stored = fs.readFileSync(path.join(localRoot, "backups", filename!), "utf8");
      expect(stored).not.toContain("sensitive@example.test");
      expect(JSON.parse(decryptBackup(stored)).counts.users).toBe(1);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(localRoot, { recursive: true, force: true });
      if (originalS3.endpoint === undefined) delete process.env.S3_ENDPOINT;
      else process.env.S3_ENDPOINT = originalS3.endpoint;
      if (originalS3.accessKey === undefined) delete process.env.S3_ACCESS_KEY_ID;
      else process.env.S3_ACCESS_KEY_ID = originalS3.accessKey;
      if (originalS3.secretKey === undefined) delete process.env.S3_SECRET_ACCESS_KEY;
      else process.env.S3_SECRET_ACCESS_KEY = originalS3.secretKey;
      if (originalS3.bucket === undefined) delete process.env.S3_BUCKET;
      else process.env.S3_BUCKET = originalS3.bucket;
    }
  });

  it("rejects backup storage configured inside the public directory", () => {
    process.env.BACKUP_DIR = path.join(process.cwd(), "public", "backups");

    expect(() => BackupService.getBackupDirectory()).toThrow(/outside the public directory/);
  });

  it("requires explicit non-production opt-in for plaintext envelope backups", async () => {
    const filename = "db_backup_2026-09-28_legacy.json";
    const { createPostgresBackupEnvelope } = await import("../server/backupFormat");
    fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(createPostgresBackupEnvelope(syntheticSnapshot())));

    await expect(BackupService.restoreBackup(filename)).rejects.toThrow(/disabled/);
    expect(dbService.importPostgresData).not.toHaveBeenCalled();

    process.env.ALLOW_LEGACY_UNENCRYPTED_BACKUPS = "true";
    expect(await BackupService.restoreBackup(filename)).toBe(true);
  });
});
