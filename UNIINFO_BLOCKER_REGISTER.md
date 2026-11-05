# UniInfo blocker register

Status: **reconstructed register for human triage.**
Companion audit: `MIGRATION_READINESS_AUDIT.md`.
Base commit: `de9c507` on `main`.
Audit branch: `audit/parity-and-gaps`.
Date reconstructed: 2026-11-05.

Severity means impact if the item is ignored, not implementation difficulty:

- **Critical** — can cause data loss, account compromise, or an unsafe cutover.
- **High** — blocks production parity or makes failures hard to detect/recover.
- **Medium** — degrades correctness, security, or operability before cutover.
- **Low** — documentation/cleanup issue with limited direct impact.

Status values: **Open**, **Partially mitigated**, **Decision needed**,
**Resolved in Stage 1 branch** (only when the child branch commit exists).

## Register

| ID | Blocker | Severity | Status | Evidence | Why it blocks | Exit criterion |
| --- | --- | --- | --- | --- | --- | --- |
| B-001 | Live source schema is not independently verified | Critical | Open | `src/db/schema.ts` exists, but the checked-in Drizzle snapshot is stale. No live read-only schema fingerprint is recorded. | Migration correctness depends on the real column set, constraints, indexes, and sequences. | Read-only live-schema capture reviewed against `src/db/schema.ts`; discrepancies documented. |
| B-002 | `account_sync_outbox` status unresolved | Critical | Decision needed | No `account_sync_outbox`, `sync_outbox`, or `outbox` appears in this checkout. The constraint says it must remain PostgreSQL-owned pending sign-off. | Adding or omitting an unverified queue can silently drop or duplicate synchronization work. | Product/data owner confirms whether it exists outside this checkout and records the durable ownership decision. |
| B-003 | Catalog deployment is hard-pinned | High | Resolved in Stage 1 branch | `src/server/convexUniversityCatalog.ts` hard-codes `dev:clear-gopher-925` and its host. | Cannot safely select an approved isolated deployment; encourages editing source or bypasses. | Shared fail-closed resolver adopted, tested, and reviewed in the Stage 1 commit. |
| B-004 | Convex auth bridge is unverified | Critical | Open | `src/server/convexAuth.ts`, `convex/auth.config.ts`, and `convex/me.ts` exist. No live staging exchange/JWKS evidence is recorded. | Private Convex functions cannot be trusted until identity, signature, issuer/audience, expiry, subject, `tokenVersion`, and disabled-user checks are exercised end to end. | Recorded isolated-staging positive and negative auth evidence; no test issuer or disabled validation. |
| B-005 | Private Convex read functions are missing | High | Open | No application `me`-wired profile/bookmark/notification/chat functions; only internal migration writers exist. | Users would lose private read parity if reads moved. | Owner-derived, role-safe functions with parity tests and rollback switches. |
| B-006 | Private Convex write functions are missing | Critical | Open | All profile, bookmark, notification, chat, and review writes are Express/PostgreSQL only. | No Convex write cutover is possible. | Atomic, idempotent, authorized mutations for approved domains, tested against isolated staging data. |
| B-007 | Review reads and writes are split | High | Open | Public catalog reads can use Convex; `POST /api/universities/:id/reviews` writes PostgreSQL. | Convex can serve stale reviews immediately after a PostgreSQL write. | Written dual-write/cutover decision plus staleness/refresh behavior, or keep review reads on PostgreSQL until writes move. |
| B-008 | Admin operation parity is missing | High | Open | No Convex admin university/user/review/audit functions; Express admin routes are PostgreSQL-only. | Admin actions cannot be performed if authority moves to Convex. | Admin-only Convex functions with explicit cascade/cleanup behavior and tests. |
| B-009 | Audit and analytics parity is missing | High | Open | `audit_logs` and `analytics_events` have internal migration writers only. Pino security events and the audit table are distinct streams. | Security/analytics visibility is lost or conflated after a cutover. | Convex audit/analytics write and Admin read functions, retention rules, and stream separation documented. |
| B-010 | Cleanup/cron parity is missing | Medium | Open | PostgreSQL `cleanupExpired*` methods exist; no `convex/crons.ts` or Convex cleanup mutation exists. | Sessions, tokens, login attempts, and notifications would accumulate indefinitely. | Approved retention windows and bounded, audited Convex cleanup jobs. |
| B-011 | Convex indexes are not unique constraints | Critical | Open | Migration checks collisions, but no ordinary application mutation enforces email, subject, profile, bookmark, or review uniqueness. | Future writes can create duplicate identities or logical rows. | Runtime uniqueness enforcement or atomic check-and-insert for every applicable write path. |
| B-012 | Delete/cascade semantics are absent | High | Open | PostgreSQL relies on foreign keys/cascades; Convex has no equivalent and no ordinary delete mutations. | Deletes can orphan rows or fail after cutover. | Explicit, tested Convex deletion order and cleanup strategy. |
| B-013 | Duplicate-review policy is undecided | Critical | Decision needed | `src/server/convexMigration.ts` preserves duplicate review rows; `drizzle/0004_review_user_uniqueness.sql` would delete them. The runbook forbids applying it. | A future uniqueness migration can silently destroy review history. | Product decision on canonical reviews, archives, and whether `0004` may ever run. |
| B-014 | Legacy identity anomalies are not preflighted against real data | Critical | Open | Code checks duplicate normalized emails, duplicate/blank/email-shaped subjects, and legacy subject backfill, but the real source has not been checked. | Ambiguous identities can merge or block accounts. | Read-only preflight report on the approved source, with a named remediation owner. |
| B-015 | Unlinked historical chat policy is undecided | High | Decision needed | Migration preserves guest/unmatched chat with email and no invented user; warning codes are documented. | Privacy exposure or orphaned history after read migration. | Product/privacy approval for visibility, retention, and ownership of unlinked history. |
| B-016 | Real backup/restore is not verified | Critical | Open | Encrypted backup and transactional restore tests exist; no real source backup has been restored and reconciled. | A failed migration may be unrecoverable. | Verified restorable backup with checksums and a timed restore rehearsal. |
| B-017 | Cutover/dual-write/rollback plan is missing | Critical | Open | PostgreSQL remains authoritative; no automatic traffic switch or dual-write/change capture exists. | Partial cutover can leave divergent stores with no safe reversal. | Written cutover architecture, staleness bounds, rollback triggers, owner, and reconciliation procedure. |
| B-018 | Key custody, rotation, and revocation are incomplete | Critical | Open | Single ES256 private key; JWT valid up to five minutes; logout deletes only the PostgreSQL session; no denylist/key-overlap procedure. | Key compromise or stale tokens can outlive logout/role changes. | Security-approved key rotation/overlap, secret storage, logout semantics, and incident procedure. |
| B-019 | Convex read observability/reconciliation is missing | High | Open | Catalog adapter has fallback/logging but no periodic parity or drift monitoring against PostgreSQL. | Stale or incorrect Convex reads may go unnoticed. | Metrics/alerts for Convex errors, latency, fallback, and sampled parity checks. |
| B-020 | Deployment target is not exercised against a live staging deployment | High | Open | Stage 1 tests are local/unit-level; no real isolated deployment was contacted. | A resolver can pass tests but still reject or misconfigure the approved deployment. | Read-only staging validation recorded against an approved isolated deployment. |
| B-021 | Catalog search semantics may differ | Medium | Open | Express filters cached `universities.list` results client-side; a Convex `search` query exists but is not the active catalog path. | Search recall, ranking, and performance may diverge. | Parity tests for representative queries or an approved switch to the Convex search query. |
| B-022 | Migration guard duplication permits drift/bypass | High | Resolved in Stage 1 branch | Target checks are repeated in catalog, destination, orchestrator, and migration scripts. | One missed copy can bypass protected/synthetic-only deployment rules. | Catalog, destination, and orchestrator use the shared resolver; scripts are assessed and covered by tests. |
| B-023 | No production traffic-switch mechanism exists | High | Open | `UNIINFO_CATALOG_BACKEND=convex` is an environment switch; no staged rollout, canary, or automatic rollback. | Switching reads is all-or-nothing and manual. | Approved rollout mechanism with health gates and instant rollback. |
| B-024 | Historical claims are not all independently verified | Medium | Open | Migration docs/reports make claims about prior rehearsal/verification; this audit did not reproduce those live runs. | Readers may mistake historical claims for current production evidence. | Evidence index mapping each operational claim to a reproducible artifact/date. |
| B-025 | Future Convex inserts can collide with legacy IDs | Critical | Open | `idCounters` is reserved at `max(legacyId)+1`; ordinary insert paths do not exist yet. | Duplicate public numeric IDs can corrupt identity and references. | Every future insert uses the allocator atomically; concurrency tests prove no reuse. |
| B-026 | Convex `me` query is not wired into Express | Low | Open | `convex/me.ts` exists; `/api/user/profile` still reads PostgreSQL. | The only protected Convex query provides no product value yet. | Decide whether `me` is a staging verification probe or wire it to an approved read route. |

