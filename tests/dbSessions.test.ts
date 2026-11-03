import { describe, expect, it } from "vitest";
import { DatabaseService } from "../db/dbService";

function createInMemoryService(): DatabaseService {
  const service = Object.create(DatabaseService.prototype) as DatabaseService;
  Object.assign(service, {
    isPostgres: false,
    drizzleDb: null,
    mockSessions: [],
    mockUsers: [],
  });
  return service;
}

describe("database session hardening", () => {
  it("stores session creation and use timestamps and enforces the absolute 24-hour lifetime", async () => {
    const service = createInMemoryService();
    const createdAt = 1_800_000_000_000;
    const absoluteExpiry = createdAt + 24 * 60 * 60 * 1000;
    const token = "absolute-lifetime-session";

    await service.createSession(token, "session@example.com", createdAt + 8 * 60 * 60 * 1000, createdAt);
    const created = service.mockSessions[0];
    expect(created.createdAt.getTime()).toBe(createdAt);
    expect(created.lastUsedAt.getTime()).toBe(createdAt);
    expect(created.absoluteExpiresAt).toBe(absoluteExpiry);

    for (const hours of [7, 14, 21]) {
      const touchedAt = createdAt + hours * 60 * 60 * 1000;
      const session = await service.getSession(token, touchedAt);
      expect(session?.email).toBe("session@example.com");
    }
    expect(service.mockSessions[0].expiresAt).toBe(absoluteExpiry);
    expect(service.mockSessions[0].lastUsedAt.getTime()).toBe(createdAt + 21 * 60 * 60 * 1000);

    expect(await service.getSession(token, absoluteExpiry)).toBeNull();
    expect(service.mockSessions).toHaveLength(0);
  });

  it("does not revive a session after its idle expiry", async () => {
    const service = createInMemoryService();
    const createdAt = 1_800_000_000_000;
    const token = "idle-expiration-session";

    await service.createSession(token, "idle@example.com", createdAt + 8 * 60 * 60 * 1000, createdAt);
    expect(await service.getSession(token, createdAt + 8 * 60 * 60 * 1000)).toBeNull();
    expect(service.mockSessions).toHaveLength(0);
  });

  it("deletes only the logged-out session token", async () => {
    const service = createInMemoryService();
    const now = 1_800_000_000_000;
    await service.createSession("logout-token", "logout@example.com", now + 8 * 60 * 60 * 1000, now);
    await service.createSession("other-session", "logout@example.com", now + 8 * 60 * 60 * 1000, now);

    await service.deleteSession("logout-token");

    expect(await service.getSession("logout-token", now + 1)).toBeNull();
    expect((await service.getSession("other-session", now + 1))?.email).toBe("logout@example.com");
    expect(service.mockSessions).toHaveLength(1);
  });

  it("returns only UI-safe user fields from the admin listing", async () => {
    const service = createInMemoryService();
    service.mockUsers = [{
      id: 7,
      email: "admin-list@example.com",
      password: "stored-password-hash",
      role: "Student",
      name: "Student",
      loginFailures: 4,
      lockedUntil: 1_800_000_000_001,
      bookmarks: [1, 2],
      createdAt: "2026-09-28T00:00:00.000Z",
      emailVerified: true,
      verificationToken: "verification-secret",
      verificationExpires: "2026-09-29T00:00:00.000Z",
      authSubject: "11111111-1111-4111-8111-111111111111",
      tokenVersion: 0,
      disabled: false,
    }];

    const users = await service.getAllUsers();

    expect(users).toEqual([{
      id: 7,
      email: "admin-list@example.com",
      name: "Student",
      role: "Student",
      emailVerified: true,
      createdAt: "2026-09-28T00:00:00.000Z",
    }]);
    expect(Object.keys(users[0]).sort()).toEqual([
      "createdAt",
      "email",
      "emailVerified",
      "id",
      "name",
      "role",
    ]);
  });
});
