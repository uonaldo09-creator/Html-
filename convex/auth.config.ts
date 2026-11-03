import type { AuthConfig } from "convex/server";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set in the Convex deployment environment.`);
  return value;
}

const issuer = requiredEnv("CONVEX_AUTH_ISSUER").replace(/\/+$/, "");
const audience = requiredEnv("CONVEX_AUTH_AUDIENCE");
const issuerUrl = new URL(issuer);
if (issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
  throw new Error("CONVEX_AUTH_ISSUER must be an HTTPS URL without credentials, query, or fragment.");
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer,
      applicationID: audience,
      jwks: `${issuer}/.well-known/jwks.json`,
      algorithm: "ES256",
    },
  ],
} satisfies AuthConfig;
