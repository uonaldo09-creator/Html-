# Identity subject migration (`0003_identity_subjects`)

Status: **prepared and unit-tested only. Not applied to any database.** No production DDL has
been executed and no Convex deployment has been touched.

This migration is the single source of the user identity subject that the Convex
authentication bridge will rely on. The subject is stored once in PostgreSQL and copied
verbatim into Convex by the migration; it is never derived independently on either side.

## What `0003_identity_subjects.sql` changes

| Column | Effect |
|---|---|
| `users.auth_subject` | Added; missing legacy subjects are backfilled as `uniinfo-user:<id>`; then `NOT NULL` + `UNIQUE`. New registrations keep server-generated UUID subjects. |
| `users.token_version` | Added `integer NOT NULL DEFAULT 0`. |
| `users.disabled` | Added `boolean NOT NULL DEFAULT false`. |

The application deliberately no longer creates or backfills these columns at startup;
they are owned by this migration. **A fresh database must have this migration applied
before the application (or the PostgreSQL rehearsal) is started**, otherwise Drizzle
selects on `users` fail because the column does not exist.

## Journal consistency (verified 2026-10-14)

| tag | journal entry | SQL file | snapshot |
|---|---|---|---|
| `0000_thick_husk` | yes (pre-existing) | **missing** | `0000_snapshot.json` |
| `0001_session_lifetimes` | yes (pre-existing) | **missing** | missing |
| `0002_analytics_events` | **was missing** — registered by this change | `0002_analytics_events.sql` (unmodified) | missing |
| `0003_identity_subjects` | added by this change | `0003_identity_subjects.sql` (new) | missing |

Pre-existing defects that were **deliberately not repaired**, because repairing them would
mean inventing migration history:

* `0000` and `0001` have journal entries but no `.sql` files. The SQL for them exists
  nowhere in git history, so it was not fabricated. If `drizzle-kit migrate` is ever wired
  up, these two entries must be reconciled first.
* Only `0000_snapshot.json` exists. `drizzle-kit generate` would therefore diff the current
  schema against a stale snapshot and emit unrelated DDL for columns and tables that already
  exist. **Do not run `drizzle-kit generate` until the missing snapshots are restored.**
* `0002_analytics_events.sql` existed but was not registered in the journal; this change adds
  its journal entry without modifying the file or any existing entry.

## Applying it to an isolated local database

```bash
createdb uniinfo_identity_rehearsal
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/uniinfo_identity_rehearsal

# 1. Apply
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0003_identity_subjects.sql

# 2. Prove it is idempotent - re-running must be a no-op and must not change any subject
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0003_identity_subjects.sql

# 3. Verify
psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE auth_subject IS NULL) AS missing,
                                count(DISTINCT auth_subject) AS distinct_subjects,
                                count(*) AS rows FROM users;"
#    missing must be 0 and distinct_subjects must equal rows
```

`gen_random_uuid()` requires PostgreSQL 13+, where it is built in.

## Required production procedure (needs explicit approval — not run)

1. Create and verify a restorable encrypted backup (`npm run backup`), and confirm the
   restore path works against an isolated target.
2. Confirm the target database is at the current schema (through `0001_session_lifetimes`)
   before applying anything.
3. Confirm the server is PostgreSQL 13+.
4. Apply during a maintenance window, in a single transaction:
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0003_identity_subjects.sql
   ```
   Note the locking profile: `ALTER COLUMN ... SET NOT NULL` and the unique constraint on
   `auth_subject` take `ACCESS EXCLUSIVE` locks and scan `users`. On a large table, schedule
   this accordingly.
5. Re-run the verification query above (`missing = 0`, `distinct_subjects = rows`).
6. Only after the stored subjects exist may the Convex migration be run, so that Convex
   copies the authoritative subjects instead of generating its own.

## Rollback / recovery limitations

* There is **no down migration**. Dropping `auth_subject` would invalidate every issued
  Convex identity, so no `DROP COLUMN` is provided.
* The backfill is **not reversible**: the generated UUIDs are not recorded anywhere.
  Recovering from a bad backfill means restoring the pre-migration backup.
* `token_version` and `disabled` could be dropped safely, but nothing in this change does so.
