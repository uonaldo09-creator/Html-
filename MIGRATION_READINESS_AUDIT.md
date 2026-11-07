# UniInfo migration readiness audit

Status: **reconstructed audit for human review. Stage 1 only; not a production-readiness declaration.**
Base commit: `de9c507` (`Document verified Convex staging migration`) on `main`.
Audit branch: `audit/parity-and-gaps`.
Date reconstructed: 2026-11-05.

The original commits `2ba1355` and `ed4acfa` are unavailable. This document is a
new reconstruction from the current checkout; it does not claim to recover or
reproduce those commits byte-for-byte.

## Evidence labels

| Label | Meaning |
| --- | --- | 
| **[VERIFIED]** | Directly observed in the current checkout or by a command run during this reconstruction. |
| **[LIVE VERIFIED]** | Verified by an explicit read-only live PostgreSQL inspection of Supabase project King (reported to this agent; not re-queried in this session to avoid repeating production queries). |
| **[DOC CLAIM]** | Stated by repository documentation or prior reports, but not independently re-verified against a live service. |
| **[ASSUMPTION]** | Working assumption used to frame a gap; must be confirmed before relying on it. |
| **[PRODUCT SIGN-OFF]** | A product, security, privacy, or data-owner decision that engineering must not make alone. |

## 1. Environment and baseline facts

### 1.1 Live source findings (Supabase project King, read-only, 2026-11-05)

**[LIVE VERIFIED]** The following findings were obtained via explicit PostgreSQL read-only transactions and are recorded here without re-querying production:

1. Fourteen public tables exist: the 13 mapped application tables plus `account_sync_outbox`.
2. Total records: 332 across the inspected public tables.
3. `account_sync_outbox` exists and contains **0 rows**. It is **not mapped** by the Convex migration registry and remains **PostgreSQL-owned pending approval**.
4. Drizzle migration `0003_identity_subjects` is applied; `0004_review_user_uniqueness` is **not** applied.
5. All 13 users have unique, nonblank legacy `uniinfo-user:<id>` auth subjects.
6. No missing or duplicate auth subjects, no disabled accounts, and all token versions are nonnegative.
7. Eighteen `chat_history` records have unmatched nonblank `user_email` values (guest/unlinked history; preserved by migration design, no invented user IDs).
8. Four review groups each contain 39 identical records. There are **152 additional duplicate review rows** (157 reviews total across five universities). Source rows must remain intact.
9. `university_reviews_agg` is empty despite 157 reviews across five universities (aggregate drift; migration/recomputation policy requires product sign-off).
10. Live `users.firebase_uid` and `users.sync_version` columns exist in PostgreSQL but are **absent from `src/db/schema.ts`**; their current live values are empty/zero. Schema reconciliation is documentation/remediation only — no live schema/data changes.
11. `analytics_events.id` is **identity-generated** in PostgreSQL but is not modeled as generated in Drizzle. Migration reads/imports legacy IDs read-only; no sequence/identity mutation performed.
12. `bookmarks` has maximum existing row ID **6** but PostgreSQL sequence high-water **232**. Reserving Convex ID counters from `max(legacyId)+1` alone is **insufficient** and can reuse previously allocated PostgreSQL IDs; code remediation is implemented on `fix/migration-id-counter-sequence-floor` (fail-closed, read-only sequence metadata).


### 1.4 Sequence-floor semantics (implemented, regression-fixed)

- `MigrationIdCounterFloor.sequenceNextId` means the **next safe allocation boundary** for future Convex legacy-style ID allocation for a counter-backed table (the value at/above which Convex may allocate without colliding with PostgreSQL source history). It is computed from read-only catalog/runtime state, never from `nextval/currval/setval`.
- Catalog config is read via `PostgresMigrationSource.SEQUENCE_METADATA_SQL` (`pg_get_serial_sequence` + `pg_class`/`pg_namespace`/`pg_sequence`, including `has_sequence_privilege(current_user, sequence_oid, 'SELECT')`). Runtime state (`last_value`, `is_called`) is read from the catalog-derived sequence relation **only after confirmed SELECT privilege**.
- `last_value` must be present and a safe integer in both runtime states.
- **`is_called=false`** (e.g. `SETVAL(sequence, 500, false)`): `sequenceNextId = last_value` — next `nextval()` returns `last_value` exactly.
- **`is_called=true`**: `sequenceNextId = last_value + increment` — `last_value` was returned/reserved; boundary is conservative for cache reservations.
- Result is validated against sequence bounds and JavaScript safe-integer limits. Missing SELECT privilege, invalid metadata, cycling sequences, unsafe/nonpositive increments, unreadable/incomplete state, or unsafe overflow **fail closed**.
- Tables without an associated sequence/identity generator (and token-keyed/aggregate special cases) preserve `sequenceNextId = null`; orchestrator still applies `max(existing legacy row IDs)+1` lower bounds.
- Bookmarks expected floor remains **233** for max row 6 / high-water 232.

