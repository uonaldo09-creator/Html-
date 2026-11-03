import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const MAGIC = Buffer.from('UNIINFO-PGDUMP-ENC-V1\n', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Required environment setting ${name} is missing.`);
  return value;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function assertCommandAvailable(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} was not found or could not be run. Install PostgreSQL client tools and add them to PATH.`);
  }
}

async function writeChunk(stream, chunk) {
  await new Promise((resolve, reject) => {
    stream.write(chunk, (error) => error ? reject(error) : resolve());
  });
}

async function createEncryptedDump(targetPath, key) {
  const partialPath = `${targetPath}.partial`;
  const iv = randomBytes(IV_BYTES);
  const output = createWriteStream(partialPath, { flags: 'wx', mode: 0o600 });
  let child;

  try {
    await writeChunk(output, Buffer.concat([MAGIC, iv]));
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    child = spawn('pg_dump', [
      '--format=custom',
      '--schema=public',
      '--no-owner',
      '--no-acl',
    ], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });

    const closePromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });

    const sink = new Writable({
      write(chunk, encoding, callback) {
        output.write(chunk, encoding, callback);
      },
      final(callback) { callback(); },
    });

    await pipeline(child.stdout, cipher, sink);
    const status = await closePromise;
    if (status.code !== 0) {
      throw new Error(`pg_dump failed (exit ${status.code ?? 'unknown'}). No export will be published.`);
    }

    await new Promise((resolve, reject) => {
      output.write(cipher.getAuthTag(), (error) => {
        if (error) return reject(error);
        output.end(resolve);
      });
      output.once('error', reject);
    });
    return partialPath;
  } catch (error) {
    if (child && child.exitCode === null) child.kill();
    output.destroy();
    await new Promise((resolve) => {
      if (output.closed) resolve();
      else output.once('close', resolve);
    });
    try { unlinkSync(partialPath); } catch {}
    throw error;
  }
}

function readHeaderAndTag(filePath) {
  const stats = statSync(filePath);
  const headerLength = MAGIC.length + IV_BYTES;
  if (stats.size <= headerLength + TAG_BYTES) {
    throw new Error('Encrypted export is too short to be a valid archive.');
  }

  const descriptor = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(headerLength);
    const tag = Buffer.alloc(TAG_BYTES);
    const headerRead = readSync(descriptor, header, 0, header.length, 0);
    const tagRead = readSync(descriptor, tag, 0, tag.length, stats.size - TAG_BYTES);
    if (headerRead !== header.length || tagRead !== tag.length || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Encrypted export header is invalid or unsupported.');
    }
    return {
      stats,
      headerLength,
      iv: header.subarray(MAGIC.length),
      tag,
    };
  } finally {
    closeSync(descriptor);
  }
}