## Decision log required before production cutover

| Decision | Owner | Status | Notes |
| --- | --- | --- | --- |
| Authoritative source schema and queue ownership (B-001, B-002) | Product/data owner | Pending | Must be written, dated, and linked to a read-only schema capture. |
| Duplicate-review policy (B-013) | Product/data owner | Pending | Explicitly state whether `0004_review_user_uniqueness.sql` is permanently retired. |
| Unlinked chat and analytics privacy/retention (B-015, B-010) | Product/privacy owner | Pending | Cover historical email/IP retention and deletion. |
| Cutover, dual-write, staleness, and rollback (B-007, B-017, B-023) | Product/engineering owner | Pending | Include go/no-go criteria and incident ownership. |
| JWT key custody, rotation, logout, and disable (B-004, B-018) | Security owner | Pending | Must be approved before private Convex functions are enabled. |
| Admin delete/cascade parity (B-008, B-012) | Product/engineering owner | Pending | Define expected cascades and recovery for each entity. |

## Stage 1 scope boundary

The Stage 1 branch addresses **B-003** and **B-022 only**: a shared deployment
target policy for the catalog, migration destination, and orchestrator, plus
tests. It does not resolve auth, private/admin functions, schema verification,
backups, cutover, or any product decision above. It does not deploy, migrate,
push, or open a pull request.
