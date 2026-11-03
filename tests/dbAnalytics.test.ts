import { describe, expect, it } from "vitest";
import { buildAnalyticsSummary } from "../db/analytics";

describe("database analytics summary", () => {
  it("aggregates supported events, ranks searches, and excludes personal data", () => {
    const logs = [
      { action: "login", status: "success", createdAt: "2026-09-27T10:00:00.000Z" },
      { action: "search", details: { query: "Engineering", email: "private@example.com" }, createdAt: "2026-09-27T10:01:00.000Z" },
      { action: "search", details: { query: "Engineering" }, createdAt: "2026-09-27T10:02:00.000Z" },
      { action: "search", details: { query: "Medicine" }, createdAt: "2026-09-27T10:03:00.000Z" },
      { action: "unrelated_admin_action", details: {}, createdAt: "2026-09-27T10:04:00.000Z" },
    ];

    const summary = buildAnalyticsSummary(logs);

    expect(summary.eventCounts.login).toBe(1);
    expect(summary.eventCounts.search).toBe(3);
    expect(summary.trendingSearches).toEqual([
      { keyword: "Engineering", count: 2 },
      { keyword: "Medicine", count: 1 },
    ]);
    expect(summary.recentEventLogs[0]).toEqual({
      action: "unrelated_admin_action",
      status: null,
      createdAt: "2026-09-27T10:04:00.000Z",
    });
    expect(JSON.stringify(summary)).not.toContain("private@example.com");
  });

  it("caps recent event logs at twenty and normalizes search queries", () => {
    const logs = Array.from({ length: 25 }, (_, index) => ({
      action: "search",
      details: { query: index === 0 ? "   " : "  campus  " },
      createdAt: new Date(Date.UTC(2026, 8, 27, 10, index)),
    }));

    const summary = buildAnalyticsSummary(logs);

    expect(summary.recentEventLogs).toHaveLength(20);
    expect(summary.trendingSearches).toEqual([{ keyword: "campus", count: 24 }]);
    expect(summary.recentEventLogs[0].createdAt).toBe(new Date(Date.UTC(2026, 8, 27, 10, 24)).toISOString());
  });
});
