# UniInfo SaaS Platform Architecture & Production Guide

This document details the architectural upgrades implemented to transform the **UniInfo** university search and AI-counselling applet into a secure, production-grade, highly-resilient SaaS platform.

---

## 1. Directory Structure

The following directories and files have been introduced to modularize the backend architecture:

```
├── /backups/                 # Local directory housing rolling timestamped database backups
├── /src/server/
│   ├── logger.ts             # Pino-powered structured logging configuration
│   ├── backup.ts             # 24-hourly backup, prune, retention, and restore services for PostgreSQL
│   ├── migration.ts          # Schema migrations helper
│   ├── error.ts              # Centrally-managed HTTP errors and stack-trace masking
│   ├── security.ts           # Account lockouts, correlation IDs, and CSRF protection
│   └── monitoring.ts         # Health diagnostics and Prometheus /metrics builders
├── /src/tests/
│   └── saas.test.ts          # Automated unit, integration, and coverage test suites
└── SaaS_ARCHITECTURE.md      # Production operations and API blueprint documentation (This file)
```

---

## 2. API Endpoints Reference

### 🏥 System Diagnostics & Observability

#### `GET /health` or `GET /api/health`
* **Description:** Performs full active health checks on storage disk reads, memory allocations, and AI API configurations.
* **Response `200 OK` (Healthy):**
```json
{
  "status": "ok",
  "timestamp": "2026-06-24T07:20:00.000Z",
  "uptimeSeconds": 1420,
  "components": {
    "database": {
      "status": "healthy",
      "recordCounts": { "universities": 14, "users": 1, "sessions": 1 }
    },
    "aiProviders": {
      "status": "available",
      "groqConfigured": true
    },
    "system": {
      "memoryHeapUsedMB": 42,
      "memoryHeapTotalMB": 68,
      "memoryRssMB": 95,
      "nodeVersion": "v20.11.0"
    }
  }
}
```

#### `GET /metrics` or `GET /api/metrics`
* **Description:** Exposes raw, real-time node cluster memory consumption, database size, and session stats in Prometheus-compliant text format.
* **Response `200 OK` (Format `text/plain`):**
```text
# HELP node_uptime_seconds Uptime of the node server in seconds
# TYPE node_uptime_seconds gauge
node_uptime_seconds 1420

# HELP node_memory_rss_bytes Resident Set Size memory usage in bytes
# TYPE node_memory_rss_bytes gauge
node_memory_rss_bytes 99614720

# HELP db_universities_total Total number of universities in the database
# TYPE db_universities_total gauge
db_universities_total 14
```

---

### 🔑 Authentication & Session Management

#### `POST /api/register`
* **Description:** Securely provisions new student accounts. Enforces input sanitization and complex password criteria (>=6 chars, uppercase, digit, special char).
* **Security:** Checked by strict auth rate-limiter (max 5 requests per 15 minutes).
* **Payload:** `{"email": "student@uni.edu", "password": "SecurePassword123!"}`
* **Response `200 OK`:** Sets HTTP-only, secure, SameSite=Strict cookie `session_token`. Returns auth token.

#### `POST /api/login`
* **Description:** Validates credentials. Sets HttpOnly session identifier.
* **Security Lockout:** Increments consecutive failures. On the 5th failure, locks the account for **15 minutes**.
* **Payload:** `{"email": "student@uni.edu", "password": "SecurePassword123!"}`
* **Response `200 OK`:** Resets lockout tracker. Returns user profile and session token.
* **Response `423 Locked`:** Account is locked out. Response indicates remaining minutes.

#### `POST /api/user/logout`
* **Description:** Clears active sessions and prunes cookies.
* **Response `200 OK`:** Clears `session_token` cookie (sets age to 0).

---

### 🎓 University Catalog & AI Counselling

#### `GET /api/universities`
* **Description:** Query-driven university catalog lookup. Supports searching, sorting (by fee, rank, placement, ratings), and filters (for accrediting bodies: AICTE, NBA, NMC, NAAC, NIRF).

