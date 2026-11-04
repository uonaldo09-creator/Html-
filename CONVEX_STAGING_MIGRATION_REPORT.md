# UniInfo: King → isolated Convex staging migration report

Status: **isolated Convex staging data import and independent verification complete.**
The 332-row King snapshot was imported and reconciled in the dedicated staging
deployment on 2026-11-04. Production remains on PostgreSQL; no production cutover
or production/shared-deployment write was performed. Application JWT authentication
and end-to-end staging integration remain open.

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

## Live isolated staging execution — 2026-11-04

The real King source was read through the read-only migration connection and
imported into the isolated Convex staging deployment `confident-oyster-610`
(`ap-southeast-2`). The source PostgreSQL project was not modified.

| Check | Result |
| --- | --- |
| Source preflight | `PREFLIGHT_PASS` |
| Empty-destination dry-run | `DRY_RUN_PLAN_COMPLETE`; 332 planned inserts |
| Import and reconciliation | `STAGING_IMPORT_AND_RECONCILIATION_PASS` |
| Independent read-only verification | `VERIFY_COMPLETE` |
| Source rows | 332 across 13 tables |
| Imported / destination keys | 332 / 332 |
| Missing keys / conflicts | 0 / 0 |
| Validation errors / import warnings | 0 / 0 |
| Independent verify classification | 332 already present and identical; 0 planned inserts |
| Source fingerprint | `151c9d246d6b2024bd9ee90d83a1eee37b7d2d437a746ddce590153f805e86eb` |

| Table | Source rows | Imported / verified | Destination keys |
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

All 157 review rows were preserved, including 152 repeated-content records
with distinct legacy IDs. All 32 chat-history rows were preserved, including
18 unlinked records; no user identity was invented. The independent `verify`
run re-read the source and found all 332 destination keys identical. A second
live `import` invocation was not performed; the independent read-only verify
is the recorded live idempotency/reconciliation evidence.

The isolated staging import did not switch application routes. PostgreSQL remains
the authoritative production datastore. No production deployment was written to.

## Verification

- `npm test`: 190 tests across 26 files, all passing.
- Backend, Convex, and frontend TypeScript checks: all passing.
- `npm run build`: passing (backend, Convex, and frontend bundles built).

## Remaining blockers

The database import and independent reconciliation are complete. The remaining
application-level blocker is live JWT authentication and browser/application
integration. The repository's bridge code requires a real, publicly reachable
HTTPS issuer that serves `/.well-known/jwks.json`, a matching Convex issuer and
audience, and a backend-only P-256/ES256 private key. No real issuer endpoint has
been provisioned or verified. Do not substitute `https://auth.uniinfo.test`,
disable JWT validation, or set `providers: []` to bypass authentication.

The local commit `2ecbc73` contains the migration preflight reporting and safe
dry-run fixes; it has been committed in the Fedora checkout but was not pushed
to GitHub at the time this report was prepared. GitHub repository write access
was unavailable to the connected integration (HTTP 403), so the user must push
from the authorized local checkout.

## Exact remaining work

1. Push local commit `2ecbc73` from the authorized Fedora checkout, then commit
   these report/runbook updates.
2. Provision a real HTTPS staging issuer/JWKS endpoint and set matching
   `CONVEX_AUTH_ISSUER` and `CONVEX_AUTH_AUDIENCE` values in Express and the
   isolated Convex deployment. Keep `CONVEX_AUTH_PRIVATE_KEY` backend-only.
3. Run staging-only auth and application integration tests: successful verified
   session token exchange and protected `me` query; JWKS key match; rejection of
   invalid signature, issuer, audience, expiry, disabled user, and stale token
   version; then catalog reads and a controlled synthetic write/readback.
4. Update this report with test evidence and the published commit/PR references.

Production cutover remains out of scope. PostgreSQL must remain authoritative
until a separate production migration plan, backup/restore rehearsal, approval,
and explicit change window are completed.
