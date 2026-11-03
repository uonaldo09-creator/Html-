import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, pbkdf2Sync } from "node:crypto";
import { importJWK, jwtVerify, type JWK } from "jose";

const mocks = vi.hoisted(() => ({
  users: new Map<string, any>(),
  sessions: new Map<string, { email: string; expiresAt: number; absoluteExpiresAt: number }>(),
  db: {
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    createSession: vi.fn(),
    deleteUniversity: vi.fn(),
    deleteReview: vi.fn(),
    updateUserVerificationToken: vi.fn(),
    verifyEmail: vi.fn(),
    recordLoginAttempt: vi.fn(),
    updateUserLockout: vi.fn(),
    getAllUsers: vi.fn(),
    getStudentProfile: vi.fn(),
    saveStudentProfile: vi.fn(),
    getParentProfile: vi.fn(),
    saveParentProfile: vi.fn(),
    addNotification: vi.fn(),
    getNotifications: vi.fn(),
    markNotificationAsRead: vi.fn(),
    getChatHistory: vi.fn(),
    toggleBookmark: vi.fn(),
    logAnalyticsEvent: vi.fn(),
  },
  firebaseApps: [] as unknown[],
  verifyIdToken: vi.fn(),
  handleCounselorChat: vi.fn(),
}));

vi.mock("../db/dbService", () => ({ dbService: mocks.db }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/backup", () => ({
  BackupService: { startScheduler: vi.fn(), stopScheduler: vi.fn() },
}));
vi.mock("../server/maintenance", () => ({
  maintenanceService: { start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../server/monitoring", () => ({
  MonitoringService: {
    getHealthDiagnostics: vi.fn(),
    handleMetrics: vi.fn(),
  },
}));
vi.mock("../server/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  cacheFlushPattern: vi.fn().mockResolvedValue(undefined),
  getRedisClient: vi.fn().mockReturnValue(null),
}));
vi.mock("../server/queue", () => ({
  backgroundQueue: { addJob: vi.fn(), shutdown: vi.fn() },
}));
vi.mock("../server/s3Backup", () => ({
  S3BackupService: class {},
}));
vi.mock("../server/ai", () => ({
  handleCounselorChat: mocks.handleCounselorChat,
  handleGeneralChat: vi.fn(),
  aiAnalytics: { requests: 0, failures: 0, getAverageResponseTime: vi.fn() },
}));
vi.mock("firebase-admin/app", () => ({
  getApps: () => mocks.firebaseApps,
  initializeApp: vi.fn(() => {
    const app = {};
    mocks.firebaseApps.push(app);
    return app;
  }),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));
vi.mock("vite", () => ({ createServer: vi.fn() }));

let baseUrl = "";
let httpServer: ReturnType<(typeof import("node:http"))["createServer"]>;
let requestNumber = 1;
const previousEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL,
  PORT: process.env.PORT,
  ENABLE_DEV_AUTH_BYPASS: process.env.ENABLE_DEV_AUTH_BYPASS,
  CONVEX_AUTH_ISSUER: process.env.CONVEX_AUTH_ISSUER,
  CONVEX_AUTH_AUDIENCE: process.env.CONVEX_AUTH_AUDIENCE,
  CONVEX_AUTH_PRIVATE_KEY: process.env.CONVEX_AUTH_PRIVATE_KEY,
};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "test-only-no-database";
  process.env.LOG_LEVEL = "silent";
  process.env.PORT = "0";
  delete process.env.ENABLE_DEV_AUTH_BYPASS;
  delete process.env.CONVEX_AUTH_ISSUER;
  delete process.env.CONVEX_AUTH_AUDIENCE;
  delete process.env.CONVEX_AUTH_PRIVATE_KEY;

  const { app } = await import("../../server");
  httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Test HTTP server failed to bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (httpServer) {
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => error ? reject(error) : resolve()),
    );
  }
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.users.clear();
  mocks.sessions.clear();
  mocks.firebaseApps.length = 0;
  delete process.env.CONVEX_AUTH_ISSUER;
  delete process.env.CONVEX_AUTH_AUDIENCE;
  delete process.env.CONVEX_AUTH_PRIVATE_KEY;

  mocks.db.getSession.mockImplementation(async (token: string) => {
    const session = mocks.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now() || session.absoluteExpiresAt <= Date.now()) {
      mocks.sessions.delete(token);
      await mocks.db.deleteSession(token);
      return null;
    }
    session.expiresAt = Math.min(Date.now() + 8 * 60 * 60 * 1000, session.absoluteExpiresAt);
    return session;
  });
  mocks.db.deleteSession.mockImplementation(async (token: string) => {
    mocks.sessions.delete(token);
  });
  mocks.db.getUserByEmail.mockImplementation(async (email: string) => mocks.users.get(email) ?? null);
  mocks.db.createUser.mockImplementation(async (input: any) => {
    const user = { ...input, bookmarks: [] };
    mocks.users.set(input.email, user);
    return user;
  });
  mocks.db.createSession.mockImplementation(async (token: string, email: string, expiresAt: number) => {
    mocks.sessions.set(token, {
      email,
      expiresAt,
      absoluteExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    mocks.db.deleteUniversity.mockResolvedValue(true);
    mocks.db.deleteReview.mockResolvedValue(true);
    mocks.db.updateUserVerificationToken.mockResolvedValue(undefined);
  });
  mocks.db.verifyEmail.mockImplementation(async (email: string) => {
    const user = mocks.users.get(email);
    if (user) user.emailVerified = true;
  });
  mocks.db.recordLoginAttempt.mockResolvedValue(undefined);
  mocks.db.updateUserLockout.mockResolvedValue(undefined);
  mocks.db.getAllUsers.mockResolvedValue([]);
  mocks.db.getStudentProfile.mockImplementation(async (email: string) => ({ owner: email }));
  mocks.db.saveStudentProfile.mockImplementation(async (email: string, profile: unknown) => ({ owner: email, profile }));
  mocks.db.getParentProfile.mockImplementation(async (email: string) => ({ owner: email }));
  mocks.db.saveParentProfile.mockImplementation(async (email: string, profile: unknown) => ({ owner: email, profile }));
  mocks.db.addNotification.mockResolvedValue(undefined);
  mocks.db.getNotifications.mockImplementation(async (email: string) => [{ owner: email, id: 27 }]);
  mocks.db.markNotificationAsRead.mockImplementation(async (_id: number, email: string) => email === "alice@example.test");
  mocks.db.getChatHistory.mockImplementation(async (email: string) => [{ role: "user", content: email, createdAt: 1 }]);
  mocks.db.toggleBookmark.mockImplementation(async (email: string, universityId: number) => ({
    action: "added",
    bookmarks: [{ owner: email, universityId }],
  }));
  mocks.db.logAnalyticsEvent.mockResolvedValue(undefined);
  mocks.handleCounselorChat.mockResolvedValue({ reply: "Counselor response.", recommendations: [] });
  mocks.verifyIdToken.mockRejectedValue(new Error("Invalid Firebase token"));
});

