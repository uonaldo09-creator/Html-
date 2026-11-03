import crypto from "crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import * as schema from "./schema";
import { logger } from "../server/logger";
import { buildPostgresConnectionOptions } from "./postgresConnectionOptions";
import { UserDb, UniversityDb, UniversityReviewDb } from "./types";
import { buildAnalyticsSummary } from "./analytics";
import { BookmarkRecord, toggleInMemoryBookmark } from "./bookmarks";

// ──────────────────────────────────────────────────────────────────────────────
//  Static fallback data — mirrors src/data.ts so in-memory mode behaves like
//  the live seed does once Postgres is reachable.
// ──────────────────────────────────────────────────────────────────────────────
import { universities as staticUniversities } from "../data";
import { staticUsers } from "./staticUsers";
import { staticBookmarks } from "./staticBookmarks";
import { staticReviews } from "./staticReviews";
import { staticNotifications } from "./staticNotifications";
import { getUttarakhandUniversityDirectory } from "../data/uttarakhandUniversities";
import { deduplicateUniversities } from "../lib/utils";

function getPostgresErrorCode(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Re-export compatible callers from the static data modules
// ──────────────────────────────────────────────────────────────────────────────
export {
  staticUsers as staticUsers,
  staticBookmarks as staticBookmarks,
  staticReviews as staticReviews,
  staticNotifications as staticNotifications,
};

export function staticUniversityData() {
  const catalog = deduplicateUniversities([
    ...staticUniversities,
    ...getUttarakhandUniversityDirectory(staticUniversities),
  ]);
  return catalog.map((u) => ({
    id: u.id,
    logo: u.logo || "",
    image: u.image || "",
    name: u.name,
    location: u.location,
    state: u.state,
    type: u.type,
    fee: u.fee,
    rating: u.rating,
    students: u.students,
    courses: u.courses,
    categories: u.categories ?? [],
    stream: u.stream ?? [],
    degrees: u.degrees ?? [],
    majors: u.majors ?? [],
    popularCourses: u.popularCourses ?? [],
    phone: u.phone,
    competitiveExams: u.competitiveExams ?? [],
    min10th: u.min10th,
    min12th: u.min12th,
    naacGrade: u.naacGrade,
    nirfRank: u.nirfRank,
    aicteApproved: u.aicteApproved ?? false,
    nbaAccredited: u.nbaAccredited ?? false,
    nmcRecognized: u.nmcRecognized ?? false,
    avgPlacementLPA: u.avgPlacementLPA,
    website: u.website || "",
    virtualTourUrl: u.virtualTourUrl || "",
    expertInsight: u.expertInsight || "",
    alumniStories: u.alumniStories ?? [],
    campusMap: u.campusMap ?? { acreage: 0, established: 0, hasHostels: false, totalBuildings: 0, zones: [] },
    directoryProfile: u.directoryProfile,
  }));
}

export function logAnalyticsEvent(event: { eventType: string; details?: Record<string, any>; ip?: string; userEmail?: string }) {
  // In-memory fallback: no-op; live path writes to analytics_events + audit_logs.
}
export function cleanupExpiredTokens(retentionDays: number): Promise<number> {
  return Promise.resolve(0);
}
export function cleanupExpiredLoginAttempts(retentionDays: number): Promise<number> {
  return Promise.resolve(0);
}
export function cleanupExpiredSessions(retentionDays: number): Promise<number> {
  return Promise.resolve(0);
}
export function cleanupExpiredNotifications(retentionDays: number): Promise<number> {
  return Promise.resolve(0);
}
export function getPoolDiagnostics(): Promise<{ status: string; totalConnections: number; idleConnections: number; waitingConnections: number }> {
  return Promise.resolve({ status: "in-memory-active", totalConnections: 1, idleConnections: 1, waitingConnections: 0 });
}
export function initialize() {
  // no-op — the class constructor schedules initialization
}
export async function exportPostgresData(): Promise<Record<string, any>> {
  throw new Error("PostgreSQL export is unavailable outside the active database service.");
}
export async function importPostgresData(data: Record<string, any>): Promise<void> {
  void data;
  throw new Error("PostgreSQL restore is unavailable outside the active database service.");
}

// ──────────────────────────────────────────────────────────────────────────────
//  DatabaseService — the single source of truth for all Postgres access.
//
//  Startup sequence:
//    1. read .env for DATABASE_URL / SUPABASE_DB_URL
//    2. attempt to build a pg.Pool + drizzle instance
//    3. on failure fall back to an in-memory datastore seeded with static data
//
//  Pool fault recovery (NEW — 2026-09-05):
//    When the Postgres pooler drops a connection or a DNS resolver blips
//    mid-flight (the recurring Supabase "Connection terminated unexpectedly"
//    / "getaddrinfo" pattern), the idle-client handler tears down the dead
//    pool and CONTINUOUSLY re-establishes it so subsequent queries go to a
//    live pool instead of surfacing fatal unhandled rejections.
//
//  Continuous retry vs single retry:
//    A single try is too brittle when the pooler cycles — it may succeed for
//    a few seconds and fail again 20 seconds later. The recovery loop polls up
//    to MAX_RECOVERY_ATTEMPTS times, sleeping RECOVERY_BACKOFF_BASE (doubled
//    each attempt) between tries. Non-production environments can fall back
//    to in-memory storage; production exits rather than serving stale data.
// ──────────────────────────────────────────────────────────────────────────────

const POOL_RECOVERY_COOLDOWN_MS = 1500;          // don't hammer a freshly-dying pool
const MAX_RECOVERY_ATTEMPTS = 8;                 // cap so we never loop forever
const RECOVERY_BACKOFF_BASE_MS = 800;            // grows 2x each attempt, capped at 30s

export class DatabaseService {
  private pgPool: pg.Pool | null = null;
  private drizzleDb: ReturnType<typeof drizzle<Record<string, unknown>> & typeof schema> | null = null;
  private isPostgres = false;
  private initialization: Promise<void> = Promise.resolve();
  public mockUsers: UserDb[] = [];
  private mockBookmarks: BookmarkRecord[] = [];
  private readonly mockReviews: Record<number, { id: number; userEmail?: string; userName: string; rating: number; comment: string; avatar: string; reviewDate: string }[]> = {};
  private mockUniversitiesStore: UniversityDb[] | null = null;
  private mockStudentProfiles: { email: string; profile: any }[] = [];
  private mockParentProfiles: { email: string; profile: any }[] = [];
  private mockAuditLogs: any[] = [];
  private recoveryAttempts = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (process.env.NODE_ENV === "test") return;

    // Defer database initialization to the next tick of the event loop.
    // This ensures that dotenv.config() in server.ts has run and loaded
    // all environment variables before we attempt to parse database URLs.
    this.initialization = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => this.initialize());
  }

  public async waitUntilReady(): Promise<void> {
    await this.initialization;
  }

  private cleanDatabaseUrl(rawUrl: string): string {
    let url = rawUrl.trim();

    if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1).trim();
    else if (url.startsWith("'") && url.endsWith("'")) url = url.slice(1, -1).trim();

    const prefixes = ["DATABASE_URL=", "SUPABASE_DB_URL="];
    for (const prefix of prefixes) {
      if (url.startsWith(prefix)) url = url.slice(prefix.length).trim();
    }

    if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1).trim();
    else if (url.startsWith("'") && url.endsWith("'")) url = url.slice(1, -1).trim();

    return url;
  }

  private isFatalError(err: any): boolean {
    if (!err) return false;
    const msg = (err.message || "").toLowerCase();
    const code = err.code || "";
    return (
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "28P01" ||
      code === "3D000" ||
      code === "ECONNREFUSED" ||
      msg.includes("enotfound") ||
      msg.includes("tenant/user") ||
      msg.includes("not found") ||
      msg.includes("password authentication failed") ||
      (msg.includes("database") && msg.includes("does not exist")) ||
      (msg.includes("role") && msg.includes("does not exist"))
    );
  }

  private async initialize() {
    let attempts = 0;
    const maxAttempts = 3;
    let delay = 1000;

    while (attempts < maxAttempts) {
      attempts++;
      logger.info(`Database connection attempt ${attempts}/${maxAttempts}...`);

      const result = await this.tryConnect();
      if (result.success) return;

      if (result.fatal) {
        logger.info(
          process.env.NODE_ENV === "production"
            ? "Configured database endpoint is not reachable; production startup will fail."
            : "Configured database endpoint is not reachable. Operating in resilient in-memory storage mode.",
        );
        break;
      }

      if (attempts < maxAttempts) {
        logger.info(`Database connection attempt ${attempts} failed. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    if (process.env.NODE_ENV === "production") {
      throw new Error("PostgreSQL is unavailable in production; refusing to start with in-memory storage.");
    }

    this.isPostgres = false;
    this.drizzleDb = null;
    logger.info("In-memory local datastore active for non-production use.");
  }

  private async tryConnect(): Promise<{ success: boolean; fatal: boolean }> {
    let dbUrlRaw = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    let databaseUrlConnected = false;
    let isFatal = false;

    if (dbUrlRaw && dbUrlRaw !== "undefined" && dbUrlRaw !== "null" && dbUrlRaw.trim() !== "") {
      const dbUrl = this.cleanDatabaseUrl(dbUrlRaw);

      if (dbUrl.includes("[YOUR-PASSWORD]") || dbUrl.includes("YOUR_PASSWORD") || dbUrl.includes("username:password")) {
        logger.info("DATABASE_URL contains placeholder password. Skipping remote database attempt...");
        isFatal = true;
      } else {
        try {
          logger.info("DATABASE_URL detected. Initiating connection pool to PostgreSQL...");
          const connectionOptions = buildPostgresConnectionOptions(dbUrl);
          const pool = new pg.Pool({
            ...connectionOptions,
            max: 10,
            connectionTimeoutMillis: 3000,
            idleTimeoutMillis: 30000,
          });

          pool.on("error", (err) => {
            logger.warn({ error: err.message, code: getPostgresErrorCode(err) }, "Unexpected error on idle PostgreSQL client; triggering pool recovery.");
            this.recoverFromPoolFault(err).catch((recoverErr: any) => {
              /* never block the idle-client handler — even if recovery itself is mid-flight */
            });
          });
          this.pgPool = pool;

          const client = await this.pgPool.connect();
          client.release();

          this.drizzleDb = drizzle(this.pgPool, { schema });
          this.isPostgres = true;
          databaseUrlConnected = true;
          logger.info("PostgreSQL database successfully connected with Drizzle ORM!");

          logger.info("Validating normalized database table structures...");

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password TEXT NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'Student', name VARCHAR(100),
            login_failures INTEGER DEFAULT 0 NOT NULL, locked_until BIGINT DEFAULT 0 NOT NULL,
            created_at TIMESTAMP DEFAULT NOW() NOT NULL, email_verified BOOLEAN DEFAULT FALSE NOT NULL,
            verification_token TEXT, verification_expires TIMESTAMP
          );`);
          await this.pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE NOT NULL;`);
          await this.pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;`);
          await this.pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP;`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS universities (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, state TEXT NOT NULL,
            type TEXT NOT NULL, fee INTEGER NOT NULL, rating DOUBLE PRECISION NOT NULL,
            students TEXT NOT NULL, courses INTEGER NOT NULL, image TEXT NOT NULL,
            logo TEXT, categories JSONB NOT NULL, stream JSONB NOT NULL, degrees JSONB NOT NULL,
            majors JSONB NOT NULL, popular_courses JSONB NOT NULL, phone TEXT NOT NULL,
            competitive_exams JSONB NOT NULL, min_10th INTEGER NOT NULL, min_12th INTEGER NOT NULL,
            naac_grade TEXT NOT NULL, nirf_rank INTEGER NOT NULL, aicte_approved BOOLEAN NOT NULL,
            nba_accredited BOOLEAN NOT NULL, nmc_recognized BOOLEAN NOT NULL, avg_placement_lpa DOUBLE PRECISION NOT NULL,
            website TEXT, virtual_tour_url TEXT, expert_insight TEXT, alumni_stories JSONB,
            campus_map JSONB, created_at TIMESTAMP DEFAULT NOW() NOT NULL
          );`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY, university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
            user_email VARCHAR(255) NOT NULL, user_name VARCHAR(100) NOT NULL DEFAULT 'Student', rating INTEGER NOT NULL, comment TEXT NOT NULL,
            review_date VARCHAR(50) NOT NULL, avatar TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL
          );`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS id SERIAL;`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS university_id INTEGER;`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_email VARCHAR(255) NOT NULL DEFAULT 'unknown@uninfo.com';`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_name VARCHAR(100) NOT NULL DEFAULT 'Student';`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating INTEGER NOT NULL DEFAULT 0;`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS avatar TEXT;`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS review_date VARCHAR(50) NOT NULL DEFAULT '';`);
          await this.pgPool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW() NOT NULL;`);
          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS sessions (
            token VARCHAR(255) PRIMARY KEY, email VARCHAR(255) NOT NULL, expires_at BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW() NOT NULL, last_used_at TIMESTAMP DEFAULT NOW() NOT NULL,
            absolute_expires_at BIGINT NOT NULL
          );`);
          await this.pgPool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW() NOT NULL;`);
          await this.pgPool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP DEFAULT NOW() NOT NULL;`);
          await this.pgPool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at BIGINT;`);
          await this.pgPool.query(`UPDATE sessions SET absolute_expires_at = expires_at WHERE absolute_expires_at IS NULL;`);
          await this.pgPool.query(`ALTER TABLE sessions ALTER COLUMN absolute_expires_at SET NOT NULL;`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS bookmarks (
            id SERIAL PRIMARY KEY, user_email VARCHAR(255) NOT NULL, university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW() NOT NULL
          );`);
          await this.pgPool.query(`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS id SERIAL;`);
          await this.pgPool.query(`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS user_email VARCHAR(255) NOT NULL DEFAULT '';`);
          await this.pgPool.query(`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS university_id INTEGER;`);
          await this.pgPool.query(`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW() NOT NULL;`);
          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY, user_email VARCHAR(255), role VARCHAR(50) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL
          );`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY, user_email VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, message TEXT NOT NULL, type VARCHAR(100) NOT NULL DEFAULT 'announcement', read BOOLEAN DEFAULT FALSE NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL
          );`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS university_reviews_agg (
            university_id INTEGER PRIMARY KEY REFERENCES universities(id) ON DELETE CASCADE, avg_rating DOUBLE PRECISION, review_count INTEGER DEFAULT 0
          );`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS student_profiles (id SERIAL PRIMARY KEY, user_email VARCHAR(255) UNIQUE NOT NULL, stream VARCHAR(100), budget INTEGER, preferred_location VARCHAR(255), preferred_course VARCHAR(255), entrance_exams JSONB, hostel_preference BOOLEAN DEFAULT FALSE NOT NULL, placement_priority VARCHAR(100), academic_scores JSONB, career_goals TEXT, updated_at TIMESTAMP DEFAULT NOW() NOT NULL);`);
          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS parent_profiles (id SERIAL PRIMARY KEY, user_email VARCHAR(255) UNIQUE NOT NULL, budget INTEGER, preferred_state_city VARCHAR(255), safety_preference VARCHAR(100), roi_preference VARCHAR(100), scholarship_preference VARCHAR(100), distance_preference VARCHAR(100), accommodation_preference VARCHAR(100), updated_at TIMESTAMP DEFAULT NOW() NOT NULL);`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY, action VARCHAR(100) NOT NULL, details JSONB DEFAULT '{}' NOT NULL, user_email VARCHAR(255), ip VARCHAR(100), status VARCHAR(50), correlation_id VARCHAR(255), created_at TIMESTAMP DEFAULT NOW() NOT NULL
          );`);

          await this.pgPool.query(`CREATE TABLE IF NOT EXISTS login_attempts (
            id SERIAL PRIMARY KEY, ip VARCHAR(100) NOT NULL, email VARCHAR(255), success BOOLEAN NOT NULL, attempt_time TIMESTAMP DEFAULT NOW() NOT NULL
          );`);

          logger.info("All table structure checks and indexing verified successfully.");

          const universityData = staticUniversityData();
          await this.pgPool.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS virtual_tour_url TEXT;`);
          await this.pgPool.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS expert_insight TEXT;`);
          await this.pgPool.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS alumni_stories JSONB;`);
          await this.pgPool.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS campus_map JSONB;`);
          await this.pgPool.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS directory_profile JSONB;`);

          for (const university of universityData) {
            await this.pgPool.query(`INSERT INTO universities (id, name, location, state, type, fee, rating, students, courses, image, logo,
              categories, stream, degrees, majors, popular_courses, phone, competitive_exams,
              min_10th, min_12th, naac_grade, nirf_rank, aicte_approved, nba_accredited, nmc_recognized,
              avg_placement_lpa, website, virtual_tour_url, expert_insight, alumni_stories, campus_map, directory_profile, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18::jsonb,
              $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30::jsonb, $31::jsonb, $32::jsonb, NOW())
              ON CONFLICT (id) DO UPDATE SET
                image = EXCLUDED.image,
                directory_profile = COALESCE(universities.directory_profile, EXCLUDED.directory_profile);`,
              [
                university.id, university.name, university.location, university.state,
                university.type, university.fee, university.rating, university.students, university.courses,
                university.image, university.logo || "", JSON.stringify(university.categories ?? []),
                JSON.stringify(university.stream ?? []), JSON.stringify(university.degrees ?? []),
                JSON.stringify(university.majors ?? []), JSON.stringify(university.popularCourses ?? []),
                university.phone, JSON.stringify(university.competitiveExams ?? []),
                university.min10th, university.min12th, university.naacGrade,
                university.nirfRank, university.aicteApproved, university.nbaAccredited,
                university.nmcRecognized, university.avgPlacementLPA,
                university.website, university.virtualTourUrl, university.expertInsight,
                JSON.stringify(university.alumniStories ?? []),
                JSON.stringify(university.campusMap ?? { hasHostels: true, library: true, labs: true, sportsComplex: true }),
                JSON.stringify(university.directoryProfile ?? null),
              ],
            );
          }

          logger.info(`PostgreSQL normalized users, universities, and bookmarks verified successfully.`);

          const seedDemoData = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
          if (seedDemoData) {
            for (const user of staticUsers) {
              await this.pgPool.query(`INSERT INTO users (id, email, password, role, name, login_failures, locked_until, created_at, email_verified, verification_token, verification_expires, auth_subject)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;`,
                [user.id, user.email, user.password, user.role, user.name, user.loginFailures, user.lockedUntil, user.createdAt, user.emailVerified, user.verificationToken, user.verificationExpires, crypto.randomUUID()],
              );
            }

            for (const bookmark of staticBookmarks) {
              await this.pgPool.query(`INSERT INTO bookmarks (id, user_email, university_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING;`,
                [bookmark.id, bookmark.userEmail, bookmark.universityId, bookmark.createdAt],
              );
            }

            for (const review of staticReviews) {
              await this.pgPool.query(`INSERT INTO reviews (id, university_id, user_email, user_name, rating, comment, review_date, avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING;`,
                [review.id, review.universityId, review.userEmail, review.userName, review.rating, review.comment, review.reviewDate, review.avatar],
              );
            }

            for (const notification of staticNotifications) {
              const notificationType = notification.type || "announcement";
              await this.pgPool.query(`INSERT INTO notifications (id, user_email, title, message, type, read, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING;`,
                [notification.id, notification.email, notification.title, notification.message, notificationType, notification.isRead, notification.created_at],
              );
            }

            logger.info("Successfully seeded development sample data into normalized tables.");
            this.mockUsers = staticUsers.map((user) => ({ ...user, authSubject: crypto.randomUUID(), tokenVersion: 0, disabled: false }));
            this.mockBookmarks = staticBookmarks.map(({ userEmail, universityId, createdAt }) => ({
              userEmail,
              universityId,
              createdAt,
            }));
            for (const rev of staticReviews) {
              if (!this.mockReviews[rev.universityId]) this.mockReviews[rev.universityId] = [];
              this.mockReviews[rev.universityId].push(rev);
            }
          } else {
            this.mockUsers = [];
            this.mockBookmarks = [];
          }
          return { success: true, fatal: false };
        } catch (err: any) {
          // NOTE: previously `isFatal = isFatal && this.isFatalError(err)` — since isFatal
          // starts false in this branch, that expression was always false regardless of
          // the actual error, so fatal DB errors (bad password, missing DB) were retried
          // 3 times instead of failing fast. Fixed to reflect the real error.
          isFatal = this.isFatalError(err);
          logger.info({ error: err.message }, "Cloud SQL connection could not be established.");
          this.isPostgres = false;
          if (this.pgPool) {
            try { await this.pgPool.end(); } catch (e) {}
            this.pgPool = null;
          }
        }
      }
    }

    return { success: false, fatal: isFatal };
  }

  /**
   * When the Postgres pooler drops a connection or a DNS resolver blips
   * mid-flight (the recurring Supabase "Connection terminated unexpectedly"
   * / "getaddrinfo" pattern), this tears down the dead pool and RE-CREATES it
   * so subsequent queries go to a live pool instead of surfacing fatal
   * unhandled rejections.
   *
   * Idempotent and fire-and-forget: the idle-client handler invokes it without
   * awaiting, so a fault never blocks request handlers or other concurrent
   * queries.
   */
  public async recoverFromPoolFault(err: Error & { code?: string; message?: string }): Promise<void> {
    const msg = (err.message || "" as string).toLowerCase();
    const code = (err.code || "" as string);
    const isPoolFault =
      /connection terminated|terminating connection|could not serialize access|ssl error|connection reset/i.test(msg) ||
      /ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/i.test(code) ||
      code === "08006" ||
      code === "57P01" || code === "57P03";

    if (!isPoolFault) return;

    logger.warn({ code, msg: msg.slice(0, 200), err: err }, "Postgres pool fault detected.");

    if (process.env.NODE_ENV === "production") {
      logger.error("PostgreSQL became unavailable in production; exiting instead of using in-memory storage.");
      process.exit(1);
    }

    logger.info("Attempting PostgreSQL pool recovery.");

    if (this.recoveryTimer) return;

    try {
      if (this.pgPool) {
        await this.pgPool.end().catch(() => {});
        this.pgPool = null;
      }
      this.isPostgres = false;
      this.drizzleDb = null;

      this.recoveryAttempts = 0;
      let recovered = false;
      let backoff = RECOVERY_BACKOFF_BASE_MS;

      while (this.recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
        this.recoveryAttempts++;
        logger.info({ attempt: this.recoveryAttempts, max: MAX_RECOVERY_ATTEMPTS, backoff }, "Attempting post-fault pool re-establishment.");

        const result = await this.tryConnect();
        if (result.success) {
          recovered = true;
          logger.info({ }, "Postgres pool recovered from fault.");
          break;
        }

        if (result.fatal) {
          logger.warn({ fatal: result.fatal }, "Postgres pool recovery failed (fatal); remaining in fallback mode.");
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 30000);
      }

      if (!recovered) {
        logger.warn({ attempts: this.recoveryAttempts, max: MAX_RECOVERY_ATTEMPTS }, "Postgres pool recovery exhausted; remaining in fallback mode.");
      }
    } catch (recoverErr: any) {
      logger.warn({ error: recoverErr.message }, "Postgres pool recovery attempt threw; staying in fallback mode.");
    } finally {
      this.recoveryTimer = null;
    }
  }

  public async shutdown(): Promise<void> {
    logger.info("Closing database connection pool...");
    if (this.pgPool) {
      try {
        await this.pgPool.end();
        logger.info("Database connection pool closed cleanly.");
      } catch (err: any) {
        logger.error({ error: err.message }, "Error closing database connection pool.");
      }
      this.pgPool = null;
    }
    this.isPostgres = false;
    this.drizzleDb = null;
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  PUBLIC DIAGNOSTICS HELPERS
  // ──────────────────────────────────────────────────────────────────────────────
  public isUsingPostgres(): boolean {
    return this.isPostgres;
  }

  public getPoolDiagnostics() {
    if (!this.pgPool) {
      return {
        status: this.isPostgres ? "offline" : "in-memory-active",
        totalConnections: this.isPostgres ? 0 : 1,
        idleConnections: this.isPostgres ? 0 : 1,
        waitingConnections: 0,
      };
    }
    return {
      status: "online",
      totalConnections: this.pgPool.totalCount || 0,
      idleConnections: this.pgPool.idleCount || 0,
      waitingConnections: this.pgPool.waitingCount || 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  USERS OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────────
  public async getUserByEmail(email: string): Promise<UserDb | null> {
    if (!this.isPostgres || !this.drizzleDb) {
      const u = this.mockUsers.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (u) {
        const bookmarksList = this.mockBookmarks.filter((b) => b.userEmail.toLowerCase() === email.toLowerCase()).map((b) => b.universityId);
        return { ...u, bookmarks: bookmarksList };
      }
      return null;
    }
    try {
      const usersList = await this.drizzleDb.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (usersList.length > 0) {
        const u = usersList[0];
        const bookmarksList = await this.drizzleDb.select({ universityId: schema.bookmarks.universityId })
          .from(schema.bookmarks)
          .where(eq(schema.bookmarks.userEmail, email));

        return {
          id: u.id,
          email: u.email,
          password: u.password,
          role: u.role,
          name: u.name,
          bookmarks: bookmarksList.map((b: any) => b.universityId),
          loginFailures: u.loginFailures,
          lockedUntil: u.lockedUntil,
          createdAt: u.createdAt.toISOString(),
          emailVerified: u.emailVerified,
          verificationToken: u.verificationToken,
          verificationExpires: u.verificationExpires ? u.verificationExpires.toISOString() : null,
          authSubject: u.authSubject,
          tokenVersion: u.tokenVersion,
          disabled: u.disabled,
        };
      }
      return null;
    } catch (err: any) {
      logger.error({
        error: err.message,
        databaseError: err.cause?.message || err.cause,
        databaseErrorCode: err.cause?.code,
        databaseTable: err.cause?.table,
        databaseColumn: err.cause?.column,
      }, "getUserByEmail PG Error");
      throw err;
    }
  }

  public async createUser(userData: Partial<UserDb>): Promise<UserDb> {
    if (!this.isPostgres || !this.drizzleDb) {
      const email = userData.email!;
      const existing = this.mockUsers.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (existing) throw new Error("User already exists.");

      const newUser: UserDb = {
        id: this.mockUsers.length + 1,
        email,
        password: userData.password || "",
        role: userData.role || "Student",
        name: userData.name || null,
        bookmarks: [],
        loginFailures: 0,
        lockedUntil: 0,
        createdAt: new Date().toISOString(),
        emailVerified: userData.emailVerified || false,
        verificationToken: userData.verificationToken || null,
        verificationExpires: userData.verificationExpires ? new Date(userData.verificationExpires) : null,
        // Generated exactly once, here, and persisted for the life of the account.
        authSubject: crypto.randomUUID(),
        tokenVersion: 0,
        disabled: false,
      };
      this.mockUsers.push(newUser);
      return newUser;
    }
    try {
      const [inserted] = await this.drizzleDb.insert(schema.users)
        .values({
          email: userData.email!,
          password: userData.password!,
          role: userData.role || "Student",
          name: userData.name || null,
          loginFailures: 0,
          lockedUntil: 0,
          createdAt: new Date(),
          emailVerified: userData.emailVerified || false,
          verificationToken: userData.verificationToken || null,
          verificationExpires: userData.verificationExpires ? new Date(userData.verificationExpires) : null,
          // Single authoritative subject, generated once at registration.
          authSubject: crypto.randomUUID(),
          tokenVersion: 0,
          disabled: false,
        })
        .returning();
      return inserted;
    } catch (err: any) {
      logger.error({ error: err.message }, "createUser PG Error");
      throw err;
    }
  }

  public async verifyEmail(email: string): Promise<boolean> {
    if (!this.isPostgres || !this.drizzleDb) {
      const u = this.mockUsers.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (u) {
        u.emailVerified = true;
        return true;
      }
      return false;
    }
    try {
      await this.drizzleDb.update(schema.users)
        .set({ emailVerified: true })
        .where(eq(schema.users.email, email));
      return true;
    } catch (err: any) {
      logger.error({ error: err.message }, "verifyEmail PG Error");
      throw err;
    }
  }

  public async getUserByVerificationToken(token: string): Promise<UserDb | null> {
    if (!this.isPostgres || !this.drizzleDb) {
      return this.mockUsers.find((u) => u.verificationToken?.toLowerCase() === token.toLowerCase()) || null;
    }
    try {
      const usersList = await this.drizzleDb.select().from(schema.users).where(eq(schema.users.verificationToken, token)).limit(1);
      if (usersList.length > 0) {
        const u = usersList[0];
        const bookmarksList = await this.drizzleDb.select({ universityId: schema.bookmarks.universityId })
          .from(schema.bookmarks)
          .where(eq(schema.bookmarks.userEmail, u.email));
        return {
          id: u.id,
          email: u.email,
          password: u.password,
          role: u.role,
          name: u.name,
          bookmarks: bookmarksList.map((b: any) => b.universityId),
          loginFailures: u.loginFailures,
          lockedUntil: u.lockedUntil,
          createdAt: u.createdAt.toISOString(),
          emailVerified: u.emailVerified,
          verificationToken: u.verificationToken,
          verificationExpires: u.verificationExpires ? u.verificationExpires.toISOString() : null,
          authSubject: u.authSubject,
          tokenVersion: u.tokenVersion,
          disabled: u.disabled,
        };
      }
      return null;
    } catch (err: any) {
      logger.error({ error: err.message }, "getUserByVerificationToken PG Error");
      throw err;
    }
  }

  public async updateUserVerificationToken(email: string, token: string | null, expires: string | null): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      const u = this.mockUsers.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (u) {
        u.verificationToken = token;
        u.verificationExpires = expires ? new Date(expires) : null;
      }
      return;
    }
    try {
      await this.drizzleDb.update(schema.users)
        .set({ verificationToken: token, verificationExpires: expires ? new Date(expires) : null })
        .where(eq(schema.users.email, email));
    } catch (err: any) {
      logger.error({ error: err.message }, "updateUserVerificationToken PG Error");
      throw err;
    }
  }

  public async updateUserLockout(email: string, failures: number, lockedUntil: number): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      const u = this.mockUsers.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (u) {
        u.loginFailures = failures;
        u.lockedUntil = lockedUntil;
      }
      return;
    }
    try {
      await this.drizzleDb.update(schema.users)
        .set({ loginFailures: failures, lockedUntil })
        .where(eq(schema.users.email, email));
    } catch (err: any) {
      logger.error({ error: err.message }, "updateUserLockout PG Error");
      throw err;
    }
  }

  public async recordLoginAttempt(ip: string, email: string, success: boolean): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) return;
    try {
      await this.drizzleDb.insert(schema.loginAttempts).values({
        ip,
        email,
        success,
        attemptTime: new Date(),
      }).onConflictDoNothing();
    } catch (err: any) {
      logger.warn({ error: err.message }, "recordLoginAttempt PG Error");
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  UNIVERSITIES OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────────
  public async getUniversities(query?: { search?: string }): Promise<UniversityDb[]> {
    if (!this.isPostgres || !this.drizzleDb) {
      let list = staticUniversityData();
      if (query?.search) {
        const q = query.search.toLowerCase();
        list = list.filter((u) =>
          u.name.toLowerCase().includes(q) ||
          u.location.toLowerCase().includes(q) ||
          u.directoryProfile?.courses.toLowerCase().includes(q) ||
          u.directoryProfile?.sourceName.toLowerCase().includes(q),
        );
      }
      return list.map((u) => ({
        id: u.id,
        logo: u.logo || "",
        image: u.image || "",
        name: u.name,
        location: u.location,
        state: u.state,
        type: u.type,
        fee: u.fee,
        rating: u.rating,
        students: u.students,
        courses: u.courses,
        categories: u.categories,
        stream: u.stream,
        degrees: u.degrees,
        majors: u.majors,
        popularCourses: u.popularCourses,
        phone: u.phone,
        competitiveExams: u.competitiveExams,
        min10th: u.min10th,
        min12th: u.min12th,
        naacGrade: u.naacGrade,
        nirfRank: u.nirfRank,
        aicteApproved: u.aicteApproved,
        nbaAccredited: u.nbaAccredited,
        nmcRecognized: u.nmcRecognized,
        avgPlacementLPA: u.avgPlacementLPA,
        website: u.website || "",
        virtualTourUrl: u.virtualTourUrl || "",
        expertInsight: u.expertInsight || "",
        alumniStories: u.alumniStories,
        campusMap: u.campusMap,
        directoryProfile: u.directoryProfile,
        reviews: this.mockReviews[u.id]?.map((r) => ({
          id: r.id,
          userName: r.userName,
          rating: r.rating,
          comment: r.comment,
          avatar: r.avatar,
          reviewDate: r.reviewDate,
        })) || [],
        reviewCount: (this.mockReviews[u.id]?.length || 0),
        averageReview: (this.mockReviews[u.id]?.length
          ? this.mockReviews[u.id].reduce((s, r) => s + r.rating, 0) / this.mockReviews[u.id].length
          : 0),
      }));
    }
    try {
      let base = await this.drizzleDb.select().from(schema.universities);
      if (query?.search) {
        const q = query.search.toLowerCase();
        base = base.filter((u) =>
          u.name.toLowerCase().includes(q) ||
          u.location.toLowerCase().includes(q) ||
          (typeof u.directoryProfile === "object" && u.directoryProfile !== null &&
            "courses" in u.directoryProfile && typeof u.directoryProfile.courses === "string" &&
            u.directoryProfile.courses.toLowerCase().includes(q)) ||
          (typeof u.directoryProfile === "object" && u.directoryProfile !== null &&
            "sourceName" in u.directoryProfile && typeof u.directoryProfile.sourceName === "string" &&
            u.directoryProfile.sourceName.toLowerCase().includes(q)),
        );
      }
      const allReviews = base.length > 0
        ? await this.drizzleDb.select().from(schema.reviews)
          .where(inArray(schema.reviews.universityId, base.map((university) => university.id)))
        : [];
      const reviewsByUniversity = new Map<number, typeof allReviews>();
      for (const review of allReviews) {
        const universityReviews = reviewsByUniversity.get(review.universityId) ?? [];
        universityReviews.push(review);
        reviewsByUniversity.set(review.universityId, universityReviews);
      }
      const universitiesList = base.map((u) => {
        const reviewsList = reviewsByUniversity.get(u.id) ?? [];
        const count = reviewsList.length;
        return {
          ...u,
          reviews: reviewsList.map((r) => ({
            id: r.id,
            userName: r.userName,
            rating: r.rating,
            comment: r.comment,
            avatar: r.avatar,
            reviewDate: r.reviewDate,
          })),
          reviewCount: count,
          averageReview: count
            ? reviewsList.reduce((s, r) => s + (r.rating ?? 0), 0) / count
            : 0,
          categories: u.categories as string[],
          stream: u.stream as string[],
          degrees: u.degrees as string[],
          majors: u.majors as string[],
          popularCourses: u.popularCourses as string[],
          competitiveExams: u.competitiveExams as string[],
          campusMap: u.campusMap as any,
          alumniStories: u.alumniStories as any[],
          directoryProfile: u.directoryProfile as UniversityDb["directoryProfile"],
        };
      });
      return deduplicateUniversities(universitiesList);
    } catch (err: any) {
      logger.error({
        error: err.message,
        databaseError: err.cause?.message || err.cause,
        databaseErrorCode: err.cause?.code,
        databaseTable: err.cause?.table,
        databaseColumn: err.cause?.column,
      }, "getUniversities PG Error");
      throw err;
    }
  }

  public async getUniversityById(id: number): Promise<UniversityDb | null> {
    if (!this.isPostgres || !this.drizzleDb) {
      const u = staticUniversityData().find((x) => x.id === id);
      if (!u) return null;
      return {
        id: u.id,
        logo: u.logo || "",
        image: u.image || "",
        name: u.name,
        location: u.location,
        state: u.state,
        type: u.type,
        fee: u.fee,
        rating: u.rating,
        students: u.students,
        courses: u.courses,
        categories: u.categories,
        stream: u.stream,
        degrees: u.degrees,
        majors: u.majors,
        popularCourses: u.popularCourses,
        phone: u.phone,
        competitiveExams: u.competitiveExams,
        min10th: u.min10th,
        min12th: u.min12th,
        naacGrade: u.naacGrade,
        nirfRank: u.nirfRank,
        aicteApproved: u.aicteApproved,
        nbaAccredited: u.nbaAccredited,
        nmcRecognized: u.nmcRecognized,
        avgPlacementLPA: u.avgPlacementLPA,
        website: u.website || "",
        virtualTourUrl: u.virtualTourUrl || "",
        expertInsight: u.expertInsight || "",
        alumniStories: u.alumniStories,
        campusMap: u.campusMap,
        directoryProfile: u.directoryProfile,
        reviews: this.mockReviews[id]?.map((r) => ({
          id: r.id,
          userName: r.userName,
          rating: r.rating,
          comment: r.comment,
          avatar: r.avatar,
          reviewDate: r.reviewDate,
        })) || [],
        reviewCount: (this.mockReviews[id]?.length || 0),
        averageReview: (this.mockReviews[id]?.length
          ? this.mockReviews[id].reduce((s, r) => s + r.rating, 0) / this.mockReviews[id].length
          : 0),
      };
    }
    try {
      const res = await this.drizzleDb.select().from(schema.universities).where(eq(schema.universities.id, id)).limit(1);
      if (res.length > 0) {
        const u = res[0];
        const reviewsList = await this.drizzleDb.select().from(schema.reviews).where(eq(schema.reviews.universityId, id));
        const reviewCount = await this.drizzleDb.select({ count: sql<number>`count(*)` }).from(schema.reviews).where(eq(schema.reviews.universityId, id));
        return {
          ...u,
          reviews: reviewsList.map((r) => ({
            id: r.id,
            userName: r.userName,
            rating: r.rating,
            comment: r.comment,
            avatar: r.avatar,
            reviewDate: r.reviewDate,
          })),
          reviewCount: reviewCount[0]?.count ?? 0,
          averageReview: reviewCount[0]?.count
            ? reviewsList.reduce((s, r) => s + r.rating, 0) / reviewCount[0].count
            : 0,
          categories: u.categories as string[],
          stream: u.stream as string[],
          degrees: u.degrees as string[],
          majors: u.majors as string[],
          popularCourses: u.popularCourses as string[],
          competitiveExams: u.competitiveExams as string[],
          campusMap: u.campusMap as any,
          alumniStories: u.alumniStories as any[],
          directoryProfile: u.directoryProfile as UniversityDb["directoryProfile"],
        };
      }
      return null;
    } catch (err: any) {
      logger.error({ error: err.message }, "getUniversityById PG Error");
      throw err;
    }
  }

  public async upsertUniversity(university: UniversityDb): Promise<UniversityDb> {
    if (!this.isPostgres || !this.drizzleDb) {
      const existing = this.mockUniversities.find((x) => x.id === university.id);
      if (existing) Object.assign(existing, university);
      else this.mockUniversities.push(university);
      return university;
    }
    try {
      const [upserted] = await this.drizzleDb.insert(schema.universities)
        .values({
          id: university.id,
          name: university.name,
          location: university.location,
          state: university.state,
          type: university.type,
          fee: university.fee,
          rating: university.rating,
          students: university.students,
          courses: university.courses,
          image: university.image,
          logo: university.logo || "",
          categories: university.categories as any,
          stream: university.stream as any,
          degrees: university.degrees as any,
          majors: university.majors as any,
          popularCourses: university.popularCourses as any,
          phone: university.phone,
          competitiveExams: university.competitiveExams as any,
          min10th: university.min10th,
          min12th: university.min12th,
          naacGrade: university.naacGrade,
          nirfRank: university.nirfRank,
          aicteApproved: university.aicteApproved,
          nbaAccredited: university.nbaAccredited,
          nmcRecognized: university.nmcRecognized,
          avgPlacementLPA: university.avgPlacementLPA,
          website: university.website || "",
          virtualTourUrl: university.virtualTourUrl || "",
          expertInsight: university.expertInsight || "",
          alumniStories: university.alumniStories as any,
          campusMap: university.campusMap as any,
          directoryProfile: university.directoryProfile ?? null,
        })
        .onConflictDoUpdate({
          target: schema.universities.id,
          set: {
            name: university.name,
            location: university.location,
            state: university.state,
            type: university.type,
            fee: university.fee,
            rating: university.rating,
            students: university.students,
            courses: university.courses,
            image: university.image,
            logo: university.logo || "",
            categories: university.categories as any,
            stream: university.stream as any,
            degrees: university.degrees as any,
            majors: university.majors as any,
            popularCourses: university.popularCourses as any,
            phone: university.phone,
            competitiveExams: university.competitiveExams as any,
            min10th: university.min10th,
            min12th: university.min12th,
            naacGrade: university.naacGrade,
            nirfRank: university.nirfRank,
            aicteApproved: university.aicteApproved,
            nbaAccredited: university.nbaAccredited,
            nmcRecognized: university.nmcRecognized,
            avgPlacementLPA: university.avgPlacementLPA,
            website: university.website || "",
            virtualTourUrl: university.virtualTourUrl || "",
            expertInsight: university.expertInsight || "",
            alumniStories: university.alumniStories as any,
            campusMap: university.campusMap as any,
            directoryProfile: university.directoryProfile ?? null,
          },
        })
        .returning();
      return {
        ...upserted,
        categories: university.categories,
        stream: university.stream,
        degrees: university.degrees,
        majors: university.majors,
        popularCourses: university.popularCourses,
        competitiveExams: university.competitiveExams,
        alumniStories: university.alumniStories,
        campusMap: university.campusMap,
        directoryProfile: university.directoryProfile,
      };
    } catch (err: any) {
      logger.error({ error: err.message }, "upsertUniversity PG Error");
      throw err;
    }
  }

  public async deleteUniversity(id: number): Promise<boolean> {
    if (!this.isPostgres || !this.drizzleDb) {
      const idx = this.mockUniversities.findIndex((u) => u.id === id);
      if (idx >= 0) {
        this.mockUniversities.splice(idx, 1);
        return true;
      }
      return false;
    }
    try {
      await this.drizzleDb.delete(schema.universities).where(eq(schema.universities.id, id));
      return true;
    } catch (err: any) {
      logger.error({ error: err.message }, "deleteUniversity PG Error");
      throw err;
    }
  }

  public async getAllUniversities(): Promise<UniversityDb[]> {
    return this.getUniversities();
  }

  public async searchUniversities(query: string): Promise<UniversityDb[]> {
    return this.getUniversities({ search: query });
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  REVIEW OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────────
  public async addReview(
    universityId: number,
    review: {
      user: string;
      userEmail: string;
      rating: number;
      comment: string;
      date: string;
      avatar: string;
    },
  ): Promise<{ id: number; rating: number }> {
    const normalizedEmail = String(review.userEmail ?? "").trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error("A verified reviewer email is required to submit a university review.");
    }

    if (!this.isPostgres || !this.drizzleDb) {
      if (!this.mockReviews[universityId]) this.mockReviews[universityId] = [];

      const reviews = this.mockReviews[universityId];
      const existing = reviews.find(
        (item) => (item.userEmail ?? "").trim().toLowerCase() === normalizedEmail,
      );

      let savedReview = existing;
      if (savedReview) {
        savedReview.userName = review.user;
        savedReview.rating = review.rating;
        savedReview.comment = review.comment;
        savedReview.avatar = review.avatar;
        savedReview.reviewDate = review.date;
      } else {
        const nextId = Object.values(this.mockReviews)
          .flat()
          .reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1;
        savedReview = {
          id: nextId,
          userEmail: normalizedEmail,
          userName: review.user,
          rating: review.rating,
          comment: review.comment,
          avatar: review.avatar,
          reviewDate: review.date,
        };
        reviews.push(savedReview);
      }

      const average = reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length;
      return {
        id: savedReview.id,
        rating: Math.round(average * 100) / 100,
      };
    }

    try {
      const result = await this.drizzleDb.transaction(async (tx) => {
        // Serialize submissions for this university/reviewer pair. This keeps
        // concurrent requests from inserting duplicate logical reviews without
        // requiring a unique index over the existing historical data.
        const lockKey = `${universityId}:${normalizedEmail}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

        // Preserve historical duplicate rows. Update only the oldest matching
        // row so a repeat submission does not create another duplicate.
        const existing = await tx
          .select({ id: schema.reviews.id })
          .from(schema.reviews)
          .where(and(
            eq(schema.reviews.universityId, universityId),
            sql`LOWER(BTRIM(${schema.reviews.userEmail})) = ${normalizedEmail}`,
          ))
          .orderBy(schema.reviews.id)
          .limit(1);

        let savedReview: { id: number } | undefined;
        if (existing.length > 0) {
          [savedReview] = await tx
            .update(schema.reviews)
            .set({
              userEmail: normalizedEmail,
              userName: review.user,
              rating: review.rating,
              comment: review.comment,
              reviewDate: review.date,
              avatar: review.avatar,
            })
            .where(eq(schema.reviews.id, existing[0].id))
            .returning({ id: schema.reviews.id });
        } else {
          [savedReview] = await tx
            .insert(schema.reviews)
            .values({
              universityId,
              userEmail: normalizedEmail,
              userName: review.user,
              rating: review.rating,
              comment: review.comment,
              reviewDate: review.date,
              avatar: review.avatar,
            })
            .returning({ id: schema.reviews.id });
        }

        if (!savedReview) {
          throw new Error("The review save did not return a database ID.");
        }

        const [aggregate] = await tx
          .select({
            count: sql<number>`count(*)`,
            average: sql<number>`avg(${schema.reviews.rating})`,
          })
          .from(schema.reviews)
          .where(eq(schema.reviews.universityId, universityId));

        const average = Number(aggregate?.average ?? 0);
        const count = Number(aggregate?.count ?? 0);
        const roundedAverage = Math.round(average * 100) / 100;

        await tx
          .insert(schema.universityReviewsAgg)
          .values({
            universityId,
            avgRating: roundedAverage,
            reviewCount: count,
          })
          .onConflictDoUpdate({
            target: schema.universityReviewsAgg.universityId,
            set: {
              avgRating: roundedAverage,
              reviewCount: count,
            },
          });

        return { id: savedReview.id, rating: roundedAverage };
      });

      return result;
    } catch (err: any) {
      logger.error({ error: err.message, universityId }, "addReview PG Error");
      throw err;
    }
  }

  public async getAllReviews(): Promise<any[]> {
    if (!this.isPostgres || !this.drizzleDb) {
      return Object.values(this.mockReviews).flat();
    }
    try {
      return await this.drizzleDb.select().from(schema.reviews).orderBy(sql`${schema.reviews.reviewDate} desc`);
    } catch (err: any) {
      logger.error({ error: err.message }, "getAllReviews PG Error");
      throw err;
    }
  }

  public async deleteReview(id: number): Promise<boolean> {
    if (!this.isPostgres || !this.drizzleDb) {
      for (const revs of Object.values(this.mockReviews)) {
        const idx = revs.findIndex((r) => r.id === id);
        if (idx >= 0) {
          revs.splice(idx, 1);
          return true;
        }
      }
      return false;
    }
    try {
      await this.drizzleDb.delete(schema.reviews).where(eq(schema.reviews.id, id));
      return true;
    } catch (err: any) {
      logger.error({ error: err.message }, "deleteReview PG Error");
      throw err;
    }
  }

  public async getAllUniversityReviews(universityId: number): Promise<any[]> {
    if (!this.isPostgres || !this.drizzleDb) {
      return this.mockReviews[universityId] || [];
    }
    try {
      return await this.drizzleDb.select().from(schema.reviews).where(eq(schema.reviews.universityId, universityId)).orderBy(sql`${schema.reviews.reviewDate} desc`);
    } catch (err: any) {
      logger.error({ error: err.message }, "getAllUniversityReviews PG Error");
      throw err;
    }
  }

  public async getUniversityReviewsForUniversities(
    universityIds: number[],
  ): Promise<Record<number, UniversityReviewDb[]>> {
    const ids = [...new Set(universityIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
    const grouped: Record<number, UniversityReviewDb[]> = Object.create(null);

    for (const id of ids) grouped[id] = [];
    if (ids.length === 0) return grouped;

    if (!this.isPostgres || !this.drizzleDb) {
      for (const id of ids) {
        grouped[id] = (this.mockReviews[id] ?? [])
          .map((review) => ({
            id: review.id,
            userName: review.userName,
            rating: review.rating,
            comment: review.comment,
            avatar: review.avatar,
            reviewDate: review.reviewDate,
          }))
          .sort((a, b) => b.reviewDate.localeCompare(a.reviewDate) || b.id - a.id);
      }
      return grouped;
    }

    try {
      const rows = await this.drizzleDb
        .select({
          universityId: schema.reviews.universityId,
          id: schema.reviews.id,
          userName: schema.reviews.userName,
          rating: schema.reviews.rating,
          comment: schema.reviews.comment,
          avatar: schema.reviews.avatar,
          reviewDate: schema.reviews.reviewDate,
        })
        .from(schema.reviews)
        .where(inArray(schema.reviews.universityId, ids))
        .orderBy(sql`${schema.reviews.reviewDate} DESC`, sql`${schema.reviews.id} DESC`);

      for (const row of rows) {
        grouped[row.universityId].push({
          id: row.id,
          userName: row.userName,
          rating: row.rating,
          comment: row.comment,
          avatar: row.avatar,
          reviewDate: row.reviewDate,
        });
      }

      return grouped;
    } catch (err: any) {
      logger.error({ error: err.message }, "getUniversityReviewsForUniversities PG Error");
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  BOOKMARK OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────────
  public async toggleBookmark(email: string, universityId: number): Promise<{ added: boolean; action: "added" | "removed"; bookmarks: number[] }> {
    if (!this.isPostgres || !this.drizzleDb) {
      const toggle = toggleInMemoryBookmark(this.mockBookmarks, email, universityId);
      this.mockBookmarks = toggle.nextBookmarks;
      return toggle.result;
    }
    try {
      // NOTE: previously this deleted ALL of the user's bookmarks (any university) AND
      // separately ALL bookmarks for this university (any user) on removal — far too broad.
      // Scoped to the exact (email, universityId) pair with `and(...)`.
      const existing = await this.drizzleDb.select().from(schema.bookmarks)
        .where(and(eq(schema.bookmarks.userEmail, email), eq(schema.bookmarks.universityId, universityId)));
      const alreadyBookmarked = existing.length > 0;
      if (alreadyBookmarked) {
        await this.drizzleDb.delete(schema.bookmarks)
          .where(and(eq(schema.bookmarks.userEmail, email), eq(schema.bookmarks.universityId, universityId)));
      } else {
        await this.drizzleDb.insert(schema.bookmarks).values({ userEmail: email, universityId });
      }
      const bookmarks = await this.drizzleDb.select({ universityId: schema.bookmarks.universityId }).from(schema.bookmarks).where(eq(schema.bookmarks.userEmail, email));
      return {
        added: !alreadyBookmarked,
        action: alreadyBookmarked ? "removed" : "added",
        bookmarks: bookmarks.map((b) => b.universityId),
      };
    } catch (err: any) {
      logger.error({ error: err.message }, "toggleBookmark PG Error");
      throw err;
    }
  }

  public async getBookmarks(email: string): Promise<number[]> {
    if (!this.isPostgres || !this.drizzleDb) {
      return this.mockBookmarks.filter((b) => b.userEmail.toLowerCase() === email.toLowerCase()).map((b) => b.universityId);
    }
    try {
      const bookmarks = await this.drizzleDb.select({ universityId: schema.bookmarks.universityId }).from(schema.bookmarks).where(eq(schema.bookmarks.userEmail, email));
      return bookmarks.map((b: any) => b.universityId);
    } catch (err: any) {
      logger.error({ error: err.message }, "getBookmarks PG Error");
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  SESSIONS OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────────
  public async getSession(token: string, now = Date.now()): Promise<{ email: string; expiresAt: number } | null> {
    if (!this.isPostgres || !this.drizzleDb) {
      const session = this.mockSessions.find((s) => s.token === token);
      if (!session) return null;
      if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
        this.mockSessions = this.mockSessions.filter((s) => s.token !== token);
        return null;
      }
      session.lastUsedAt = new Date(now);
      session.expiresAt = Math.min(now + 8 * 60 * 60 * 1000, session.absoluteExpiresAt);
      return session;
    }
    try {
      const sessions = await this.drizzleDb.select().from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1);
      if (sessions.length > 0) {
        const s = sessions[0];
        if (s.expiresAt <= now || s.absoluteExpiresAt <= now) {
          await this.drizzleDb.delete(schema.sessions).where(eq(schema.sessions.token, token));
          return null;
        }
        const expiresAt = Math.min(now + 8 * 60 * 60 * 1000, s.absoluteExpiresAt);
        await this.drizzleDb.update(schema.sessions)
          .set({ expiresAt, lastUsedAt: new Date(now) })
          .where(eq(schema.sessions.token, token));
        return { email: s.email, expiresAt };
      }
      return null;
    } catch (err: any) {
      logger.error({ error: err.message }, "getSession PG Error");
      throw err;
    }
  }

  public async createSession(token: string, email: string, expiresAt: number, createdAt = Date.now()): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      this.mockSessions.push({
        token,
        email,
        expiresAt,
        createdAt: new Date(createdAt),
        lastUsedAt: new Date(createdAt),
        absoluteExpiresAt: createdAt + 24 * 60 * 60 * 1000,
      });
      return;
    }
    try {
      const absoluteExpiresAt = createdAt + 24 * 60 * 60 * 1000;
      await this.drizzleDb.insert(schema.sessions).values({
        token,
        email,
        expiresAt: Math.min(expiresAt, absoluteExpiresAt),
        createdAt: new Date(createdAt),
        lastUsedAt: new Date(createdAt),
        absoluteExpiresAt,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, "createSession PG Error");
      throw err;
    }
  }

  public async deleteSession(token: string): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      this.mockSessions = this.mockSessions.filter((s) => s.token !== token);
      return;
    }
    try {
      await this.drizzleDb.delete(schema.sessions).where(eq(schema.sessions.token, token));
    } catch (err: any) {
      logger.error({ error: err.message }, "deleteSession PG Error");
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  NOTIFICATIONS OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────────
  public async getNotifications(email: string): Promise<any[]> {
    if (!this.isPostgres || !this.drizzleDb) {
      return this.mockNotifications.filter((n) => n.email === email);
    }
    try {
      return await this.drizzleDb.select().from(schema.notifications).where(eq(schema.notifications.userEmail, email)).orderBy(sql`${schema.notifications.createdAt} desc`);
    } catch (err: any) {
      logger.error({ error: err.message }, "getNotifications PG Error");
      throw err;
    }
  }

  public async markNotificationAsRead(id: number, email: string): Promise<boolean> {
    if (!this.isPostgres || !this.drizzleDb) {
      const n = this.mockNotifications.find((x) => x.id === id && x.email === email);
      if (n) {
        n.isRead = true;
        return true;
      }
      return false;
    }
    try {
      const updated = await this.drizzleDb.update(schema.notifications)
        .set({ read: true })
        .where(and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.userEmail, email),
        ))
        .returning();
      return updated.length > 0;
    } catch (err: any) {
      logger.error({ error: err.message }, "markNotificationAsRead PG Error");
      throw err;
    }
  }

  public async addNotification(email: string, title: string, message: string, type: string): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      const id = (this.mockNotifications.length > 0 ? Math.max(...this.mockNotifications.map((n) => n.id)) : 0) + 1;
      this.mockNotifications.push({ id, email, title, message, isRead: false, created_at: new Date().toISOString(), type });
      return;
    }
    try {
      await this.drizzleDb.insert(schema.notifications).values({ userEmail: email, title, message, type, read: false });
    } catch (err: any) {
      logger.error({ error: err.message }, "addNotification PG Error");
    }
  }

  public async cleanupExpiredNotifications(retentionDays: number): Promise<number> {
    if (!this.isPostgres || !this.drizzleDb) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);
      const deleted = this.mockNotifications.filter((n) => new Date(n.created_at) < cutoff);
      this.mockNotifications = this.mockNotifications.filter((n) => new Date(n.created_at) >= cutoff);
      return deleted.length;
    }
    try {
      const deleted = await this.drizzleDb.delete(schema.notifications)
        .where(lt(schema.notifications.createdAt, new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)))
        .returning();
      return deleted.length;
    } catch (err: any) {
      logger.error({ error: err.message, retentionDays }, "cleanupExpiredNotifications PG Error");
      return 0;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  STUDENT / PARENT PROFILES
  // ──────────────────────────────────────────────────────────────────────────────
  public async getStudentProfile(email: string): Promise<any> {
    if (!this.isPostgres || !this.drizzleDb) {
      const p = this.mockStudentProfiles.find((x) => x.email.toLowerCase() === email.toLowerCase());
      return p ? p.profile : null;
    }
    try {
      const rows = await this.drizzleDb.select().from(schema.studentProfiles).where(eq(schema.studentProfiles.userEmail, email)).limit(1);
      return rows.length > 0 ? rows[0] : null;
    } catch (err: any) {
      logger.error({ error: err.message }, "getStudentProfile PG Error");
      throw err;
    }
  }

  public async saveStudentProfile(email: string, profile: any): Promise<any> {
    if (!this.isPostgres || !this.drizzleDb) {
      const existing = this.mockStudentProfiles.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (existing) existing.profile = profile;
      else this.mockStudentProfiles.push({ email, profile });
      return profile;
    }
    try {
      await this.drizzleDb.insert(schema.studentProfiles)
        .values({ userEmail: email, ...profile })
        .onConflictDoUpdate({
          target: schema.studentProfiles.userEmail,
          set: { ...profile },
        });
      return profile;
    } catch (err: any) {
      logger.error({ error: err.message }, "saveStudentProfile PG Error");
      throw err;
    }
  }

  public async getParentProfile(email: string): Promise<any> {
    if (!this.isPostgres || !this.drizzleDb) {
      const p = this.mockParentProfiles.find((x) => x.email.toLowerCase() === email.toLowerCase());
      return p ? p.profile : null;
    }
    try {
      const rows = await this.drizzleDb.select().from(schema.parentProfiles).where(eq(schema.parentProfiles.userEmail, email)).limit(1);
      return rows.length > 0 ? rows[0] : null;
    } catch (err: any) {
      logger.error({ error: err.message }, "getParentProfile PG Error");
      throw err;
    }
  }

  public async saveParentProfile(email: string, profile: any): Promise<any> {
    if (!this.isPostgres || !this.drizzleDb) {
      const existing = this.mockParentProfiles.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (existing) existing.profile = profile;
      else this.mockParentProfiles.push({ email, profile });
      return profile;
    }
    try {
      await this.drizzleDb.insert(schema.parentProfiles)
        .values({ userEmail: email, ...profile })
        .onConflictDoUpdate({
          target: schema.parentProfiles.userEmail,
          set: { ...profile },
        });
      return profile;
    } catch (err: any) {
      logger.error({ error: err.message }, "saveParentProfile PG Error");
      throw err;
    }
  }

  public async updateUserRole(email: string, role: string): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      const u = this.mockUsers.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (u) {
        u.role = role;
        u.tokenVersion = (u.tokenVersion ?? 0) + 1;
      }
      return;
    }
    try {
      await this.drizzleDb.update(schema.users)
        .set({ role, tokenVersion: sql`${schema.users.tokenVersion} + 1` })
        .where(eq(schema.users.email, email));
    } catch (err: any) {
      logger.error({ error: err.message }, "updateUserRole PG Error");
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  CHAT HISTORY
  // ──────────────────────────────────────────────────────────────────────────────
  public async getChatHistory(email: string): Promise<{ role: string; content: string; createdAt: string }[]> {
    if (!this.isPostgres || !this.drizzleDb) {
      return this.mockChatHistory.filter((h) => h.email === email);
    }
    try {
      const rows = await this.drizzleDb.select({ role: schema.chatHistory.role, content: schema.chatHistory.content, createdAt: schema.chatHistory.createdAt })
        .from(schema.chatHistory)
        .where(eq(schema.chatHistory.userEmail, email))
        .orderBy(sql`${schema.chatHistory.createdAt} asc`);
      return rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.createdAt.toISOString() }));
    } catch (err: any) {
      logger.error({ error: err.message }, "getChatHistory PG Error");
      throw err;
    }
  }

  public async saveChatMessage(email: string, role: string, content: string): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      this.mockChatHistory.push({ email, role, content, createdAt: new Date().toISOString() });
      return;
    }
    try {
      await this.drizzleDb.insert(schema.chatHistory).values({ userEmail: email, role, content });
    } catch (err: any) {
      logger.error({ error: err.message }, "saveChatMessage PG Error");
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  ADMIN / AUDIT
  // ──────────────────────────────────────────────────────────────────────────────
  public async getAllUsers(): Promise<Pick<UserDb, "id" | "email" | "name" | "role" | "emailVerified" | "createdAt">[]> {
    if (!this.isPostgres || !this.drizzleDb) {
      return this.mockUsers.map(({ id, email, name, role, emailVerified, createdAt }) => ({
        id, email, name, role, emailVerified, createdAt,
      }));
    }
    try {
      return await this.drizzleDb.select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        emailVerified: schema.users.emailVerified,
        createdAt: schema.users.createdAt,
      }).from(schema.users);
    } catch (err: any) {
      logger.error({ error: err.message }, "getAllUsers PG Error");
      throw err;
    }
  }

  public async getAllAuditLogs(): Promise<any[]> {
    if (!this.isPostgres || !this.drizzleDb) return this.mockAuditLogs;
    try {
      return await this.drizzleDb.select().from(schema.auditLogs).orderBy(sql`${schema.auditLogs.createdAt} desc`);
    } catch (err: any) {
      logger.error({ error: err.message }, "getAllAuditLogs PG Error");
      throw err;
    }
  }

  public async getAnalyticsSummary(): Promise<{
    eventCounts: {
      login: number;
      register: number;
      search: number;
      page_view: number;
      review_submit: number;
      recommendation_request: number;
    };
    trendingSearches: Array<{ keyword: string; count: number }>;
    recentEventLogs: Array<{ action: string; status: string | null; createdAt: string }>;
  }> {
    return buildAnalyticsSummary(await this.getAllAuditLogs());
  }

  public logAnalyticsEvent(event: {
    eventType: string;
    details?: Record<string, any>;
    ip?: string;
    userEmail?: string;
    correlationId?: string;
  }): void {
    const details = {
      ...(event.details ?? {}),
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    };

    if (!this.isPostgres || !this.drizzleDb) {
      this.mockAuditLogs.push({
        action: event.eventType,
        details,
        userEmail: event.userEmail,
        ip: event.ip,
        status: "success",
        correlationId: event.correlationId,
        createdAt: new Date(),
      });
      return;
    }

    void this.drizzleDb.insert(schema.auditLogs).values({
      action: event.eventType,
      details,
      userEmail: event.userEmail,
      ip: event.ip,
      status: "success",
      correlationId: event.correlationId,
    }).catch((err: Error) => {
      logger.error({ error: err.message, eventType: event.eventType }, "logAnalyticsEvent PG Error");
    });
  }

  // ──────────────────────────────────────────────────────────────────────────────
  //  Public fallback datastore surfaces consumed by monitoring / backup tooling.
  //  These mirror the live in-memory collections so the rest of the app can
  //  read counts / snapshots even when PostgreSQL is unreachable.
  // ──────────────────────────────────────────────────────────────────────────────

  // NOTE: previously this was a `get mockUniversities()` that recomputed
  // staticUniversityData() fresh on every access — any push/splice/assign done
  // by upsertUniversity/deleteUniversity was silently discarded on the next
  // read. Now backed by a real array, lazily seeded once, so writes persist.
  public get mockUniversities(): UniversityDb[] {
    if (!this.mockUniversitiesStore) {
      this.mockUniversitiesStore = staticUniversityData() as unknown as UniversityDb[];
    }
    return this.mockUniversitiesStore;
  }

  // ── surfaces consumed by monitoring.ts / s3Backup.ts ──────────────────────
  public mockSessions: {
    token: string;
    email: string;
    expiresAt: number;
    createdAt: Date;
    lastUsedAt: Date;
    absoluteExpiresAt: number;
  }[] = [];
  public mockNotifications: any[] = [];
  public mockChatHistory: any[] = [];

  /** Snapshot of the full datastore for backup / diagnostics exports. */
  public async exportPostgresData(): Promise<Record<string, any>> {
    if (!this.isPostgres || !this.drizzleDb) {
      throw new Error("PostgreSQL export requires an active PostgreSQL connection.");
    }
    try {
      return await this.drizzleDb.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
        const universities = await tx.select().from(schema.universities).orderBy(schema.universities.id);
        const users = await tx.select().from(schema.users).orderBy(schema.users.id);
        const sessions = await tx.select().from(schema.sessions).orderBy(schema.sessions.token);
        const reviews = await tx.select().from(schema.reviews).orderBy(schema.reviews.id);
        const bookmarks = await tx.select().from(schema.bookmarks).orderBy(schema.bookmarks.id);
        const chatHistory = await tx.select().from(schema.chatHistory).orderBy(schema.chatHistory.id);
        const auditLogs = await tx.select().from(schema.auditLogs).orderBy(schema.auditLogs.id);
        const analyticsEvents = await tx.select().from(schema.analyticsEvents).orderBy(schema.analyticsEvents.id);
        const loginAttempts = await tx.select().from(schema.loginAttempts).orderBy(schema.loginAttempts.id);
        const studentProfiles = await tx.select().from(schema.studentProfiles).orderBy(schema.studentProfiles.id);
        const parentProfiles = await tx.select().from(schema.parentProfiles).orderBy(schema.parentProfiles.id);
        const notifications = await tx.select().from(schema.notifications).orderBy(schema.notifications.id);
        const universityReviewsAgg = await tx.select().from(schema.universityReviewsAgg).orderBy(schema.universityReviewsAgg.universityId);
        return {
          universities,
          users,
          sessions,
          reviews,
          bookmarks,
          chatHistory,
          auditLogs,
          analyticsEvents,
          loginAttempts,
          studentProfiles,
          parentProfiles,
          notifications,
          universityReviewsAgg,
        };
      });
    } catch {
      logger.error("PostgreSQL snapshot export failed.");
      throw new Error("PostgreSQL snapshot export failed.");
    }
  }

  public async importPostgresData(data: Record<string, any>): Promise<void> {
    if (!this.isPostgres || !this.drizzleDb) {
      throw new Error("PostgreSQL restore requires an active PostgreSQL connection.");
    }
    const timestampFields: Record<string, readonly string[]> = {
      universities: ["createdAt"],
      users: ["createdAt", "verificationExpires"],
      studentProfiles: ["updatedAt"],
      parentProfiles: ["updatedAt"],
      reviews: ["createdAt"],
      bookmarks: ["createdAt"],
      notifications: ["createdAt"],
      chatHistory: ["createdAt"],
      sessions: ["createdAt", "lastUsedAt"],
      auditLogs: ["createdAt"],
      analyticsEvents: ["createdAt"],
      loginAttempts: ["attemptTime"],
    };
    try {
      await this.drizzleDb.transaction(async (tx) => {
        const tables = [
          ["universities", schema.universities],
          ["users", schema.users],
          ["reviews", schema.reviews],
          ["bookmarks", schema.bookmarks],
          ["studentProfiles", schema.studentProfiles],
          ["parentProfiles", schema.parentProfiles],
          ["notifications", schema.notifications],
          ["chatHistory", schema.chatHistory],
          ["sessions", schema.sessions],
          ["auditLogs", schema.auditLogs],
          ["analyticsEvents", schema.analyticsEvents],
          ["loginAttempts", schema.loginAttempts],
          ["universityReviewsAgg", schema.universityReviewsAgg],
        ] as const;

        for (const [tableName, table] of tables) {
          const rows = data[tableName];
          if (!Array.isArray(rows)) throw new Error(`Restore table ${tableName} is missing.`);
          if (rows.length > 0) {
            const restoredRows = rows.map((row) => {
              if (typeof row !== "object" || row === null || Array.isArray(row)) {
                throw new Error(`Restore table ${tableName} contains an invalid row.`);
              }
              const restored = { ...row };
              for (const field of timestampFields[tableName] ?? []) {
                const value = restored[field];
                if (value == null || value instanceof Date) continue;
                if (typeof value !== "string" && typeof value !== "number") {
                  throw new Error(`Restore table ${tableName} contains an invalid timestamp.`);
                }
                const timestamp = new Date(value);
                if (!Number.isFinite(timestamp.getTime())) {
                  throw new Error(`Restore table ${tableName} contains an invalid timestamp.`);
                }
                restored[field] = timestamp;
              }
              return restored;
            });
            await tx.insert(table).values(restoredRows as never[]);
          }
        }

        for (const tableName of [
          "users",
          "reviews",
          "bookmarks",
          "chat_history",
          "audit_logs",
          "login_attempts",
          "student_profiles",
          "parent_profiles",
          "notifications",
        ]) {
          await tx.execute(sql`
            SELECT setval(
              pg_get_serial_sequence(${`public.${tableName}`}, 'id'),
              COALESCE(MAX(id), 1),
              MAX(id) IS NOT NULL
            )
            FROM ${sql.identifier(tableName)}
          `);
        }

        for (const tableName of [
          "users",
          "reviews",
          "bookmarks",
          "chat_history",
          "audit_logs",
          "login_attempts",
          "student_profiles",
          "parent_profiles",
          "notifications",
        ]) {
          await tx.execute(sql`
            SELECT setval(
              pg_get_serial_sequence(${`public.${tableName}`}, 'id'),
              COALESCE(MAX(id), 1),
              MAX(id) IS NOT NULL
            )
            FROM ${sql.identifier(tableName)}
          `);
        }
      });
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "PostgreSQL restore transaction failed.",
      );
      throw new Error("PostgreSQL restore transaction failed.", { cause: error });
    }
  }

  public async cleanupExpiredSessions(retentionDays = 1): Promise<number> {
    if (!this.isPostgres || !this.drizzleDb) {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const deleted = this.mockSessions.filter((s) => s.expiresAt < cutoff);
      this.mockSessions = this.mockSessions.filter((s) => s.expiresAt >= cutoff);
      return deleted.length;
    }
    try {
      const deleted = await this.drizzleDb.delete(schema.sessions)
        .where(lt(schema.sessions.expiresAt, Date.now()))
        .returning();
      return deleted.length;
    } catch (err: any) {
      logger.error({ error: err.message }, "cleanupExpiredSessions PG Error");
      return 0;
    }
  }

  public async cleanupExpiredTokens(retentionDays = 1): Promise<number> {
    if (!this.isPostgres || !this.drizzleDb) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);
      const deleted = this.mockUsers.filter((u) => u.verificationExpires && new Date(u.verificationExpires) < cutoff).length;
      return deleted;
    }
    try {
      const deleted = await this.drizzleDb.update(schema.users)
        .set({ verificationToken: null, verificationExpires: null })
        .where(lt(schema.users.verificationExpires, new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)))
        .returning();
      return deleted.length;
    } catch (err: any) {
      logger.error({ error: err.message }, "cleanupExpiredTokens PG Error");
      return 0;
    }
  }

  public async cleanupExpiredLoginAttempts(retentionDays = 1): Promise<number> {
    if (!this.isPostgres || !this.drizzleDb) return 0;
    try {
      const deleted = await this.drizzleDb.delete(schema.loginAttempts)
        .where(lt(schema.loginAttempts.attemptTime, new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)))
        .returning();
      return deleted.length;
    } catch (err: any) {
      logger.error({ error: err.message }, "cleanupExpiredLoginAttempts PG Error");
      return 0;
    }
  }
}

export const dbService = new DatabaseService();
