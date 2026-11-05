export type ConvexDeploymentRole =
  | "catalog-read"
  | "synthetic-migration"
  | "real-data-migration";

export interface ConvexDeploymentTarget {
  deploymentName: string;
  url: string;
  role: ConvexDeploymentRole;
}

export const PROTECTED_CONVEX_DEPLOYMENTS = new Set([
  "prod",
  "graceful-kangaroo-272",
]);

export const SYNTHETIC_ONLY_CONVEX_DEPLOYMENT = "clear-gopher-925";

const DEPLOYMENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REGION_PATTERN = /^[a-z]{2,}(?:-[a-z0-9]+)+$/;
const DEPLOYMENT_ROLES = new Set<ConvexDeploymentRole>([
  "catalog-read",
  "synthetic-migration",
  "real-data-migration",
]);

export function normalizeConvexDeploymentName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("UniInfo Convex deployment name is required.");
  }

  const separator = trimmed.indexOf(":");
  const scope = separator === -1 ? null : trimmed.slice(0, separator);
  const name = separator === -1 ? trimmed : trimmed.slice(separator + 1);
  if (scope !== null && scope !== "dev") {
    throw new Error("UniInfo Convex deployment name must use the dev: scope or no scope.");
  }
  if (name.length > 64 || !DEPLOYMENT_NAME_PATTERN.test(name)) {
    throw new Error("UniInfo Convex deployment name is malformed.");
  }
  return name;
}

export function assertConvexDeploymentAllowed(
  deploymentName: string,
  role: ConvexDeploymentRole,
): string {
  if (!DEPLOYMENT_ROLES.has(role)) {
    throw new Error("UniInfo Convex deployment role is invalid.");
  }
  const name = normalizeConvexDeploymentName(deploymentName);
  if (PROTECTED_CONVEX_DEPLOYMENTS.has(name)) {
    throw new Error(`Convex deployment ${name} is protected.`);
  }
  if (role === "real-data-migration" && name === SYNTHETIC_ONLY_CONVEX_DEPLOYMENT) {
    throw new Error(`Convex deployment ${name} is reserved for synthetic rehearsals.`);
  }
  return name;
}

function parseHttpsOrigin(value: string): URL {
  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("UniInfo Convex deployment URL must be an HTTPS Convex deployment origin.");
  }

  const authority = raw.slice(raw.indexOf("://") + 3).split(/[/?#]/, 1)[0] ?? "";
  if (
    parsed.protocol !== "https:" ||
    authority.includes("@") ||
    authority.includes(":") ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new Error("UniInfo Convex deployment URL must be an HTTPS Convex deployment origin.");
  }
  return parsed;
}

export function resolveConvexDeploymentTarget(options: {
  deploymentName: string;
  url: string;
  role: ConvexDeploymentRole;
}): ConvexDeploymentTarget {
  const deploymentName = assertConvexDeploymentAllowed(options.deploymentName, options.role);
  const parsed = parseHttpsOrigin(options.url);
  const labels = parsed.hostname.split(".");
  const hasStandardHost =
    labels.length === 3 &&
    labels[0] === deploymentName &&
    labels[1] === "convex" &&
    labels[2] === "cloud";
  const hasRegionalHost =
    labels.length === 4 &&
    labels[0] === deploymentName &&
    REGION_PATTERN.test(labels[1] ?? "") &&
    labels[2] === "convex" &&
    labels[3] === "cloud";

  if (!hasStandardHost && !hasRegionalHost) {
    throw new Error("UniInfo Convex deployment URL host does not match the deployment name.");
  }

  return {
    deploymentName,
    url: parsed.origin,
    role: options.role,
  };
}
