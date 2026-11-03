import crypto from "crypto";

const ENCRYPTED_BACKUP_FORMAT = "uniinfo-backup-encrypted-v1";

export class BackupConfigurationError extends Error {
  public readonly code = "BACKUP_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "BackupConfigurationError";
  }
}

function getEncryptionKey(): Buffer {
  const configuredKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!configuredKey) {
    const productionRequirement = process.env.NODE_ENV === "production"
      ? " Production backup operations are disabled until this key is configured."
      : "";
    throw new BackupConfigurationError(
      `BACKUP_ENCRYPTION_KEY is required to create or restore encrypted backups.${productionRequirement} Configure an externally managed 32-byte key encoded as 64 hexadecimal characters.`
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(configuredKey)) {
    throw new BackupConfigurationError(
      "BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)."
    );
  }

  return Buffer.from(configuredKey, "hex");
}

export function validateBackupEncryptionConfig(): void {
  getEncryptionKey();
}

export function encryptBackup(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return JSON.stringify({
    format: ENCRYPTED_BACKUP_FORMAT,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

export function decryptBackup(serialized: string): string {
  let envelope: any;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    throw new Error("Encrypted backup has an invalid envelope.");
  }

  if (
    envelope?.format !== ENCRYPTED_BACKUP_FORMAT ||
    typeof envelope.iv !== "string" ||
    typeof envelope.authTag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Encrypted backup has an unsupported format.");
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof BackupConfigurationError) throw error;
    throw new Error("Backup decryption failed; verify the configured backup key and file integrity.");
  }
}