**PostgreSQL 17+ integration verification status:** `src/tests/postgresSequenceMetadata.pg17.integration.test.ts` executes `PostgresMigrationSource`’s actual SQL/read path against disposable non-production databases only (never King/Supabase). It covers: populated ordinary serial and identity sequences, a genuinely fresh sequence (initial `last_value`, `is_called=false`), the **`SETVAL(...,500,false)` regression => floor 500**, missing SELECT privilege, SELECT without USAGE/UPDATE, no-sequence/token-keyed/aggregate tables, bookmarks row max 6/high-water 232 => 233, repeatable-read/read-only enforcement, and no `nextval/currval/setval` calls. **The six real integration cases passed on PostgreSQL 18.6 on 5 November 2026 (re-verified 7 November 2026).** The regression case returned `sequenceNextId=500`, and the separate genuinely fresh sequence returned its initial `last_value`. The suite accepts PostgreSQL 17+, but PostgreSQL 17 itself was not separately tested; the actual server used was PostgreSQL 18.6.

### 1.2 Approved migration-reader permissions (documentation only; do not execute on King)

**[PRODUCT/SECURITY/DATA-OWNER SIGN-OFF REQUIRED]** For a future approved real-data migration reader, grant the minimum read-only access needed to inspect rows and sequence state:

- `SELECT` on the 13 mapped application tables.
- `USAGE` on the `public` schema.
- `SELECT` on the associated mapped sequences needed to inspect sequence state (required because PostgreSQL can report `last_value` as `NULL` both for an unused sequence and when the current role lacks `SELECT`/`USAGE` visibility; the reader must distinguish these cases and fail closed).
- **No** `USAGE` or `UPDATE` on sequences.
- **No** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, role-management, or elevated privileges.
- **No** `BYPASSRLS`.
- **No** `nextval()`, `currval()`, or `setval()` calls during source inspection.

Reviewed SQL example for the database owner (grant on mapped sequence objects only; **do not execute against King in this task**):

```sql
-- Example only. Review, adapt role/schema names, and execute only with explicit approval.
GRANT USAGE ON SCHEMA public TO migration_reader_role;
GRANT SELECT ON TABLE
  public.users,
  public.universities,
  public.sessions,
  public.reviews,
  public.bookmarks,
  public.chat_history,
  public.audit_logs,
  public.analytics_events,
  public.login_attempts,
  public.student_profiles,
  public.parent_profiles,
  public.notifications,
  public.university_reviews_agg
TO migration_reader_role;
GRANT SELECT ON SEQUENCE
  public.users_id_seq,
  public.reviews_id_seq,
  public.bookmarks_id_seq,
  public.chat_history_id_seq,
  public.audit_logs_id_seq,
  public.login_attempts_id_seq,
  public.student_profiles_id_seq,
  public.parent_profiles_id_seq,
  public.notifications_id_seq,
  public.analytics_events_id_seq
TO migration_reader_role;
-- Do not grant access to unmapped account_sync_outbox or its sequence.
```

If sequence metadata cannot be read with confirmed `SELECT` privilege, the import must fail closed and never interpret missing permission as an unused sequence.

### 1.3 Production cutover safety for sequence high-water

A sequence high-water read is **not** a permanent reservation against future PostgreSQL writes. A staging rehearsal does **not** approve production cutover.

Before a production domain is switched to Convex:
1. Quiesce writes for that domain.
2. Perform the final PostgreSQL snapshot and sequence high-water inspection.
3. Reserve the Convex counter floor from the final inspected values.
4. Complete final reconciliation.
5. Switch writes only after verification.



**Privacy/safety:** no personal information, credentials, password hashes, session tokens, or private record contents were recorded in this audit update.


- **[VERIFIED]** Working directory is `/home/charlie/Documents/uniinfo-html`.
- **[VERIFIED]** `origin` is `https://github.com/uonaldo09-creator/Html-.git`.
- **[VERIFIED]** The working tree started clean, the branch was `main`, `HEAD`
  was `de9c507f76bb6d9fec7fce1b7858f1333cdf2027`, and `git stash list` was empty.
- **[VERIFIED]** Local and remote heads include `origin/main`,
  `origin/fix/uniinfo-p0-baseline`,
  `origin/migration/king-to-convex-staging`, and
  `origin/sync/complete-uniinfo-project-20261103-202946`. No branch was deleted
  or rewritten.
- **[VERIFIED]** No production database, Convex deployment, deployment key, or
  credential was used during this audit.

