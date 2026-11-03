# UniInfo Convex Architecture — Phases 2 and 3A–3C

This is an architecture and security record, not a deployment or data
migration. PostgreSQL remains the source of truth. Express, Drizzle,
PostgreSQL, and Firebase remain in place.

## Authentication options and recommendation

| Concern | A. Firebase directly to Convex | B. Express issues custom JWTs for Convex | C. Express remains the auth boundary |
|---|---|---|---|
| Password accounts | Not compatible with existing PBKDF2 password hashes or Express sessions. Requires a password migration/reset or a second auth provider. | Compatible: Express continues password verification and exchanges its established session for an app JWT. | Fully compatible; keep password login and sessions unchanged. |
| Firebase Google | Possible only after verifying actual token claims and configuring exact Firebase issuer, project audience, and supported signing-key/JWKS URL. Do not assume a Firebase token is accepted by default. | Compatible: Firebase Admin verifies ID token in Express, then Express issues its own JWT for Convex. | Compatible: Firebase Admin verification remains in Express. |
| Authorization | Firebase proves Firebase identity, not UniInfo role. Resolve the UniInfo user from verified identity and fetch role server-side in every sensitive function. | Convex verifies app JWT signature/issuer/audience/expiry; functions still resolve subject to the current UniInfo user and role. Never trust a role claim. | Express resolves its cookie session and loads role from the DB before protected routes; protected Convex writes remain unexposed until a safe service boundary is built. |
| Security and complexity | Medium/high: configure OIDC/JWT precisely, handle user linking and role lookup, and support password accounts separately. | High: build and operate issuer/JWKS, private-key rotation, secure token endpoint, and session binding/revocation. | Lowest immediate change; preserves the tested Express boundary. Do not expose admin-key-backed functions directly to browsers or pass unverified identity fields to Convex. |
| Session revocation | Firebase ID tokens are short-lived (normally about one hour); direct Convex validation does not itself call Firebase Admin to check token revocation. Revocation therefore is not necessarily immediate. | JWT remains valid until `exp` unless each sensitive operation also checks server-side session/version state. Short expiry bounds exposure; checking a live session/version enables prompt revocation. | Existing DB session lookup/deletion continues to govern each protected request, preserving current logout/session semantics. |
| Expiration | Firebase token expiry is verified by Convex only if its provider configuration matches; refresh remains with Firebase client SDK. | Set short `exp`, `iat`, exact issuer and audience; refresh only after Express revalidates its HttpOnly session. | Existing sliding and absolute application session expiry remains authoritative. |
| Account migration | No automatic migration. Preserve PBKDF2 accounts separately or perform an explicit password reset/migration and safe Firebase linking. | No credential migration is necessary while Express remains password verifier. Convex user rows still need stable subjects/roles when data later moves. | None for authentication during the transition; migrate records separately and verify account links later. |

**Recommendation: C for Phases 3A/3B and the first gradual migration step.** Keep
authentication, role checks, and all protected user-data routes behind Express.
Initially migrate only public catalog reads after their parity is verified.
This preserves password accounts, Firebase sign-in, HttpOnly sessions,
lockouts, and current revocation behavior without introducing a new JWT issuer
or changing production traffic. Do not call protected Convex functions using a
client-controlled identity or a broadly privileged deployment secret.

### Current Express authentication policy (Phase 3B)

- Password accounts retain their existing PBKDF2 password hashes and login
  route; no credential migration or reset is required. In production, the
  account must have a verified email before login.
- Firebase Admin verifies the ID token. The token must carry a non-empty,
  verified email before the server looks up or creates an account. Account
  linking is by exact normalized email only; an unverified email cannot link
  to or create a UniInfo account. Linking never changes the stored role or
  password. The verified Firebase UID should also be stored with a uniqueness
  check when the account schema is extended; it is not currently persisted by
  the PostgreSQL auth flow.
- Express issues the existing opaque HttpOnly cookie session for both login
  methods. The session has an eight-hour idle expiry, extended on use, and a
  24-hour absolute expiry. Logout deletes the session immediately; server-side
  authorization resolves the current role from the account on every request.
  Firebase refresh-token revocation is **not** checked on every application
  request after login; an already-issued application session remains usable
  until logout, expiry, or server-side account/session revocation.
- Authentication bypasses (mock Google tokens, instant email verification,
  and development auto-login) require both `NODE_ENV=development` and
  `ENABLE_DEV_AUTH_BYPASS=true`. Leave that flag unset/false outside a local
  development environment. Do not expose a development server with the flag
  enabled to untrusted users.
- Express remains the only authentication boundary in this phase. Convex
  catalog functions below expose public university data only and do not read
  users, sessions, roles, or other private records.

Before any authenticated browser call reaches Convex, select and implement B
or an equivalent supported auth integration. B is the preferred later bridge
if direct Convex client access is required: issue a short-lived app JWT only
after Express validates the session; configure a dedicated HTTPS issuer,
JWKS, RS256/ES256 algorithm, and exact audience; bind `sub` to a server-created
immutable `authSubject`; bind the token to a session/version and check that
binding in every sensitive function for revocation. Keep private keys server
side and overlap old/new public keys during rotation.

Option A is viable only after validating a real Firebase ID token's `iss`,
`aud`, `exp`, `alg`, and key ID against the chosen Convex provider. Firebase
tokens normally use issuer `https://securetoken.google.com/<projectId>` and
audience `<projectId>`; the configured Convex issuer and `applicationID` must
match exactly and Convex must be able to retrieve the matching signing key.
Firebase Admin remains the supported custom-backend verifier. Firebase ID
token acceptance is not the same as checking Firebase refresh-token
revocation; direct Convex JWT validation does not automatically perform that
Firebase Admin network check. Firebase Admin's `verifyIdToken(token, true)`
can check revocation but requires an online backend call. Convex Auth is a
separate beta product that supports Google OAuth and passwords; it is not a
drop-in import of this app's Firebase sessions or PBKDF2 hashes.

### Role and ownership policy

Registration rejects client `role` fields, including `"Admin"` and
`"Counselor"`. It may accept a distinct, strictly allowlisted `accountType` of
`Student` or `Parent`, which the server maps to a stored role. The caller can
never choose privileged roles. After account creation, authorization and
counselor behavior use only the stored role loaded from the authenticated
session. Admin role updates remain behind the existing Admin-authenticated
route and must be similarly protected in Convex.

Chat routes ignore request-body roles. A Parent counselor flow is selected only
when the authenticated account's stored role is `Parent`; all other roles use
the Student counselor behavior. Guests cannot read or write account profiles,
bookmarks, notifications, or shared chat history. For every owner-scoped
operation, derive the owner from the authenticated session/identity; do not
accept a user ID or email as authority.

## Schema and relationships

The executable schema is [convex/schema.ts](./convex/schema.ts). It covers all
12 PostgreSQL tables plus `idCounters`, which allocates collision-free numeric
IDs where existing API contracts require them.

- Convex `_id` is the internal document identity. Each numeric PostgreSQL
  primary key is preserved as `legacyId`; university and review references
  additionally preserve `legacyUniversityId`. Public API adapters continue
  returning numeric IDs and resolve them through `by_legacy_id` indexes.
- `reviews` and `bookmarks` hold Convex university references as well as the
  legacy university number. Bookmarks hold a Convex user reference. Profiles
  hold a Convex user reference. Sessions hold a Convex user reference and a
  SHA-256 hash of the cookie token, never the bearer token itself.
- Reviews and notifications retain the source email field for historical
  records. Optional user references preserve records whose old table did not
  enforce a user foreign key; those records are not exposed as another user's
  data. Sessions require a resolved user reference.
- `universityReviewsAgg` references the Convex university document and stores
  the numeric university ID as well. Review writes and aggregate changes must
  happen atomically in one mutation.
- PostgreSQL timestamps become Unix milliseconds (`number`). Preserve original
  date strings such as `reviewDate` unchanged. Convert SQL `NULL` deliberately;
  do not replace missing historical values with guessed values.
- PostgreSQL JSONB columns remain `v.any()` where their actual nested shape is
  dynamic (`details`, profile JSON, and university JSONB fields). Validate
  untrusted writes with narrower argument validators before storage.
- Convex indexes are not unique constraints. Every create/upsert mutation must
  check the corresponding logical key in the same transaction: user email,
  auth subject, Firebase UID, legacy ID, profile user, bookmark pair, and
  counter name. Reject collisions; do not silently select the first match.
- `searchText` is a derived text field for the university full-text index. Build
  it from source name/location/state and the existing directory search fields
  on import and every university upsert; never treat it as authoritative data.

| PostgreSQL table | Convex table | Important indexes |
|---|---|---|
| `users` | `users` | `by_legacy_id`, `by_auth_subject`, `by_email`, `by_firebase_uid`, `by_verification_token_hash`, `by_role` |
| `universities` | `universities` | `by_legacy_id`, `by_state`, `by_type`, `search_text` full-text index filtered by state/type |
| `sessions` | `sessions` | `by_token_hash`, `by_user`, `by_expiry` |
| `reviews` | `reviews` | `by_legacy_id`, `by_university_date`, `by_legacy_university`, `by_user` |
| `bookmarks` | `bookmarks` | `by_legacy_id`, `by_user_university`, `by_user`, `by_legacy_university` |
| `chat_history` | `chatHistory` | `by_legacy_id`, `by_user_created`, `by_email_created` |
| `audit_logs` | `auditLogs` | `by_legacy_id`, `by_action_created`, `by_created`, `by_email_created` |
| `login_attempts` | `loginAttempts` | `by_legacy_id`, `by_ip_attempt`, `by_email_attempt`, `by_attempt_time` |
| `student_profiles` | `studentProfiles` | `by_legacy_id`, `by_user` |
| `parent_profiles` | `parentProfiles` | `by_legacy_id`, `by_user` |
| `notifications` | `notifications` | `by_legacy_id`, `by_user_created`, `by_email_created`, `by_user_read` |
| `university_reviews_agg` | `universityReviewsAgg` | `by_university`, `by_legacy_university` |
| — | `idCounters` | `by_table_name` |

Convex does not provide relational foreign keys or unique indexes. Every
mutation that creates a relationship must load and validate both referenced
documents. Delete operations must explicitly perform the required dependent
cleanup (or reject deletion); do not assume PostgreSQL cascade behavior exists.

## Function boundaries

Function names below are the proposed narrow API, not implemented functions.
Public functions require Convex identity and role/ownership checks as relevant;
migration-only functions are internal or protected by an operator-held secret.

