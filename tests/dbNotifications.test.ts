import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DatabaseService } from "../db/dbService";

function createDatabaseService(): DatabaseService {
  const service = Object.create(DatabaseService.prototype) as DatabaseService;
  const internals = service as any;
  internals.isPostgres = false;
  internals.drizzleDb = null;
  service.mockNotifications = [
    { id: 1, email: "alice@example.com", isRead: false },
    { id: 2, email: "bob@example.com", isRead: false },
  ];
  return service;
}

describe("notification ownership", () => {
  it("returns only notifications owned by the requested user", async () => {
    const service = createDatabaseService();

    await expect(service.getNotifications("alice@example.com")).resolves.toEqual([
      { id: 1, email: "alice@example.com", isRead: false },
    ]);
  });

  it("scopes PostgreSQL notification reads to the authenticated owner's email", async () => {
    const service = createDatabaseService();
    const internals = service as any;
    let whereCondition: unknown;
    internals.isPostgres = true;
    internals.drizzleDb = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            whereCondition = condition;
            return { orderBy: async () => [] };
          },
        }),
      }),
    };

    await expect(service.getNotifications("alice@example.com")).resolves.toEqual([]);

    const query = new PgDialect().sqlToQuery(whereCondition as any);
    expect(query.sql).toContain('"notifications"."user_email"');
    expect(query.params).toEqual(["alice@example.com"]);
  });

  it("does not mark another user's notification as read in memory", async () => {
    const service = createDatabaseService();

    await expect(service.markNotificationAsRead(1, "bob@example.com")).resolves.toBe(false);
    expect(service.mockNotifications[0].isRead).toBe(false);
    expect(await service.getNotifications("bob@example.com")).toEqual([
      { id: 2, email: "bob@example.com", isRead: false },
    ]);
    await expect(service.markNotificationAsRead(1, "alice@example.com")).resolves.toBe(true);
    expect(service.mockNotifications[0].isRead).toBe(true);
  });

  it("includes the authenticated owner's email in the PostgreSQL update condition", async () => {
    const service = createDatabaseService();
    const internals = service as any;
    let whereCondition: unknown;
    internals.isPostgres = true;
    internals.drizzleDb = {
      update: () => ({
        set: () => ({
          where: (condition: unknown) => {
            whereCondition = condition;
            return { returning: async () => [] };
          },
        }),
      }),
    };

    await expect(service.markNotificationAsRead(17, "bob@example.com")).resolves.toBe(false);

    const query = new PgDialect().sqlToQuery(whereCondition as any);
    expect(query.sql).toContain('"notifications"."id"');
    expect(query.sql).toContain('"notifications"."user_email"');
    expect(query.params).toEqual([17, "bob@example.com"]);
  });
});
