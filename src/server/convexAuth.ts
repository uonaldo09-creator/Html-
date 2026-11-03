import crypto from "node:crypto";
import { calculateJwkThumbprint, SignJWT, type JWK } from "jose";

export const CONVEX_TOKEN_TTL_SECONDS = 300;
const ALGORITHM = "ES256";

export interface ConvexAuthSettings {
  issuer: string;
  audience: string;
  privateKeyPem: string;
}

export function readConvexAuthSettings(
  env: NodeJS.ProcessEnv = process.env,
): ConvexAuthSettings | null {
  const issuer = env.CONVEX_AUTH_ISSUER?.trim();
  const audience = env.CONVEX_AUTH_AUDIENCE?.trim();
  const rawKey = env.CONVEX_AUTH_PRIVATE_KEY?.trim();
  if (!issuer && !audience && !rawKey) return null;
  if (!issuer || !audience || !rawKey) {
    throw new Error("CONVEX_AUTH_ISSUER, CONVEX_AUTH_AUDIENCE, and CONVEX_AUTH_PRIVATE_KEY must be configured together.");
  }

  const normalizedIssuer = issuer.replace(/\/+$/, "");
  const issuerUrl = new URL(normalizedIssuer);
  if (
    issuerUrl.protocol !== "https:" ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash
  ) {
    throw new Error("CONVEX_AUTH_ISSUER must be an HTTPS URL without credentials, query, or fragment.");
  }

  return {
    issuer: normalizedIssuer,
    audience,
    privateKeyPem: rawKey.replace(/\\n/g, "\n"),
  };
}

function loadPrivateKey(settings: ConvexAuthSettings): crypto.KeyObject {
  const key = crypto.createPrivateKey(settings.privateKeyPem);
  if (key.asymmetricKeyType !== "ec") {
    throw new Error("CONVEX_AUTH_PRIVATE_KEY must be an EC P-256 key for ES256.");
  }
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (curve !== "prime256v1" && curve !== "P-256") {
    throw new Error("CONVEX_AUTH_PRIVATE_KEY must use the P-256 curve for ES256.");
  }
  return key;
}

async function publicSigningJwk(privateKey: crypto.KeyObject): Promise<JWK> {
  const exported = crypto.createPublicKey(privateKey).export({ format: "jwk" });
  const { d: _privateComponent, ...publicJwk } = exported as JsonWebKey;
  const kid = await calculateJwkThumbprint(publicJwk);
  return { ...publicJwk, kid, alg: ALGORITHM, use: "sig" };
}

export async function buildConvexJwks(settings: ConvexAuthSettings): Promise<{ keys: JWK[] }> {
  return { keys: [await publicSigningJwk(loadPrivateKey(settings))] };
}

export async function mintConvexToken(
  input: { subject: string; tokenVersion: number; now?: number },
  settings: ConvexAuthSettings,
): Promise<{ token: string; expiresIn: number }> {
  if (!input.subject || input.subject.trim() !== input.subject || /[\u0000-\u001f]/.test(input.subject)) {
    throw new Error("A valid token subject is required.");
  }
  if (!Number.isSafeInteger(input.tokenVersion) || input.tokenVersion < 0) {
    throw new Error("Token version must be a non-negative safe integer.");
  }

  const privateKey = loadPrivateKey(settings);
  const jwk = await publicSigningJwk(privateKey);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const token = await new SignJWT({ tv: input.tokenVersion })
    .setProtectedHeader({ alg: ALGORITHM, kid: jwk.kid, typ: "JWT" })
    .setIssuer(settings.issuer)
    .setAudience(settings.audience)
    .setSubject(input.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + CONVEX_TOKEN_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(privateKey);

  return { token, expiresIn: CONVEX_TOKEN_TTL_SECONDS };
}