| Existing operation | Proposed Convex function |
|---|---|
| University list, search, detail, spotlight | `universities.list`, `universities.search`, `universities.getByLegacyId`, `universities.spotlight` queries |
| University create/update/delete | `universities.upsert` and `universities.remove` mutations; Admin-only |
| Reviews by university or all reviews | `reviews.listByUniversity` query; `reviews.listForAdmin` Admin-only query |
| Submit/delete review and recompute rating | `reviews.create` verified-user mutation; `reviews.remove` Admin-only mutation; update aggregate atomically |
| User lookup/current profile/admin list/role change | `users.current` safe-field query; `users.listForAdmin` and `users.setRole` Admin-only. No public arbitrary user lookup or create-as-role. |
| Email verification lookup/consume | `users.consumeVerificationToken` mutation using a hash and expiry; token creation remains server-side |
| Login-attempt recording | `security.recordLoginAttempt` internal mutation; public access cannot choose another identity |
| Student/parent profiles | `profiles.getStudent`, `profiles.saveStudent`, `profiles.getParent`, `profiles.saveParent`; derive owner from auth, validate allowed fields and role |
| Bookmarks | `bookmarks.listMine` query; `bookmarks.toggleMine` mutation; derive user and university reference server-side |
| Sessions | Keep cookie-session operations in Express during the bridge. If moved, use hashed tokens, identity-bound ownership, idle and absolute expiry, and revocation; never expose session records. |
| Notifications | `notifications.listMine` query and `notifications.markMineRead` mutation; owner from auth. `notifications.create` internal/Admin-only. |
| Chat history | `chatHistory.listMine` query and `chatHistory.appendMine` mutation; owner and allowable roles from auth, not request arguments |
| Audit/analytics | `audit.record` internal mutation; `audit.listForAdmin` and analytics aggregation Admin-only. Preserve action, details, status, correlation ID, timestamp, and retention. Note that current `logAuditEvent` security events go to Pino, while the `audit_logs` table currently stores analytics events; these are separate streams and must not be conflated. |
| Cleanup | Internal paginated mutations for sessions, verification tokens, login attempts, and notifications; scheduled by `convex/crons.ts` only after verification |
| Migration and reconciliation | Internal, batch-bounded importer/check functions; never callable by ordinary browser users |
| AI counselor and email | Keep server-side in Express/worker initially; see integrations below |

Avoid broad `getAll*` public queries and generic table-writing mutations. Use
explicit `v` argument validators, safe response projections, bounded page
sizes, and index-backed pagination. `convex/universities.ts` currently
implements only the public list, full-text search, and legacy-ID detail
queries. List/search use Convex pagination capped at 100 records per page;
search filters are limited to the existing state/type index fields. These
functions use the source `legacyId` for public numeric `id` values and omit
internal search text. They preserve the existing public reviews/count/average
response fields while projecting out reviewer email and Convex document IDs.
Public review reads are index-backed; test the maximum real review volume
against Convex query read limits before deployment. No Convex functions for
private user data are implemented.

## Express/API and external integrations

The React client currently calls the API directly from `App.tsx`, `Header`,
`AdminPortal`, `AnalyticsDashboard`, `SmartRecommendations`, `AIRecommendations`,
`AIAgent`, and `UniversityDetailsModal`. Direct Convex subscriptions should
replace data reads only after auth and equivalent server-side rate limits are
working. Existing API shapes can be preserved temporarily by having Express
adapt Convex results.

| Existing route(s) | Eventual owner |
|---|---|
| `GET /api/universities`, `/api/universities/search`, `/api/universities/:id`, `/api/university-of-the-day` | Public Convex queries; Express adapters may remain during frontend migration |
| `POST /api/universities/:id/reviews` | Authenticated/verified Convex mutation; preserve route response while consumers move |
| `GET /api/user/profile`, `/api/profile/student`, `/api/profile/parent`; profile POSTs | Ownership-checked Convex functions; retain Express adapters until frontend auth uses the bridge |
| `POST /api/user/bookmarks`, `GET /api/notifications`, `POST /api/notifications/read`, `GET /api/chat/history` | Owner-scoped Convex functions; keep existing HTTP contracts during transition |
| `/api/admin/universities` (POST/DELETE), `/api/admin/users` (GET), `/api/admin/users/role` (POST), `/api/admin/reviews` (GET/DELETE), `/api/admin/audit-logs`, `/api/analytics` | Admin-authorized Convex functions; Express may adapt responses |
| `/api/auth/google`, `/api/login`, `/api/register`, `/api/auth/session`, `/api/user/logout` | Keep Express as auth/BFF boundary for the proposed bridge |
| `/api/auth/verify-email`, `/api/verify-email`, `/auth/verify-email`, `/verify-email`, `/api/resend-verification`, `/api/auth/dev-verify` | Keep verification/email delivery in Express; dev-only verification remains disabled in production |
| `/api/chat`, `/api/chat/message`, `/api/recommendations`, `/api/ai-metrics` | Keep in Express/worker initially. Groq key stays server-only; load profile/catalog through trusted backend calls |
| `/health`, `/api/health`, `/metrics`, `/api/metrics` and maintenance | Keep Express; adapt database diagnostics to Convex without reporting a false healthy state |
| Rate limiting, CSRF, validation, audit logger, correlation IDs | Retain at Express boundary. Direct Convex calls need equivalent Convex-side validation/authorization and a real abuse limit before cutover |
| Backups/S3 | Keep current PostgreSQL backup and recovery path until post-cutover verification. Design and verify a separate Convex export/restore procedure before retiring it. |

Do not put Groq, Resend, Firebase Admin, signing, PostgreSQL, or S3 secrets in
Vite variables or browser code. Convex actions may use server environment
variables, but retaining the existing Express/worker ownership initially
avoids duplicating integrations and failure behavior.

## Migration and rollback plan (future phase; not run)

### Preconditions and source safety

1. Keep PostgreSQL the only write source. Take and test an encrypted backup
   using the existing backup procedure; never log its connection string,
   credentials, tokens, email contents, IPs, or record payloads.
2. Add a read-only preflight that obtains counts for **all 13 tables**,
   verifies required source columns/constraints, detects duplicate normalized
   emails and orphaned references, and records a schema/version fingerprint.
   Stop for operator review on collisions; never discard/merge a record
   automatically.
3. Define table-specific transforms and validators. Convert dates to
   milliseconds; hash session and verification tokens before they enter
   Convex; omit no records silently. Treat undecodable or invalid rows as a
   failed batch with a redacted row key and count, not as success.
4. Use a migration-only credential and bounded batches with checkpoints.
   Upsert on a stable legacy key so retrying the same batch is idempotent.
   Keep migration code separate from public user mutations and rate-limited
   public APIs.

### Dependency-aware import order

1. `universities`, keyed by `legacyId`.
2. `users`, keyed by `legacyId`; set a stable `authSubject`, hash verification
   tokens, retain PBKDF2 password hashes only in server-only fields, and
   preserve role values for review. Public signup rules apply to future
   accounts, not as an implicit role rewrite of historical records.
3. `student_profiles` and `parent_profiles`, resolving `userEmail` to users.
4. `reviews`, resolving university and matching user where possible; preserve
   `legacyId`, `legacyUniversityId`, `userEmail`, text, rating and dates.
5. `bookmarks`, resolving user and university; validate the composite pair.
6. `notifications`, resolving users where possible; preserve email and read
   state.
7. `chat_history`, resolving non-null user emails where possible; preserve
   nullable/guest history and order.
8. `sessions`, resolving the account, hashing the existing cookie token,
   preserving idle/absolute expiry. If secure token-hash conversion cannot be
   completed, revoke all sessions at cutover and require reauthentication;
   never migrate raw session tokens into Convex.
9. `audit_logs` and `login_attempts`, preserving IDs, action/outcome/time,
   correlation IDs, and configured retention. Redact PII from migration logs,
   not from records.
10. `university_reviews_agg`, resolving each legacy university ID; compare
    the source aggregates to recomputed reviews and halt on material mismatch.
11. Seed `idCounters` to one greater than each source maximum for generated
    numeric IDs. Validate safe integer range and reserve IDs atomically.

### Verification gate

- Compare per-table counts and sets of legacy IDs; check uniqueness of logical
  keys and all resolved relationships. Optional references must be listed and
  explained, not silently dropped.
- Compare representative records and deterministic, privacy-safe field hashes
  for each table. Check review aggregates, bookmarks, profiles, sessions,
  notifications, chat ordering, audit events, and login-attempt retention.
- Exercise create/read/update/delete and retry semantics against a non-production
  Convex deployment using synthetic data, including unauthorized and
  cross-user cases. Re-run the same import batch and prove counts/values do not
  change.
- Keep PostgreSQL writes authoritative through the complete verification.
  Before any later cutover, use a controlled write freeze/final catch-up so
  counts cannot drift during comparison. Do not switch traffic automatically.

### Rollback

- Before Convex accepts production writes, rollback means routing back to
  unchanged PostgreSQL and discarding only the isolated Convex test/migration
  deployment data under an explicitly approved procedure.
- After any Convex production writes, stop writes first and preserve both
  systems. Reconcile/export Convex changes by legacy ID (including new IDs)
  into PostgreSQL with validation and a tested backup before returning traffic.
  A blind route flip would lose writes and is not an acceptable rollback.
- Do not drop PostgreSQL, Drizzle schema/migrations, credentials, or backups
  until production verification, backup/restore checks, and the rollback window
  have been explicitly signed off.

## Phase 2 / 3B boundaries and blockers

- No PostgreSQL records have been read or migrated. Convex contains only
  Phase 3C synthetic development catalog data.
- Phase 3A now rejects public `role` fields, limits public account types to
  Student/Parent, derives counselor role from the authenticated stored role,
  and prevents guest chat from reading/writing per-account records.
- Convex auth configuration, JWT issuance, and direct Convex client access
  remain unimplemented. Option C is the current recommendation; reconsider
  option B before exposing authenticated Convex functions.
- Google linking now requires a verified Firebase email and exact normalized
  email match; it preserves the existing account role and password. Firebase
  UID persistence/uniqueness remains an account-model decision before Convex
  identity migration.
- Authentication bypasses now require `NODE_ENV=development` and
  `ENABLE_DEV_AUTH_BYPASS=true`. Do not set this flag on shared or exposed
  development/staging environments.
- The three public catalog queries are deployed and tested on the development
  deployment only. They have not been wired to frontend calls or production.
- Express route integration regressions are in `src/tests/authRoutes.test.ts`;
  public catalog handler tests are in `src/tests/convexUniversities.test.ts`.
- Before deploy/cutover, verify actual PostgreSQL schema and data, Firebase
  project configuration, production secrets, rate-limit behavior for direct
  Convex access, migration/rollback evidence, and a Convex backup/restore plan.

## Phase 3C development deployment status

- Test startup is isolated: Vitest sets `NODE_ENV=test`, replaces database URLs
  with a localhost-only test URL, clears `SUPABASE_DB_URL`, and
  `DatabaseService` does not schedule database initialization in test mode.
- Deployment `graceful-kangaroo-272` (`uninfo`, Sydney) was selected and
  verified. `convex/_generated/` exists, and the public list, search, and
  legacy-ID detail functions were deployed and exercised with synthetic data.
- Development currently contains only the three synthetic universities with
  legacy IDs `990001`, `990002`, `990003` and their reviews `990101` for
  `990001`, `990102` for `990001`, and `990103` for `990002`. No user data is
  present. No cleanup was run; see Phase 4A's scoped cleanup plan below.
- `npm audit` reports 6 vulnerabilities (4 high, 2 moderate, 0 critical).
  Affected installed dependency paths include `firebase@12.19.0` via
  `@firebase/firestore@4.17.2` and `@grpc/grpc-js@1.9.16`, plus
  `@tailwindcss/typography@0.5.20` via `postcss-selector-parser@6.0.10`.
  No dependency upgrades were applied. Audit offers a major-version Firebase
  downgrade and a major-version typography downgrade as fixes; evaluate
  compatibility before changing either dependency.

## Phase 4A migration preparation (not executed; historical status)

### Source audit and backup limitation

