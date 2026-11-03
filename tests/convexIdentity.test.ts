import type { QueryCtx } from "../../convex/_generated/server";
import { describe, expect, it, vi } from "vitest";
import { requireActiveUser } from "../../convex/identity";

const activeUser = {
  _id: "users:1",
  _creationTime: 1,
  legacyId: 1,
  authSubject: "postgres-auth-subject",
  email: "user@example.test",
  passwordHash: "not-returned-to-clients",
  role: "Admin",
  name: "User",
  loginFailures: 0,
  lockedUntil: 0,
  createdAt: 1,
  emailVerified: true,
  tokenVersion: 2,
  disabled: false,
};

function context(identity: Record<string, unknown> | null, user = activeUser) {
  const eq = vi.fn();
  const unique = vi.fn().mockResolvedValue(user);
  const withIndex = vi.fn((_name: string, build: (query: { eq: typeof eq }) => unknown) => {
    build({ eq });
    return { unique };
  });
  const ctx = {
    auth: { getUserIdentity: vi.fn().mockResolvedValue(identity) },
    db: { query: vi.fn(() => ({ withIndex })) },
  };
  return { ctx: ctx as unknown as QueryCtx, eq, unique };
}

describe("Convex identity resolution", () => {
  it("resolves only the persisted subject and gets role from the stored account", async () => {
    const { ctx, eq } = context({ subject: "postgres-auth-subject", tv: 2, role: "Student" });
    const user = await requireActiveUser(ctx);
    expect(eq).toHaveBeenCalledWith("authSubject", "postgres-auth-subject");
    expect(user.role).toBe("Admin");
  });

  it("rejects absent identities, unknown users, disabled accounts, and stale token versions", async () => {
    const noIdentity = context(null);
    await expect(requireActiveUser(noIdentity.ctx)).rejects.toThrow(/UNAUTHENTICATED/);

    const unknown = context({ subject: "unknown", tv: 2 });
    unknown.unique.mockResolvedValue(null);
    await expect(requireActiveUser(unknown.ctx)).rejects.toThrow(/UNAUTHENTICATED/);

    const disabled = context({ subject: "postgres-auth-subject", tv: 2 }, { ...activeUser, disabled: true });
    await expect(requireActiveUser(disabled.ctx)).rejects.toThrow(/ACCOUNT_DISABLED/);

    const stale = context({ subject: "postgres-auth-subject", tv: 1 });
    await expect(requireActiveUser(stale.ctx)).rejects.toThrow(/TOKEN_REVOKED/);
  });
});
