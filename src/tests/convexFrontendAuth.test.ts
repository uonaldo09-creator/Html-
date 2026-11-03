import { describe, expect, it, vi } from "vitest";
import {
  ExpressSessionExpiredError,
  fetchConvexToken,
  hasExpressSession,
} from "../lib/convexAuth";

describe("Express-backed Convex frontend auth", () => {
  it("uses the existing cookie session to determine frontend auth state", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "authenticated" }), { status: 200 }),
    );

    await expect(hasExpressSession(fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/auth/session", { credentials: "include" });
  });

  it("requests a fresh Convex token with the HttpOnly session cookie", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: "short-lived-test-token", expiresIn: 300 }), { status: 200 }),
    );

    await expect(fetchConvexToken(fetcher)).resolves.toBe("short-lived-test-token");
    expect(fetcher).toHaveBeenCalledWith("/api/auth/convex-token", {
      method: "POST",
      credentials: "include",
    });
  });

  it("distinguishes expired sessions from unavailable bridge configuration", async () => {
    const expiredFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const unavailableFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(fetchConvexToken(expiredFetcher)).rejects.toBeInstanceOf(ExpressSessionExpiredError);
    await expect(fetchConvexToken(unavailableFetcher)).rejects.toThrow(
      "Convex token request failed (503).",
    );
  });

  it("does not treat an unauthenticated Express session as a Convex identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "unauthenticated" }), { status: 200 }),
    );

    await expect(hasExpressSession(fetcher)).resolves.toBe(false);
  });
});
