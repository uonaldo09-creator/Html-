export interface AnalyticsLog {
  action: string;
  details?: unknown;
  status?: unknown;
  createdAt: Date | string;
}

export interface AnalyticsSummary {
  eventCounts: {
    login: number;
    register: number;
    search: number;
    page_view: number;
    review_submit: number;
    recommendation_request: number;
  };
  trendingSearches: Array<{ keyword: string; count: number }>;
  recentEventLogs: Array<{ action: string; status: string | null; createdAt: string }>;
}

export function buildAnalyticsSummary(logs: AnalyticsLog[]): AnalyticsSummary {
  const eventCounts: AnalyticsSummary["eventCounts"] = {
    login: 0,
    register: 0,
    search: 0,
    page_view: 0,
    review_submit: 0,
    recommendation_request: 0,
  };
  const searchCounts = new Map<string, number>();

  for (const log of logs) {
    if (Object.hasOwn(eventCounts, log.action)) {
      eventCounts[log.action as keyof typeof eventCounts] += 1;
    }
    if (log.action === "search" && log.details && typeof log.details === "object") {
      const query = (log.details as Record<string, unknown>).query;
      if (typeof query === "string") {
        const keyword = query.trim().slice(0, 100);
        if (keyword) searchCounts.set(keyword, (searchCounts.get(keyword) ?? 0) + 1);
      }
    }
  }

  const newestFirst = [...logs].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
  });
  const recentEventLogs = newestFirst.slice(0, 20).map((log) => ({
    action: log.action,
    status: typeof log.status === "string" ? log.status : null,
    createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
  }));
  const trendingSearches = Array.from(searchCounts, ([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, 5);

  return { eventCounts, trendingSearches, recentEventLogs };
}
