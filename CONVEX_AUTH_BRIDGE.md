# UniInfo Express-to-Convex authentication bridge

Status: implemented locally and covered by unit/HTTP tests. **Not verified
against a Convex deployment.** Do not enable protected Convex traffic until the
isolated staging checklist below passes.

## Flow

1. The browser signs in through the existing Express routes and keeps the
   HttpOnly application session. The frontend Convex auth provider is gated by
   `VITE_CONVEX_AUTH_ENABLED=true` and an HTTPS `VITE_CONVEX_URL`; it checks the
   existing Express session and obtains/refreshes short-lived Convex tokens through
   the Express endpoint. Tokens are not persisted in browser storage.
2. `POST /api/auth/convex-token` accepts that existing session as a cookie or
   bearer value. Express also requires a verified email and an enabled account.
3. Express signs a five-minute ES256 JWT with the persisted PostgreSQL
   `users.auth_subject` as `sub` and `users.token_version` as `tv`.
4. `GET /.well-known/jwks.json` publishes only the matching public P-256 key.
5. Convex verifies issuer, audience, expiry, and signature through
   `convex/auth.config.ts`. Private-user functions call
   `requireActiveUser(ctx)` from `convex/identity.ts`, which resolves
   `identity.subject` using `by_auth_subject` and checks `disabled` and `tv`
   against the stored user record.

The token contains no email, role, or legacy ID. Convex authorization uses the
stored user document. `convex/me.ts` is the first protected query and returns
only the caller's profile fields.

## Configuration and key handling

- Express requires `CONVEX_AUTH_ISSUER`, `CONVEX_AUTH_AUDIENCE`, and
  `CONVEX_AUTH_PRIVATE_KEY` together. With none set, the bridge remains off.
- The issuer must be an HTTPS URL reachable by Convex and serve
  `/.well-known/jwks.json`. The audience must match `applicationID` in Convex.
- `CONVEX_AUTH_PRIVATE_KEY` is a P-256 PKCS#8 PEM held only by the Express
  server's secret store. It is intentionally absent from `.env.example`, must
  never be put in a `VITE_*` variable, and must not be set in Convex.
- Convex needs only `CONVEX_AUTH_ISSUER` and `CONVEX_AUTH_AUDIENCE` as
  deployment environment variables.
- The POC signing key is not reused. Key rotation/overlap is not implemented;
  configure and test a rotation procedure before production use.

## Identity migration and revocation

`drizzle/0003_identity_subjects.sql` owns PostgreSQL identity columns. It has
not been applied to production. The transform copies the persisted `auth_subject`, `token_version`, and `disabled` into Convex verbatim; it never invents a subject at import time. For legacy rows without a subject, the candidate PostgreSQL backfill assigns `uniinfo-user:<id>` from the immutable `users.id` before import. New signups continue receiving server-generated UUID subjects. This does not infer a Firebase UID.

Changing a user's role increments PostgreSQL `token_version`, invalidating
already-issued Convex tokens on their next protected call. A disabled account
cannot receive another bridge token, and Convex rejects tokens for a disabled
record. Logout still leaves an already-issued Convex token valid for at most
five minutes. The app currently has no account-disable administration route.

## Remaining work / deployment gate

- Frontend provider/token refresh wiring is implemented locally, but remains
  disabled until explicitly configured for a verified isolated staging deployment.
- No application feature currently calls a protected Convex function; the
  provider wiring alone does not move private application functionality.
- Reviews, profiles, bookmarks, notifications, chat history, session storage,
  and the rest of the private application remain Express/PostgreSQL-backed.
- No token/JWKS verification against the project deployment has been performed.

Before testing, provision a **new isolated staging deployment** (not one of
the existing UniInfo deployments) and a reachable HTTPS staging issuer. Use
synthetic accounts only, set separate staging keys/secrets, deploy the
`auth.config.ts` environment values, and verify: JWKS fetch and matching key,
successful `me`, no session/unverified-email token exchange, invalid
issuer/audience/expiry/signature rejection, stored-role authorization, and
token-version revocation after role change. Do not reset or repurpose an
existing deployment to create this test environment.
