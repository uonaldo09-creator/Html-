import crypto from "node:crypto";
import { decodeJwt, importJWK, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildConvexJwks,
  CONVEX_TOKEN_TTL_SECONDS,
  mintConvexToken,
  readConvexAuthSettings,
  type ConvexAuthSettings,
} from "../server/convexAuth";

let settings: ConvexAuthSettings;

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  settings = {
    issuer: "https://auth.uniinfo.test",
    audience: "uniinfo-convex",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
});

describe("Convex auth bridge", () => {
  it("mints a short-lived ES256 token verifiable from the public JWKS", async () => {
    const { token, expiresIn } = await mintConvexToken(
      { subject: "persisted-postgres-subject", tokenVersion: 4 },
      settings,
    );
    const jwks = await buildConvexJwks(settings);
    const [jwk] = jwks.keys;
    const key = await importJWK(jwk, "ES256");
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      issuer: settings.issuer,
      audience: settings.audience,
      algorithms: ["ES256"],
    });

    expect(payload.sub).toBe("persisted-postgres-subject");
    expect(payload.tv).toBe(4);
    expect(payload.exp! - payload.iat!).toBe(CONVEX_TOKEN_TTL_SECONDS);
    expect(expiresIn).toBe(CONVEX_TOKEN_TTL_SECONDS);
    expect(protectedHeader.kid).toBe(jwk.kid);
    expect(decodeJwt(token)).not.toHaveProperty("role");
  });

  it("publishes no private key material", async () => {
    const jwks = await buildConvexJwks(settings);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).not.toHaveProperty("d");
    expect(jwks.keys[0].alg).toBe("ES256");
    expect(JSON.stringify(jwks)).not.toContain("BEGIN PRIVATE KEY");
  });

  it("rejects expired tokens and tokens with a wrong issuer or audience", async () => {
    const { token } = await mintConvexToken({ subject: "persisted-postgres-subject", tokenVersion: 0 }, settings);
    const key = await importJWK((await buildConvexJwks(settings)).keys[0], "ES256");
    await expect(jwtVerify(token, key, { issuer: settings.issuer, audience: settings.audience })).resolves.toBeDefined();
    await expect(jwtVerify(token, key, { issuer: "https://wrong.example", audience: settings.audience })).rejects.toThrow();
    await expect(jwtVerify(token, key, { issuer: settings.issuer, audience: "wrong-audience" })).rejects.toThrow();

    const expired = await mintConvexToken(
      { subject: "persisted-postgres-subject", tokenVersion: 0, now: Date.now() - 600_000 },
      settings,
    );
    await expect(jwtVerify(expired.token, key, { issuer: settings.issuer, audience: settings.audience })).rejects.toThrow();
  });

  it("requires a valid subject, non-negative token version, and P-256 signing key", async () => {
    await expect(mintConvexToken({ subject: "", tokenVersion: 0 }, settings)).rejects.toThrow(/subject/);
    await expect(mintConvexToken({ subject: "user", tokenVersion: -1 }, settings)).rejects.toThrow(/version/);
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      .export({ type: "pkcs8", format: "pem" }).toString();
    await expect(mintConvexToken({ subject: "user", tokenVersion: 0 }, { ...settings, privateKeyPem: rsa }))
      .rejects.toThrow(/P-256/);
  });

  it("keeps the bridge disabled when absent and rejects insecure issuer configuration", () => {
    expect(readConvexAuthSettings({})).toBeNull();
    expect(() => readConvexAuthSettings({
      CONVEX_AUTH_ISSUER: "http://auth.uniinfo.test",
      CONVEX_AUTH_AUDIENCE: "uniinfo-convex",
      CONVEX_AUTH_PRIVATE_KEY: settings.privateKeyPem,
    })).toThrow(/HTTPS/);
    expect(() => readConvexAuthSettings({
      CONVEX_AUTH_ISSUER: settings.issuer,
    })).toThrow(/configured together/);
  });
});
