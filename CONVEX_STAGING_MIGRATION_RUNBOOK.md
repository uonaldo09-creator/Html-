# UniInfo: King (PostgreSQL) → isolated Convex staging runbook

This runbook describes how to move the confirmed source database, King, into an
**isolated Convex staging deployment**. It never switches application traffic and
never touches production. Read it fully before running anything.

## Scope and non-goals

In scope:

- Reading King (PostgreSQL) with a read-only, repeatable-read transaction.
- Writing every source record into one isolated Convex staging deployment.
- Preflight validation, resumable checkpoints, bounded retries, idempotent
  writes, and final key-set reconciliation.

Out of scope (do not attempt as part of this migration):

- Production cutover or application routing changes.
- Running `drizzle/0004_review_user_uniqueness.sql`.
- Writing real data to `clear-gopher-925` (synthetic rehearsal), to
  `graceful-kangaroo-272` (development), or to any production deployment.

## Source and destination

| Role | Variable | Notes |
| --- | --- | --- |
| Source | `KING_DATABASE_URL` | Read-only. PostgreSQL only. |
| Destination | `CONVEX_STAGING_URL` | Isolated staging deployment only. |
| Destination key | `CONVEX_STAGING_DEPLOY_KEY` | Admin key for that deployment only. |
| Mode | `MIGRATION_MODE` | `preflight` \| `dry-run` \| `import` \| `verify`. |
| Import token | `ALLOW_STAGING_IMPORT` | Must equal the confirmation token for `import`. |

The runner refuses to start unless `CONVEX_MIGRATION_ENABLED` is exactly
`false`. That flag is the global kill switch for the application-side migration
and must stay off; this runbook's runner is separate from it.

The runner rejects any destination whose host is not a positively identified
`*.convex.cloud` deployment, and it rejects the protected names above. It never
prints the source URL, the deploy key, or any credential.

## Prerequisites

1. The staging Convex deployment exists and has the current `convex/schema.ts`
   deployed (`npx convex deploy` from a checkout with that deployment selected).
2. King already has the `0003_identity_subjects` migration applied:
   `users.auth_subject`, `users.token_version`, and `users.disabled` are present,
   and every `auth_subject` is non-null and unique.
3. Do **not** apply `0004_review_user_uniqueness.sql`. The migration preserves
   duplicate reviews; that migration would collapse them.
4. `npm ci` has been run so `tsx` and dependencies are available.

## Expected source shape

The King snapshot contains 332 rows across 13 tables:

| Table | Rows |
| --- | ---: |
| universities | 31 |
| users | 13 |
| student_profiles | 4 |
| parent_profiles | 0 |
| reviews | 157 |
| bookmarks | 6 |
| notifications | 4 |
| chat_history | 32 |
| sessions | 0 |
| audit_logs | 66 |
| login_attempts | 19 |
| university_reviews_agg | 0 |
| analytics_events | 0 |
| **Total** | **332** |

Two known source characteristics must survive unchanged:

- **152 repeated review rows** across four reviewer/university groups. Their
  content is identical, but each row keeps its own legacy ID. All 152 must exist
  in the destination.
- **18 chat-history rows** whose email matches no current user. They are imported
  as unlinked chat records (`userEmail` set, no invented user identity).

## Step 1 — Preflight (read-only, no destination writes)

Preflight fingerprints the source, validates every row, and reports grouped
errors and warnings. It opens the source transaction `REPEATABLE READ READ ONLY`
and writes nothing to either side.

```bash
export MIGRATION_MODE=preflight
export CONVEX_MIGRATION_ENABLED=false
export KING_DATABASE_URL='<king read-only connection string>'
export CONVEX_STAGING_URL='https://<isolated-staging>.convex.cloud'
export CONVEX_STAGING_DEPLOY_KEY='<isolated-staging admin key>'
npm run migrate:staging
```

The JSON report shows `status`, the source fingerprint, per-table counts, and
grouped validation issues. Fix every `error`. `warning` issues with the code
`unresolved_optional_relationship` are expected (unlinked chat and reviews) and
are pre-approved by the runner.

Stop if the report shows any error. Do not proceed to `dry-run` or `import`.

## Step 2 — Destination dry-run (read-only classification)

Dry-run classifies every record against the destination without writing:

```bash
export MIGRATION_MODE=dry-run
npm run migrate:staging
```

