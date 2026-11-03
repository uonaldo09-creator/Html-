# UniInfo: credential rotation, live verification, and fresh export runbook

## Current status

This repository snapshot has been audited locally. The uploaded archive contained three alternate environment files and the Git history. Two `CONVEX_DEPLOY_KEY` values were present in the alternate environment files, and a historic Resend API-key-shaped value was present in a past `server.ts` revision. Treat those values as exposed. Secret values are intentionally not reproduced in this document or in the cleaned project bundle.

**Provider-side revocation, live authentication verification, and the actual fresh database export are not marked complete by this package.** The archive intentionally excludes environment files, and this execution environment has no authorized live database credentials or PostgreSQL client utilities. Do not claim these steps are complete until the provider actions and local export script succeed.

Keep these safeguards in all normal environments until the migration review is closed:

```env
ENABLE_DEV_AUTH_BYPASS=false
CONVEX_MIGRATION_ENABLED=false
```

## 1. Revoke exposed credentials first

### Convex deployment keys

1. Open the Convex dashboard and inspect the Settings / Deploy keys area for each deployment referenced by the two `.env.uniinfo-convex*.local` files in the original archive.
2. Revoke/delete the two keys found in the archive. Do not reuse them for a new deployment or local CLI session.
3. If deployment access is later needed, create a new, least-privilege deploy key after the revocations are confirmed, and store it only in your local secret manager or an approved provider secret store. Do not paste it into chats, tickets, logs, or source files.
4. Remove all old local alternate environment files from any copies you control. The cleaned project package intentionally does not include them.

Official documentation: https://docs.convex.dev/dashboard/deployments/deployment-settings and https://docs.convex.dev/cli/deploy-key-types

### Resend

1. In the Resend dashboard, verify that the old key previously rotated by you is now revoked/disabled. Its historical shape was found in the ZIP's Git history, even though the checked-out source no longer contains it.
2. If it is not revoked, revoke it immediately.
3. When a replacement is needed, create a new key with sending-only permissions and limit it to the verified UniInfo sending domain where possible. Put it only in the backend's secret store as `RESEND_API_KEY`.
4. If this Git repository was pushed remotely, plan a separate history-cleaning operation after revocation. Do not force-push automatically: coordinate with every clone/branch owner and make a backup before rewriting history.

Provider documentation: https://resend.com/changelog/new-api-key-permissions

### Supabase / PostgreSQL

1. The ZIP did not contain a current `DATABASE_URL` or current database password, so this package cannot verify whether the previously reported password rotation is effective.
2. In the Supabase dashboard, confirm the old database password is no longer valid. If uncertain, reset it, then update the backend secret store and any explicitly authorized backup/restore job that needs access.
3. Obtain the current connection parameters and the official database root CA certificate from the dashboard. Do not commit or paste them into chat.
4. Use certificate and hostname verification (`PGSSLMODE=verify-full` with `PGSSLROOTCERT` set to the provider CA path). The code now builds remote `pg` connection options with `rejectUnauthorized: true`; remote `sslmode=disable` is rejected. Local loopback rehearsal databases may remain non-TLS.

Official documentation: https://supabase.com/docs/guides/platform/ssl-enforcement and https://supabase.com/docs/guides/database/connecting-to-postgres

### Firebase / Google

The scan found a Firebase Web API key format in historical configuration, not a service-account private-key PEM. Web API keys are client identifiers, but restrict the key to appropriate APIs and allowed application referrers in Google Cloud/Firebase. Do not download or commit a service-account JSON key for this task unless the architecture explicitly requires it.

## 2. Live Convex auth is not configured/verified yet

The project code expects all three backend settings together:

- `CONVEX_AUTH_ISSUER`: an actual, publicly reachable HTTPS issuer URL whose `/.well-known/jwks.json` route returns the matching public signing JWK.
- `CONVEX_AUTH_AUDIENCE`: the exact audience configured in the target Convex deployment.
- `CONVEX_AUTH_PRIVATE_KEY`: a private P-256/ES256 key, backend-only. Never add a `VITE_` prefix or put this key in frontend configuration.

The ZIP did not establish a real HTTPS issuer URL or include those settings. Do not use the placeholder `https://auth.uniinfo.test` as a live issuer. Once a real HTTPS issuer is provisioned through an approved hosting/account workflow, set matching values in the backend and the intended Convex deployment, then test:

1. `GET https://<issuer>/.well-known/jwks.json` returns HTTP 200 and a public JWK with no private `d` value.
2. A verified user session can request `/api/auth/convex-token`; the JWT has the expected issuer, audience, subject, `tv`, ES256 algorithm, and five-minute expiry.
3. A disabled user cannot obtain a token; a token with a stale token version is denied by Convex `requireActiveUser`.
4. Invalid signature, wrong issuer/audience, expired token, and missing/disabled user fail closed.
5. A real Google/Firebase sign-in is tested through the full browser flow. A mock session is not proof of live sign-in.

