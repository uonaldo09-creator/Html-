import fs from "node:fs";

export interface SecurePostgresConnectionOptions {
  connectionString: string;
  ssl?: {
    rejectUnauthorized: true;
    ca?: string;
    cert?: string;
    key?: string;
  };
}

const SSL_QUERY_PARAMETERS = ["sslmode", "sslrootcert", "sslcert", "sslkey"] as const;

function readCertificate(pathValue: string | null, label: string): string | undefined {
  if (!pathValue || pathValue.toLowerCase() === "system") return undefined;
  try {
    return fs.readFileSync(pathValue, "utf8");
  } catch {
    throw new Error(`${label} file could not be read; configure a valid certificate path.`);
  }
}

/**
 * Build PostgreSQL connection options without letting libpq-style URL options
 * silently replace the explicit TLS settings passed to node-postgres.
 * Loopback connections retain the existing local-development behavior. Remote
 * connections always verify the server certificate and hostname.
 */
export function buildPostgresConnectionOptions(rawUrl: string): SecurePostgresConnectionOptions {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  // Permit plaintext only for the explicitly named Render private Postgres host.
  // Render internal networking is private and documents that TLS is optional there;
  // internal TLS certificates are self-signed and cannot pass normal CA validation.
  const expectedRenderInternalHost = process.env.RENDER_INTERNAL_POSTGRES_HOST?.trim().toLowerCase();
  const isConfiguredRenderInternalHost = Boolean(expectedRenderInternalHost) &&
    (hostname === expectedRenderInternalHost || hostname.startsWith(`${expectedRenderInternalHost}.`));
  const allowRenderInternalPlaintext =
    process.env.RENDER_INTERNAL_POSTGRES_NO_TLS === "true" && isConfiguredRenderInternalHost;
  const requestedSslMode = (url.searchParams.get("sslmode") || "").toLowerCase();

  if (!isLoopback && requestedSslMode === "disable" && !allowRenderInternalPlaintext) {
    throw new Error("Remote PostgreSQL connections must not disable SSL certificate verification.");
  }

  const caPath = url.searchParams.get("sslrootcert") || process.env.PGSSLROOTCERT || null;
  const certPath = url.searchParams.get("sslcert");
  const keyPath = url.searchParams.get("sslkey");
  if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error("PostgreSQL client certificate and key must be configured together.");
  }

  const ca = readCertificate(caPath, "PostgreSQL root certificate");
  const cert = readCertificate(certPath, "PostgreSQL client certificate");
  const key = readCertificate(keyPath, "PostgreSQL client key");

  // node-postgres documents that sslmode/sslrootcert in a URL can override the
  // supplied ssl object. Consume those options here and pass an explicit config.
  for (const parameter of SSL_QUERY_PARAMETERS) url.searchParams.delete(parameter);

  if (isLoopback || allowRenderInternalPlaintext) {
    return { connectionString: url.toString() };
  }

  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
      ...(cert ? { cert } : {}),
      ...(key ? { key } : {}),
    },
  };
}
