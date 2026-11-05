import { describe, expect, it } from "vitest";
import {
  assertConvexDeploymentAllowed,
  normalizeConvexDeploymentName,
  resolveConvexDeploymentTarget,
  type ConvexDeploymentRole,
} from "../server/convexDeploymentTarget";

const validTarget = {
  deploymentName: "isolated-staging-123",
  url: "https://isolated-staging-123.us-east-1.convex.cloud",
  role: "real-data-migration" as const,
};

describe("Convex deployment name policy", () => {
  it("normalizes bare and dev-scoped deployment names", () => {
    expect(normalizeConvexDeploymentName("isolated-staging-123")).toBe("isolated-staging-123");
    expect(normalizeConvexDeploymentName(" dev:isolated-staging-123 ")).toBe("isolated-staging-123");
  });

  it("rejects malformed or non-dev scoped deployment names", () => {
    for (const deploymentName of [
      "",
      "dev:",
      "prod:staging-target",
      "Dev:staging-target",
      "UPPER-CASE",
      "-leading",
      "trailing-",
      "double--hyphen",
      "contains_dot",
      "a".repeat(65),
    ]) {
      expect(() => normalizeConvexDeploymentName(deploymentName)).toThrow(/deployment name/);
    }
  });

  it("refuses protected deployments for every role", () => {
    const roles: ConvexDeploymentRole[] = [
      "catalog-read",
      "synthetic-migration",
      "real-data-migration",
    ];
    for (const deploymentName of ["prod", "graceful-kangaroo-272"]) {
      for (const role of roles) {
        expect(() => assertConvexDeploymentAllowed(deploymentName, role)).toThrow(/protected/);
      }
    }
  });

  it("allows the synthetic-only deployment only outside real-data migration", () => {
    expect(assertConvexDeploymentAllowed("clear-gopher-925", "catalog-read")).toBe("clear-gopher-925");
    expect(assertConvexDeploymentAllowed("clear-gopher-925", "synthetic-migration")).toBe("clear-gopher-925");
    expect(() => assertConvexDeploymentAllowed("clear-gopher-925", "real-data-migration"))
      .toThrow(/reserved for synthetic/);
  });

  it("rejects an unknown runtime role", () => {
    expect(() => assertConvexDeploymentAllowed(
      "isolated-staging-123",
      "unknown" as ConvexDeploymentRole,
    )).toThrow(/role is invalid/);
  });
});

describe("Convex deployment URL policy", () => {
  it("resolves standard and regional HTTPS origins", () => {
    expect(resolveConvexDeploymentTarget({ ...validTarget })).toEqual(validTarget);
    expect(resolveConvexDeploymentTarget({
      ...validTarget,
      url: "https://isolated-staging-123.convex.cloud/",
    })).toEqual({
      ...validTarget,
      url: "https://isolated-staging-123.convex.cloud",
    });
  });

  it("rejects URLs that are not a bare HTTPS Convex origin", () => {
    for (const url of [
      "not a url",
      "http://isolated-staging-123.us-east-1.convex.cloud",
      "https://isolated-staging-123.us-east-1.convex.cloud:8443",
      "https://isolated-staging-123.us-east-1.convex.cloud:443",
      "https://user:pass@isolated-staging-123.us-east-1.convex.cloud",
      "https://isolated-staging-123.us-east-1.convex.cloud/path",
      "https://isolated-staging-123.us-east-1.convex.cloud?query=1",
      "https://isolated-staging-123.us-east-1.convex.cloud#fragment",
    ]) {
      expect(() => resolveConvexDeploymentTarget({ ...validTarget, url }))
        .toThrow(/HTTPS Convex deployment origin/);
    }
  });

  it("rejects deployment-name and host mismatches", () => {
    for (const url of [
      "https://other-deployment-999.us-east-1.convex.cloud",
      "https://isolated-staging-123.us-east-1.convex.cloud.evil.test",
      "https://isolated-staging-123.us_east_1.convex.cloud",
      "https://isolated-staging-123.region.extra.convex.cloud",
      "https://isolated-staging-123.convex.site",
    ]) {
      expect(() => resolveConvexDeploymentTarget({ ...validTarget, url }))
        .toThrow(/host does not match/);
    }
  });

  it("fails closed before parsing a protected deployment URL", () => {
    expect(() => resolveConvexDeploymentTarget({
      ...validTarget,
      deploymentName: "prod",
      url: "not a url",
    })).toThrow(/protected/);
  });
});