## 2. Current architecture in one paragraph

The application is an Express server (`server.ts`) that serves an SPA and a
PostgreSQL/Drizzle data layer (`src/db/dbService.ts`, `src/db/schema.ts`). A
13-table migration registry (`src/server/convexMigration.ts`) feeds an
orchestrator, a PostgreSQL read-only source adapter, a Convex destination
adapter, and internal Convex functions (`convex/migration.ts`). Convex currently
has a public read-only university catalog (`convex/universities.ts`), one
protected `me` query (`convex/me.ts`), and an unverified JWT auth bridge
(`src/server/convexAuth.ts`, `convex/auth.config.ts`). PostgreSQL remains the
authoritative store for every application write.

## 3. Feature-parity matrix

### 3.1 How to read this matrix

- **PG** = PostgreSQL through `src/db/dbService.ts` (Drizzle) or its
  non-production in-memory fallback.
- **Convex** = Convex function call through `src/server/convexUniversityCatalog.ts`.
- **External** = Firebase Admin, Groq AI, Resend/BullMQ email, Redis, S3, or
  another service.
- **In-process** = counters/metrics kept in server memory.
- **Static/frontend** = no application datastore.
- Reads and writes are treated independently. A route can read Convex while its
  corresponding write path remains PostgreSQL.

### 3.2 Every Express route

| # | Route | Auth / role | Current backend | Reads / writes | Convex coverage today | Parity gap |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `GET /health` | Public | PG + in-process + external probes | Read | None | Monitoring not migrated. |
| 2 | `GET /api/health` | Public | PG + in-process + external probes | Read | None | Duplicate of `/health`. |
| 3 | `GET /metrics` | Public in code | In-process/PG counts | Read | None | Prometheus metrics not migrated. |
| 4 | `GET /api/metrics` | Public in code | In-process/PG counts | Read | None | Duplicate of `/metrics`. |
| 5 | `GET /.well-known/jwks.json` | Public | Express config/crypto | Read (public key) | Convex auth config consumes it | Bridge not verified against a deployment. |
| 6 | `POST /api/auth/convex-token` | Session + verified email | PG read + Express ES256 signing | Read + token mint | Auth config exists | End-to-end staging exchange not verified. |
| 7 | `GET /api/docs` | Public | Static HTML + CDN | Read | None | Frontend/documentation only. |
| 8 | `GET /api/openapi.json` | Public | Static spec | Read | None | Frontend/documentation only. |
| 9 | `POST /api/auth/google` | Firebase ID token | External Firebase + PG | Read + writes users, sessions, login attempts, analytics | None | All writes still PG. |
| 10 | `POST /api/login` | Public, rate-limited | PG | Reads user/session; writes session, lockout, login attempt, analytics | None | Auth/session still PG. |
| 11 | `GET /api/auth/session` | Optional session | PG | Read | None | Session resolution still PG. |
| 12 | `POST /api/register` | Public, rate-limited | PG + external email queue | Writes user, session (dev), verification token, login attempt, analytics | None | Registration still PG. |
| 13 | `GET /api/auth/verify-email` | Token query | PG | Read + write email-verified state, analytics | None | Verification still PG. |
| 14 | `GET /auth/verify-email` | Public | Redirect only | None | None | Compatibility redirect. |
| 15 | `GET /verify-email` | Public | Redirect only | None | None | Compatibility redirect. |
| 16 | `GET /api/verify-email` | Token query | PG | Read + write email-verified state, analytics | None | Duplicate verification implementation. |
| 17 | `POST /api/verify-email` | Token body | PG | Read + write email-verified state, analytics | None | Duplicate verification implementation. |
| 18 | `POST /api/resend-verification` | Public | PG + external email queue | Read + write verification token | None | Still PG. |
| 19 | `POST /api/auth/dev-verify` | Dev-only | PG | Read + write verification and session | None | Must remain disabled outside development. |
| 20 | `GET /api/universities` | Public | PG **or** Convex read; PG analytics write | Read; analytics write | `universities.list` read | Public read is optionally migrated; analytics remains PG. |
| 21 | `GET /api/university-of-the-day` | Public | PG **or** Convex read | Read | `universities.list` read | Same adapter as list. |
| 22 | `GET /api/universities/search` | Public | PG **or** Convex read | Read | `universities.list` + client-side filter | Search semantics currently emulated in Express, not a Convex search call. |
| 23 | `GET /api/universities/:id` | Public | PG **or** Convex read; PG analytics write | Read; analytics write | `universities.getByLegacyId` read | Public read is optionally migrated; analytics remains PG. |
| 24 | `POST /api/universities/:id/reviews` | Session + verified email | PG | Writes review, aggregate/rating, analytics | None public | Public Convex reads can serve reviews while writes go to PG: split-brain risk. |
| 25 | `GET /api/user/profile` | Session | PG | Read | `me` query exists but is not used by this route | Convex `me` is not wired into the application. |
| 26 | `GET /api/profile/student` | Session + verified + Student/Admin/Counselor | PG | Read | None | Private read not migrated. |
| 27 | `POST /api/profile/student` | Session + verified + Student/Admin/Counselor | PG | Write + notification + Pino audit | None | Private write not migrated. |
| 28 | `GET /api/profile/parent` | Session + verified + Parent/Admin/Counselor | PG | Read | None | Private read not migrated. |
| 29 | `POST /api/profile/parent` | Session + verified + Parent/Admin/Counselor | PG | Write + notification + Pino audit | None | Private write not migrated. |
| 30 | `GET /api/notifications` | Session | PG | Read | None | Private read not migrated. |
| 31 | `POST /api/notifications/read` | Session | PG | Write | None | Private write not migrated. |
| 32 | `GET /api/chat/history` | Session | PG | Read | None | Private read not migrated. |
| 33 | `POST /api/chat` | Optional session | External Groq + PG + PG catalog/profile reads | Read + conditional writes chat/profile/notification | None | Mixed external/AI and PG writes. |
| 34 | `POST /api/chat/message` | Optional session | External Groq + PG + PG catalog/profile reads | Read + conditional writes chat/profile/notification | None | Mixed external/AI and PG writes. |
| 35 | `GET /api/ai-metrics` | Session | In-process | Read | None | In-memory only. |
| 36 | `GET /api/recommendations` | Session + verified | PG reads + static fallback | Read | None | Scoring reads PG profiles and catalog. |
| 37 | `POST /api/admin/universities` | Admin | PG | Write + Pino audit | None | Admin write not migrated. |
| 38 | `DELETE /api/admin/universities/:id` | Admin | PG | Write/delete cascade + Pino audit | None | Delete/cascade semantics not migrated. |
| 39 | `GET /api/admin/users` | Admin | PG | Read | None | Admin read not migrated. |
| 40 | `POST /api/admin/users/role` | Admin | PG | Write role + token version + Pino audit | None | Admin write not migrated. |
| 41 | `GET /api/admin/reviews` | Admin | PG | Read | None | Admin read not migrated. |
| 42 | `DELETE /api/admin/reviews/:id` | Admin | PG | Write/delete + Pino audit | None | Admin write not migrated. |
| 43 | `GET /api/admin/audit-logs` | Admin | PG | Read | None | Admin read not migrated. |
| 44 | `POST /api/user/bookmarks` | Session + verified | PG | Write/toggle | None | Private write not migrated. |
| 45 | `GET /api/analytics` | Admin | PG | Read aggregate | None | Admin analytics not migrated. |
| 46 | `POST /api/user/logout` | Session cookie (optional) | PG | Write/delete session | None | Session revocation remains PG; Convex JWT expires independently. |
| 47 | `GET *` (non-API) | Public | Static/Vite frontend | None | None | SPA fallback only. |

