import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";

const pgDialect = new PgDialect();
const snapshot = JSON.parse(
  readFileSync(new URL("../../drizzle/meta/0000_snapshot.json", import.meta.url), "utf8"),
);
const currentTables = new Map(
  Object.values(schema)
    .filter((table) => table instanceof PgTable)
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    }),
);

function snapshotDefault(column: { type: string; default?: unknown }) {
  if (!Object.hasOwn(column, "default")) return column.type === "serial" ? "serial" : null;
  if (typeof column.default !== "string") return column.default;

  const jsonb = /^'(.*)'::jsonb$/.exec(column.default);
  if (jsonb) return JSON.parse(jsonb[1].replace(/''/g, "'"));
  const literal = /^'(.*)'$/.exec(column.default);
  return literal ? literal[1].replace(/''/g, "'") : column.default;
}

describe("checked-in Drizzle metadata audit", () => {
  it("keeps the known schema and snapshot differences explicit", () => {
    expect([...currentTables.keys()].sort()).toEqual([
      "analytics_events",
      "audit_logs",
      "bookmarks",
      "chat_history",
      "login_attempts",
      "notifications",
      "parent_profiles",
      "reviews",
      "sessions",
      "student_profiles",
      "universities",
      "university_reviews_agg",
      "users",
    ]);

    expect(Object.keys(snapshot.tables).sort()).toEqual([
      "public.audit_logs",
      "public.bookmarks",
      "public.chat_history",
      "public.login_attempts",
      "public.reviews",
      "public.sessions",
      "public.universities",
      "public.users",
    ]);

    expect(
      [...currentTables.keys()]
        .filter((name) => !snapshot.tables[`public.${name}`])
        .sort(),
    ).toEqual([
      "analytics_events",
      "notifications",
      "parent_profiles",
      "student_profiles",
      "university_reviews_agg",
    ]);

    const currentOnlyColumns = Object.fromEntries(
      [...currentTables].flatMap(([name, config]) => {
        const saved = snapshot.tables[`public.${name}`];
        if (!saved) return [];
        const oldColumns = new Set(Object.keys(saved.columns));
        const missing = config.columns
          .map((column) => column.name)
          .filter((column) => !oldColumns.has(column))
          .sort();
        return missing.length ? [[name, missing]] : [];
      }),
    );
    expect(currentOnlyColumns).toEqual({
      sessions: ["absolute_expires_at", "created_at", "last_used_at"],
      universities: ["directory_profile"],
      users: ["auth_subject", "disabled", "email_verified", "token_version", "verification_expires", "verification_token"],
    });

    const analytics = currentTables.get("analytics_events");
    expect(analytics?.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      primaryKey: column.primary,
      default: column.default instanceof SQL
        ? pgDialect.sqlToQuery(column.default).sql
        : column.default ?? null,
    }))).toEqual([
      { name: "id", type: "integer", notNull: true, primaryKey: true, default: null },
      { name: "event_type", type: "varchar", notNull: true, primaryKey: false, default: null },
      { name: "details", type: "jsonb", notNull: false, primaryKey: false, default: null },
      { name: "user_email", type: "varchar", notNull: false, primaryKey: false, default: null },
      { name: "ip_address", type: "varchar", notNull: false, primaryKey: false, default: null },
      { name: "created_at", type: "timestamp", notNull: true, primaryKey: false, default: "now()" },
    ]);
  });

  it("preserves matching column types, nullability, keys, and defaults", () => {
    for (const [name, config] of currentTables) {
      const saved = snapshot.tables[`public.${name}`];
      if (!saved) continue;

      for (const column of config.columns) {
        const snapshotColumn = saved.columns[column.name];
        if (!snapshotColumn) continue;

        const currentDefault =
          column.columnType === "PgSerial"
            ? "serial"
            : column.default instanceof SQL
              ? pgDialect.sqlToQuery(column.default).sql
              : column.default ?? null;
        expect({
          type: column.getSQLType(),
          notNull: column.notNull,
          primaryKey: column.primary,
          default: currentDefault,
        }).toEqual({
          type: snapshotColumn.type,
          notNull: snapshotColumn.notNull,
          primaryKey: snapshotColumn.primaryKey,
          default: snapshotDefault(snapshotColumn),
        });
      }
    }
  });
});