- At the time of this Phase 4A audit, `src/db/schema.ts` defined 12 tables;
  Phase 6D adds the thirteenth `analytics_events` declaration.
  Root `drizzle.config.ts` and `src/db/drizzle.config.ts` both load environment
  files and can select a PostgreSQL URL or SQL host credentials. No Drizzle
  command was run: migrations/generation may access or alter the configured DB.
- `drizzle/meta/_journal.json` references `0000_thick_husk` and
  `0001_session_lifetimes`, but the corresponding SQL migration files are
  absent from this checkout. The snapshot is metadata, not proof of the live
  database schema. A read-only live-schema fingerprint and source counts are
  still required before import.
- `scripts/backup.ts` calls `BackupService.createBackup()`. At the time of this
  Phase 4A note, the backup path exported all 12 then-supported source tables in one repeatable-read, read-only PostgreSQL
  transaction; a versioned envelope verifies the exact table set, per-table
  counts, migration preflight, and SHA-256 payload digest before encrypted
  storage. S3-compatible and local fallback exports are also encrypted.
  Export, restore, pre-restore-backup, and transactional restore failures
  propagate instead of producing empty or success-shaped backups. Restore
  rejects incomplete legacy formats and duplicate-key writes; it does not
  overwrite existing rows. These changes have synthetic tests only. No live
  database was connected, and no backup has been verified against the actual
  source schema or used as migration evidence.
- The `MigrationManager` in `src/server/migration.ts` migrates an in-memory
  legacy object and is not a PostgreSQL-to-Convex importer.

### Source-to-Convex mapping

`idCounters` is the thirteenth Convex table and is derived; it has no PostgreSQL
source table.

| PostgreSQL source | Convex destination | Mapping and relationship rules |
|---|---|---|
| `universities` | `universities` | `id` → `legacyId`; preserve source fields and derive `searchText`; convert `createdAt` to milliseconds. |
| `users` | `users` | `id` → `legacyId`; `password` → server-only `passwordHash` unchanged; preserve stored role and lock state; set a deterministic server-owned `authSubject` from the legacy ID. Hash only non-expired verification tokens with SHA-256; clear expired tokens. No Firebase UID column exists in this source schema, so do not invent or infer one. |
| `sessions` | `sessions` | Hash the opaque source `token` to `sessionTokenHash`; resolve `email` to a user document; convert timestamps/expiry numbers to milliseconds. Never log or export the raw token. Expired idle or absolute sessions are disposable and should be excluded with an explicit excluded count; active sessions require the auth-boundary/cutover decision below. |
| `reviews` | `reviews` | `id` → `legacyId`; resolve `universityId` and preserve it as `legacyUniversityId`; optionally resolve `userId` by normalized email while retaining `userEmail`; preserve text/rating/date. A missing university is an error; unmatched user email is a reported optional-reference warning, never dropped. |
| `bookmarks` | `bookmarks` | `id` → `legacyId`; resolve `userEmail` and `universityId` to document IDs; preserve `legacyUniversityId`. Enforce one bookmark per normalized `(user, university)` pair. Both relationships are mandatory. |
| `chat_history` | `chatHistory` | `id` → `legacyId`; retain nullable guest/email history; resolve `userId` only when the email matches a user. Preserve role/content/correlation/timestamp. |
| `audit_logs` | `auditLogs` | `id` → `legacyId`; preserve details, actor email, IP, status, correlation ID, and timestamp. Do not mix this analytics table with Pino security logs. |
| `login_attempts` | `loginAttempts` | `id` → `legacyId`; preserve IP/email/success/time. Apply only the existing approved retention period; the current cleanup helper accepts a caller-provided `retentionDays`. |
| `student_profiles` | `studentProfiles` | `id` → `legacyId`; resolve `userEmail` to `userId`; enforce one student profile per user and Student role. Preserve optional JSON and preference fields. |
| `parent_profiles` | `parentProfiles` | `id` → `legacyId`; resolve `userEmail` to `userId`; enforce one parent profile per user and Parent role. |
| `notifications` | `notifications` | `id` → `legacyId`; preserve owner email/content/read state/time; resolve optional `userId` when possible. Unmatched owners are surfaced for explicit review; never silently discard private notifications. |
| `university_reviews_agg` | `universityReviewsAgg` | Resolve `universityId`; preserve average/count and compare against aggregates recomputed from migrated reviews. Missing/mismatched universities or material aggregate differences block completion. |

All source keys must be safe integers and unique. Serial primary keys must be
positive; the custom PostgreSQL university `integer` key has no positive-value
constraint, so zero/negative values are reported as compatibility warnings
because the current public detail query accepts only positive IDs. Resolve
that contract against a read-only source count before import; do not rewrite
those IDs. Convex `_id` values are created by Convex; every source numeric ID
remains `legacyId`.
Timestamps are converted to Unix milliseconds. `idCounters` are derived as
`max(legacyId) + 1` for the applicable generated-ID tables after confirming
safe-integer range; they are not imported as source rows. Convex indexes are
not unique constraints, so the writer must atomically reject same-key/different
content conflicts and must not use blind upsert or conflict-ignore behavior.

### Preflight and restartable batch design

- `src/server/convexMigration.ts` contains a pure snapshot validator and a
  dependency-ordered batch-runner contract. `src/server/postgresMigrationSource.ts`
  adds an explicitly constructed PostgreSQL reader: it requires an injected
  client, begins a repeatable-read read-only transaction, permits only the 13
  declared source tables, uses bounded keyset pages, and hashes a complete
  deterministic snapshot fingerprint. Session-token cursors are encrypted
  before they can be checkpointed. The adapter has synthetic-client tests and
  never opens a connection itself. At the time of this Phase 4A note the writer
  and orchestrator were not implemented; they now exist in
  `src/server/convexMigrationDestination.ts`,
  `src/server/convexMigrationOrchestrator.ts`, and `convex/migration.ts`.
  They remain restricted to synthetic destinations and the current 13-table
  registry, so this history does not authorize a live migration.
- The historical Phase 4A preflight required arrays for all 12 then-supported
  source tables; the current registry and preflight require all 13 source tables,
  including `analytics_events`. The validator checks required fields,
  field types, safe legacy keys, duplicate IDs, normalized user-email
  collisions, bookmark pair uniqueness, profile roles/uniqueness, and required
  user/university references. Optional source references produce redacted
  warnings. Error records contain table, row index, field, and code only—never
  source values, emails, tokens, or contents. Warnings require explicit
  operator resolution/approval before import; `assertMigrationPreflightClear`
  blocks all errors and all warnings unless their codes are explicitly approved.
- Read ordered source pages under a stable snapshot, transform a complete
  dependency-ordered snapshot, and batch by legacy key. Order: universities,
  users, profiles, reviews, bookmarks, notifications, chat, sessions, audit
  logs, login attempts, aggregates, analytics events, then derived counters. This preserves
  parent-before-child references. The current pure runner expects its adapter
  to provide already transformed records and a stable source cursor.
- `--dry-run` equivalent classifies every row without writes/checkpoint changes.
  The destination classifies every key as identical, missing, or conflicting;
  an unclassified row or conflict is fatal. Only missing rows may be inserted.
  The checkpoint stores the source fingerprint, cursor, processed/count
  totals, and completion state. Compare streamed rows with the preflight source
  count and re-read/compare after each batch before persisting its cursor. Empty
  non-final pages are rejected rather than treated as skipped data. If a write
  partially succeeds or checkpoint persistence fails, retry from the prior
  cursor; identical rows are idempotent, conflicting rows halt without
  overwriting.
- Batches must be bounded and destination inserts must be atomic per batch or
  safely retryable by per-record keys. The current pure runner caps each batch
  at 100 records. Use a single migration worker; if
  concurrent writers are ever allowed, destination key check + insert must
  occur atomically. Record counts by table, inserts, identical existing rows,
  excluded expired rows, warnings, and failures. Logs contain counts and
  redacted row positions only. Verify every batch after write and compare full
  source/destination legacy-key sets/counts before sign-off.
- Required data is all rows not excluded by a documented retention rule.
  Expired sessions and expired verification tokens are disposable; expired
  login attempts and notifications may be excluded only according to the
  currently approved retention values, captured in the run report. Do not
  truncate audit logs, chat history, reviews, or profiles as a migration
  shortcut. No policy decision currently authorizes bulk data loss.
- Rollback before Convex becomes authoritative is route back to unchanged
  PostgreSQL; preserve the isolated Convex import for diagnosis and remove it
  only after explicit approval. After Convex accepts writes, stop writes and
  reconcile by legacy key before routing back. Retain a tested encrypted,
  complete PostgreSQL backup and a Convex export/restore check before cutover.

### Synthetic cleanup plan (not executed)

The Phase 3C-only university legacy IDs are `990001`, `990002`, `990003`.
Their review records are exactly:

| Review legacy ID | University legacy ID |
|---:|---:|
| `990101` | `990001` |
| `990102` | `990001` |
| `990103` | `990002` |

For cleanup, use a one-shot **internal-only** Convex mutation with hard-coded
allowlists for those three university IDs and three review ID → university ID
pairs. In a single mutation, resolve only those legacy keys, assert every
matched review still references the expected university, then delete only
those exact reviews and universities. Missing keys are idempotent; unexpected
IDs/relationships abort the whole mutation. Do not accept arbitrary table
names, document IDs, or client-provided ID arrays. Do not execute cleanup
without separate approval.

### Phase 4A validation and blockers

- Synthetic fixture tests cover missing relationships, duplicate IDs/email,
  dry runs, retries after partial writes, identical duplicates, conflicting
  IDs, checkpoint resume, and destination count verification.
- No PostgreSQL or Convex connection was opened for this phase; no records
  were imported or deleted, no database schema/traffic changed, and no
  production deployment was targeted.
- Blockers before a real migration: restore the five omitted tables in the
  backup/export safety path and test a restore; recover/verify the actual
  Drizzle SQL migration history and live schema without modifying it; resolve
  optional-reference warnings; finalize session revocation/cutover and
  Firebase UID reconciliation; implement and separately review the real
  read-only PostgreSQL source and development-only Convex destination adapter;
  define explicit Convex synthetic-data cleanup approval; and verify a full
  synthetic import/retry/rollback cycle before any real records are read.

## Phase 6A Drizzle metadata reconciliation (analysis only)

This comparison is between `src/db/schema.ts` and the checked-in Drizzle
snapshot only. It does not establish the schema of any PostgreSQL database.
Phase 5C initialized synthetic databases from the current TypeScript schema;
those tests are not evidence of the actual source schema.

| Table | Current columns | Snapshot columns | Current-only columns |
|---|---:|---:|---|
| `audit_logs` | 8 | 8 | — |
| `bookmarks` | 4 | 4 | — |
| `chat_history` | 6 | 6 | — |
| `login_attempts` | 5 | 5 | — |
| `notifications` | 7 | absent | whole table |
| `parent_profiles` | 10 | absent | whole table |
| `reviews` | 9 | 9 | — |
| `sessions` | 6 | 3 | `created_at`, `last_used_at`, `absolute_expires_at` |
| `student_profiles` | 12 | absent | whole table |
| `universities` | 33 | 32 | `directory_profile` |
| `university_reviews_agg` | 3 | absent | whole table |
| `users` | 11 | 8 | `email_verified`, `verification_token`, `verification_expires` |

