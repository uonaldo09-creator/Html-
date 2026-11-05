import { describe, expect, it } from "vitest";
import {
  ConvexInternalHttpTransport,
  ConvexMigrationDestination,
} from "../server/convexMigrationDestination";

function makeDestination(response: unknown) {
  const calls: { functionName: string; args: Record<string, unknown> }[] = [];
  const transport = {
    deploymentName: "synthetic-isolated",
    async invoke<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ functionName, args });
      return response as T;
    },
  };
  return {
    calls,
    destination: new ConvexMigrationDestination(transport, "synthetic-isolated"),
  };
}

describe("ConvexMigrationDestination analytics events", () => {
  it("routes analytics classification through the internal destination validator", async () => {
    const { calls, destination } = makeDestination({
      identicalKeys: [],
      missingKeys: ["101"],
      conflictingKeys: [],
      inserted: 0,
      identical: 0,
      missing: 1,
      conflicting: 0,
    });

    await expect(destination.classify("analyticsEvents", [{
      key: "101",
      value: {
        legacyId: 101,
        eventType: "synthetic.view",
        details: null,
        userEmail: null,
        ipAddress: null,
        createdAt: 1_797_000_000_000,
      },
    }])).resolves.toEqual({
      identical: [],
      missing: ["101"],
      conflicting: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.functionName).toBe("migration:migrateAnalyticsEvents");
    expect(calls[0]?.args.write).toBe(false);
  });

  it("rejects duplicate legacy keys before contacting Convex", async () => {
    const { calls, destination } = makeDestination({});
    const duplicateEvents = [
      { key: "101", value: { legacyId: 101 } },
      { key: "101", value: { legacyId: 101 } },
    ];

    await expect(destination.classify("analyticsEvents", duplicateEvents)).rejects.toThrow(/duplicate/);
    await expect(destination.insertBatch("analyticsEvents", duplicateEvents)).rejects.toThrow(/duplicate/);
    expect(calls).toEqual([]);
  });

  it("rejects malformed destination classification responses", async () => {
    const { destination } = makeDestination({
      identicalKeys: [],
      missingKeys: [],
      conflictingKeys: [],
      inserted: 1,
      identical: 0,
      missing: 0,
      conflicting: 0,
    });

    await expect(destination.classify("analyticsEvents", [{
      key: "101",
      value: { legacyId: 101 },
    }])).rejects.toThrow(/classification response is invalid/);
  });

  it("rejects classification responses that omit or invent source keys", async () => {
    const { destination } = makeDestination({
      identicalKeys: [],
      missingKeys: ["not-the-source-key"],
      conflictingKeys: [],
      inserted: 0,
      identical: 0,
      missing: 1,
      conflicting: 0,
    });

    await expect(destination.classify("analyticsEvents", [{
      key: "101",
      value: { legacyId: 101 },
    }])).rejects.toThrow(/keys do not match the source batch/);
  });
});

describe("Convex destination identity guards", () => {
  const stagingOptions = {
    url: "https://isolated-staging-123.us-east-1.convex.cloud",
    deploymentName: "isolated-staging-123",
    adminKey: "admin-key",
    isolatedStagingConfirmed: true,
  };

  it("accepts a positively identified isolated staging deployment", () => {
    expect(() => ConvexInternalHttpTransport.create(stagingOptions)).not.toThrow();
  });

  it("refuses protected deployments even when a role is confirmed", () => {
    for (const deploymentName of ["prod", "graceful-kangaroo-272"]) {
      expect(() => ConvexInternalHttpTransport.create({
        ...stagingOptions,
        deploymentName,
        url: `https://${deploymentName}.us-east-1.convex.cloud`,
      })).toThrow(/isolated target/);
    }
  });

  it("never routes a real staging import to the synthetic rehearsal deployment", () => {
    expect(() => ConvexInternalHttpTransport.create({
      ...stagingOptions,
      deploymentName: "clear-gopher-925",
      url: "https://clear-gopher-925.us-east-1.convex.cloud",
    })).toThrow(/isolated target/);
    // The synthetic role may still use it for rehearsals.
    expect(() => ConvexInternalHttpTransport.create({
      url: "https://clear-gopher-925.us-east-1.convex.cloud",
      deploymentName: "clear-gopher-925",
      adminKey: "admin-key",
      isolatedSyntheticConfirmed: true,
    })).not.toThrow();
  });

  it("refuses a staging role without explicit confirmation", () => {
    expect(() => ConvexInternalHttpTransport.create({
      ...stagingOptions,
      isolatedStagingConfirmed: false,
    })).toThrow(/isolated target/);
  });

  it("refuses ambiguous or missing role confirmation", () => {
    expect(() => ConvexInternalHttpTransport.create({
      ...stagingOptions,
      isolatedSyntheticConfirmed: true,
    })).toThrow(/isolated target/);
    expect(() => ConvexInternalHttpTransport.create({
      ...stagingOptions,
      isolatedStagingConfirmed: false,
      isolatedSyntheticConfirmed: false,
    })).toThrow(/isolated target/);
  });

  it("refuses a deployment-name and host mismatch", () => {
    expect(() => ConvexInternalHttpTransport.create({
      ...stagingOptions,
      deploymentName: "other-deployment-999",
    })).toThrow(/isolated target/);
  });

  it("refuses a destination whose identity is protected or mismatched", () => {
    const transport = {
      deploymentName: "isolated-staging-123",
      async invoke<T>() { return undefined as T; },
    };
    expect(() => new ConvexMigrationDestination(transport, "isolated-staging-123")).not.toThrow();
    expect(() => new ConvexMigrationDestination(transport, "prod")).toThrow();
    expect(() => new ConvexMigrationDestination(transport, "graceful-kangaroo-272")).toThrow();
    expect(() => new ConvexMigrationDestination(transport, "different")).toThrow();
  });
});