#### `POST /api/universities/:id/reviews`
* **Description:** Submits student reviews (requires active login). Re-calculates university rating aggregates.
* **Payload:** `{"rating": 5, "comment": "Outstanding campus!"}`

#### `POST /api/chat`
* **Description:** Interactive smart university counselling chat.
* **AI Provider Engine:**
  Uses high-thinking Groq models (e.g. `llama-3.3-70b-versatile` or `llama-3.1-8b-instant`).

---

## 3. Environment Variables Reference

Create a `.env` file in the root directory. Never check this file into source control.

```bash
# General Server Mode
NODE_ENV=production        # Enables HSTS, restricts stack traces, and enforces Secure cookies
LOG_LEVEL=info             # Pino Logging levels: 'fatal', 'error', 'warn', 'info', 'debug'

# Database Connection (Supabase PostgreSQL)
DATABASE_URL=postgres://... # Connection string to the primary PostgreSQL database

# Primary AI Counseling Provider (Groq Cloud)
GROQ_API_KEY=your_groq_api_key_here       # Triggers deepseek reasoning and stable llama models
```

---

## 4. Automated Backup & Recovery Procedures

Our platform runs an autonomous, container-safe backup service that requires zero crontab configurations:

1. **Daily Schedules:** Upon server boot, a background interval runs hourly. If 24 hours have elapsed since the last backup file was created, an encrypted, integrity-checked snapshot of all 12 PostgreSQL tables is generated outside the public directory.
2. **Backup Retention Pruning:** During each snapshot, the service evaluates backup timestamps. Backups older than **7 days** are automatically unlinked to conserve local disk space.
3. **Pre-Restore Safety:** Restoring any backup triggers an automatic, immediate snapshot (`pre_restore_safety`) before making any database modifications, protecting against administrative errors.

### Manual Operations via Code API

#### Programmatic Backup Creation:
```typescript
import { BackupService } from "./src/server/backup";

// Triggers an instant on-demand backup
const filename = await BackupService.createBackup("manual_admin_op");
console.log(`Backup file created: ${filename}`);
```

#### Programmatic Restoration:
```typescript
import { BackupService } from "./src/server/backup";

// Restores the database tables safely from export file after performing a pre-restore backup
await BackupService.restoreBackup("db_backup_2026-06-24T07-20-00-000Z_manual_admin_op.json.enc");
```
Restore returns `true` on success and throws on invalid/incomplete backups,
failed safety-backup creation, or failed PostgreSQL writes. Handle and report
those errors at the calling boundary; legacy partial plaintext backups are
not accepted.

---

## 5. Security & SaaS Architecture Upgrades

* **Double-Submit Cookie CSRF:** For all mutative endpoints (`POST/PUT/DELETE`), our system validates that the client-submitted `X-CSRF-Token` header matches the browser's `csrf_token` cookie. The React client-side monkey-patches `window.fetch` to attach this transparently, providing robust security with zero refactoring.
* **HSTS (HTTP Strict Transport Security):** When `NODE_ENV=production`, our server automatically sends `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` headers to ensure clients never connect over insecure HTTP.
* **Secure Cookies:** Session identifier cookies are dynamically appended with `; Secure` tags in production to block eavesdropping.
* **Correlated Request Tracing:** Every incoming transaction receives a unique `X-Correlation-Id` header (generated automatically or verified from proxy headers). All pino logs append this ID, allowing developers to trace errors across microservices.
* **Data Sanitization Auditing:** All incoming body/query/params payloads undergo recursive, tag-stripping sanitization to prevent XSS. Sanitization changes are logged to Pino as suspicious events.
* **Centralized Error Boundary:** Any unhandled routing error is routed to the central boundary, masking low-level node stack traces and database schemas from the end user while outputting fully trace-linked error JSON.

---

## 6. Verification & Automated Testing

### Running Tests
Execute unit and integration tests covering password validation, lockouts, database schema migrations, and monitoring builders:
```bash
# Run tests once
npm test

# Run tests and watch for changes
npx vitest

# Generate visual coverage metrics
npm run test:coverage
```