**Verified summary:** Convex currently covers only public university reads and a
protected `me` query. Every Express write, all private user data, all admin
operations, all auth/session operations, all audit/analytics paths, and all
cleanup/retention operations remain PostgreSQL/Express.

**Independently migrated reads and writes [VERIFIED]:** the catalog switch
`UNIINFO_CATALOG_BACKEND=convex` changes only reads. It does not change any write
route. Reviews are the clearest example: public review data can be read from
Convex while new reviews are still written to PostgreSQL.

## 4. PostgreSQL-to-Convex mapping

### 4.1 Executable source of truth

- **[VERIFIED]** PostgreSQL source declarations: `src/db/schema.ts` (13 tables).
- **[VERIFIED]** Convex schema: `convex/schema.ts` (13 source tables plus derived
  `idCounters` and migration-only `migrationCheckpoints`).
- **[VERIFIED]** Migration registry: `src/server/convexMigration.ts`
  (`migrationTables`, `expectedSourceTables`).
- **[VERIFIED]** Transform: `src/server/convexMigrationTransform.ts`.
- **[VERIFIED]** Source reader allowlist: `src/server/postgresMigrationSource.ts`.

### 4.2 Table mapping

| PostgreSQL source | Convex destination | Source key | Mapping notes | Status |
| --- | --- | --- | --- | --- |
| `users` | `users` | `id` | `id` → `legacyId`; `password` → `passwordHash`; preserves role, lock state, `authSubject`, `tokenVersion`, `disabled`; optional verification token hash. | Mapped |
| `universities` | `universities` | `id` | `id` → `legacyId`; derives `searchText`; timestamps to milliseconds; preserves JSONB fields. | Mapped |
| `sessions` | `sessions` | `token` | Raw token → SHA-256 `sessionTokenHash`; resolves `userId`; converts expiry fields. | Mapped |
| `reviews` | `reviews` | `id` | `id` → `legacyId`; resolves university and optional user; preserves `userEmail`, duplicate rows, date string. | Mapped |
| `bookmarks` | `bookmarks` | `id` | Resolves mandatory user and university; preserves `legacyUniversityId`; enforces `(user, university)` logical uniqueness in migration checks. | Mapped |
| `chat_history` | `chatHistory` | `id` | Resolves optional user; unlinked guest history preserved with email and no invented user. | Mapped |
| `audit_logs` | `auditLogs` | `id` | Preserves action, JSON details, actor email, IP, status, correlation ID, timestamp. | Mapped |
| `login_attempts` | `loginAttempts` | `id` | Preserves IP, optional email, success, attempt time. | Mapped |
| `student_profiles` | `studentProfiles` | `id` | Resolves mandatory user; preserves optional preference fields; migration checks Student role. | Mapped |
| `parent_profiles` | `parentProfiles` | `id` | Resolves mandatory user; preserves optional preference fields; migration checks Parent role. | Mapped |
| `notifications` | `notifications` | `id` | Preserves owner email/content/read state/time; resolves optional user. | Mapped |
| `university_reviews_agg` | `universityReviewsAgg` | `universityId` | Resolves university; preserves average/count. | Mapped |
| `analytics_events` | `analyticsEvents` | `id` | Preserves event type, nullable JSON details, nullable email/IP, timestamp; signed PostgreSQL INTEGER range accepted. | Mapped |
| — | `idCounters` | — | Derived table for collision-free numeric IDs; no PostgreSQL source. | Convex-only |
| — | `migrationCheckpoints` | — | Migration resume state; no PostgreSQL source. | Migration-only |

