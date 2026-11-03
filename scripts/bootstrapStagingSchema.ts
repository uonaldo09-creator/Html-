import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const STAGING_DATABASE_NAME = "uniinfo_staging";
export const STAGING_TABLES = [
  "users",
  "universities",
  "sessions",
  "reviews",
  "bookmarks",
  "chat_history",
  "audit_logs",
  "analytics_events",
  "login_attempts",
  "student_profiles",
  "parent_profiles",
  "notifications",
  "university_reviews_agg",
] as const;
export const STAGING_INDEXES = [
  "users_email_unique",
  "users_auth_subject_unique",
  "reviews_university_id_idx",
  "reviews_user_email_idx",
  "bookmarks_user_uni_unique_idx",
  "chat_history_email_idx",
  "login_attempts_ip_idx",
  "student_profiles_user_email_unique",
  "parent_profiles_user_email_unique",
] as const;

export function validateStagingDatabaseUrl(
  value: string | undefined,
  confirmed: boolean,
): string {
  if (!confirmed) throw new Error("Pass --confirm-staging to authorize this staging-only operation.");
  if (!value) throw new Error("STAGING_DATABASE_URL is required; DATABASE_URL is never used by this script.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("STAGING_DATABASE_URL is invalid.");
  }

  const host = url.hostname.toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !host.endsWith(".render.com") ||
    host.includes("supabase") ||
    !url.username ||
    !url.password
  ) {
    throw new Error("Target must be a credentialed Render PostgreSQL URL.");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error("STAGING_DATABASE_URL has an invalid database name.");
  }
  if (databaseName !== STAGING_DATABASE_NAME) {
    throw new Error(`Target database must be exactly ${STAGING_DATABASE_NAME}.`);
  }

  return value;
}

async function bootstrap(): Promise<void> {
  const args = process.argv.slice(2);
  const allowedArgs = new Set(["--confirm-staging", "--dry-run"]);
  if (args.some((arg) => !allowedArgs.has(arg)) || new Set(args).size !== args.length) {
    throw new Error("Usage: npm run db:bootstrap:staging -- --confirm-staging [--dry-run].");
  }

  const connectionString = validateStagingDatabaseUrl(
    process.env.STAGING_DATABASE_URL,
    args.includes("--confirm-staging"),
  );
  if (args.includes("--dry-run")) {
    console.log(`Dry run only. Would create ${STAGING_TABLES.length} tables in ${STAGING_DATABASE_NAME}:`);
    console.log(STAGING_TABLES.join(", "));
    console.log(`Would create ${STAGING_INDEXES.length} non-primary indexes/unique indexes:`);
    console.log(STAGING_INDEXES.join(", "));
    return;
  }

  const sqlPath = fileURLToPath(new URL("../drizzle/staging_bootstrap.sql", import.meta.url));
  const sql = await readFile(sqlPath, "utf8");
  const client = new Client({ connectionString });
  let transactionStarted = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const identity = await client.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (identity.rows[0]?.database_name !== STAGING_DATABASE_NAME) {
      throw new Error(`Connected database is not ${STAGING_DATABASE_NAME}.`);
    }

    const existingRelations = await client.query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm')`,
    );
    if (existingRelations.rowCount) {
      throw new Error("Refusing bootstrap because public schema already contains relations.");
    }

    await client.query("SET LOCAL uniinfo.staging_bootstrap = 'confirmed'");
    await client.query(sql);
    await client.query("COMMIT");
    transactionStarted = false;
    console.log(`Created the UniInfo staging schema in ${STAGING_DATABASE_NAME}. No application data was copied.`);
  } catch {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw new Error("Staging schema bootstrap failed; transaction rolled back. Inspect sanitized database logs.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  void bootstrap().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Staging schema bootstrap failed.");
    process.exitCode = 1;
  });
}
