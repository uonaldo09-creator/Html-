import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrationTables } from "../server/convexMigration";
import {
  STAGING_DATABASE_NAME,
  STAGING_INDEXES,
  STAGING_TABLES,
  validateStagingDatabaseUrl,
} from "../../scripts/bootstrapStagingSchema";

const bootstrapSql = readFileSync(resolve("drizzle/staging_bootstrap.sql"), "utf8");
const bootstrapRunner = readFileSync(resolve("scripts/bootstrapStagingSchema.ts"), "utf8");

function renderStagingUrl(databaseName = STAGING_DATABASE_NAME): string {
  const url = new URL(`postgresql://dpg-staging-a.oregon-postgres.render.com/${databaseName}`);
  url.username = "test";
  url.password = "placeholder";
  return url.toString();
}

describe("staging schema bootstrap safety", () => {
  it("accepts only an explicitly confirmed Render staging database URL", () => {
    const url = renderStagingUrl();
    expect(validateStagingDatabaseUrl(url, true)).toBe(url);
  });

  it("rejects missing confirmation, wrong database names, and non-Render hosts", () => {
    const renderUrl = renderStagingUrl();
    expect(() => validateStagingDatabaseUrl(renderUrl, false)).toThrow(/--confirm-staging/);
    expect(() => validateStagingDatabaseUrl(renderStagingUrl("postgres"), true)).toThrow(
      new RegExp(STAGING_DATABASE_NAME),
    );
    const supabaseUrl = new URL(`postgresql://db.example.supabase.co/${STAGING_DATABASE_NAME}`);
    supabaseUrl.username = "test";
    supabaseUrl.password = "placeholder";
    expect(() => validateStagingDatabaseUrl(supabaseUrl.toString(), true)).toThrow(/Render PostgreSQL URL/);
  });

  it("does not use an unrecognized or missing target URL", () => {
    expect(() => validateStagingDatabaseUrl(undefined, true)).toThrow(/STAGING_DATABASE_URL is required/);
    expect(() => validateStagingDatabaseUrl("not-a-url", true)).toThrow(/invalid/);
  });

  it("defines every Convex migration source table and required identity columns", () => {
    expect(STAGING_TABLES).toHaveLength(13);
    const migratedTables = migrationTables
      .map(({ source }) => source.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`))
      .sort();
    expect([...STAGING_TABLES].sort()).toEqual(migratedTables);
    for (const table of STAGING_TABLES) {
      expect(bootstrapSql).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\s*\\(`));
    }
    expect(bootstrapSql).toMatch(/auth_subject text NOT NULL CONSTRAINT users_auth_subject_unique UNIQUE/);
    expect(bootstrapSql).toMatch(/token_version integer NOT NULL DEFAULT 0/);
    expect(bootstrapSql).toMatch(/disabled boolean NOT NULL DEFAULT false/);
  });

  it("includes all Drizzle secondary indexes and foreign-key cascades", () => {
    for (const index of STAGING_INDEXES) expect(bootstrapSql).toContain(index);
    expect(bootstrapSql.match(/ON DELETE CASCADE/g)).toHaveLength(6);
    expect(bootstrapSql).toMatch(/current_database\(\) <> 'uniinfo_staging'/);
    expect(bootstrapSql).toContain("current_setting('uniinfo.staging_bootstrap', true)");
    expect(bootstrapRunner).toContain("SET LOCAL uniinfo.staging_bootstrap = 'confirmed'");
  });
});
