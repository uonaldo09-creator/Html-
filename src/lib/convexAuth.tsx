import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { customFetch } from "./api";

export const EXPRESS_SESSION_CHANGED_EVENT = "uniinfo:express-session-changed";
export const EXPRESS_SESSION_EXPIRED_EVENT = "uniinfo:express-session-expired";
export const EXPRESS_LOGOUT_EVENT = "uniinfo:express-logout";

type ExpressSession = {
  status?: unknown;
};

type TokenResponse = {
  token?: unknown;
};

export class ExpressSessionExpiredError extends Error {
  constructor() {
    super("The Express session is no longer valid.");
    this.name = "ExpressSessionExpiredError";
  }
}

export async function hasExpressSession(fetcher: typeof fetch): Promise<boolean> {
  const response = await fetcher("/api/auth/session", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Express session check failed (${response.status}).`);
  }

  const session = (await response.json()) as ExpressSession;
  return session.status === "authenticated";
}

export async function fetchConvexToken(fetcher: typeof fetch): Promise<string> {
  const response = await fetcher("/api/auth/convex-token", {
    method: "POST",
    credentials: "include",
  });
  if (response.status === 401 || response.status === 403) {
    throw new ExpressSessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Convex token request failed (${response.status}).`);
  }

  const body = (await response.json()) as TokenResponse;
  if (typeof body.token !== "string" || body.token.length === 0) {
    throw new Error("Convex token response did not contain a token.");
  }
  return body.token;
}

export function notifyExpressSessionChanged(): void {
  window.dispatchEvent(new Event(EXPRESS_SESSION_CHANGED_EVENT));
}

export function notifyExpressLogout(): void {
  window.dispatchEvent(new Event(EXPRESS_LOGOUT_EVENT));
}

function useExpressAuth() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const refreshSession = useCallback(async () => {
    setIsLoading(true);
    try {
      setIsAuthenticated(await hasExpressSession(customFetch));
    } catch (error) {
      console.error("Unable to resolve the Express session for Convex.", error);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    const handleLogout = () => setIsAuthenticated(false);
    window.addEventListener(EXPRESS_SESSION_CHANGED_EVENT, refreshSession);
    window.addEventListener(EXPRESS_LOGOUT_EVENT, handleLogout);
    return () => {
      window.removeEventListener(EXPRESS_SESSION_CHANGED_EVENT, refreshSession);
      window.removeEventListener(EXPRESS_LOGOUT_EVENT, handleLogout);
    };
  }, [refreshSession]);

  const fetchAccessToken = useCallback(async () => {
    if (!isAuthenticated) return null;
    try {
      return await fetchConvexToken(customFetch);
    } catch (error) {
      if (error instanceof ExpressSessionExpiredError) {
        setIsAuthenticated(false);
        window.dispatchEvent(new Event(EXPRESS_SESSION_EXPIRED_EVENT));
        return null;
      }
      throw error;
    }
  }, [isAuthenticated]);

  return { isLoading, isAuthenticated, fetchAccessToken };
}

export function ConvexAuthProvider({ children }: PropsWithChildren) {
  const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();
  const enabled = import.meta.env.VITE_CONVEX_AUTH_ENABLED === "true" && !!convexUrl;
  const client = useMemo(
    () => {
      if (!enabled || !convexUrl) return null;
      const url = new URL(convexUrl);
      if (url.protocol !== "https:") {
        throw new Error("Convex authentication requires an HTTPS deployment URL.");
      }
      return new ConvexReactClient(url.origin);
    },
    [enabled, convexUrl],
  );

  if (!client) return children;
  return (
    <ConvexProviderWithAuth client={client} useAuth={useExpressAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
