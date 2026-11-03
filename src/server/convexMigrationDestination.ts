import { ConvexHttpClient } from "convex/browser";
import type {
  MigrationCheckpoint,
  MigrationRecord,
  SourceTable,
} from "./convexMigration";
import { migrationTables } from "./convexMigration";

declare module "convex/browser" {
  interface ConvexHttpClient {
    /** Convex's internal admin API; keep this adapter server-only. */
    setAdminAuth(token: string): void;
    /** Convex's internal function API; do not expose this client to application routes. */
    function(name: string, componentPath?: string, args?: Record<string, unknown>): Promise<unknown>;
  }
}

const CURRENT_DEVELOPMENT_DEPLOYMENT = "graceful-kangaroo-272";
/**
 * Deployments that must never receive any migration writes: the existing
 * development deployment and production.
 */
const PROTECTED_DESTINATIONS = new Set([
  "prod",
  "graceful-kangaroo-272",
]);
/**
 * The synthetic rehearsal deployment. It is allowed only for synthetic
 * rehearsals and must never receive migrated real data.
 */
const SYNTHETIC_ONLY_DESTINATION = "clear-gopher-925";
const TABLE_MUTATIONS: Record<SourceTable, string> = {
  universities: "migration:migrateUniversities",
  users: "migration:migrateUsers",
  studentProfiles: "migration:migrateStudentProfiles",
  parentProfiles: "migration:migrateParentProfiles",
  reviews: "migration:migrateReviews",
  bookmarks: "migration:migrateBookmarks",
  notifications: "migration:migrateNotifications",
  chatHistory: "migration:migrateChatHistory",
  sessions: "migration:migrateSessions",
  auditLogs: "migration:migrateAuditLogs",
  loginAttempts: "migration:migrateLoginAttempts",
  universityReviewsAgg: "migration:migrateUniversityReviewsAgg",
  analyticsEvents: "migration:migrateAnalyticsEvents",
};

function assertUniqueRecordKeys(table: SourceTable, records: readonly MigrationRecord[]): void {
  const keys = new Set<string>();
  for (const { key } of records) {
    if (!key || keys.has(key)) {
      throw new Error(`Convex migration batch contains duplicate or invalid keys for ${table}.`);
    }
    keys.add(key);
  }
}

interface InternalMigrationTransport {
  readonly deploymentName: string;
  invoke<T>(functionName: string, args: Record<string, unknown>): Promise<T>;
}

export interface MigrationDestination {
  classify(table: SourceTable, records: readonly MigrationRecord[]): Promise<{
    identical: readonly string[];
    missing: readonly string[];
    conflicting: readonly string[];
  }>;
  insertBatch(table: SourceTable, records: readonly MigrationRecord[]): Promise<void>;
  loadCheckpoint(table: SourceTable): Promise<MigrationCheckpoint | null>;
  saveCheckpoint(table: SourceTable, checkpoint: MigrationCheckpoint): Promise<void>;
  listKeys(table: SourceTable): Promise<string[]>;
  /**
   * Raises the durable ID counter so future allocations cannot collide with
   * imported legacy IDs. Present only on real-data destinations; the synthetic
   * and dry-run planners omit it.
   */
  reserveIdCounterFloor?(table: SourceTable, nextId: number): Promise<void>;
  /** Read-only membership check used for bounded final key reconciliation. */
  listMissingKeys?(table: SourceTable, keys: readonly string[]): Promise<string[]>;
}

export class ConvexInternalHttpTransport implements InternalMigrationTransport {
  private constructor(
    private readonly client: ConvexHttpClient,
    readonly deploymentName: string,
  ) {}

