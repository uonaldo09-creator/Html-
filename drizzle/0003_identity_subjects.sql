-- 0003_identity_subjects
--
-- Adds the authoritative, persisted user identity subject used by the Convex
-- authentication bridge, together with the revocation columns that accompany it.
--
-- Why this exists:
--   * "users"."auth_subject" is the single authoritative subject. The Express
--     server mints the Convex JWT with this value, and the Convex migration must
--     copy this stored value verbatim instead of deriving its own.
--   * "users"."token_version" is incremented on a role change or an account
--     disable so Convex tokens issued under the old identity stop validating.
--   * "users"."disabled" marks an account that must not receive new tokens.
--
-- Safety properties:
--   * Additive only - no DROP, TRUNCATE or DELETE. There is no data-destructive
--     rollback path to run (see the rollback notes at the bottom of this file).
--   * Idempotent - every statement is guarded, so re-running is a no-op and an
--     already-persisted subject is never regenerated.
--   * Run inside a single transaction, against an isolated database first.
--   * Subject values use the stable users.id and are persisted before Convex import.
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0003_identity_subjects.sql

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_subject" text;

-- Backfill exactly once. Only rows that still lack a subject are touched, so a
-- re-run never replaces a subject that was already issued to a client.
UPDATE "users" SET "auth_subject" = 'uniinfo-user:' || "id"::text WHERE "auth_subject" IS NULL;

ALTER TABLE "users" ALTER COLUMN "auth_subject" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_subject_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_auth_subject_unique" UNIQUE ("auth_subject");
  END IF;
END
$$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled" boolean NOT NULL DEFAULT false;

-- Rollback / recovery limitations (deliberately not automated):
--   * Dropping "auth_subject" would invalidate every issued Convex identity, so
--     no DROP COLUMN is provided.
--   * The backfill is not reversible: the generated UUIDs are not recorded.
--     Recovering from a bad backfill means restoring the pre-migration backup.
--   * "token_version" and "disabled" could be dropped safely, but are left in
--     place because the Drizzle schema and application code declare them.
