# UniInfo migration checkpoint — 2026-10-14

## JWT bridge implementation status

- Added the frontend Convex auth provider, gated behind an explicit
  `VITE_CONVEX_AUTH_ENABLED=true` and HTTPS `VITE_CONVEX_URL`. It reuses the
  HttpOnly Express session, exchanges/refreshes tokens through the Express
  endpoint, and clears Convex auth on logout/session expiry. It is not enabled
  or live-verified; do not configure it until an isolated staging deployment
  and reachable HTTPS issuer are verified.
- Added mocked local frontend-auth tests. No Convex CLI, deployment, production
  database, or production data was accessed for this integration.
- Added an Express-to-Convex JWT bridge: verified existing sessions exchange at
  `POST /api/auth/convex-token`; `GET /.well-known/jwks.json` serves the public
  ES256 key only. Tokens use the PostgreSQL `auth_subject` and `token_version`,
  expire after five minutes, and carry no role/email.
- Added Convex JWT configuration and `requireActiveUser` identity lookup plus a
  protected `me` query. Convex migration rows now include the persisted subject,
  token version, and disabled flag. Role changes increment the token version.
- Added focused crypto, route, identity, migration, and revocation tests.
  `npm test` excludes the standalone `.mjs` cloud POC; run it explicitly with
  `npm run test:convex-auth:poc`.
- Added `jose` as a direct runtime dependency. `.env.example` contains only
  public bridge setting names and a warning; no private key value was added.
- The archive was compared with the active checkout. The auth implementation
  files were absent in the active checkout; archive copies that replaced the
  active migration mapping with `legacy:<id>` and/or added startup DDL were not
  copied. The existing authoritative `auth_subject` mapping and `0003`
  migration remain.
- No production database DDL or data migration was run. The bridge is **not
  verified against Convex**; no reachable HTTPS issuer or new isolated staging
  deployment was available. Deployment requirements and remaining work are in
  `CONVEX_AUTH_BRIDGE.md`.
- Safety note: `npx convex codegen --dry-run` unexpectedly selected the
  existing local Convex CLI deployment and reported an upload attempt before
  stopping because `CONVEX_AUTH_ISSUER` was unset. No further Convex CLI
  commands were run. Remote effect is unconfirmed; inspect that deployment
  through the project owner before any subsequent deployment command.

## Latest local verification

- Focused auth, identity, migration, and subject tests passed: 56 tests.
- Full app suite passed: 143 tests across 20 files.
- Backend (including Convex source) and frontend TypeScript checks passed.
- Production build passed. Vite still reports the existing >500 kB main-chunk
  advisory.
- `npm audit --audit-level=moderate` found 0 vulnerabilities; `git diff --check`
  passed.
- The standalone cloud POC was not run because its configured endpoint is not a
  newly provisioned isolated staging deployment. The `test:convex-auth:poc`
  command remains available once the isolated deployment and HTTPS issuer are
  ready.

## Environment recovery status

- The original ignored `.env.local` could not be recovered exactly. Git history,
  recoverable Git objects, Windows File History locations, recycle-bin entries,
  adjacent project folders, and VS Code/Cursor history were searched without
  displaying secret values. The only historical environment candidates belonged
  to an unrelated `jokesaside-main` project and were not used.
- `.env.local` currently contains only Convex CLI public selectors. Its content
  was not changed during recovery work.
- `.env.uniinfo-convex.local` remains unchanged and is the only local file
  holding `CONVEX_DEPLOY_KEY`. Do not copy that key into `.env`, `.env.local`,
  any `VITE_*` setting, or source control.
- `LOCAL_DEVELOPMENT_ENVIRONMENT.template` and
  `LOCAL_DEVELOPMENT_CONFIGURATION.md` provide a credential-free inventory and
  recovery template. Copy the template manually to a new ignored `.env` after
  obtaining values from their authoritative providers.

## Current runtime configuration facts

- `server.ts` requires `DATABASE_URL`, `LOG_LEVEL`, and `PORT` at startup.
  A local PostgreSQL URL is suitable for development; production values must be
  recovered from the authorized database deployment/secret manager.
- AI, email, Firebase, Redis, S3, encrypted-backup, and Convex catalog settings
  are feature-specific. Their recovery source and local fallback are documented
  in `LOCAL_DEVELOPMENT_CONFIGURATION.md`.
- Convex catalog reads are disabled unless `UNIINFO_CATALOG_BACKEND=convex`.
  When enabled, `src/server/convexUniversityCatalog.ts` rejects any deployment
  reference or HTTPS host other than the dedicated UniInfo development target.
  Therefore it fails closed rather than silently selecting another deployment.

## Verified migration state before this checkpoint

- The dedicated UniInfo Convex development deployment received the current
  schema/functions and the synthetic 13-table migration rehearsal passed.
- The isolated local PostgreSQL rehearsal passed its encrypted backup/restore,
  integrity, rollback, read-only-source, and 13-table reconciliation checks.
- `npm test` passed 126 tests. Backend/frontend/Convex type checks, production
  build, and moderate-or-higher npm audit had passed earlier in this session.
- No production Supabase/PostgreSQL connection was opened, no production data
  was exported/migrated, and no Convex deployment was reset or selected during
  environment recovery.

## Remaining blockers — do not bypass

1. Recover or provision values for a new ignored `.env`, beginning with a local
   PostgreSQL `DATABASE_URL`, `PORT`, and `LOG_LEVEL`. Provider-owned values
   must come from the respective Supabase/PostgreSQL, Groq, Resend, Firebase,
   Redis, AWS/S3, and secret-management accounts.
2. A production migration cannot begin without an authorized production
   read-only source connection, a verified restorable backup, and a deliberately
   clean destination. The current dedicated development target contains only
   synthetic rehearsal data and must not be reset without explicit approval.
3. The full runtime migration remains incomplete: private user features and
   authentication still depend on PostgreSQL/Drizzle. A production-safe Convex
   auth bridge needs separately managed signing-key/JWKS infrastructure; do not
   reuse the authentication proof-of-concept key.

## Safe next session

1. Read this checkpoint and `LOCAL_DEVELOPMENT_CONFIGURATION.md`.
2. Confirm a new local `.env` has been manually created from the template using
   authorized values only; do not alter either existing Convex file.
3. Start the application against local PostgreSQL with Convex catalog reads
   disabled, then continue feature-by-feature Convex replacement after the
   secure authentication design has been supplied.
