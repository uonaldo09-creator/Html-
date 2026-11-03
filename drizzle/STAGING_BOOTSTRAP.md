# Fresh staging database bootstrap

`staging_bootstrap.sql` creates the current 13-table PostgreSQL schema with
indexes, foreign keys, and the required `users.auth_subject`,
`users.token_version`, and `users.disabled` columns. It creates no application
rows. Use the guarded runner; do not invoke Drizzle's migration or generation
commands for a fresh database.

## Safety checks

The runner:

- reads only `STAGING_DATABASE_URL` (never `DATABASE_URL`);
- requires `--confirm-staging`;
- permits only a credentialed `*.render.com` PostgreSQL URL whose database name
  is exactly `uniinfo_staging`, rejecting Supabase hosts;
- checks `current_database()` after connecting;
- refuses a non-empty `public` schema; and
- creates everything in one transaction, rolling back on failure.

The SQL also requires a transaction-local marker set only by the guarded
runner, so invoking the SQL file directly with `psql` fails closed.

First perform a non-connecting check:

```powershell
$env:STAGING_DATABASE_URL = '<Render external URL for uniinfo_staging>'
npm run db:bootstrap:staging -- --confirm-staging --dry-run
```

Review that the host is the new staging database in Render, then apply using
the same command without `--dry-run`. Do not save the URL to a project
environment file, paste it into logs, or use a production/Supabase URL.

Afterward, verify the schema using a read-only database inspection in Render
and configure the staging app with the staging connection string. This bootstrap
does not transfer production data, and the app's existing startup code may seed
the public university catalog from repository data when it starts.

## Historical Drizzle journal

The journal still references `0000_thick_husk` and `0001_session_lifetimes`
without their historical SQL files; only the `0000` snapshot exists. Their
history must not be invented. `0002_analytics_events.sql` and
`0003_identity_subjects.sql` are incremental changes for databases with the
earlier schema, not a fresh-database bootstrap. This current-schema bootstrap
includes the identity columns directly; applying `0003` afterward is neither
needed nor safe to assume idempotent for this fresh schema.