async function verifyByListingArchive(filePath, key) {
  const { stats, headerLength, iv, tag } = readHeaderAndTag(filePath);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const listingChunks = [];
  let listingBytes = 0;
  const restore = spawn('pg_restore', ['--list'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
  const closePromise = new Promise((resolve, reject) => {
    restore.once('error', reject);
    restore.once('close', (code, signal) => resolve({ code, signal }));
  });
  restore.stdout.on('data', (chunk) => {
    // The table-of-contents list is small; cap memory in case of a malformed archive.
    if (listingBytes < 2 * 1024 * 1024) {
      const remaining = (2 * 1024 * 1024) - listingBytes;
      const kept = chunk.subarray(0, remaining);
      listingChunks.push(kept);
      listingBytes += kept.length;
    }
  });

  try {
    await pipeline(
      createReadStream(filePath, { start: headerLength, end: stats.size - TAG_BYTES - 1 }),
      decipher,
      restore.stdin,
    );
    const status = await closePromise;
    if (status.code !== 0) {
      throw new Error(`pg_restore could not read the decrypted archive (exit ${status.code ?? 'unknown'}).`);
    }
  } catch (error) {
    if (restore.exitCode === null) restore.kill();
    throw error;
  }

  const listing = Buffer.concat(listingChunks).toString('utf8');
  const tableEntries = listing.split(/\r?\n/).filter((line) => /\bTABLE\s+public\s+/i.test(line));
  const tableDataEntries = listing.split(/\r?\n/).filter((line) => /\bTABLE DATA\s+public\s+/i.test(line));
  if (tableEntries.length === 0) {
    throw new Error('Archive verified cryptographically but contains no public tables.');
  }
  return { tableEntries: tableEntries.length, tableDataEntries: tableDataEntries.length };
}

async function main() {
  const host = requiredEnv('PGHOST');
  const database = requiredEnv('PGDATABASE');
  requiredEnv('PGUSER');
  requiredEnv('PGPASSWORD');
  const port = requiredEnv('PGPORT');
  const caPath = requiredEnv('PGSSLROOTCERT');
  const outputDirectory = path.resolve(requiredEnv('FRESH_EXPORT_DIR'));
  const encryptionKeyHex = requiredEnv('FRESH_EXPORT_ENCRYPTION_KEY');

  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
    throw new Error('FRESH_EXPORT_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  }
  if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PGPORT must be a valid TCP port.');
  }
  if (!existsSync(caPath) || !statSync(caPath).isFile()) {
    throw new Error('PGSSLROOTCERT must point to the database CA certificate file.');
  }
  if ((process.env.PGSSLMODE || '').toLowerCase() !== 'verify-full') {
    throw new Error('PGSSLMODE must be verify-full for the fresh export.');
  }

  const projectRoot = path.resolve(process.cwd());
  const relativeOutDir = path.relative(projectRoot, outputDirectory);
  if (relativeOutDir === '' || (!relativeOutDir.startsWith(`..${path.sep}`) && relativeOutDir !== '..' && !path.isAbsolute(relativeOutDir))) {
    throw new Error('Fresh exports must be stored outside the project directory.');
  }

  assertCommandAvailable('pg_dump');
  assertCommandAvailable('pg_restore');
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basename = `uniinfo-public-${timestamp}.pgdump.enc`;
  const finalPath = path.join(outputDirectory, basename);
  const partialPath = `${finalPath}.partial`;
  const key = Buffer.from(encryptionKeyHex, 'hex');

  console.log(`Starting read-only PostgreSQL export for database '${database}' on host '${host}:${port}'.`);
  console.log('Scope: public schema only. Transport TLS: verify-full. Output: AES-256-GCM encrypted.');
  console.log('The database password and encryption key are not printed or passed as command-line arguments.');

  try {
    const producedPartialPath = await createEncryptedDump(finalPath, key);
    const listing = await verifyByListingArchive(producedPartialPath, key);
    renameSync(producedPartialPath, finalPath);
    const fileSize = statSync(finalPath).size;
    const sha256 = await sha256File(finalPath);
    const manifest = {
      format: 'uniinfo-encrypted-postgresql-custom-archive',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      databaseHost: host,
      databaseName: database,
      schemaScope: ['public'],
      encryption: 'AES-256-GCM',
      encryptedFile: basename,
      sizeBytes: fileSize,
      sha256,
      archiveVerification: 'authenticated decryption + pg_restore --list passed',
      publicTableEntries: listing.tableEntries,
      publicTableDataEntries: listing.tableDataEntries,
      restoreTested: false,
    };
    const manifestPath = `${finalPath}.manifest.json`;
    const manifestPartialPath = `${manifestPath}.partial`;
    writeFileSync(manifestPartialPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(manifestPartialPath, manifestPath);
    console.log('FRESH EXPORT CREATED AND VERIFIED.');
    console.log(`Encrypted file: ${finalPath}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Bytes: ${fileSize}`);
    console.log(`SHA-256: ${sha256}`);
    console.log(`Public table entries: ${listing.tableEntries}; table-data entries: ${listing.tableDataEntries}`);
    console.log('Note: archive integrity is verified; a restore rehearsal has not been performed by this command.');
  } catch (error) {
    try { unlinkSync(partialPath); } catch {}
    throw error;
  } finally {
    key.fill(0);
  }
}

if (process.argv.includes('--self-test')) {
  // Exercise AES-GCM framing locally without contacting PostgreSQL or using credentials.
  const key = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const sample = Buffer.from('synthetic-export-test-only');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(sample), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  if (!decrypted.equals(sample)) throw new Error('Synthetic encryption self-test failed.');
  console.log('Synthetic AES-256-GCM round-trip passed; no external service was contacted.');
} else {
  main().catch((error) => {
    // Do not include environment values in errors; only report the exception message.
    console.error(`Fresh export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