function addUser(email: string, role: string, emailVerified = true) {
  const user = {
    email,
    role,
    emailVerified,
    name: email.split("@")[0],
    bookmarks: [],
    password: "hash",
    authSubject: `persisted-${email}`,
    tokenVersion: 0,
    disabled: false,
  };
  mocks.users.set(email, user);
  return user;
}

async function request(path: string, options: RequestInit = {}) {
  const forwardedIp = `198.51.100.${requestNumber++}`;
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "X-Forwarded-For": forwardedIp,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  return { response, body: await response.json() };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("Express authentication and authorization routes", () => {
  it("keeps the Convex bridge disabled until all server settings are configured", async () => {
    addUser("alice@example.test", "Student");
    mocks.sessions.set("alice-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });

    const jwks = await request("/.well-known/jwks.json");
    const unauthenticated = await request("/api/auth/convex-token", { method: "POST" });
    const unconfigured = await request("/api/auth/convex-token", {
      method: "POST",
      headers: bearer("alice-session"),
    });

    expect(jwks.response.status).toBe(404);
    expect(unauthenticated.response.status).toBe(401);
    expect(unconfigured.response.status).toBe(503);
  });

  it("exchanges a verified session for a token matching the persisted subject", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.CONVEX_AUTH_ISSUER = "https://auth.uniinfo.test";
    process.env.CONVEX_AUTH_AUDIENCE = "uniinfo-convex";
    process.env.CONVEX_AUTH_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const user = addUser("alice@example.test", "Student");
    user.authSubject = "11111111-1111-4111-8111-111111111101";
    user.tokenVersion = 7;
    mocks.sessions.set("alice-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });

    const jwksResponse = await request("/.well-known/jwks.json");
    const tokenResponse = await request("/api/auth/convex-token", {
      method: "POST",
      headers: bearer("alice-session"),
    });
    const jwks = jwksResponse.body as { keys: JWK[] };
    const key = await importJWK(jwks.keys[0], "ES256");
    const { payload } = await jwtVerify(tokenResponse.body.token, key, {
      issuer: "https://auth.uniinfo.test",
      audience: "uniinfo-convex",
      algorithms: ["ES256"],
    });

    expect(jwksResponse.response.status).toBe(200);
    expect(jwks.keys[0]).not.toHaveProperty("d");
    expect(tokenResponse.response.status).toBe(200);
    expect(tokenResponse.response.headers.get("cache-control")).toBe("no-store");
    expect(payload.sub).toBe(user.authSubject);
    expect(payload.tv).toBe(7);
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("email");
  });

  it("does not issue Convex tokens to unverified or disabled accounts", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.CONVEX_AUTH_ISSUER = "https://auth.uniinfo.test";
    process.env.CONVEX_AUTH_AUDIENCE = "uniinfo-convex";
    process.env.CONVEX_AUTH_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const unverifiedUser = addUser("unverified@example.test", "Student", false);
    const disabledUser = addUser("disabled@example.test", "Student");
    disabledUser.disabled = true;
    for (const email of [unverifiedUser.email, disabledUser.email]) {
      mocks.sessions.set(`${email}-session`, {
        email,
        expiresAt: Date.now() + 60_000,
        absoluteExpiresAt: Date.now() + 120_000,
      });
    }

    const unverified = await request("/api/auth/convex-token", {
      method: "POST",
      headers: bearer(`${unverifiedUser.email}-session`),
    });
    const disabled = await request("/api/auth/convex-token", {
      method: "POST",
      headers: bearer(`${disabledUser.email}-session`),
    });

    expect(unverified.response.status).toBe(403);
    expect(disabled.response.status).toBe(401);
  });

  it("rejects Admin and alternate privileged signup fields without creating an account", async () => {
    const forbiddenFields = [
      { role: "Admin" },
      { accountType: "Admin" },
      { userRole: "Admin" },
      { isAdmin: true },
      { roles: ["Admin"] },
      { privilege: "Admin" },
    ];

    for (const [index, field] of forbiddenFields.entries()) {
      const { response } = await request("/api/register", {
        method: "POST",
        body: JSON.stringify({
          email: `attempt-${index}@example.test`,
          password: "StrongPass1!",
          ...field,
        }),
      });
      expect(response.status).toBe(400);
    }
    expect(mocks.db.createUser).not.toHaveBeenCalled();
  });

  it.each(["Student", "Parent"])("registers a legitimate %s account with its server-mapped role", async (accountType) => {
    const { response, body } = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({
        email: `${accountType.toLowerCase()}@example.test`,
        password: "StrongPass1!",
        accountType,
      }),
    });

    expect(response.status).toBe(200);
    expect(body.status).toBe("success");
    expect(mocks.db.createUser.mock.calls[0][0]).toMatchObject({
      role: accountType,
      emailVerified: false,
    });
    expect(mocks.db.updateUserVerificationToken).toHaveBeenCalledOnce();
  });

  it("rejects an existing account email before creating another user", async () => {
    addUser("existing@example.test", "Student");

    const { response } = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({
        email: "existing@example.test",
        password: "StrongPass1!",
        accountType: "Student",
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.db.createUser).not.toHaveBeenCalled();
  });

  it("denies administrator endpoints without a session or to a student", async () => {
    const noSession = await request("/api/admin/users");
    expect(noSession.response.status).toBe(401);

    addUser("alice@example.test", "Student");
    mocks.sessions.set("student-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });
    const student = await request("/api/admin/users", { headers: bearer("student-session") });

    expect(student.response.status).toBe(403);
    expect(mocks.db.getAllUsers).not.toHaveBeenCalled();
  });

  it("keeps university deletion Admin-only and delegates authorized deletion to PostgreSQL", async () => {
    const noSession = await request("/api/admin/universities/5", { method: "DELETE" });
    expect(noSession.response.status).toBe(401);

    addUser("alice@example.test", "Student");
    mocks.sessions.set("student-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });
    const student = await request("/api/admin/universities/5", {
      method: "DELETE",
      headers: bearer("student-session"),
    });
    expect(student.response.status).toBe(403);
    expect(mocks.db.deleteUniversity).not.toHaveBeenCalled();

    addUser("admin@example.test", "Admin");
    mocks.sessions.set("admin-session", {
      email: "admin@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });
    const admin = await request("/api/admin/universities/5", {
      method: "DELETE",
      headers: bearer("admin-session"),
    });

    expect(admin.response.status).toBe(200);
    expect(mocks.db.deleteUniversity).toHaveBeenCalledWith(5);
  });

  it("keeps review moderation Admin-only and delegates authorized deletion to PostgreSQL", async () => {
    addUser("alice@example.test", "Student");
    mocks.sessions.set("student-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });

    const student = await request("/api/admin/reviews/9", {
      method: "DELETE",
      headers: bearer("student-session"),
    });
    expect(student.response.status).toBe(403);
    expect(mocks.db.deleteReview).not.toHaveBeenCalled();

    addUser("admin@example.test", "Admin");
    mocks.sessions.set("admin-session", {
      email: "admin@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });
    const admin = await request("/api/admin/reviews/9", {
      method: "DELETE",
      headers: bearer("admin-session"),
    });

    expect(admin.response.status).toBe(200);
    expect(mocks.db.deleteReview).toHaveBeenCalledWith(9);
  });

  it("enforces student and parent roles using the stored account role", async () => {
    addUser("alice@example.test", "Student");
    addUser("parent@example.test", "Parent");
    mocks.sessions.set("student-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });
    mocks.sessions.set("parent-session", {
      email: "parent@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });

    const student = await request("/api/profile/student?email=parent%40example.test", {
      headers: bearer("student-session"),
    });
    const savedStudent = await request("/api/profile/student", {
      method: "POST",
      headers: bearer("student-session"),
      body: JSON.stringify({ budget: 123, userEmail: "parent@example.test", userId: "parent-id" }),
    });
    const studentDenied = await request("/api/profile/parent", { headers: bearer("student-session") });
    const parent = await request("/api/profile/parent?email=alice%40example.test", {
      headers: bearer("parent-session"),
    });
    const parentDenied = await request("/api/profile/student", { headers: bearer("parent-session") });

    expect(student.response.status).toBe(200);
    expect(student.body.profile.owner).toBe("alice@example.test");
    expect(savedStudent.body.profile.owner).toBe("alice@example.test");
    expect(studentDenied.response.status).toBe(403);
    expect(parent.response.status).toBe(200);
    expect(parent.body.profile.owner).toBe("parent@example.test");
    expect(parentDenied.response.status).toBe(403);
    expect(mocks.db.getStudentProfile).toHaveBeenCalledTimes(1);
    expect(mocks.db.getParentProfile).toHaveBeenCalledTimes(1);
    expect(mocks.db.saveStudentProfile).toHaveBeenCalledWith("alice@example.test", { budget: 123 });
  });

  it("scopes bookmarks, notifications, and chat history to the session owner", async () => {
    addUser("alice@example.test", "Student");
    addUser("bob@example.test", "Parent");
    mocks.sessions.set("alice-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });

    const bookmark = await request("/api/user/bookmarks", {
      method: "POST",
      headers: bearer("alice-session"),
      body: JSON.stringify({ universityId: 5, userEmail: "bob@example.test", userId: "bob-id" }),
    });
    const notifications = await request("/api/notifications?userId=bob-id", {
      headers: bearer("alice-session"),
    });
    const markRead = await request("/api/notifications/read", {
      method: "POST",
      headers: bearer("alice-session"),
      body: JSON.stringify({ id: 27, userEmail: "bob@example.test" }),
    });
    const history = await request("/api/chat/history?userEmail=bob%40example.test", {
      headers: bearer("alice-session"),
    });

    expect(bookmark.response.status).toBe(200);
    expect(mocks.db.toggleBookmark).toHaveBeenCalledWith("alice@example.test", 5);
    expect(notifications.body.notifications).toEqual([{ owner: "alice@example.test", id: 27 }]);
    expect(mocks.db.getNotifications).toHaveBeenCalledWith("alice@example.test");
    expect(markRead.response.status).toBe(200);
    expect(mocks.db.markNotificationAsRead).toHaveBeenCalledWith(27, "alice@example.test");
    expect(history.body.history[0].content).toBe("alice@example.test");
    expect(mocks.db.getChatHistory).toHaveBeenCalledWith("alice@example.test");
  });

  it("rejects missing, malformed, invalid, and expired authentication tokens", async () => {
    const missing = await request("/api/user/profile");
    const malformed = await request("/api/user/profile", { headers: { Authorization: "Bearer" } });
    const invalid = await request("/api/user/profile", { headers: bearer("not-a-session") });
    mocks.sessions.set("expired-session", {
      email: "alice@example.test",
      expiresAt: Date.now() - 1,
      absoluteExpiresAt: Date.now() + 60_000,
    });
    mocks.sessions.set("absolute-expired-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() - 1,
    });
    const expired = await request("/api/user/profile", { headers: bearer("expired-session") });
    const absoluteExpired = await request("/api/user/profile", { headers: bearer("absolute-expired-session") });

    expect(missing.response.status).toBe(401);
    expect(malformed.response.status).toBe(401);
    expect(invalid.response.status).toBe(401);
    expect(expired.response.status).toBe(401);
    expect(absoluteExpired.response.status).toBe(401);
    expect(mocks.db.deleteSession).toHaveBeenCalledWith("expired-session");
    expect(mocks.db.deleteSession).toHaveBeenCalledWith("absolute-expired-session");
    expect(mocks.db.getUserByEmail).not.toHaveBeenCalled();
  });

  it("does not let guests persist account data by sending an email, user ID, profile, or role", async () => {
    addUser("bob@example.test", "Parent");
    const history = await request("/api/chat/history?userEmail=bob%40example.test");
    const { response } = await request("/api/chat/message", {
      method: "POST",
      body: JSON.stringify({
        message: "Save my private profile",
        userEmail: "bob@example.test",
        userId: "bob-id",
        role: "Parent",
        completedProfile: { budget: 1 },
      }),
    });

    expect(history.response.status).toBe(401);
    expect(mocks.db.getChatHistory).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(mocks.handleCounselorChat).toHaveBeenCalledWith(
      "guest@uniinfo.edu",
      "Student",
      "Save my private profile",
      [],
      "standard",
      { budget: 1 },
      false,
    );
    expect(mocks.db.getStudentProfile).not.toHaveBeenCalled();
    expect(mocks.db.getParentProfile).not.toHaveBeenCalled();
    expect(mocks.db.getNotifications).not.toHaveBeenCalled();
    expect(mocks.db.getChatHistory).not.toHaveBeenCalled();
    expect(mocks.db.saveStudentProfile).not.toHaveBeenCalled();
    expect(mocks.db.saveParentProfile).not.toHaveBeenCalled();
  });

  it("uses the authenticated stored role and identity for counselor chats", async () => {
    addUser("alice@example.test", "Student");
    addUser("parent@example.test", "Parent");
    mocks.sessions.set("student-session", {
      email: "alice@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });
    mocks.sessions.set("parent-session", {
      email: "parent@example.test",
      expiresAt: Date.now() + 60_000,
      absoluteExpiresAt: Date.now() + 120_000,
    });

    await request("/api/chat/message", {
      method: "POST",
      headers: bearer("student-session"),
      body: JSON.stringify({ message: "Student chat", role: "Parent", userEmail: "parent@example.test" }),
    });
    await request("/api/chat/message", {
      method: "POST",
      headers: bearer("parent-session"),
      body: JSON.stringify({ message: "Parent chat", role: "Student", userEmail: "alice@example.test" }),
    });

    expect(mocks.handleCounselorChat).toHaveBeenNthCalledWith(
      1, "alice@example.test", "Student", "Student chat", [], "standard", undefined, true,
    );
    expect(mocks.handleCounselorChat).toHaveBeenNthCalledWith(
      2, "parent@example.test", "Parent", "Parent chat", [], "standard", undefined, true,
    );
  });

  it("keeps PBKDF2 password accounts compatible and issues the existing bounded session", async () => {
    const email = "password@example.test";
    const password = "StrongPass1!";
    const salt = "1234567890abcdef1234567890abcdef";
    const hash = pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
    addUser(email, "Student");
    mocks.users.get(email).password = `${salt}:${hash}`;

    const { response, body } = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    expect(response.status).toBe(200);
    expect(body.user).toMatchObject({ email, role: "Student", emailVerified: true });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mocks.db.createSession).toHaveBeenCalledWith(
      expect.any(String),
      email,
      expect.any(Number),
    );
    const [token, session] = [...mocks.sessions.entries()][0];
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 7 * 60 * 60 * 1000);
    expect(session.absoluteExpiresAt).toBeGreaterThan(session.expiresAt);

    const { response: denied, body: deniedBody } = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "WrongPassword1!" }),
    });
    expect(denied.status).toBe(401);
    expect(deniedBody.error).toContain("Invalid");
    expect(mocks.sessions.has(token)).toBe(true);

    const unverifiedEmail = "unverified@example.test";
    addUser(unverifiedEmail, "Student", false);
    mocks.users.get(unverifiedEmail).password = `${salt}:${hash}`;
    const unverified = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: unverifiedEmail, password }),
    });
    expect(unverified.response.status).toBe(403);
    expect(mocks.db.createSession).toHaveBeenCalledTimes(1);
  });

  it("verifies Firebase tokens, requires verified email, preserves linked roles, and starts a revocable app session", async () => {
    mocks.firebaseApps.push({});
    addUser("alice@example.test", "Parent");
    mocks.verifyIdToken.mockResolvedValue({
      email: " ALICE@example.test ",
      name: "Alice",
      email_verified: true,
    });

    const { response, body } = await request("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken: "firebase-valid-token" }),
    });

    expect(response.status).toBe(200);
    expect(body.user.role).toBe("Parent");
    expect(mocks.users.get("alice@example.test").password).toBe("hash");
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("firebase-valid-token");
    expect(mocks.db.createUser).not.toHaveBeenCalled();
    expect(mocks.db.createSession).toHaveBeenCalledWith(
      expect.any(String),
      "alice@example.test",
      expect.any(Number),
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(body).not.toHaveProperty("sessionToken");

    const sessionToken = [...mocks.sessions.keys()][0];
    const session = await request("/api/auth/session", { headers: bearer(sessionToken) });
    expect(session.body).toMatchObject({
      status: "authenticated",
      user: { email: "alice@example.test", role: "Parent" },
    });

    const logout = await request("/api/user/logout", {
      method: "POST",
      headers: bearer(sessionToken),
    });
    expect(logout.response.status).toBe(200);
    expect(mocks.sessions.has(sessionToken)).toBe(false);
    expect((await request("/api/user/profile", { headers: bearer(sessionToken) })).response.status).toBe(401);
  });

  it("rejects invalid Firebase tokens and unverified addresses before account linking", async () => {
    mocks.firebaseApps.push({});
    const invalid = await request("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken: "bad-token" }),
    });
    expect(invalid.response.status).toBe(401);

    mocks.verifyIdToken.mockResolvedValue({
      email: "alice@example.test",
      name: "Alice",
      email_verified: false,
    });
    const unverified = await request("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken: "unverified-token" }),
    });
    expect(unverified.response.status).toBe(403);
    expect(mocks.db.getUserByEmail).not.toHaveBeenCalled();
    expect(mocks.db.createUser).not.toHaveBeenCalled();
    expect(mocks.db.createSession).not.toHaveBeenCalled();
  });

  it("does not accept development mock Google tokens outside explicit development configuration", async () => {
    mocks.firebaseApps.push({});
    const { response } = await request("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken: "mock-google-token-alice@example.test" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("mock-google-token-alice@example.test");
  });

  it("enables mock Google sign-in only with the explicit local development flag", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.ENABLE_DEV_AUTH_BYPASS;
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_AUTH_BYPASS = "true";
    try {
      const { response, body } = await request("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken: "mock-google-token-dev@example.test" }),
      });
      expect(response.status).toBe(200);
      expect(body.user).toMatchObject({ email: "dev@example.test", role: "Student", emailVerified: true });
      expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) delete process.env.ENABLE_DEV_AUTH_BYPASS;
      else process.env.ENABLE_DEV_AUTH_BYPASS = previousFlag;
    }
  });

  it("keeps the dev email-verification shortcut unavailable without its explicit development flag", async () => {
    addUser("alice@example.test", "Student", false);
    const { response } = await request("/api/auth/dev-verify", {
      method: "POST",
      body: JSON.stringify({ email: "alice@example.test" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.db.verifyEmail).not.toHaveBeenCalled();
    expect(mocks.db.createSession).not.toHaveBeenCalled();
  });
});