  static create(options: {
    url: string;
    deploymentName: string;
    adminKey: string;
    isolatedSyntheticConfirmed?: boolean;
    isolatedStagingConfirmed?: boolean;
  }): ConvexInternalHttpTransport {
    const parsed = new URL(options.url);
    const hostname = parsed.hostname.split(".");
    const matchesDeployment =
      (hostname.length === 3 &&
        hostname[0] === options.deploymentName &&
        hostname[1] === "convex" &&
        hostname[2] === "cloud") ||
      (hostname.length === 4 &&
        hostname[0] === options.deploymentName &&
        /^[a-z]{2,}(?:-[a-z0-9]+)+$/.test(hostname[1]) &&
        hostname[2] === "convex" &&
        hostname[3] === "cloud");
    // A synthetic rehearsal and a real staging import are distinct roles. Each
    // must be positively confirmed. Neither may name the existing dev target or
    // prod; a staging (real-data) target may additionally never be the synthetic
    // rehearsal deployment.
    const confirmedRole = options.isolatedSyntheticConfirmed
      ? "synthetic"
      : options.isolatedStagingConfirmed
        ? "staging"
        : null;
    if (
      parsed.protocol !== "https:" ||
      parsed.port !== "" ||
      !matchesDeployment ||
      !options.deploymentName ||
      PROTECTED_DESTINATIONS.has(options.deploymentName) ||
      (confirmedRole === "staging" && options.deploymentName === SYNTHETIC_ONLY_DESTINATION) ||
      confirmedRole === null ||
      !options.adminKey
    ) {
      throw new Error("Convex migration destination is not positively identified as an isolated target.");
    }
    const client = new ConvexHttpClient(parsed.origin, { logger: false });
    client.setAdminAuth(options.adminKey);
    return new ConvexInternalHttpTransport(client, options.deploymentName);
  }

  async invoke<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
    return await this.client.function(functionName, undefined, args) as T;
  }
}

export class ConvexMigrationDestination implements MigrationDestination {
  constructor(
    private readonly transport: InternalMigrationTransport,
    expectedIsolatedDeployment: string,
  ) {
    if (
      !expectedIsolatedDeployment ||
      expectedIsolatedDeployment !== transport.deploymentName ||
      PROTECTED_DESTINATIONS.has(expectedIsolatedDeployment)
    ) {
      throw new Error("Convex migration destination does not match the isolated deployment identity.");
    }
  }

  async classify(table: SourceTable, records: readonly MigrationRecord[]) {
    if (records.length > 100) throw new RangeError("Convex migration batches cannot exceed 100 records.");
    assertUniqueRecordKeys(table, records);
    const result = await this.transport.invoke<{
      identicalKeys: string[];
      missingKeys: string[];
      conflictingKeys: string[];
      inserted: number;
      identical: number;
      missing: number;
      conflicting: number;
    }>(TABLE_MUTATIONS[table], {
      records: records.map(({ value }) => value),
      write: false,
    });
    if (
      !Array.isArray(result.identicalKeys) ||
      !Array.isArray(result.missingKeys) ||
      !Array.isArray(result.conflictingKeys) ||
      result.identical !== result.identicalKeys.length ||
      result.missing !== result.missingKeys.length ||
      result.conflicting !== result.conflictingKeys.length ||
      result.inserted !== 0
    ) {
      throw new Error("Convex migration classification response is invalid.");
    }
    const sourceKeys = new Set(records.map(({ key }) => key));
    const classifiedKeys = [
      ...result.identicalKeys,
      ...result.missingKeys,
      ...result.conflictingKeys,
    ];
    if (
      classifiedKeys.length !== sourceKeys.size ||
      new Set(classifiedKeys).size !== sourceKeys.size ||
      classifiedKeys.some((key) => !sourceKeys.has(key))
    ) {
      throw new Error("Convex migration classification keys do not match the source batch.");
    }
    return {
      identical: result.identicalKeys,
      missing: result.missingKeys,
      conflicting: result.conflictingKeys,
    };
  }

  async insertBatch(table: SourceTable, records: readonly MigrationRecord[]): Promise<void> {
    if (records.length > 100) throw new RangeError("Convex migration batches cannot exceed 100 records.");
    assertUniqueRecordKeys(table, records);
    const result = await this.transport.invoke<{
      inserted: number;
      missing: number;
      conflicting: number;
    }>(
      TABLE_MUTATIONS[table],
      {
        records: records.map(({ value }) => value),
        write: true,
      },
    );
    if (result.conflicting > 0) {
      throw new Error("Convex migration batch contains conflicting records.");
    }
    if (result.inserted !== records.length || result.missing !== records.length) {
      throw new Error("Convex migration write count verification failed.");
    }

  }