The four absent tables are `notifications`, `parent_profiles`,
`student_profiles`, and `university_reviews_agg`. The supplied status
description called the current `sessions` table five columns; the checked-in
TypeScript definition actually has six. For columns present in both artifacts,
the SQL types, nullability, primary-key flags, and defaults agree. The
snapshot contains the same five explicit indexes and the same three foreign
keys on overlapping tables. The current schema additionally declares three
foreign keys on omitted tables (the profile email references to `users.email`
and the aggregate university reference), and unique profile email constraints.
The `directory_profile` column is another snapshot omission.

The TypeScript schema declares nine `serial` primary keys; the snapshot
contains six because the profile and notification tables are absent. Neither
artifact declares enums. The snapshot has no top-level sequence metadata;
serial columns imply PostgreSQL sequences. Foreign keys are declared inline;
there are no separate Drizzle `relations()` declarations. The snapshot records
database types, but not TypeScript driver modes: the current schema uses
numeric mode for `users.locked_until` and the two session expiry `bigint`
columns, and date mode for timestamp columns. These mode details must be
preserved by application mappings even though they are not separate snapshot
fields.

### Migration history and decision

`drizzle/meta/_journal.json` has entries for `0000_thick_husk` and
`0001_session_lifetimes`, but `drizzle/` contains only the journal and
`0000_snapshot.json`: both SQL files and a second snapshot are absent. No SQL
files or matching migration history were found in the available local Git
refs. The project workspace is untracked in its enclosing Git checkout, so
that checkout cannot establish when or why the artifacts went missing. The
configured remote could not be inspected (GitHub returned 404); recovery from
that location is therefore unverified. The root and `src/db` Drizzle configs
both point at `./drizzle` but use different checks for selecting host-based
credentials. `package.json` has no Drizzle generation or migration script.
No Drizzle command was run.

The observable root cause is repository inconsistency: the journal names
migrations whose SQL is unavailable, and the sole snapshot is incomplete
relative to the current code. Why this happened, what the missing migrations
did, and whether the current code matches the source database cannot be
determined from available evidence. Do not reconstruct or relabel the
historical chain.

**Recovery/baselining strategy**

1. First seek the original migration SQL and matching snapshots from a
   trusted commit, release artifact, or repository copy. Verify their
   provenance and journal ordering before restoring them.
2. Independently establish the authoritative source schema from an
   explicitly authorized read-only catalog inspection or a verified,
   provenance-checked schema backup. Compare tables, columns, defaults,
   constraints, indexes, sequences, and data before changing the mapping.
3. For a genuinely new, empty database, create a separately identified,
   reviewed baseline from that verified schema. Keep it distinct from this
   unresolved journal and document that it is a fresh-install baseline, not
   recovered history.
4. For an existing database, do not apply a fresh baseline or mark missing
   journal entries as applied. After read-only comparison, prepare only
   forward repair migrations for proven differences, then rehearse them on
   an isolated clone and verify backup/rollback before approval.

Until steps 1–2 resolve the source of truth, leave the journal and snapshot
unchanged and block live migration or schema mutation. No database was
connected to or modified during Phase 6A.

## Phase 6C source-to-Convex reconciliation

This section uses only the Phase 6B read-only Supabase inspection handoff and
the repository files listed below. No production connection, Convex deployment,
or migration write was used. The handoff confirms the 13 public table names
and selected facts, but does not include a complete column/type/default/key/
index catalog for all tables. Accordingly, the Drizzle column sets below are
the repository's mapping assumptions, not a claim that every listed source
column was independently verified. Do not use this matrix as an executable
source inventory until the full catalog is attached to the migration record.

| Source table | Source facts available from handoff | Drizzle candidate column set | Convex mapping and reconciliation |
|---|---|---|---|
| `analytics_events` | 6 columns; absent from the original 12-table plan. Column names, types, key, nullability, indexes and retention are not in the handoff. | Absent. | Absent from the source allowlist, `SourceTable`, preflight, transform, Convex schema and internal mutations. **Decision: include in the required migration scope, not exclude.** Block execution until its exact schema, stable key and privacy/retention rules are verified and a mapping is implemented/tested. |
| `audit_logs` | Table presence confirmed; remaining source metadata unavailable. | `id`, `action`, `details`, `user_email`, `ip`, `status`, `correlation_id`, `created_at`. | Preserves ID as `legacyId`, JSONB `details`, nullable fields and timestamp milliseconds. User email is retained as an optional attribution, not an FK. JSON is validated at destination. |
| `bookmarks` | Composite unique `(user_email, university_id)` confirmed; source FK actions are not identified by name in the handoff. | `id`, `user_email`, `university_id`, `created_at`. Drizzle declares cascading FKs to `users.email` and `universities.id`, plus the same pair as a unique index. | Preserves row ID and legacy university ID; resolves email/university to Convex IDs. Preflight checks pair uniqueness and the writer checks the logical pair. Convex indexes are not unique constraints; ordinary future writes need equivalent atomic enforcement. |
| `chat_history` | Table presence confirmed; remaining source metadata unavailable. | `id`, `user_email`, `role`, `content`, `correlation_id`, `created_at`. | Preserves legacy ID and nullable email/correlation ID; resolves an optional `userId`. No FK is declared by Drizzle; email linkage is best-effort. |
| `login_attempts` | Table presence confirmed; remaining source metadata unavailable. | `id`, `ip`, `email`, `success`, `attempt_time`. | Preserves legacy ID; nullable email remains nullable; timestamp becomes Unix milliseconds. Drizzle declares an IP index. |
| `notifications` | Table presence confirmed; remaining source metadata unavailable. | `id`, `user_email`, `title`, `message`, `type`, `read`, `created_at`. | Preserves legacy ID and email; adds optional resolved `userId`. Drizzle declares no FK. Convex `userId` is optional; orphan emails can remain. |
| `parent_profiles` | Table presence confirmed; full source catalog unavailable. | `id`, `user_email`, `budget`, `preferred_state_city`, `safety_preference`, `roi_preference`, `scholarship_preference`, `distance_preference`, `accommodation_preference`, `updated_at`. | Preserves legacy ID and nullable profile values; replaces email reference with `userId`, requiring a Parent role. Drizzle declares unique email and cascading FK; preflight/writer enforce relationship and uniqueness, but Convex itself does not. |
| `reviews` | Table presence confirmed; remaining source metadata unavailable. | `id`, `university_id`, `user_email`, `user_name`, `rating`, `comment`, `avatar`, `review_date`, `created_at`. | Preserves legacy review/university IDs; stores Convex university ID and optional resolved user ID. Nullable avatar is retained. Drizzle declares cascading university FK and indexes on university/email; optional user attribution can warn if unresolved. |
| `sessions` | Exactly 6 columns confirmed, including `created_at`, `last_used_at`, `expires_at BIGINT`, and `absolute_expires_at BIGINT`. The handoff does not name the other two columns. | Candidate set: `token`, `email`, `expires_at`, `created_at`, `last_used_at`, `absolute_expires_at`. Drizzle declares token primary key; the two expiry BIGINTs use numeric mode. | Existing mapping assumes source token/email fields: raw token is replaced with SHA-256 `sessionTokenHash`; email becomes `userId`; BIGINT expiry values remain epoch-number values, and timestamps become milliseconds. Safe-integer guards reject lossy BIGINT conversion. Verify source key/column names, BIGINT units, and naive timestamp timezone semantics before migration. |
| `student_profiles` | Table presence confirmed; full source catalog unavailable. | `id`, `user_email`, `stream`, `budget`, `preferred_location`, `preferred_course`, `entrance_exams`, `hostel_preference`, `placement_priority`, `academic_scores`, `career_goals`, `updated_at`. | Preserves legacy ID and nullable scalars/JSONB; replaces email reference with a Student `userId`. JSON is checked for Convex-safe JSON values at destination. Drizzle declares unique email and cascading FK; mapping preflight/writer enforce them. |
| `universities` | Exactly 33 columns confirmed, including `directory_profile JSONB`. | `id`, `name`, `location`, `state`, `type`, `fee`, `rating`, `students`, `courses`, `image`, `logo`, `categories`, `stream`, `degrees`, `majors`, `popular_courses`, `phone`, `competitive_exams`, `min_10th`, `min_12th`, `naac_grade`, `nirf_rank`, `aicte_approved`, `nba_accredited`, `nmc_recognized`, `avg_placement_lpa`, `website`, `virtual_tour_url`, `expert_insight`, `alumni_stories`, `campus_map`, `directory_profile`, `created_at`. | Preserves source ID as `legacyId`; keeps all declared catalog fields and JSONB. Convex requires six JSONB list fields to be arrays of strings; preflight now rejects malformed elements. Other JSONB values are validated at destination. Adds derived `searchText`; no PostgreSQL unique/index semantics transfer except explicit Convex indexes. |
| `university_reviews_agg` | Table presence confirmed; remaining source metadata unavailable. | `university_id`, `avg_rating`, `review_count`. | Preserves the university key as `legacyUniversityId`, resolves Convex university ID, and retains nullable average/defaulted count. Drizzle declares a cascading university FK. Convex mapping checks for existing duplicates by both logical keys. |
| `users` | Exactly 11 columns confirmed, including `email_verified`, `verification_token`, and `verification_expires`. | `id`, `email`, `password`, `role`, `name`, `login_failures`, `locked_until`, `created_at`, `email_verified`, `verification_token`, `verification_expires`. Drizzle declares email unique. | Preserves ID as `legacyId`; lowercases email; maps password hash to `passwordHash`; hashes only unexpired verification tokens and never carries the plaintext token. `locked_until` BIGINT must be a safe integer. `authSubject` is derived; Firebase UID is not sourced by this mapping. Convex email index is non-unique, so preflight and writes check collisions. Password hashes, verification hashes and private account fields must remain server-only. |

### Drizzle type, nullability, default, and constraint detail

The following is an exact reading of the checked-in `src/db/schema.ts`, not a
claim that the source catalog has these declarations. PostgreSQL source types,
defaults, keys, and actions outside the facts above remain unverified.