**Unmapped source tables [VERIFIED]:** none among the 13 declarations in
`src/db/schema.ts`. Every declared source table has a registry entry, transform,
Convex destination, and migration mutation.

**[LIVE VERIFIED] `account_sync_outbox`:** the live Supabase project King schema contains `account_sync_outbox` with **0 rows**. A repository-wide source search still finds no Convex mapping/registry/transform for it. It is therefore **present in live PostgreSQL, not mapped to Convex, and remains PostgreSQL-owned pending product/data-owner approval**. Do not add it to the Convex migration without explicit sign-off and contract design.

### 4.3 Mapping caveats

- **[VERIFIED]** Convex `_id` is internal; every public numeric ID is the
  preserved `legacyId`.
- **[VERIFIED]** Convex indexes are **not unique constraints**. Migration
  classification checks collisions, but ordinary application mutations do not
  exist yet to enforce the same invariants at runtime.
- **[VERIFIED]** PostgreSQL `ON DELETE CASCADE` behavior has no Convex
  equivalent. Delete paths remain PostgreSQL-only today.
- **[LIVE VERIFIED]** Live schema inspection (King, read-only) confirms 14 public tables including `account_sync_outbox` and the 13 mapped app tables, with 332 total records. Live-vs-Drizzle drift remains: `users.firebase_uid`/`users.sync_version` exist live but are absent from `src/db/schema.ts` (current values empty/zero); `analytics_events.id` is identity-generated live but not modeled as generated in Drizzle. No live schema/data changes were made.
- **[PRODUCT SIGN-OFF]** Confirm the authoritative source schema, timezone
  convention for `TIMESTAMP WITHOUT TIME ZONE`, retention rules for
  `analytics_events`, and the privacy treatment of historical emails/IPs before
  any production migration.

## 5. Missing Convex functions and adapters

The proposed narrow function names below come from the architecture document;
the gap statements are verified against the current checkout.

### 5.1 Reviews and aggregates

- **[VERIFIED]** Public university reads include projected reviews, review
  counts, and average rating from `convex/universities.ts`.
- **[VERIFIED]** Review creation, deletion, moderation, rating recomputation,
  and `university_reviews_agg` maintenance exist only in PostgreSQL/Express and
  internal migration functions.
- **Missing:** verified-user `reviews.create`, Admin-only `reviews.remove`,
  Admin `reviews.listForAdmin`, aggregate recomputation in the same transaction,
  and public review query functions separate from the catalog projection.

### 5.2 Bookmarks

- **Missing:** `bookmarks.listMine` and `bookmarks.toggleMine`, owner derived
  from auth, atomic `(userId, universityId)` uniqueness check. Only internal
  migration writers exist.

### 5.3 Student and parent profiles

