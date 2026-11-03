# UniInfo: King → isolated Convex staging migration report

Status: **implementation and local rehearsal complete; the real staging import is
blocked on missing credentials.** No production cutover was performed. No
production or shared deployment was written to.

## What was delivered

| Area | File |
| --- | --- |
| Real PostgreSQL source adapter | `src/server/postgresMigrationSource.ts` |
| Source transform | `src/server/convexMigrationTransform.ts` |
| Migration orchestrator | `src/server/convexMigrationOrchestrator.ts` |
| Destination adapter | `src/server/convexMigrationDestination.ts` |
| Convex internal functions | `convex/migration.ts` |
| Convex schema (counters, checkpoints) | `convex/schema.ts` |
| Real-data runner | `scripts/convexStagingImport.ts` |
| Runbook | `CONVEX_STAGING_MIGRATION_RUNBOOK.md` |
| Import tests | `src/tests/convexStagingImport.test.ts` |
| Destination guard tests | `src/tests/convexMigrationDestination.test.ts` |
| In-memory Convex context helper | `src/tests/helpers/fakeConvexCtx.ts` |

## Implementation summary

- **Read-only source.** `PostgresMigrationSource` opens
  `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` and only ever issues
  `SELECT`. There is no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or DDL against
  King.
- **Explicit identification.** The runner requires `KING_DATABASE_URL`,
  `CONVEX_STAGING_URL`, and `CONVEX_STAGING_DEPLOY_KEY`, parses the destination
  host to a positively identified `*.convex.cloud` deployment, and refuses the
  protected names `prod`, `graceful-kangaroo-272`, and `clear-gopher-925`.
  `import` additionally requires the exact `ALLOW_STAGING_IMPORT` token.
- **Synthetic safeguards preserved.** `postgres-import` mode requires
  `source.kind === "postgres"` plus a confirmed, non-protected isolated staging
  destination. `synthetic` mode still requires a confirmed isolated synthetic
  source and destination. Neither mode can borrow the other's confirmation.
- **Source fingerprint.** A SHA-256 over every normalized row is computed before
  work starts and re-checked after preflight and after reconciliation; a source
  change aborts the run.
- **Resumable checkpoints.** Each batch saves `{sourceFingerprint, cursor,
  counts, done}` to the destination `migrationCheckpoints` table. A resumed run
  skips completed tables and continues each partial table from its cursor. A
  checkpoint whose fingerprint or counts no longer match the source is rejected.
- **Bounded retries.** Each batch retries up to `maxRetries` (default 3) and then
  fails loudly with `MigrationError`.
- **Idempotent writes.** `classify` splits each batch into `identical`, `missing`,
  and `conflicting`; only `missing` keys are written. A repeat import writes
  nothing and duplicates nothing. A `conflicting` key is always a hard stop.
- **Final reconciliation.** After the import, every table's full destination key
  set is compared with the source key set, and `listMissingKeys` re-checks
  membership. Totals must match exactly.
- **ID counter safety.** Before any write, each counter-backed table's floor is
  reserved at `max(legacyId) + 1`. Future rows must call the internal
  `migration:allocateNextLegacyId`, which only returns values above the floor.
- **Internal-only functions.** Every migration mutation and query uses
  `internalMutation` / `internalQuery`; a test asserts none are public.
- **Nullable/optional handling.** `chatHistory.userEmail` and
  `loginAttempts.email` are nullable; optional author links resolve to
  `userId: undefined`; timestamps are converted to epoch milliseconds; JSON is
  validated as a Convex-safe value; session tokens are stored only as SHA-256
  hashes; analytics IDs are range-checked against PostgreSQL integer limits.

## Local rehearsal results

A real PostgreSQL 16 container was loaded with a King-shaped dataset and driven
through the **real** `PostgresMigrationSource`, the **real**
`ConvexMigrationDestination` adapter, and the **real** Convex migration handlers
on an in-memory database context.

Per-table result of the first import:

| Table | Source | Verified | Destination keys |
| --- | ---: | ---: | ---: |
| universities | 31 | 31 | 31 |
| users | 13 | 13 | 13 |
| studentProfiles | 4 | 4 | 4 |
| parentProfiles | 0 | 0 | 0 |
| reviews | 157 | 157 | 157 |
| bookmarks | 6 | 6 | 6 |
| notifications | 4 | 4 | 4 |
| chatHistory | 32 | 32 | 32 |
| sessions | 0 | 0 | 0 |
| auditLogs | 66 | 66 | 66 |
| loginAttempts | 19 | 19 | 19 |
| universityReviewsAgg | 0 | 0 | 0 |
| analyticsEvents | 0 | 0 | 0 |
| **Total** | **332** | **332** | **332** |

Additional rehearsed behaviour:

- **Repeated reviews.** All 157 reviews landed, including 152 rows that are
  byte-identical apart from their legacy IDs. Each kept its own legacy ID.
- **Unlinked chat.** All 32 chat rows landed; the unlinked rows carry
  `userEmail` and no `userId`. No user identity was invented.
- **Idempotency.** A second import added zero rows (332 → 332).
- **Interruption recovery.** An import aborted with `reviews` partially loaded
  (`done=false`, cursor set) and the other tables complete. A resumed run
  reconciled to 332 verified rows with no duplicates.
- **Counters.** Floors were reserved one past each table's maximum legacy ID
  (e.g. `reviews → 158`, `users → 14`).

The source-only preflight also ran end to end against the same container and
reported `PREFLIGHT_PASS` with zero errors and one pre-approved warning
(`unresolved_optional_relationship` for unlinked chat).

## Verification

- `npm test`: 190 tests across 26 files, all passing.
- Backend, Convex, and frontend TypeScript checks: all passing.
- `npm run build`: passing (backend, Convex, and frontend bundles built).

## Remaining blockers

The real staging import could not be executed because none of the required
credentials are present in this environment:

| Variable | State |
| --- | --- |
| `KING_DATABASE_URL` | unset |
| `CONVEX_STAGING_URL` | unset |
| `CONVEX_STAGING_DEPLOY_KEY` | unset |
| `CONVEX_DEPLOY_KEY` | unset |
| `STAGING_DATABASE_URL` | unset |

Because the destination deployment does not exist in this environment, there is
no way to confirm the real per-table destination counts, the 152 repeated
reviews, or the 18 unlinked chat rows **in the real staging deployment**. Those
figures above come from the rehearsal, not from a live staging deployment.

## Exact remaining work

1. Register `KING_DATABASE_URL`, `CONVEX_STAGING_URL`, and
   `CONVEX_STAGING_DEPLOY_KEY` (and, for `import`, `ALLOW_STAGING_IMPORT`).
2. Provision the isolated staging Convex deployment and deploy the current
   `convex/schema.ts` to it.
3. Run `MIGRATION_MODE=preflight`, then `dry-run`, then `import`, then `verify`
   per `CONVEX_STAGING_MIGRATION_RUNBOOK.md`. Expect 332 rows across 13 tables,
   157 reviews, and 32 chat rows.
4. Application integration: point a non-production environment at the staging
   deployment and exercise the auth bridge, catalog reads, and writes.
5. Production cutover (out of scope here): provision the production deployment,
   rehearse against a fresh staging clone, schedule an explicit change window,
   execute, verify, then retire PostgreSQL.