| Table | Drizzle type / nullability / default declarations | Drizzle keys and indexes |
|---|---|---|
| `analytics_events` | No Drizzle declaration; source is reported to have 6 columns, whose details are unavailable. | No mapping, key, or index declared. |
| `audit_logs` | `id serial`; `action varchar(100) NOT NULL`; `details jsonb NOT NULL DEFAULT {}`; `user_email varchar(255)`, `ip varchar(100)`, `status varchar(50)`, `correlation_id varchar(255)` nullable; `created_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; no FK/unique declaration. |
| `bookmarks` | `id serial`; `user_email varchar(255) NOT NULL`; `university_id integer NOT NULL`; `created_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; cascading FKs to `users.email` and `universities.id`; unique index `(user_email, university_id)` (matches the pair reported unique at source). |
| `chat_history` | `id serial`; `user_email varchar(255)` nullable; `role varchar(50) NOT NULL`; `content text NOT NULL`; `correlation_id varchar(255)` nullable; `created_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; index on `user_email`; no FK/unique declaration. |
| `login_attempts` | `id serial`; `ip varchar(100) NOT NULL`; `email varchar(255)` nullable; `success boolean NOT NULL`; `attempt_time timestamp NOT NULL DEFAULT now()`. | `id` primary key; index on `ip`; no FK/unique declaration. |
| `notifications` | `id serial`; `user_email varchar(255) NOT NULL`; `title varchar(255) NOT NULL`; `message text NOT NULL`; `type varchar(100) NOT NULL`; `read boolean NOT NULL DEFAULT false`; `created_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; no FK/unique/index declaration. |
| `parent_profiles` | `id serial`; `user_email varchar(255) NOT NULL`; `budget integer`, `preferred_state_city varchar(255)`, `safety_preference varchar(100)`, `roi_preference varchar(100)`, `scholarship_preference varchar(100)`, `distance_preference varchar(100)`, `accommodation_preference varchar(100)` nullable; `updated_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; unique `user_email`; cascading FK to `users.email`. |
| `reviews` | `id serial`; `university_id integer NOT NULL`; `user_email varchar(255) NOT NULL`; `user_name varchar(100) NOT NULL DEFAULT 'Student'`; `rating integer NOT NULL`; `comment text NOT NULL`; `avatar text` nullable; `review_date varchar(50) NOT NULL`; `created_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; cascading FK to `universities.id`; indexes on `university_id` and `user_email`. |
| `sessions` | `token varchar(255)` primary key; `email varchar(255) NOT NULL`; `expires_at bigint NOT NULL`; `created_at` and `last_used_at` timestamp NOT NULL DEFAULT now(); `absolute_expires_at bigint NOT NULL`. | Token primary key; no FK/unique secondary index declaration. Source confirms 6 columns and both BIGINT expiry fields but does not identify the other two source columns in the handoff. |
| `student_profiles` | `id serial`; `user_email varchar(255) NOT NULL`; `stream varchar(100)`, `budget integer`, `preferred_location varchar(255)`, `preferred_course varchar(255)`, `entrance_exams jsonb`, `placement_priority varchar(100)`, `academic_scores jsonb`, `career_goals text` nullable; `hostel_preference boolean NOT NULL DEFAULT false`; `updated_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; unique `user_email`; cascading FK to `users.email`. |
| `universities` | `id integer` (not generated here); `name`, `location`, `state`, `type`, `students`, `image`, `phone`, `naac_grade` text NOT NULL; `fee`, `courses`, `min_10th`, `min_12th`, `nirf_rank` integer NOT NULL; `rating`, `avg_placement_lpa` double precision NOT NULL; `aicte_approved`, `nba_accredited`, `nmc_recognized` boolean NOT NULL; `categories`, `stream`, `degrees`, `majors`, `popular_courses`, `competitive_exams` jsonb NOT NULL; `logo`, `website`, `virtual_tour_url`, `expert_insight`, `alumni_stories`, `campus_map`, `directory_profile` nullable (the first four text, remaining three jsonb); `created_at timestamp NOT NULL DEFAULT now()`. | `id` primary key; no FK/unique/index declaration in Drizzle. |
| `university_reviews_agg` | `university_id integer` primary key; `avg_rating double precision` nullable; `review_count integer NOT NULL DEFAULT 0`. | Cascading FK from `university_id` to `universities.id`; no other unique/index declaration. |
| `users` | `id serial`; `email varchar(255) NOT NULL`; `password text NOT NULL`; `role varchar(50) NOT NULL DEFAULT 'Student'`; `name varchar(100)` nullable; `login_failures integer NOT NULL DEFAULT 0`; `locked_until bigint NOT NULL DEFAULT 0`; `created_at timestamp NOT NULL DEFAULT now()`; `email_verified boolean NOT NULL DEFAULT false`; `verification_token text` and `verification_expires timestamp` nullable. | `id` primary key; unique `email`; no FK declaration. |

### Cross-table types, constraints, and data-loss checks

- The current Drizzle candidate uses PostgreSQL `serial`/integer/numeric,
  boolean, varchar/text, `timestamp without time zone`, BIGINT, and JSONB.
  Convex stores numeric values as JavaScript numbers, timestamps as Unix
  milliseconds, JSON as Convex JSON-compatible values, and source primary keys
  as `legacyId`/`legacyUniversityId`; Convex `_id` values are regenerated.
  Session token is intentionally SHA-256 hashed. Existing integer IDs are not
  rewritten, and generated-ID counters are derived rather than imported.
- Row defaults are already materialized in source rows and are copied as values;
  PostgreSQL future-write defaults/sequences do not become Convex defaults.
  Source sequences/identity properties and their current values were not
  included in the handoff. Confirm them before cutover and initialize each
  derived Convex counter above the maximum imported legacy ID.
- The user handoff confirms uniqueness for `users.email`, both profile
  `user_email` columns, and the bookmark pair. Drizzle currently declares the
  same uniqueness. Convex indexes only accelerate lookups; they do not enforce
  uniqueness. Migration preflight and internal mutations detect collisions,
  but every post-migration application mutation must retain atomic uniqueness
  checks. Email lowercasing is a normalization not guaranteed by PostgreSQL's
  ordinary unique constraint; preflight blocks case-fold collisions rather
  than discarding either account.
- The handoff confirms some cascading foreign keys but does not identify their
  complete columns/actions. Drizzle declares cascades for reviews→universities,
  bookmarks→users/universities, profiles→users, and aggregates→universities.
  Convex stores corresponding document references for these mappings but has
  no automatic FK or cascade behavior; application deletes must enforce
  ownership/referential integrity explicitly. Treat exact source FK inventory
  and all non-Drizzle FK relationships as unresolved until the catalog is
  available.
- Drizzle declares lookup indexes on reviews, bookmarks, chat history, and
  login attempts. The source handoff supplies no complete index list, so these
  cannot be certified as matching PostgreSQL. Convex has purpose-specific
  indexes/search indexes, none of which creates source-equivalent unique or
  cascade semantics.
- Nullable Drizzle values are represented by optional nullable Convex fields
  where needed; undefined is omitted and SQL NULL remains `null`. Required
  fields are checked by preflight and mutation validators. JSONB arrays used
  as string lists are checked element-by-element; arbitrary JSONB still must
  pass Convex JSON validation (including nesting/cycle/prototype-key guards).
- No source enums, views, functions, sequences, identity metadata, exact
  per-column SQL types/defaults/nullability for the other ten tables, complete
  FK actions, or complete index/RLS policy definitions were supplied in the
  handoff. Do not infer these from TypeScript or snapshot metadata.

### Analytics decision as of Phase 6C (superseded by Phase 6D below)

`analytics_events` is a real source table, not a synthetic or irrelevant
artifact. This project currently exposes a no-op `logAnalyticsEvent` fallback;
that does not establish that source analytics rows are disposable. Preserve
the table in migration scope. It is **not covered by the current 12-table
reader/validator/transformer/Convex schema/writer or tests**, so no full
migration can be approved yet. Before implementing its mapping, obtain its
six exact column definitions, primary/stable key and ordering, types/nullability,
retention/privacy classification, and foreign keys/indexes from the verified
read-only catalog. Add it as a separately reviewed 13th table and test counts,
key preservation, and lossless field mapping; until then block migration rather
than silently dropping it or inventing its schema.

The current source reader uses `SELECT *` and a 12-table allowlist, so its
fingerprint and count verification do not cover this table or later-added
columns. The source catalog mismatch therefore also blocks a claim that the
current fingerprint covers the complete application dataset. The checked-in
Drizzle snapshot remains independently inconsistent with `schema.ts` as
documented above; neither should be treated as authority over the source.

### Snapshot-specific comparison

The checked-in `drizzle/meta/0000_snapshot.json` is a separate, incomplete
artifact. Compared with the source facts and current Drizzle declarations:

| Source fact | `schema.ts` | `0000_snapshot.json` | Convex / migration consequence |
|---|---|---|---|
| `users` has 11 columns, including the three verification fields | 11 columns, all three present | 8 columns; omits `email_verified`, `verification_token`, `verification_expires` | Convex maps email verification and hashes active verification tokens; snapshot cannot produce those values/defaults for a fresh migration. |
| `sessions` has 6 columns, including both timestamps and BIGINT expiry fields | 6 columns | 3 columns; omits `created_at`, `last_used_at`, `absolute_expires_at` | Convex requires all six candidate values; initializing from snapshot alone loses lifecycle state. |
| `universities` has 33 columns, including `directory_profile JSONB` | 33 columns, includes `directory_profile` | 32 columns; omits `directory_profile` | Convex accepts the JSONB field; snapshot-based schema generation would omit it. |
| The source includes `notifications`, `parent_profiles`, `student_profiles`, and `university_reviews_agg` | All four are declared | All four tables are absent | Convex and the migration registry include them; snapshot-based reconstruction would omit complete source relations. |
| The source includes `analytics_events` | Absent | Absent | Also absent from Convex and the current 12-table reader/mapping; see the explicit inclusion/block decision above. |

For the remaining source tables, the handoff has no full column/type/key
catalog, so snapshot agreement with Drizzle is not evidence of agreement with
the actual source. Phase 6A's snapshot comparison also found only part of the
current FK/index metadata represented in the snapshot. Do not regenerate,
replace, or apply this snapshot as part of this phase.

### Convex destination collision and authorization review

- Per-table writers and checkpoint/list functions are `internalMutation` /
  `internalQuery` functions, and the HTTP adapter sends the Convex admin key.
  Keep this transport and key strictly server-side; never invoke it from routes,
  browser code, or client-controlled migration arguments. The import carries
  private password hashes and account/session data.
- The adapter rejects non-HTTPS and non-Convex hosts, mismatched deployment
  names, `prod`, the known application development deployment, missing admin
  key, and a missing isolated-synthetic confirmation. The integration script
  also checks its named test deployment and environment profile before use.
  This is a useful fail-closed synthetic guard, not production authorization:
  the confirmation is caller-supplied and deployment-name denylisting cannot
  prove an arbitrary deployment is isolated. Never relax it for production;
  require a separately approved allowlisted migration deployment and scoped
  operator credentials before any future write phase.
- Classification checks legacy and logical keys, refuses conflicting rows,
  and inserts only missing records through an atomic Convex mutation; duplicate
  records in a batch or duplicate destination matches are conflicts. This
  protects against ordinary key collisions but does not make Convex indexes
  unique. Do not run concurrent importers or ordinary application writers
  against the destination during import; require a clean/verified baseline and
  full key-set reconciliation.

### Supabase RLS/grants security finding

The Phase 6B read-only inspection handoff reports RLS enabled on all 13 public
application tables, only one table with an RLS policy, and extensive table
privileges on source roles. This is a security finding for the source database:
RLS being enabled does not prove that a role is least-privileged or that policies
cover every access path, and broad grants can expose data to roles that bypass
or are not constrained by the intended policies. The handoff does not identify
the policy table, role names, exact grants, or `BYPASSRLS`/owner status, so no
stronger claim is made here. Have the database owner review effective grants,
role inheritance, service-role use and policy coverage through an authorized
security review. Do not change production grants, policies, or RLS in this
migration phase.

### Phase 6C disposition

The then-existing 12 mappings were repository implementations, not production-
validated mappings. The source-to-Convex comparison is partial because the
handoff omits a full source catalog; `analytics_events` is an explicit coverage
gap; and the historical Drizzle journal/snapshot issue remains unresolved.
No source rows were exported, no Convex writes were made, and no production
cutover is authorized. Next safe step: attach a provenance-verified, schema-only
catalog report for all 13 tables (including constraints, indexes, sequences,
views/functions, RLS policies and role grants), then finish this matrix against
that evidence and test all 13 mappings against synthetic fixtures before
requesting separate approval for a migration rehearsal.

## Phase 6D 13-table migration coverage

This follow-up adds the supplied `analytics_events` source definition to the
application schema and migration pipeline. It does not connect to Supabase,
query/export rows, call a Convex deployment, perform migration writes, or deploy
the changed Convex schema.

| Component | 13-table coverage |
|---|---|
| Drizzle source candidate | Declares `analyticsEvents` with `id integer PRIMARY KEY` and no generated default; required `eventType varchar` and `createdAt timestamp DEFAULT now()`; nullable `details jsonb`, `userEmail varchar`, and `ipAddress varchar`. The separate Drizzle snapshot remains stale and does not include this new table. |
| PostgreSQL backup/restore | `dbService` exports and restores `analyticsEvents`; the envelope requires exactly the 13 current tables and uses schema version 2 so 12-table version-1 backups are not misidentified as compatible. Synthetic tests check nullable values and that user email/IP remain encrypted in stored backup files. |
| PostgreSQL source reader | `analyticsEvents` is allowlisted as `analytics_events`, keyset-paged and counted/fingerprinted by `id`. A fixed projection includes all six source fields and casts `created_at` to text so a no-time-zone value is not first interpreted using the reader process timezone. |
| Transform and preflight | Preserves INTEGER `id` exactly as `legacyId` and its decimal-string key; accepts the full signed PostgreSQL INTEGER range, rejects fractions/out-of-range values, and rejects duplicate IDs. Preserves event type, JSONB, email and IP without normalization or omission. Requires all six source columns (including nullable fields), validates non-null JSON as finite/cycle-free Convex JSON, and rejects wrong field types and invalid timestamps. |
| Convex schema and destination | `analyticsEvents` stores `legacyId`, `eventType`, nullable JSON `details`, nullable `userEmail`/`ipAddress`, and numeric `createdAt`, indexed by legacy ID, event type/time, and time. Its writer is an internal mutation only, validates JSON, looks up collisions by legacy ID, and is covered by the checkpoint/list-key registries. There is no public query or write endpoint for these potentially sensitive event records. |
| Orchestrator and tests | The shared 13-table registry drives preflight, source counts/reads, fingerprint, batching, checkpointing, key-set verification, the synthetic integration fixture and local PostgreSQL rehearsal/backup fixtures. Tests assert exact source/Convex table registry equality, event mapping, null preservation, malformed-value rejection, duplicate-ID blocking and destination classification validation. |

PostgreSQL `TIMESTAMP WITHOUT TIME ZONE` is carried as wall-clock text from the
reader and interpreted as UTC when converted to Convex epoch milliseconds.
This avoids process-timezone-dependent shifts, but the UTC interpretation is a
migration convention, not timezone metadata present in the source. Convex
numeric milliseconds also cannot retain PostgreSQL sub-millisecond fractional
precision. Confirm the source application's intended timezone and whether
sub-millisecond precision matters before production sign-off.

`userEmail` and `ipAddress` are potentially sensitive and are intentionally
preserved rather than anonymized or dropped. Keep rows access-restricted to
server-side internal migration/security-reviewed functions, keep the admin key
out of clients, and do not add public event queries without an approved
authorization and privacy design. The supplied source facts state no event
retention period. Therefore this migration adds no event-row filter/deletion
rule: retain all rows unless a data owner separately approves a documented
retention policy. The backup-file retention period is not an analytics-row
retention policy. Migration logs and test summaries report only table names,
counts, and validation codes—not event payloads or PII.

The six-column source facts now have a matching code-level mapping in all
required components. This does not validate the mapping against live rows,
establish catalog provenance independently, resolve the stale Drizzle
snapshot/journal, verify production grants/RLS, or authorize any real-data
migration. The Phase 6C Supabase RLS/grants finding remains: all 13 tables
reportedly have RLS enabled, only one has a policy, and source roles reportedly
have extensive table privileges. No grants or policies were changed.

## Phase 6E constraint parity and readiness

This section records source facts supplied from the read-only source inspection
separately from repository declarations and Convex behavior. Source facts below
are not inferred from Drizzle or Convex.

### Confirmed source constraints and current enforcement

| Confirmed PostgreSQL constraint | Migration preflight | Convex migration collision check | Current application enforcement / Convex gap |
|---|---|---|---|
| `users.email` unique | Normalizes email and rejects duplicate normalized emails (`duplicate_logical_key`). This is deliberately stricter than PostgreSQL's default case-sensitive text uniqueness. | Queries `users.by_email` in addition to `by_legacy_id`; duplicate matches or same-email/different-user collisions are conflicts. The batch rejects repeated email logical keys. | Current app writes still use PostgreSQL, where the source unique constraint is authoritative. Convex defines non-unique `by_email`; no ordinary Convex user-write mutation exists, so future user creation/update must atomically check email uniqueness. |
| `bookmarks(user_email, university_id)` unique | Requires both references and rejects duplicate normalized-email/university pairs. | Resolves both parents, queries the `by_user_university` compound index and legacy-ID index, and rejects any matching conflicting document or duplicate pair in a batch. | PostgreSQL currently enforces the pair. Convex `by_user_university` is non-unique and no ordinary bookmark-write mutation exists; a future write mutation must perform the pair check atomically. |
| `student_profiles.user_email` unique | Requires a user reference, detects duplicate normalized email within this table, and also checks Student role (an application invariant, not an added source constraint). | Resolves the user, queries `studentProfiles.by_user` plus `by_legacy_id`, and rejects duplicate logical users. | PostgreSQL currently enforces uniqueness and FK. Convex `by_user` is non-unique; no ordinary profile-write mutation exists. |
| `parent_profiles.user_email` unique | Requires a user reference, detects duplicate normalized email within this table, and checks Parent role (an application invariant). | Resolves the user, queries `parentProfiles.by_user` plus `by_legacy_id`, and rejects duplicate logical users. | PostgreSQL currently enforces uniqueness and FK. Convex `by_user` is non-unique; no ordinary profile-write mutation exists. |
| `bookmarks.university_id -> universities.id ON DELETE CASCADE` | Blocks missing university references before any destination processing. | Resolves the university and checks both bookmark legacy ID and logical user/university pair. | PostgreSQL currently enforces the FK. Convex stores a document ID and legacy ID but has no FK; no ordinary bookmark or university delete mutation exists. |
| `bookmarks.user_email -> users.email ON DELETE CASCADE` | Blocks missing user references before migration. | Resolves user by `by_email`; missing users fail, and existing by-user documents collide. | PostgreSQL currently enforces the FK. Convex has a non-unique `bookmarks.by_user` index but no user-delete handler. |
| `parent_profiles.user_email -> users.email ON DELETE CASCADE` | Blocks missing user references and rejects role mismatch. | Resolves user by email; the existing profile is looked up through `by_user`. | PostgreSQL currently enforces the FK. Convex has no user-delete handler. |
| `student_profiles.user_email -> users.email ON DELETE CASCADE` | Blocks missing user references and rejects role mismatch. | Resolves user by email; the existing profile is looked up through `by_user`. | PostgreSQL currently enforces the FK. Convex has no user-delete handler. |
| `reviews.university_id -> universities.id ON DELETE CASCADE` | Blocks missing university references; optional review user attribution is only a warning because the source has no reported FK for it. | Resolves university; compares both `legacyId` and `legacyUniversityId` for collision; relationship verification checks matching university and any optional user document. | PostgreSQL currently enforces the university FK. Convex has no review/university delete mutation. |
| `university_reviews_agg.university_id -> universities.id ON DELETE CASCADE` | Blocks missing university references. | Resolves university and checks both legacy-university and Convex university indexes. | PostgreSQL currently enforces the FK. Convex has a by-university lookup index, but no aggregate/university delete mutation. |

The migration also rejects duplicate primary keys (including duplicate legacy
IDs) for every integer-keyed table, requires a non-empty `sessions.token`,
uses its SHA-256 digest as the destination key, and uses `universityId` as the
aggregate source key. Duplicate destination rows for those keys are conflicts,
not overwrites. Tests cover duplicate primary IDs, duplicate normalized user
emails, all four reported unique-key rules, missing references for each
reported FK, analytics required/present fields, parent-before-child table
order, hashed session-token keys, and aggregate university keys.

PostgreSQL application writes remain governed by the confirmed source
constraints. The Convex repository currently has no non-migration application
mutations: `convex/migration.ts` exposes internal migration mutations only;
the ordinary backend still writes PostgreSQL. Its Convex indexes are lookup
indexes, not unique constraints. Therefore the four unique rules are not yet
enforced for future ordinary Convex writes, even though migration preflight and
destination collision checks cover them. Before application cutover, every
create/update mutation touching these keys must enforce uniqueness in its
transaction. Current `deleteUniversity` is an Express/PostgreSQL path and
relies on PostgreSQL cascades; no corresponding Convex deletion mutation was
found.

### Delete behavior required before any Convex delete path

The source reports exactly six `ON DELETE CASCADE` edges:

1. Deleting a university deletes its `bookmarks`.
2. Deleting a user deletes their `bookmarks`.
3. Deleting a user deletes their `parent_profiles`.
4. Deleting a user deletes their `student_profiles`.
5. Deleting a university deletes its `reviews`.
6. Deleting a university deletes its `university_reviews_agg` row.

An eventual university-delete mutation must find/delete bookmarks through
`by_legacy_university` or `by_user_university`, reviews through
`by_legacy_university`, and the aggregate through `by_university`, then delete
the university in the same Convex mutation. A user-delete mutation must delete
bookmarks through `by_user` and both profile documents through their respective
`by_user` indexes before deleting the user. Convex mutations are transactional,
but fan-out limits, pagination, retry/recovery, and user-visible behavior need
design before implementation; large child sets may require a staged tombstone
and resumable cleanup rather than one oversized mutation. No delete workflow is
added here. No cascade is inferred for sessions, notifications, reviews by
user-email, or other relationships not among the six reported source FKs.

### Remaining source metadata and policy questions

The source facts in this phase establish the listed keys, unique constraints,
and six FK actions only. Exact source types, nullability/defaults for fields
outside the separately supplied analytics table, complete source index list,
other constraint checks, RLS policy identity/effect, grants/role membership,
sequence/identity details, and views/functions remain unverified in this
repository evidence. Drizzle declarations are still candidate mappings, not
substitutes for those source facts; historical migration SQL remains
unrecovered, and the checked-in Drizzle snapshot remains inconsistent.

`analytics_events.created_at` is `TIMESTAMP WITHOUT TIME ZONE`; treating its
wall-clock text as UTC during epoch-millisecond conversion is only a code
convention. The source owner must confirm intended timezone and acceptable
precision loss below one millisecond. Event `user_email` and `ip_address`
remain potentially sensitive; retention is unknown, no public event query is
added, and an authorized owner must settle retention and access policy before
production use. The reported RLS/grants concern also remains unresolved.

No source rows were read or exported for this phase, no Convex migration writes
or deployment occurred, and no production cutover is authorized. Code-level
constraint tests do not establish live data cleanliness or deployment parity.

## Phase 6F Convex application write/delete safety

### Observed PostgreSQL application behavior

The existing application writes through `src/db/dbService.ts`, called by
Express routes in `server.ts`; `convex/universities.ts` currently contains
public catalog queries only. `convex/migration.ts` contains internal
migration-only mutations, not application writes.

- Registration is public but rate-limited, validates input, maps only
  Student/Parent account types to roles, checks for an existing email, and
  relies on the PostgreSQL unique constraint as the final concurrency guard.
  Google login similarly creates a Student account after Firebase Admin
  verification. Password/session and email-verification changes remain in
  Express/DB service code.
- Lockout, email verification, and role changes update users through
  PostgreSQL. The role-update route requires Admin authorization.
- Student/parent profile reads and saves require a verified email and the
  route's role allowlist. The owner email comes from the session, not the
  request body. PostgreSQL upserts by unique `user_email`; FK and unique
  constraints remain the final referential/concurrency guards.
- Bookmark toggle requires a verified session, derives its email from the
  session, and inserts/deletes the exact email/university pair. PostgreSQL
  enforces the confirmed pair uniqueness and both FKs.
- Review creation requires a verified session, targets the route university,
  inserts a review and separately upserts the aggregate. These operations are
  not wrapped in one transaction; failures can leave the review and aggregate
  out of sync. Review deletion is Admin-only and deletes only the review; it
  does not recompute `university_reviews_agg`.
- Profile updates create notifications; notification reads and read-state
  changes are owner-scoped. Session creation, expiry extension and revocation
  remain server-side Express operations.
- University create/update and delete are Admin-only. `deleteUniversity`
  relies on PostgreSQL to cascade to the three confirmed university children:
  bookmarks, reviews and the university aggregate. No user-delete route or
  user-delete service operation was found.

These observations do not establish that every existing PostgreSQL service
method independently enforces route authorization; the Express boundary is
where the established access checks currently live.

### Phase 6F decision: no new Convex application mutations

No application write or delete mutation was added. This is the safe result,
not a migration-readiness claim: the repository has not selected/configured a
Convex authentication bridge. The architecture records three possible auth
approaches, with Express as the current boundary; Convex catalog queries are
public, while there is no verified Convex identity-to-UniInfo-user/role
resolution suitable for mutations. An admin key is server-only and belongs to
the isolated migration transport; using it as an application write boundary
would bypass per-request user authorization. Implementing mutations now would
require inventing identity, ownership, role, and session-revocation semantics.

Therefore current Convex application write coverage is **none**. Existing
internal migration mutations enforce migration collision/reference checks but
are not a substitute for user-facing authorization. In particular, future
mutations will need atomic checks for user email, bookmark pair, profile user,
and all six confirmed parent relationships. Convex indexes are non-unique and
are not foreign keys. Uniqueness lookups and writes must be in the same
mutation; this phase's tests do not exercise concurrent Convex mutation
execution, so no race/concurrency guarantee is claimed.

### Delete boundary

No Convex delete mutation was added. Existing university deletion is
Admin-authorized in Express and delegates to PostgreSQL; user deletion is not
supported by the observed application. Before implementing a Convex
university-delete mutation, preserve only the verified cascades to bookmarks,
reviews and `universityReviewsAgg`; before any user-delete feature, require an
explicit product/security decision and preserve only the verified cascades to
bookmarks, student profiles and parent profiles. Do not cascade sessions,
notifications, or other records without new verified source facts and approved
behavior.

All-or-nothing deletion of high-fan-out children may exceed Convex mutation
limits. A staged tombstone and resumable child cleanup would change observable
semantics and requires approved read behavior, retries, and recovery before
implementation. Review deletion currently leaves the aggregate stale, so any
Convex moderation mutation also needs a product-approved aggregate policy;
this phase does not silently alter that behavior.

### Tests and remaining blockers

The added HTTP tests use synthetic accounts/sessions to check duplicate
registration rejection, Admin-only university/review deletion, and that
authorized requests still delegate to the existing PostgreSQL service path.
Existing route tests cover role-gated profile saves, owner-derived bookmark
operations, registration role restrictions and session authentication.
Existing migration preflight tests cover duplicate email/bookmark/profile
keys, missing confirmed references, primary-key duplicates and safe session
token handling. They do not test Convex application writes, real PostgreSQL
concurrency, physical cascades, or deletion recovery.

Before adding any Convex application writes, owners must approve the auth
bridge and role/ownership contract, application-level uniqueness strategy,
review/aggregate transaction semantics, deletion fan-out/recovery, and
production index/cascade parity. The unresolved Drizzle migration history,
snapshot mismatch, incomplete source catalog, reported RLS/grants concern,
analytics event access/retention and naive-timestamp timezone decision remain
independent production blockers. No production source, Convex deployment, or
real-user data was modified in Phase 6F.

## Phase 6G authentication bridge investigation

### Existing authentication and trust boundaries

- Password registration/login, password hashing, email verification,
  lockout, and UniInfo session issuance are implemented by Express and the
  PostgreSQL-backed `dbService`. Password accounts are not Firebase
  identities. Registration only allows Student/Parent account types; role
  authorization uses the stored `users.role`.
- Google sign-in obtains a Firebase client ID token and sends it to
  `/api/auth/google` over HTTPS. Express verifies it with Firebase Admin
  `verifyIdToken`, requires `email_verified`, then finds/creates the local
  account by normalized email and creates an independent UniInfo session.
  Existing account role/password are preserved. Firebase UID is not stored,
  so email is the current account-linking key. Admin SDK initialization uses
  `FIREBASE_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` and application credentials;
  no service-account private key is checked into the auth implementation.
- Express creates an opaque random session cookie marked `HttpOnly`, `Path=/`,
  and `SameSite=Lax` on HTTP or `SameSite=None; Secure` on HTTPS. The database
  session has an eight-hour sliding expiry and a 24-hour absolute expiry.
  Authenticated routes look up that session and reload the current role and
  verified-email status from PostgreSQL. Logout deletes the session row and
  clears the cookie. Thus server-side logout/revocation applies immediately to
  subsequent Express requests. The cookie's browser max-age is 24 hours; the
  database remains authoritative for its shorter idle timeout.
- The frontend's React login state is initialized from `/api/auth/session`;
  it does not treat its local `userRole` state as authorization proof. Browser
  API requests carry the cookie. There is no `ConvexReactClient`,
  `ConvexProvider`, `ConvexProviderWithAuth`, Convex URL setting, or
  `convex/auth.config.ts` in the application. Firebase `onAuthStateChanged`
  is not the app's session source.
- Current Convex public university functions are unauthenticated catalog
  reads. Migration functions are internal and are not public client-callable
  functions. Migration integration scripts use a deployment key only for the
  isolated migration path; that key must never enter browser code.

Two existing auth caveats must be resolved before relying on the current
system as a new trust boundary: Firebase Admin `verifyIdToken` is called
without `checkRevoked=true`, so it validates the ID token but does not request
Firebase revocation status; after exchange, Firebase revocation does not
automatically revoke the separate UniInfo session. Also, the current password
reset UI calls Firebase `sendPasswordResetEmail`, while password registration
and login use the Express/PostgreSQL account store. Password-only account reset
parity is therefore not established. The observed user model has lockout
fields but no confirmed general disabled-account flag; lockout is not a
specified revocation mechanism for already-issued sessions.

### Options and decision

1. **Firebase ID token directly to Convex:** Convex custom OIDC/JWT
   authentication can validate a correctly configured JWT. Firebase's
   documented ID-token claims include `iss`,
   `https://securetoken.google.com/<projectId>`, `aud` equal to the Firebase
   project ID, `sub` UID, `exp`, and RS256 signing. This is technically
   plausible with a matching Convex issuer, exact audience, and supported
   signing-key/JWKS endpoint, but no project token or project configuration
   was inspected in this phase. It authenticates only Firebase identities;
   it does not authenticate password-only UniInfo sessions. Firebase UID is
   not currently persisted, and verified email alone is not an acceptable
   durable identity key. Convex token validation also does not call Firebase
   Admin to detect refresh-token revocation.
