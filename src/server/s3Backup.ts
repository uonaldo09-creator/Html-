import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { dbService } from "../db/dbService";
import { createPostgresBackupEnvelope } from "./backupFormat";
import { encryptBackup } from "./backupEncryption";

export class S3BackupService {
  private static getS3Client(): S3Client | null {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const bucket = process.env.S3_BUCKET;

    if (!accessKeyId || !secretAccessKey || !bucket) {
      logger.info("S3 backup credentials are not fully configured. S3 backups are skipped.");
      return null;
    }

    try {
      return new S3Client({
        endpoint: endpoint || undefined,
        region: process.env.S3_REGION || "us-east-1",
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle: !!endpoint, // Required for minio/supabase storage
      });
    } catch (err) {
      logger.error(
        { errorType: err instanceof Error ? err.name : "unknown" },
        "Failed to create S3 client.",
      );
      return null;
    }
  }

  /**
   * Run a full backup and upload it to S3.
   */
  public static async runAndUploadBackup(): Promise<string | null> {
    try {
      logger.info("Starting automated S3-compatible cloud backup...");

      if (!dbService.isUsingPostgres()) {
        throw new Error("PostgreSQL database is offline; a complete backup cannot be created.");
      }

      const backupData = createPostgresBackupEnvelope(await dbService.exportPostgresData());

      const serialized = encryptBackup(JSON.stringify(backupData));
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `uniinfo_backup_${timestamp}.json.enc`;

      const s3 = this.getS3Client();
      const bucket = process.env.S3_BUCKET;

      if (!s3 || !bucket) {
        if (process.env.NODE_ENV === "production") {
          throw new Error("S3-compatible backup storage is required for production; local backup fallback is disabled.");
        }

        // Fallback: save locally
        const backupDir = path.join(process.cwd(), "backups");
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        const localPath = path.join(backupDir, filename);
        fs.writeFileSync(localPath, serialized, { encoding: "utf-8", flag: "wx" });
        logger.info({ filename }, "Encrypted local backup written as fallback.");
        return filename;
      }

      logger.info({ bucket, filename }, "Uploading backup to S3-compatible bucket...");
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `backups/${filename}`,
          Body: serialized,
          ContentType: "application/octet-stream",
        })
      );

      logger.info({ filename }, "Database backup successfully uploaded to cloud S3 storage!");

      // Clean up old S3 backups
      await this.enforceS3Retention(s3, bucket);

      return filename;
    } catch (err) {
      logger.error(
        { errorType: err instanceof Error ? err.name : "unknown" },
        "Cloud backup failed.",
      );
      throw err;
    }
  }

  /**
   * Prune backups older than 7 days from S3.
   */
  private static async enforceS3Retention(s3: S3Client, bucket: string) {
    try {
      const listRes = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: "backups/",
        })
      );

      if (!listRes.Contents || listRes.Contents.length === 0) return;

      const now = Date.now();
      const retentionMs = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const item of listRes.Contents) {
        if (!item.Key || !item.LastModified) continue;

        const ageMs = now - item.LastModified.getTime();
        if (ageMs > retentionMs) {
          logger.info({ key: item.Key }, "Pruning outdated backup on S3...");
          await s3.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: item.Key,
            })
          );
        }
      }
    } catch (err) {
      logger.warn(
        { errorType: err instanceof Error ? err.name : "unknown" },
        "Failed to enforce S3 backup retention.",
      );
    }
  }
}
