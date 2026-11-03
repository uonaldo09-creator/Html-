import { describe, expect, it } from "vitest";
import { ConvexMigrationDestination } from "../server/convexMigrationDestination";

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