  async loadCheckpoint(table: SourceTable): Promise<MigrationCheckpoint | null> {
    const result = await this.transport.invoke<Record<string, unknown> | null>(
      "migration:getCheckpoint",
      { tableName: table },
    );
    if (result === null) return null;
    const {
      _id: _documentId,
      _creationTime: _creationTime,
      ...checkpoint
    } = result;
    if (
      typeof checkpoint.sourceFingerprint !== "string" ||
      !(typeof checkpoint.cursor === "string" || checkpoint.cursor === null) ||
      !Number.isSafeInteger(checkpoint.sourceCount) ||
      !Number.isSafeInteger(checkpoint.inserted) ||
      !Number.isSafeInteger(checkpoint.plannedInsert) ||
      !Number.isSafeInteger(checkpoint.alreadyPresent) ||
      !Number.isSafeInteger(checkpoint.verified) ||
      typeof checkpoint.done !== "boolean"
    ) {
      throw new Error("Convex migration checkpoint is invalid.");
    }
    return checkpoint as unknown as MigrationCheckpoint;
  }

  async listKeys(table: SourceTable): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | null = null;
    while (true) {
      const result = await this.transport.invoke<{
        keys: string[];
        continueCursor: string;
        isDone: boolean;
      }>("migration:listLegacyKeys", {
        tableName: table,
        paginationOpts: { numItems: 100, cursor },
      });
      if (
        !Array.isArray(result.keys) ||
        result.keys.some((key) => typeof key !== "string") ||
        typeof result.isDone !== "boolean" ||
        (!result.isDone && (!result.continueCursor || result.continueCursor === cursor))
      ) {
        throw new Error("Convex destination key page is invalid.");
      }
      keys.push(...result.keys);
      if (result.isDone) return keys;
      cursor = result.continueCursor;
    }
  }

  async saveCheckpoint(table: SourceTable, checkpoint: MigrationCheckpoint): Promise<void> {
    await this.transport.invoke("migration:saveCheckpoint", {
      tableName: table,
      ...checkpoint,
    });
  }

  async reserveIdCounterFloor(table: SourceTable, nextId: number): Promise<void> {
    if (!Number.isSafeInteger(nextId) || nextId < 1) {
      throw new RangeError("Reserved ID counter floor must be a positive safe integer.");
    }
    const result = await this.transport.invoke<{ nextId: number; advanced: boolean }>(
      "migration:reserveIdCounterFloor",
      { tableName: table, nextId },
    );
    if (
      typeof result?.nextId !== "number" ||
      !Number.isSafeInteger(result.nextId) ||
      typeof result.advanced !== "boolean" ||
      result.nextId < nextId
    ) {
      throw new Error("Convex ID counter reservation response is invalid.");
    }
  }

  async listMissingKeys(table: SourceTable, keys: readonly string[]): Promise<string[]> {
    const missing: string[] = [];
    for (let offset = 0; offset < keys.length; offset += 100) {
      const page = keys.slice(offset, offset + 100);
      const result = await this.transport.invoke<{ missing: string[] }>(
        "migration:listMissingKeys",
        { tableName: table, keys: page },
      );
      if (!Array.isArray(result?.missing) || result.missing.some((key) => typeof key !== "string")) {
        throw new Error("Convex missing-key response is invalid.");
      }
      missing.push(...result.missing);
    }
    return missing;
  }

  async verifyKeySets(expected: Readonly<Record<SourceTable, readonly string[]>>): Promise<void> {
    for (const { source: table } of migrationTables) {
      const expectedKeys = [...expected[table]].sort();
      const destinationKeys = (await this.listKeys(table)).sort();
      if (
        expectedKeys.length !== destinationKeys.length ||
        expectedKeys.some((key, index) => key !== destinationKeys[index])
      ) {
        throw new Error(`Convex destination verification failed for table ${table}.`);
      }
    }
  }
}