This requires provider account access and a real issuer endpoint. No deployment is performed by this runbook.

## 3. Important identity-migration blocker

The current candidate policy for existing legacy accounts is the stable, namespaced subject `uniinfo-user:<id>` for rows whose `auth_subject` is absent, based on the immutable PostgreSQL primary key. It creates a UniInfo application subject; it does not map an account to a Firebase UID, and the source inventory showed no populated Firebase UIDs. New accounts continue to receive server-generated UUID subjects. PostgreSQL persists the subject first; the Convex transform copies it exactly and fails closed if it is missing or blank.

This policy has passed a local clone rehearsal and unit tests only. Do not apply `drizzle/0003_identity_subjects.sql` live until legacy-ID immutability and authentication continuity are confirmed, a fresh encrypted backup is successfully decrypted and restored to an isolated database, and isolated staging tests verify token issuance, identity lookup, authorization, and token-version revocation. Production writes and the Convex migration flag remain disabled until those gates pass.

## 4. Create a fresh encrypted PostgreSQL export on Windows

The ZIP did not include an authorized live database connection, a root CA file, or PostgreSQL client tools usable in this execution environment. Therefore, **no fresh live database export was created here**. Do not use the app's normal `npm run dev` as a connection test against production: app startup can run schema initialization and may seed development data.

The package now includes a direct `pg_dump` exporter that does not start the application. It reads the `public` schema using TLS certificate verification and encrypts the dump stream directly with AES-256-GCM; plaintext dump contents are not saved to a file by the exporter. It also writes a manifest with a SHA-256 digest and archive-list verification result. The output directory must be outside the project.

Prerequisites on your Windows machine:

- PostgreSQL client tools (`pg_dump` and `pg_restore`) installed and available in `PATH`.
- The current connection details from Supabase's dashboard and the official root CA certificate.
- A **new export-only** 32-byte key, stored in your password manager. Generate one locally with `openssl rand -hex 32`, or with this Windows PowerShell 5.1-compatible cryptographic RNG sample. Keep the output local and do not paste it into chat. This key is separate from `BACKUP_ENCRYPTION_KEY`, which may be needed to decrypt older application backups.

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$key = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
$key  # Save it directly into your password manager; never put it in chat or source control.
$rng.Dispose()
[Array]::Clear($bytes, 0, $bytes.Length)
Remove-Variable key, bytes, rng
```

From the project root, run:

```powershell
npm run fresh:export:check
npm run fresh:export:windows
```

The PowerShell script asks for host, port, database, username and CA path; it reads the database password and the 64-character `FRESH_EXPORT_ENCRYPTION_KEY` with masked prompts and does not write a `.env` file. Confirm the intended database and type `EXPORT` when prompted. It writes to `%USERPROFILE%\Backups\UniInfo\FreshExports\<timestamp>` outside the repository.

The exporter scope is the PostgreSQL `public` schema only. It does not export Supabase Storage objects or Supabase-managed Auth schema. The exporter checks authenticated decryption and `pg_restore --list`; its manifest deliberately sets `restoreTested` to false. Before any migration, restore the export into a separate isolated local PostgreSQL database and validate row counts and critical relations. Never test restoration over production.

## 5. Verification commands

Run on the Windows development machine after applying the package:

```powershell
npm run fresh:export:check
npm run lint
npm test
npm run build
git diff --check
```

The previously reported user-machine run passed 157 tests and the build before the export/TLS helper changes. The provided ZIP had Windows-specific `node_modules`; running Vitest in a Linux environment failed due a missing Linux Rollup optional package, so this audit does not claim the updated full suite passed in Linux. Run the commands above on Windows and retain the output without including secrets.

## 6. Safe packaging and repository hygiene

- Never recreate the deleted `.env` just for this process. Populate a local ignored environment file only on your machine after provider-side rotation.
- `.env.example` is a template and should contain no real secrets.
- The cleaned package excludes `.git`, alternate `.env*` files, `node_modules`, `dist`, local backups, deployment credentials, and archive/dump/key artifacts.
- Keep deploy keys and private JWT keys in the secret store; never commit them.
- Keep `ENABLE_DEV_AUTH_BYPASS=false` and `CONVEX_MIGRATION_ENABLED=false` until all blockers are closed.

## Exit criteria

This work is complete only when the dashboard confirms old credentials are revoked, replacements are stored in the correct secret stores, the fresh export command creates a verified encrypted archive, the archive is restored and checked against an isolated database, the real HTTPS JWKS/token flow and real sign-in pass, and the identity-subject migration no longer silently assigns unsuitable identities. None of those live/provider-dependent criteria are claimed complete by this source-only package.
