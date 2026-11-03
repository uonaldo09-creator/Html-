# Local development configuration recovery

The original ignored `.env.local` could not be recovered. Use
`LOCAL_DEVELOPMENT_ENVIRONMENT.template` to create a new `.env` only after
obtaining values from their authoritative provider. Do not overwrite
`.env.local` or `.env.uniinfo-convex.local`.

`server.ts` loads `.env` with `dotenv`; Vite exposes only `VITE_*` values to
the browser. `.env.local` is reserved for CLI/Vite-local configuration and is
not a substitute for the server's required `.env` settings.

| Variable | Feature | Requirement | Visibility | Source / safe local alternative |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | Environment mode | Optional; defaults to development behavior | Server | Set `development` locally. |
| `PORT` | Express listener | Required at startup | Server | `3000` is safe locally. |
| `LOG_LEVEL` | Logging | Required at startup | Server | `debug` or `info` is safe locally. |
| `DATABASE_URL` | Application PostgreSQL/Drizzle runtime | Required at startup | Server secret | Recover from the UniInfo database provider; use a local PostgreSQL URL for a non-production setup. |
| `SUPABASE_DB_URL` | Legacy database URL alias | Not sufficient for current startup validation | Server secret | Do not rely on it; set `DATABASE_URL`. |
| `APP_URL` | Verification-email links | Feature-specific | Server | `http://localhost:3000` locally; production public origin in deployment settings. |
| `ALLOWED_ORIGINS` | Credentialed CORS | Optional | Server | Empty for same-origin local use; set deployed SPA origins in production. |
| `GROQ_API_KEY` | AI counselor | Optional; AI is disabled without it | Server secret | Groq console / organization secret manager; no local substitute beyond leaving AI disabled. |
| `GROQ_REQUEST_TIMEOUT_MS` | AI request timeout | Optional | Server | A local numeric timeout is safe. |
| `RESEND_API_KEY` | Verification email | Optional; sending is disabled without it | Server secret | Resend account / secret manager. |
| `EMAIL_FROM` | Verification email sender | Optional, but needed for deliverable email | Server configuration | Verified Resend sender/domain; use no value if email is intentionally disabled. |
| `BACKUP_ENCRYPTION_KEY` | Encrypted backup/restore | Required only for backup operations | Server secret | Existing secret manager or generate a new 32-byte key for a new local-only backup set; never use a made-up replacement for old backups. |
| `BACKUP_DIR` | Backup location | Optional | Server | A local non-repository directory. |
| `VITE_FIREBASE_*` | Firebase browser SDK / Google sign-in UI | Required only for Google sign-in | Public browser configuration | Firebase Console → project settings → web app config. |
| `FIREBASE_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` | Firebase Admin ID-token verification | Required only for Google sign-in API | Server configuration | Firebase/Google Cloud project settings. |
| `ENABLE_DEV_AUTH_BYPASS` | Guarded development-auth test path | Optional | Server | Keep `false`; it works only with `NODE_ENV=development`. |
| `REDIS_URL` or `SUPABASE_REDIS_URL` | Shared caching/rate limiting | Optional | Server secret | Redis provider; omission uses an in-memory local fallback. |
| `CACHE_MAX_ITEMS` | In-memory cache limit | Optional | Server | Built-in default is safe locally. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Remote backup storage | All required only for remote storage | Server secrets except endpoint/bucket/region | AWS/MinIO/Supabase storage settings; omit all locally to keep storage disabled. |
| `MAINTENANCE_INTERVAL_MINUTES`, `SESSION_RETENTION_HOURS`, `NOTIFICATION_RETENTION_DAYS`, `TEMP_FILE_RETENTION_DAYS` | Background maintenance | Optional | Server | Built-in defaults are safe locally. |
| `DISABLE_HMR` | Vite development behavior | Optional | Local build setting | Leave unset unless diagnosing HMR. |
| `UNIINFO_CATALOG_BACKEND` | Convex public catalog switch | Optional; disabled unless exactly `convex` | Server | Leave blank during recovery. |
| `UNIINFO_CONVEX_DEPLOYMENT`, `UNIINFO_CONVEX_URL` | Guarded Convex catalog target | Required only when catalog switch is enabled | Public/server routing configuration | Obtain only from the project owner’s dedicated UniInfo deployment configuration. |
| `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` | Convex CLI tooling | Not used by normal Express catalog routing | CLI/local configuration | Preserve existing `.env.local` and `.env.uniinfo-convex.local`; do not copy a deployment key into a frontend-readable file. |
| `CONVEX_DEPLOY_KEY` | Convex internal migration tooling | Required only for migration tooling | Server secret | Already retained in `.env.uniinfo-convex.local`; never copy to `.env`, `.env.local`, or `VITE_*`. |

## Safe recovery sequence

1. Create a new ignored `.env` by copying the template; do not rename or edit
   either existing Convex file.
2. Start with `NODE_ENV`, `PORT`, `LOG_LEVEL`, and a local `DATABASE_URL`.
3. Run `npm run dev`; confirm the server starts and the catalog uses the local
   database/in-memory data path.
4. Add Firebase, Groq, Resend, Redis, S3, and backup settings only when their
   respective features are needed.
5. Keep `UNIINFO_CATALOG_BACKEND` blank until the dedicated Convex catalog has
   been intentionally approved. When enabled, the adapter enforces the one
   expected deployment reference and HTTPS host, so a different target fails
   closed instead of silently routing traffic.
