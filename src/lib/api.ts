function getCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || "";
  return "";
}

// Interfaces for API Monitoring
export interface ApiRequestLog {
  id: string;
  url: string;
  method: string;
  status: number;
  latency: number;
  success: boolean;
  timestamp: number;
}

export interface ApiMetricsSummary {
  totalRequests: number;
  avgLatency: number;
  successRate: number;
  errorCount: number;
  endpointBreakdown: Record<string, {
    count: number;
    avgLatency: number;
    successRate: number;
    errors: number;
  }>;
  recentLogs: ApiRequestLog[];
}

// Client-side Rate Limiting Helper
export function getRateLimitState(endpoint: string, limitCount = 3, windowMs = 15000): { limited: boolean; cooldownLeft: number; remaining: number } {
  if (typeof window === "undefined") {
    return { limited: false, cooldownLeft: 0, remaining: limitCount };
  }

  const key = `rate_limit_${endpoint.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const now = Date.now();

  let history: number[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      history = JSON.parse(raw);
    }
  } catch (e) {
    history = [];
  }

  // Clean history (only keep timestamps within the current sliding window)
  history = history.filter(ts => now - ts < windowMs);

  if (history.length >= limitCount) {
    // Oldest request in the window
    const oldest = history[0];
    const elapsed = now - oldest;
    const cooldownLeft = Math.ceil((windowMs - elapsed) / 1000);
    return { limited: true, cooldownLeft: cooldownLeft > 0 ? cooldownLeft : 0, remaining: 0 };
  }

  return { limited: false, cooldownLeft: 0, remaining: limitCount - history.length };
}

export function recordRateLimitRequest(endpoint: string, windowMs = 15000): void {
  if (typeof window === "undefined") return;

  const key = `rate_limit_${endpoint.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const now = Date.now();

  let history: number[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      history = JSON.parse(raw);
    }
  } catch (e) {
    history = [];
  }

  // Clean history and push current
  history = history.filter(ts => now - ts < windowMs);
  history.push(now);

  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {
    console.error("Failed to write rate limit history to localStorage", e);
  }
}

// Client-side API Monitoring Utility
const MAX_LOGS = 100;

function recordApiLog(url: string, method: string, status: number, latency: number, success: boolean) {
  if (typeof window === "undefined") return;

  let cleanUrl = url;
  try {
    const parsed = new URL(url, window.location.origin);
    cleanUrl = parsed.pathname;
  } catch (e) {}

  const log: ApiRequestLog = {
    id: Math.random().toString(36).substring(2, 9),
    url: cleanUrl,
    method,
    status,
    latency,
    success,
    timestamp: Date.now()
  };

  try {
    const raw = localStorage.getItem("api_monitor_logs");
    let logs: ApiRequestLog[] = raw ? JSON.parse(raw) : [];

    // Maintain maximum rolling size
    logs.unshift(log);
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(0, MAX_LOGS);
    }

    localStorage.setItem("api_monitor_logs", JSON.stringify(logs));

    // Dispatch a custom event so components can listen to new API metrics real-time!
    window.dispatchEvent(new CustomEvent("api_metrics_updated"));
  } catch (e) {
    console.error("Failed to record API log", e);
  }
}

export function getApiMetricsSummary(): ApiMetricsSummary {
  if (typeof window === "undefined") {
    return { totalRequests: 0, avgLatency: 0, successRate: 100, errorCount: 0, endpointBreakdown: {}, recentLogs: [] };
  }

  let logs: ApiRequestLog[] = [];
  try {
    const raw = localStorage.getItem("api_monitor_logs");
    if (raw) {
      logs = JSON.parse(raw);
    }
  } catch (e) {
    logs = [];
  }

  const totalRequests = logs.length;
  if (totalRequests === 0) {
    return { totalRequests: 0, avgLatency: 0, successRate: 100, errorCount: 0, endpointBreakdown: {}, recentLogs: [] };
  }

  let totalLatency = 0;
  let successCount = 0;
  let errorCount = 0;
  const breakdown: Record<string, { count: number; totalLatency: number; successCount: number; errors: number }> = {};

  logs.forEach(log => {
    totalLatency += log.latency;
    if (log.success) {
      successCount++;
    } else {
      errorCount++;
    }

    const key = `${log.method} ${log.url}`;
    if (!breakdown[key]) {
      breakdown[key] = { count: 0, totalLatency: 0, successCount: 0, errors: 0 };
    }
    const b = breakdown[key];
    b.count++;
    b.totalLatency += log.latency;
    if (log.success) {
      b.successCount++;
    } else {
      b.errors++;
    }
  });

  const endpointBreakdown: ApiMetricsSummary["endpointBreakdown"] = {};
  Object.keys(breakdown).forEach(key => {
    const b = breakdown[key];
    endpointBreakdown[key] = {
      count: b.count,
      avgLatency: Math.round(b.totalLatency / b.count),
      successRate: Math.round((b.successCount / b.count) * 100),
      errors: b.errors
    };
  });

  return {
    totalRequests,
    avgLatency: Math.round(totalLatency / totalRequests),
    successRate: Math.round((b_success => b_success / totalRequests * 100)(successCount)),
    errorCount,
    endpointBreakdown,
    recentLogs: logs
  };
}

export async function customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const csrfToken = getCookie("csrf_token");
  const options: RequestInit = { ...init, credentials: "include" };
  const headers = new Headers(options.headers);
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  // `credentials: "include"` is what carries the HttpOnly session cookie to the
  // server: document.cookie cannot read it, and setting a Cookie header from
  // JavaScript is forbidden by the fetch spec.
  options.headers = headers;

  // Derive request details for monitoring
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url || "";
  const method = options.method || "GET";
  const startTime = performance.now();

  try {
    const response = await window.fetch(input, options);
    const latency = Math.round(performance.now() - startTime);
    const isSuccess = response.ok;

    recordApiLog(url, method, response.status, latency, isSuccess);

    // Safeguard response.json() calls against non-JSON content types
    const originalJson = response.json.bind(response);
    response.json = async () => {
      try {
        const contentType = response.headers.get("content-type");
        if (contentType && !contentType.includes("application/json")) {
          return { status: "error", error: `Server returned non-JSON response (${response.status})` };
        }
        return await originalJson();
      } catch (e) {
        console.warn("JSON parsing failed, returning safe error structure:", e);
        return { status: "error", error: "Failed to parse server response as JSON." };
      }
    };

    return response;
  } catch (error: any) {
    const latency = Math.round(performance.now() - startTime);
    recordApiLog(url, method, 0, latency, false);
    throw error;
  }
}