2. **Exchange an app session for a short-lived UniInfo JWT (preferred
   eventual browser bridge, not implemented):** an HTTPS Express endpoint
   would validate the existing HttpOnly session against PostgreSQL, reload
   the account, and sign a narrow-lifetime JWT accepted by a Convex custom
   JWT provider. This preserves both password and Google entry paths and
   leaves session cookies inaccessible to JavaScript. The Convex client
   necessarily receives the derived bearer JWT in page memory; XSS could
   steal it until expiration. Convex functions must independently resolve
   the verified subject to the current Convex user and authoritative role.
   This requires a trusted issuer, audience, JWKS, signing-key management,
   token refresh endpoint, session binding/revocation policy, and an approved
   isolated Convex environment.
3. **Keep Express as the auth boundary (selected for now):** do not connect
   authenticated browser operations to Convex. Express continues enforcing
   UniInfo sessions, roles, ownership, and current database checks. If a
   future server-to-Convex bridge uses a deployment/service key, it remains
   server-only and every Express route must authorize the caller; Convex
   would see a service identity, not the end user, so it is not a substitute
   for the user JWT bridge or per-function end-user authorization.
4. **Replace auth with Convex Auth or another provider:** not selected.
   Convex Auth is documented as beta and would be a change of credential and
   session ownership, not a drop-in for existing PBKDF2 accounts, Firebase
   Google sign-in, verification, lockout, and revocation behavior. It requires
   an explicit account/password migration and product approval.