`status` must be `DRY_RUN_PLAN_COMPLETE`. `plannedInsert` per table tells you how
many records are new; `alreadyPresent` tells you how many already match. A
non-zero `conflicting` count is a hard stop: a destination row with the same
legacy key has different content. Resolve it before importing.

## Step 3 — Import (writes only to isolated staging)

```bash
export MIGRATION_MODE=import
export ALLOW_STAGING_IMPORT=IMPORT_KING_INTO_ISOLATED_CONVEX_STAGING
npm run migrate:staging
```

The runner refuses `import` unless the token matches exactly, the destination is
a confirmed isolated staging deployment, and the destination is not
`clear-gopher-925`, `graceful-kangaroo-272`, or `prod`.

During the import the runner:

- streams each table in batches (default 50), classifying before writing;
- writes only missing keys, so re-running never duplicates a record;
- retries each batch a bounded number of times (default 3);
- saves a checkpoint after each batch (cursor, counts, `done`);
- reserves each table's ID-counter floor at `max(legacyId) + 1`;
- reconciles the full destination key set against the source key set.

`status` must be `STAGING_IMPORT_AND_RECONCILIATION_PASS`, and for every table
`sourceCount == verified` and `sourceCount == destinationKeys`. The run fails
loudly otherwise.

## Step 4 — Verify (read-only)

```bash
export MIGRATION_MODE=verify
unset ALLOW_STAGING_IMPORT
npm run migrate:staging
```

Verify re-reads the source and confirms every source key exists in the
destination, writing nothing. `status` must be `VERIFY_COMPLETE`.

## Idempotency

Running `import` again is safe. Existing identical records are counted as
`alreadyPresent` and never rewritten; `inserted` is `0` for a table that is
already complete. Confirm idempotency by running `import` twice and checking
that the second run reports `inserted: 0` and unchanged destination counts.

## Interruption and recovery

Checkpoints live in the destination `migrationCheckpoints` table. If a run stops
mid-table:

1. Inspect the destination: committed batches are durable, and the interrupted
   table's checkpoint has `done: false` with a `cursor`.
2. Re-run the same `import` command. The runner resumes each table from its
   saved cursor; completed tables are skipped because their checkpoint is
   `done: true` and its counts match the source.
3. If the source fingerprint changed between runs, the run aborts with
   `Checkpoint does not match the current source snapshot`. Re-run preflight and
   start a fresh import only after the source is stable.

Never hand-edit checkpoints or delete destination rows to "retry". A conflicting
record is always a hard stop.

## ID counters and future allocation

Imported rows keep their legacy IDs. To keep future inserts from colliding, the
import reserves each counter-backed table's floor at `max(legacyId) + 1` in the
destination `idCounters` table. The floor only ever moves forward.

Future code that creates a new row in a counter-backed Convex table must call
the internal `migration:allocateNextLegacyId` mutation instead of computing an
ID locally. It returns the next ID and advances the counter, so it can never
return a value at or below an imported legacy ID. This function is
`internalMutation`; ordinary clients cannot call it.

## Verification checklist

- [ ] Preflight `status` is `PREFLIGHT_PASS` with no errors.
- [ ] Dry-run `status` is `DRY_RUN_PLAN_COMPLETE` with no conflicts.
- [ ] Import `status` is `STAGING_IMPORT_AND_RECONCILIATION_PASS`.
- [ ] Total source records = 332; total destination keys = 332.
- [ ] Per table, `sourceCount == verified == destinationKeys`.
- [ ] Reviews = 157, including all 152 repeated rows.
- [ ] Chat history = 32, including all 18 unlinked records.
- [ ] A second import reports `inserted: 0` everywhere.
- [ ] `npm test`, both TypeScript checks, and `npm run build` pass.

## What this runbook does not do

This runbook does not perform production cutover. After a verified staging
import, the remaining work is:

1. Point the application at the staging deployment for a non-production
   environment and run end-to-end checks (auth bridge, catalog reads, writes).
2. Provision and deploy the production Convex deployment with the same schema.
3. Rehearse the import against a fresh staging clone and confirm reconciliation.
4. Schedule and execute the production cutover with an explicit change window,
   then verify and only then retire the PostgreSQL source.

## Rollback

The source PostgreSQL database is never modified, so rollback is simply: keep
serving from PostgreSQL and abandon the staging deployment. No automatic delete
or route switch is performed by any migration mode.
