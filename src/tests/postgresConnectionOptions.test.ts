import { afterEach, describe, expect, it } from "vitest";
import { buildPostgresConnectionOptions } from "../db/postgresConnectionOptions";

const originalNoTls = process.env.RENDER_INTERNAL_POSTGRES_NO_TLS;
const originalHost = process.env.RENDER_INTERNAL_POSTGRES_HOST;

afterEach(() => {
  if (originalNoTls === undefined) delete process.env.RENDER_INTERNAL_POSTGRES_NO_TLS;
  else process.env.RENDER_INTERNAL_POSTGRES_NO_TLS = originalNoTls;

  if (originalHost === undefined) delete process.env.RENDER_INTERNAL_POSTGRES_HOST;
  else process.env.RENDER_INTERNAL_POSTGRES_HOST = originalHost;
});

describe("buildPostgresConnectionOptions", () => {
  it("allows plaintext only for the explicitly configured Render internal database host", () => {
    process.env.RENDER_INTERNAL_POSTGRES_NO_TLS = "true";
    process.env.RENDER_INTERNAL_POSTGRES_HOST = "dpg-db7mmo6q1p3s73d1kvs0-a";

    const result = buildPostgresConnectionOptions(
      "postgresql://test-user:test-password@dpg-db7mmo6q1p3s73d1kvs0-a/uniinfo_staging?sslmode=require",
    );

    expect(result.ssl).toBeUndefined();
    expect(result.connectionString).not.toContain("sslmode=");
  });

  it("keeps certificate verification enabled for other remote hosts", () => {
    process.env.RENDER_INTERNAL_POSTGRES_NO_TLS = "true";
    process.env.RENDER_INTERNAL_POSTGRES_HOST = "dpg-db7mmo6q1p3s73d1kvs0-a";

    const result = buildPostgresConnectionOptions(
      "postgresql://test-user:test-password@db.example.test/uniinfo?sslmode=require",
    );

    expect(result.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("does not allow sslmode=disable for an unconfigured remote host", () => {
    process.env.RENDER_INTERNAL_POSTGRES_NO_TLS = "true";
    process.env.RENDER_INTERNAL_POSTGRES_HOST = "dpg-db7mmo6q1p3s73d1kvs0-a";

    expect(() => buildPostgresConnectionOptions(
      "postgresql://test-user:test-password@db.example.test/uniinfo?sslmode=disable",
    )).toThrow("Remote PostgreSQL connections must not disable SSL certificate verification.");
  });

  it("keeps certificate verification enabled for the Render host unless the explicit flag is true", () => {
    process.env.RENDER_INTERNAL_POSTGRES_NO_TLS = "false";
    process.env.RENDER_INTERNAL_POSTGRES_HOST = "dpg-db7mmo6q1p3s73d1kvs0-a";

    const result = buildPostgresConnectionOptions(
      "postgresql://test-user:test-password@dpg-db7mmo6q1p3s73d1kvs0-a/uniinfo_staging",
    );

    expect(result.ssl).toEqual({ rejectUnauthorized: true });
  });
});