The decision for Phase 6G is to retain option 3 and defer authenticated
Convex access. Option 2 is the leading candidate only if direct browser
subscriptions and mutations are an approved requirement. It is not yet
selected for production: the exact revocation contract, issuer hosting,
identity mapping, account-disable policy, and operational key ownership need
owner/security approval. Option 1 is not a complete bridge for the current
account population.

### Required security contract for a future JWT bridge

1. The browser calls a same-origin HTTPS token endpoint with its HttpOnly
   session cookie and the application's CSRF protections. Express validates
   the session row and its idle/absolute expiration, loads the user by that
   session's account, and rejects missing, expired, revoked, unverified (where
   required), or unmapped accounts. It never accepts an email, user ID, role,
   or session identity from request JSON as authentication evidence.
2. The issuer signs a short-lived JWT with `iss`, exact Convex `aud`, stable
   server-derived `sub`, `iat`, `exp`, and a key ID. Use the immutable
   PostgreSQL user ID as the source for the subject (the existing migration
   mapping derives an `authSubject` from that legacy ID), then map it to
   exactly one Convex user document; do not map identities by email alone.
   Do not include an authoritative role claim. Do not expose the signing key
   or deployment credential via `VITE_*`, logs, source control, or test
   reports; only return the short-lived JWT to the authenticated browser.
3. Convex verifies signature, algorithm, issuer, audience, and expiry from
   its configured provider. A protected function calls
   `ctx.auth.getUserIdentity()`, rejects null identity, and resolves the
   subject to exactly one pre-provisioned UniInfo user document. It loads the
   current stored role/status for every sensitive operation; owner identity
   comes from that document, never a function argument. A client-supplied role
   or email is ordinary untrusted input. Admin checks use the stored role.
   Role changes must update the authoritative user record, not just future
   JWT claims. Unknown/deleted/disabled accounts fail closed.
4. Revoking the PostgreSQL session stops further JWT issuance, but an already
   issued JWT remains cryptographically valid until `exp`. Choose and approve
   that maximum stale-auth window. If logout, role demotion, or account
   disabling must take effect sooner, include a server-owned session/version
   binding and validate revocation state in each protected operation, or
   invalidate it through a tested authoritative mechanism. A short `exp`
   alone is bounded delay, not immediate revocation.
5. Preserve Convex internal visibility: migration operations stay
   `internalQuery`/`internalMutation`; no browser identity can invoke them.
   Any service-key path stays in trusted server code and is not bundled into
   frontend configuration.

### Minimum configuration, local proof-of-concept decision, and test plan