- **Missing:** `profiles.getStudent`, `profiles.saveStudent`,
  `profiles.getParent`, `profiles.saveParent`, role checks, owner derivation,
  and atomic uniqueness on the user relation. Only internal migration writers
  exist.

### 5.4 Notifications

- **Missing:** `notifications.listMine`, `notifications.markMineRead`,
  internal/Admin `notifications.create`, ownership checks, and retention
  cleanup. Only internal migration writers exist.

### 5.5 Chat history

- **Missing:** `chatHistory.listMine` and `chatHistory.appendMine` with owner
  and role rules; guest/unlinked historical records are preserved by migration
  but have no Convex application read/write path.

### 5.6 Authentication and session operations

- **[VERIFIED]** `convex/me.ts` and `convex/identity.ts` provide one protected
  identity lookup.
- **Missing in Convex:** login, registration, email verification consumption,
  token exchange, session create/read/revoke, role changes, account disable,
  password verification, and login-attempt recording. These remain
  Express/PostgreSQL operations.

### 5.7 Admin operations

- **Missing:** university upsert/delete, user list/role change, review
  moderation, audit-log listing, and analytics aggregation as Convex functions
  with Admin authorization and explicit cascade/cleanup behavior.

### 5.8 Audit logs and analytics

- **Missing:** `audit.record`, `audit.listForAdmin`, analytics event recording,
  and Admin analytics aggregation in Convex. Only internal migration writers
  exist.
- **[VERIFIED]** `logAuditEvent` writes security/audit events to Pino, while the
  PostgreSQL `audit_logs` table is used for a different analytics-like stream in
  places. These streams must not be conflated during migration.

### 5.9 Cleanup and retention

- **[VERIFIED]** PostgreSQL cleanup exists for sessions, verification tokens,
  login attempts, and notifications (`dbService.cleanupExpired*`).
- **Missing:** Convex cleanup mutations, pagination/bounds, scheduled jobs
  (`convex/crons.ts`), retention approval, and deletion auditing.

### 5.10 Catalog and deployment targeting

- **[VERIFIED before Stage 1]** `src/server/convexUniversityCatalog.ts` was
  hard-pinned to `dev:clear-gopher-925` and
  `clear-gopher-925.ap-southeast-2.convex.cloud`.
