import { logger } from "./logger";

export interface DbState {
  schemaVersion?: number;
  universities: any[];
  users: any[];
  sessions: { [token: string]: { email: string; expiresAt: number } };
  [key: string]: any;
}

export interface Migration {
  version: number;
  description: string;
  up: (db: DbState) => void;
}

// Define the series of versioned schema migrations
const migrations: Migration[] = [
  {
    version: 1,
    description: "Ensure basic collections exist and have proper structures",
    up: (db: DbState) => {
      if (!db.universities) db.universities = [];
      if (!db.users) db.users = [];
      if (!db.sessions) db.sessions = {};
    }
  },
  {
    version: 2,
    description: "Initialize default fields for users (bookmarks, loginFailures, lockedUntil, etc.)",
    up: (db: DbState) => {
      db.users.forEach(user => {
        if (!user.bookmarks) {
          user.bookmarks = [];
        }
        if (user.loginFailures === undefined) {
          user.loginFailures = 0;
        }
        if (user.lockedUntil === undefined) {
          user.lockedUntil = 0;
        }
        if (!user.createdAt) {
          user.createdAt = new Date().toISOString();
        }
      });
    }
  },
  {
    version: 3,
    description: "Initialize reviews array and set basic average rating calculations if empty",
    up: (db: DbState) => {
      db.universities.forEach(uni => {
        if (!uni.reviews) {
          uni.reviews = [];
        }
        if (uni.rating === undefined || isNaN(uni.rating)) {
          uni.rating = 4.0;
        }
      });
    }
  },
  {
    version: 4,
    description: "Initialize email verification fields for users",
    up: (db: DbState) => {
      db.users.forEach(user => {
        if (user.emailVerified === undefined) {
          user.emailVerified = false;
        }
        if (user.verificationToken === undefined) {
          user.verificationToken = null;
        }
        if (user.verificationExpires === undefined) {
          user.verificationExpires = null;
        }
      });
    }
  }
];

export class MigrationManager {
  /**
   * Migrate the db object in-place to the newest schema version.
   * Returns true if migrations were executed.
   */
  public static migrate(db: DbState): boolean {
    const currentVersion = db.schemaVersion || 0;
    logger.info({ currentVersion }, "Checking database schema migrations...");

    const pendingMigrations = migrations
      .filter(m => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    if (pendingMigrations.length === 0) {
      logger.info("Database schema is fully up-to-date.");
      return false; // No changes made
    }

    logger.info(`Found ${pendingMigrations.length} pending migration(s) to run.`);

    for (const migration of pendingMigrations) {
      try {
        logger.info(
          { version: migration.version, description: migration.description },
          "Running database migration..."
        );
        migration.up(db);
        db.schemaVersion = migration.version;
        logger.info({ version: migration.version }, "Migration executed successfully.");
      } catch (err: any) {
        logger.error(
          { version: migration.version, error: err.message },
          "Migration failed! Halting remaining migrations."
        );
        throw err;
      }
    }

    logger.info({ newVersion: db.schemaVersion }, "All migrations executed successfully.");
    return true; // Database state modified
  }
}