No auth-related environment variables were configured in the inspected shell,
and local environment-file contents were intentionally not read. The checked-in
`.env.example` has Firebase settings but no Convex application URL or auth
issuer/key settings. The repository has no Convex auth configuration or
application client. A meaningful local proof of concept would require, at
minimum, a disposable isolated Convex deployment (not any existing
deployment), a publicly reachable HTTPS issuer/JWKS or a documented supported
local equivalent, a generated non-production signing key held outside source
control, and explicit permission to configure that isolated deployment. A
standalone JWT-signing unit test would only test a local library and would not
prove Convex issuer/JWKS/token validation.

No prototype was implemented: the required isolated Convex auth verifier and
approved key/configuration are absent, so a useful end-to-end POC cannot be
validated safely in this workspace. Before implementing the bridge, provision
an isolated test deployment and key-management/JWKS host; do not use the
existing deployment or production credentials.

Proposed configuration after approval:

- Frontend: `VITE_CONVEX_URL` (public deployment URL only).
- Backend secret store: a signing-key reference or private key and key ID;
  illustrative names are `CONVEX_AUTH_PRIVATE_KEY` and
  `CONVEX_AUTH_KEY_ID`. These must never use a `VITE_` prefix.
- Issuer/provider configuration: exact `CONVEX_AUTH_ISSUER`,
  `CONVEX_AUTH_AUDIENCE`, and HTTPS `CONVEX_AUTH_JWKS_URL`, configured
  consistently in the Express issuer and Convex auth provider.
- Existing app auth remains configured by `FIREBASE_PROJECT_ID` or
  `GOOGLE_CLOUD_PROJECT` and server application credentials; Firebase client
  values remain public `VITE_FIREBASE_*` settings. These do not substitute
  for the app-JWT signing key.

Keep the signing private key in a managed server secret store or KMS. Publish
the matching public key through the configured JWKS with a unique `kid`.
Rotation must publish old and new public keys together, switch signing to the
new key, retain the old verification key for at least the maximum token
lifetime plus accepted clock skew, then remove it. Compromise response and
session/JWT invalidation timing require a separate approved runbook; key
rotation alone does not revoke already-issued tokens.

For the approved isolated integration, test (1) valid synthetic authenticated
identity and stable subject-to-user resolution; (2) expired JWT, invalid
signature, wrong issuer, wrong audience, absent identity, and unsupported
algorithm/key ID rejection by actual Convex; (3) client role/email/user-ID
spoofing cannot change identity or authorization; (4) non-Admin rejection and
stored-Admin success; (5) expired/revoked app session prevents token issuance;
(6) already-issued JWT behavior after logout, role change, or account
disablement meets the approved stale-window contract; (7) signing-key rotation
with old/new JWKS overlap; and (8) ordinary clients cannot invoke internal
migration functions. Unit tests alone must not be reported as proof of live
Convex authentication.

### Official documentation consulted and remaining blockers

- [Convex authentication overview](https://docs.convex.dev/auth/overview)
- [Convex custom OIDC provider](https://docs.convex.dev/auth/advanced/custom-auth)
- [Convex custom JWT provider](https://docs.convex.dev/auth/advanced/custom-jwt)
- [Convex auth in functions](https://docs.convex.dev/auth/functions-auth)
- [Convex storing users in the database](https://docs.convex.dev/auth/database-auth)
- [Convex React auth integration](https://docs.convex.dev/api/modules/react#convexproviderwithauth)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase session management and revocation](https://firebase.google.com/docs/auth/admin/manage-sessions)

Open blockers: owner approval of browser-to-Convex authenticated access; stable
UniInfo subject mapping and account-linking policy; immediate-versus-bounded
session/role revocation; an account-disabled policy; password-reset alignment;
trusted issuer/JWKS hosting and signing-key generation, storage, rotation and
incident response; exact audience/issuer configuration; isolated integration
deployment and tests; and review of Firebase token revocation behavior. The
pre-existing schema/migration, source security, privacy/retention, and
timestamp decisions recorded above remain independent blockers. No production
source, Convex deployment, real-user data, or production authentication
behavior was modified in Phase 6G.

## Phase 6H isolated authentication POC readiness

### Prerequisite assessment

The environment was inspected by variable **names only**; no environment-file
values, credentials, tokens, cookies, or key material were read or printed.

- Local `.env.local` declares `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, and
  `VITE_CONVEX_SITE_URL`. Their presence does not establish that the target is
  disposable, isolated, approved for auth configuration, or safe to modify.
  No target was selected or contacted.
- `.env.migration-test.local` declares `CONVEX_MIGRATION_DEPLOYMENT`,
  `CONVEX_MIGRATION_URL`, and `CONVEX_DEPLOY_KEY`. This is an existing
  migration credential profile, not evidence of an isolated authentication
  test deployment or permission to configure one. It was not used.
- No runtime environment names for `CONVEX_AUTH_ISSUER`,
  `CONVEX_AUTH_AUDIENCE`, `CONVEX_AUTH_JWKS_URL`, a private signing key, or
  signing key ID were present. The repository has no `convex/auth.config.ts`.
- No reachable HTTPS issuer/JWKS endpoint, approved non-production signing
  key storage location, explicitly designated disposable Convex deployment,
  configuration permission, or approved issuer/audience/lifetime/revocation
  policy was provided or established.

Required prerequisites are therefore missing. Per the phase safety gate,
implementation and deployment configuration stopped here: no JWT issuer,
auth provider, client integration, test Convex function, or credentials were
created. The existing Convex deployments and environment files remain
untouched. This is a readiness assessment, not a failed POC.

### Current official integration requirements verified

Convex custom JWT provider configuration in `convex/auth.config.ts` supports
`type: "customJwt"` with `issuer`, `jwks`, `algorithm`, and `applicationID`.
The issuer must exactly equal `iss`; `applicationID` must exactly equal `aud`
and should not be omitted; the configured JWKS URL must publish the public
verification key. The documented supported algorithms are RS256 and ES256.
JWT header requirements include `kid`, `alg`, and `typ`; required payload
claims include `sub`, `iss`, and `exp`, with `iat` expected for Convex client
token-refresh behavior. An OIDC provider instead uses `domain` and
`applicationID` and requires its issuer's OIDC discovery and JWKS endpoints.

The React integration uses `ConvexReactClient` and
`ConvexProviderWithAuth`. Its `useAuth` hook returns `isLoading`,
`isAuthenticated`, and `fetchAccessToken({ forceRefreshToken })`; the fetcher
must obtain a fresh token when requested and return `null` when signed out.
Convex functions must independently call
`ctx.auth.getUserIdentity()` and enforce authorization. These documented
interfaces do not prove that any UniInfo token or deployment accepts the
configuration; only an isolated live Convex test can establish that.

Firebase's documented ID tokens use the Firebase project as audience and
`https://securetoken.google.com/<projectId>` as issuer; Firebase Admin
`verifyIdToken` verifies a token for the custom backend. Neither fact
establishes Convex compatibility with this uninspected project configuration
or provides immediate Firebase revocation checks inside Convex.

### Next safe action and acceptance tests

Before resuming this phase, the project owner/security operator must provide
or provision: (1) a new disposable Convex deployment explicitly labeled for
this POC and written approval to configure it; (2) an HTTPS issuer and JWKS
endpoint reachable by that deployment, or a specifically documented
supported isolated equivalent; (3) an approved secret manager/KMS location
for a newly generated non-production private key; and (4) explicit issuer,
audience, maximum token lifetime, clock-skew, and logout/role-change/account
disable revocation policy. No production/existing deployment credentials may
be reused.

Once those gates pass, use synthetic users only. Test actual Convex
verification of valid, expired, bad-signature, wrong-issuer, and wrong-audience
tokens; missing identity; spoofed user/email/role fields; Admin denial and
allow; expired/revoked app session token issuance; logout and role-change
staleness; signing-key rotation with overlap; and rejection of ordinary-client
calls to internal migration functions. Report local issuer unit tests
separately from live isolated Convex integration results.

No prototype or integration tests were run in Phase 6H because prerequisites
were absent. No production Supabase, production authentication, existing
Convex deployment, migration credential, or real-user data was accessed or
modified. The Phase 6G and earlier schema, authorization, migration, privacy,
retention, and timestamp blockers remain open.

## UniInfo development deployment and first application integration

On 2026-10-13, a separate Convex project `gamekillerr206/uniinfo-migration-dev-20261013`
was created for UniInfo development. Its development deployment is
`clear-gopher-925` in `ap-southeast-2`; it is not either pre-existing UniInfo
deployment or the separate authentication POC. The current Convex schema and
functions were pushed only to this new development deployment. A
deployment-scoped migration key is held in the ignored
`.env.uniinfo-convex.local`; never copy it into source control or a client.

The existing synthetic integration runner is now pinned to that project and
requires its dedicated environment file, deployment, URL host and scoped key.
It additionally rejects known pre-existing deployment references. The live
integration run verified 16 synthetic records across all 13 migration tables,
including retry after a committed batch with lost acknowledgement, checkpoints,
relationships, key-set reconciliation, repeat idempotency, collision handling,
unauthenticated rejection of internal migration functions, and public catalog
privacy. Those synthetic fixtures remain in the isolated development
deployment; no cleanup was run. No application rows were read from PostgreSQL
or written to Convex.

Express now has an opt-in public catalogue read path for list, search, spotlight
and legacy-ID detail requests. Set `UNIINFO_CATALOG_BACKEND=convex` only in the
local development process to use it. The adapter requires
`UNIINFO_CONVEX_DEPLOYMENT=dev:clear-gopher-925` and
`UNIINFO_CONVEX_URL=https://clear-gopher-925.ap-southeast-2.convex.cloud`; it
fails closed for the existing deployments. These are public deployment
settings, not a deploy key. PostgreSQL remains the default.
Search preserves the current PostgreSQL substring behavior by filtering
paginated public catalog results in Express; move it into Convex if full-catalog
reads become too costly. This opt-in path covers only public university reads:
authentication, account/profile/bookmark/review writes, notifications, chat,
analytics, sessions and Admin operations still use the existing PostgreSQL /
Express paths. The browser now has an Express-session-backed Convex auth
provider, gated by `VITE_CONVEX_AUTH_ENABLED=true` and an HTTPS Convex URL.
It remains disabled until a new isolated staging deployment and reachable
HTTPS issuer are verified; no protected application function is called by
the frontend yet.

The original `.env.local` was inadvertently updated by the Convex CLI during
project creation even though a custom environment path was requested. Its
current non-secret Convex settings point to the new UniInfo development
deployment; the new dedicated env file also holds its settings and scoped key.
Do not use or restore an unknown prior deployment value by guessing.

The live synthetic integration does not verify the actual PostgreSQL schema or
real application data. The source schema/provenance and Drizzle history remain
unresolved, so no real-row migration or production use is authorized. Before
moving private application flows, implement and validate the approved
authentication bridge and each operation's authorization/invariant parity.
Before any source reads, obtain explicit authorization for a schema-only,
read-only inventory or a provenance-verified schema backup; do not export real
rows as part of this development integration.

## References

- [Convex schemas](https://docs.convex.dev/database/schemas)
- [Convex custom OIDC auth](https://docs.convex.dev/auth/advanced/custom-auth)
- [Convex custom JWT auth](https://docs.convex.dev/auth/advanced/custom-jwt)
- [Convex Auth](https://docs.convex.dev/auth/convex-auth)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase session management and token revocation](https://firebase.google.com/docs/auth/admin/manage-sessions)