- Stage 1 (this branch's child) replaces that pin with a shared, fail-closed
  deployment-target resolver. Until that commit is reviewed, cross-deployment
  catalog selection is a blocker.

## 6. Authentication and authorization gaps

| Area | Current state | Gap / risk |
| --- | --- | --- |
| Express sessions | **[VERIFIED]** Opaque random token in an HttpOnly cookie; PG `sessions` table; idle and absolute expiry; delete on logout. | Still the only application session authority. Convex does not own sessions. |
| Convex JWT bridge | **[VERIFIED in code, DOC CLAIM for deployment]** Express exchanges a verified session for a five-minute ES256 JWT. | **[DOC CLAIM]** Not verified against any Convex deployment. No production issuer/JWKS endpoint is provisioned. |
| ES256 signing | **[VERIFIED]** `src/server/convexAuth.ts` requires an EC P-256 key via `jose`, signs `sub`, `tv`, `iss`, `aud`, `iat`, `exp`, `jti`. | Key rotation/overlap is not implemented. Private key handling must remain server-only. |
| JWKS publication | **[VERIFIED]** `GET /.well-known/jwks.json` exposes only the public JWK with `kid`, `alg: ES256`, `use: sig`. | No live HTTPS staging JWKS fetch/key-match test. |
| Subject validation | **[VERIFIED]** Tokens use persisted `users.authSubject`; migration rejects missing/blank/email-shaped/duplicate subjects. | Legacy backfill `uniinfo-user:<id>` must be applied and verified before import. |
| Token-version validation | **[VERIFIED]** `requireActiveUser` compares JWT `tv` to the stored user `tokenVersion`; role changes increment the PostgreSQL column. | No account-disable admin route exists; direct DB disable is not audited as an app flow. |
| Role and ownership checks | **[VERIFIED]** Express has `requireRole` and route-level ownership scoping. Convex `me` returns only the caller. | No Convex private mutations/queries exist yet, so no Convex role/ownership enforcement has been exercised. |
| Protected mutations | **[VERIFIED]** None exist. Migration functions are `internalMutation`/`internalQuery`. | All private writes are still unprotected from Convex because they are not in Convex. |
| Token revocation and expiry | **[VERIFIED]** JWT is short-lived; logout deletes the Express session; role changes bump `tokenVersion`. | An already-issued Convex token remains valid for up to five minutes after logout. No token denylist or key rotation. |
| End-to-end staging verification | **[VERIFIED]** Not performed. | Blocked on an isolated staging deployment, a reachable HTTPS issuer, matching issuer/audience, and synthetic accounts. Do not bypass with `providers: []` or a test issuer. |

## 7. Migration risk register

| Risk | Evidence | Impact | Current mitigation | Required decision / action |
| --- | --- | --- | --- | --- |
| Duplicate reviews | **[VERIFIED]** Migration preserves repeated review rows by distinct legacy IDs; `0004_review_user_uniqueness.sql` would delete duplicates. | Data loss or silent convergence if a later uniqueness migration is applied. | Runbook forbids applying `0004`; migration checks preserve rows. | **[PRODUCT SIGN-OFF]** Decide canonical review policy before any future uniqueness enforcement. |
| Identity collisions | **[VERIFIED]** Migration checks duplicate normalized emails, duplicate/blank/email-shaped subjects, and Convex index collisions. | Account takeover or merged identities. | Preflight and destination collision checks; persisted `authSubject`. | Verify `0003` on the real source; add atomic uniqueness to future Convex user mutations. |
| Unlinked historical chat records | **[VERIFIED]** Guest and unmatched emails are preserved with email and no invented `userId`. | Privacy exposure or orphaned history. | Explicit warning codes approved for known unlinked data. | **[PRODUCT SIGN-OFF]** Approve ownership/privacy treatment of unlinked history. |
| Sensitive token handling | **[VERIFIED]** Session tokens hashed for Convex; verification tokens hashed when non-expired; deploy key server-only. | Credential leakage. | No tokens logged by migration; scripts reject credential-bearing URLs. | Verify secret storage and redaction end-to-end; implement key rotation before production. |
| Referential integrity | **[VERIFIED]** PostgreSQL FKs/cascades; Convex has no FKs and no ordinary delete mutations. | Orphans or failed deletes after cutover. | Migration resolves every required relation and blocks missing parents. | Implement explicit Convex delete/cleanup semantics before any Convex delete path. |
| ID-counter collisions | **[VERIFIED]** `idCounters` floor reserved at `max(legacyId)+1`; future allocations must call `allocateNextLegacyId`. | Duplicate numeric IDs visible to public API. | Internal counter reservation tested. | Every future Convex insert must use the allocator, not `Date.now()` or ad-hoc IDs. |
| Retry and idempotency | **[VERIFIED]** Bounded retries, checkpointing, classify-before-write, full key reconciliation. | Partial writes or duplicate rows. | Migration tests cover retry, resume, and repeat import. | Keep retries bounded; add the same idempotency to application mutations. |
| Data consistency during cutover | **[VERIFIED]** Catalog reads can come from Convex while all writes go to PostgreSQL; no dual-write or change capture. | Stale Convex reads and divergence. | Catalog switch is opt-in; PostgreSQL remains authoritative. | **[PRODUCT SIGN-OFF]** Choose a cutover/dual-write strategy and acceptable staleness window. |
| Backup and restoration | **[VERIFIED]** Encrypted backup supports the 13 current tables and transactional restore in synthetic tests. **[DOC CLAIM]** No backup has been verified against the real source. | Unrecoverable data loss. | Encryption validation and restore tests exist. | Perform and verify a real restorable backup before any migration/cutover. |
| Rollback and traffic switching | **[VERIFIED]** Orchestrator returns `PostgreSQL remains authoritative; no automatic delete or route switch.` Catalog cache keys include the backend. | Incomplete rollback after partial cutover. | No automatic traffic switch; destination guards fail closed. | Define rollback triggers, owner, and data-reconciliation steps; rehearse before cutover. |

## 8. Dependency-ordered implementation plan

Each stage is separately reviewable. Passing tests is necessary but **not**
sufficient for production readiness.

### Stage 0 — Approved source of truth and sign-offs

- **Prerequisites:** product/data-owner availability; read-only source access
  approval; privacy/retention decisions.
- **Tasks:** independently capture the live PostgreSQL schema (tables, columns,
  constraints, indexes, sequences); reconcile it with `src/db/schema.ts`;
  explicitly confirm whether any queue such as `account_sync_outbox` exists and
  remains PostgreSQL-owned; approve retention/privacy rules.
- **Tests:** schema-diff report review; no writes.
- **Exit criteria:** signed source-schema baseline and written sign-offs. No
  production data migration before this exits.

### Stage 1 — Shared deployment-target resolver and catalog safety

- **Prerequisites:** Stage 0 is useful but not required for code-only work.
- **Tasks:** one fail-closed resolver for deployment name, scope, HTTPS origin,
  protected deployments, synthetic-only deployment, and role policy; adopt it in
  the catalog, migration destination, and orchestrator; keep catalog read-only;
  preserve PostgreSQL as the default catalog backend.
- **Tests:** valid/invalid names, origin mismatch, HTTP rejection, `prod`,
  `graceful-kangaroo-272`, `clear-gopher-925` real-data rejection, catalog
  default/read-only behavior, destination/orchestrator guard adoption.
- **Exit criteria:** all validation commands pass and a human reviews the
  fail-closed behavior. This stage does not authorize deployment or migration.

### Stage 2 — Staging auth bridge verification

- **Prerequisites:** Stage 1; a newly provisioned isolated staging deployment;
  a real HTTPS issuer serving JWKS; matching issuer/audience; server-only P-256
  key; synthetic accounts only.
- **Tasks:** deploy `auth.config.ts` environment values; verify JWKS key match;
  exchange a verified session for a token; call `me`; reject missing session,
  unverified email, wrong issuer/audience, expired/invalid signature, disabled
  user, and stale `tokenVersion`; document key rotation.
- **Tests:** staging-only auth integration tests and negative cases.
- **Exit criteria:** recorded staging evidence for every positive and negative
  case. Never substitute a test issuer or disable validation.

### Stage 3 — Private read adapters behind explicit switches

- **Prerequisites:** Stage 2 identity resolution.
- **Tasks:** implement owner-derived queries for profiles, bookmarks,
  notifications, and chat history; keep writes in PostgreSQL until write
  adapters and cutover rules are approved; add parity tests against PostgreSQL
  responses.
- **Tests:** role/ownership isolation, unlinked chat behavior, pagination, empty
  states, cache behavior.
- **Exit criteria:** feature-flagged reads match PostgreSQL for approved
  synthetic fixtures; rollback switch is proven.

### Stage 4 — Private write mutations and atomic aggregates

- **Prerequisites:** Stage 3; approved duplicate-review policy; approved
  ownership/privacy rules.
- **Tasks:** implement profile save, bookmark toggle, notification read,
  chat append, review create/delete, aggregate updates, and admin review
  moderation with atomic uniqueness and referential checks; keep PostgreSQL
  authoritative during dual-write/rehearsal.
- **Tests:** collision rejection, missing-parent rejection, cascade/delete
  behavior, idempotency, retries, rollback, concurrency.
- **Exit criteria:** writes are proven idempotent and transactionally consistent
  against isolated staging data; a written cutover/rollback plan exists.

### Stage 5 — Admin, audit, analytics, cleanup, and retention

- **Prerequisites:** Stages 2–4.
- **Tasks:** implement Admin-only functions, audit recording/listing, analytics
  aggregation, and scheduled cleanup; preserve the distinction between Pino
  security events and the `audit_logs` analytics-like stream; obtain retention
  approval.
- **Tests:** Admin authorization, non-Admin denial, retention boundaries,
  deletion auditing, bounded pagination.
- **Exit criteria:** Admin and retention behavior matches approved policy;
  cleanup cannot delete data outside an approved window.

### Stage 6 — Cutover readiness (not production readiness)

- **Prerequisites:** Stages 0–5; verified backup/restore; approved change
  window.
- **Tasks:** rehearse full migration, independent verification, rollback,
  traffic switch, and post-switch reconciliation; finalize monitoring and
  incident runbooks.
- **Tests:** full isolated rehearsal including failure injection and restore.
- **Exit criteria:** human go/no-go decision. Test success alone is not
  approval.

## 9. Decisions requiring product/security sign-off

1. **[PRODUCT SIGN-OFF]** Authoritative source schema and whether any
   PostgreSQL-owned queue (for example `account_sync_outbox`, if it exists
   outside this checkout) must stay out of Convex.
2. **[PRODUCT SIGN-OFF]** Duplicate-review policy and the status of
   `0004_review_user_uniqueness.sql`.
3. **[PRODUCT SIGN-OFF]** Privacy/retention treatment for unlinked chat,
   analytics event email/IP, audit logs, and login attempts.
4. **[PRODUCT SIGN-OFF]** Cutover strategy, acceptable read staleness, and
   rollback criteria.
5. **[SECURITY SIGN-OFF]** JWT key custody, rotation/overlap, logout semantics,
   and account-disable administration.
6. **[PRODUCT SIGN-OFF]** Admin operation parity, especially deletes and
   cascades, before any Convex write path is enabled.

## 10. Audit conclusion

The repository has a credible **read-only catalog** and a well-guarded,
resumable **data migration pipeline**, but it does **not** have application
feature parity on Convex. PostgreSQL remains authoritative for all writes and
for nearly all reads. The highest-risk gaps are the unverified auth bridge,
missing private/admin/audit/cleanup functions, split read/write behavior for
reviews, and the absence of a verified real-data backup/restore and cutover
plan.
