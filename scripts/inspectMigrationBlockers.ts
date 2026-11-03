import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const caPath = process.env.PGSSLROOTCERT;

  if (!connectionString) throw new Error("DATABASE_URL is missing.");
  if (!caPath) throw new Error("Set PGSSLROOTCERT before running this diagnostic.");
  if (process.env.CONVEX_MIGRATION_ENABLED !== "false") {
    throw new Error("Safety check failed: migration flag must be false.");
  }

  const url = new URL(connectionString);
  if (!/(^|\.)supabase\.(co|com)$/i.test(url.hostname)) {
    throw new Error("Unexpected database host. No connection attempted.");
  }

  const client = new Client({
    connectionString,
    ssl: {
      ca: readFileSync(caPath, "utf8"),
      rejectUnauthorized: true,
    },
    application_name: "uniinfo_migration_schema_diagnostic",
  });

  let connected = false;
  let transaction = false;

  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;

    async function columns(table: string) {
      const result = await client.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );
      return result.rows as {
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[];
    }

    const userColumns = await columns("users");
    const chatColumns = await columns("chat_history");

    const userNames = new Set(userColumns.map((column) => column.column_name));
    const chatNames = new Set(chatColumns.map((column) => column.column_name));

    const requiredUserFields = [
      "auth_subject",
      "token_version",
      "disabled",
    ];

    const userCount = await client.query(
      "SELECT COUNT(*)::int AS total FROM public.users",
    );

    const fieldChecks = [];

    for (const field of requiredUserFields) {
      const exists = userNames.has(field);
      let nullCount: number | null = null;

      if (exists) {
        const result = await client.query(
          `SELECT COUNT(*) FILTER (WHERE "${field}" IS NULL)::int AS null_count
           FROM public.users`,
        );
        nullCount = result.rows[0].null_count;
      }

      fieldChecks.push({
        field,
        columnExists: exists,
        nullCount,
      });
    }

    let chatRelationshipCounts: Record<string, number> | string;

    if (chatNames.has("user_email") && userNames.has("email")) {
      const result = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE ch.user_email IS NULL OR BTRIM(ch.user_email) = ''
          )::int AS missing_or_blank,
          COUNT(*) FILTER (
            WHERE ch.user_email IS NOT NULL
              AND BTRIM(ch.user_email) <> ''
              AND u.email IS NOT NULL
          )::int AS matched_to_user,
          COUNT(*) FILTER (
            WHERE ch.user_email IS NOT NULL
              AND BTRIM(ch.user_email) <> ''
              AND u.email IS NULL
          )::int AS unmatched_to_user
        FROM public.chat_history ch
        LEFT JOIN public.users u
          ON LOWER(BTRIM(u.email)) = LOWER(BTRIM(ch.user_email))
      `);
      chatRelationshipCounts = result.rows[0];
    } else {
      chatRelationshipCounts =
        "Cannot calculate: required user_email/email column is missing.";
    }

    console.log(JSON.stringify({
      mode: "read-only-schema-diagnostic",
      usersTableExists: userNames.size > 0,
      usersTotal: userCount.rows[0].total,
      relevantUserColumns: userColumns.filter((column) =>
        requiredUserFields.includes(column.column_name),
      ),
      requiredFieldChecks: fieldChecks,
      chatHistoryUserEmailColumnExists: chatNames.has("user_email"),
      userEmailColumnExists: userNames.has("email"),
      chatRelationshipCounts,
      writesAttempted: false,
      convexContacted: false,
    }, null, 2));
  } finally {
    try {
      if (transaction) await client.query("ROLLBACK");
    } finally {
      if (connected) await client.end();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Schema diagnostic failed: ${message}`);
  process.exitCode = 1;
});
