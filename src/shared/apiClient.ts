import type {
  MarketSnapshot,
  PriceSeries,
  RatePlanEvaluation,
  RecommendationCandidate,
  SettingsConfig,
  WatchlistsConfig,
} from "../../shared/types";

export interface WorkbenchConfig {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
}

export interface RecommendWatchlistInput {
  theme: string;
  pinnedSymbols: string[];
  excludedSymbols: string[];
  limit: number;
}

export interface WorkbenchApi {
  getConfig(): Promise<WorkbenchConfig>;
  saveWatchlists(watchlists: WatchlistsConfig): Promise<WatchlistsConfig>;
  fetchSnapshots(symbols: string[]): Promise<MarketSnapshot[]>;
  getHistory(symbol: string, range: PriceSeries["range"]): Promise<PriceSeries>;
  evaluateRatePlan(input: unknown): Promise<RatePlanEvaluation>;
  recommendWatchlist(input: RecommendWatchlistInput): Promise<RecommendationCandidate[]>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    throw new Error(formatRequestError(url, init?.method ?? "GET", response));
  }

  return (await response.json()) as T;
}

function formatRequestError(url: string, method: string, response: Response): string {
  const endpoint = safeEndpointLabel(url);
  const statusText = response.statusText ? ` ${response.statusText}` : "";

  return `Request ${method.toUpperCase()} ${endpoint} failed with ${response.status}${statusText}`;
}

function safeEndpointLabel(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return "/api";
  }
}

export const apiClient: WorkbenchApi = {
  getConfig: () => requestJson<WorkbenchConfig>("/api/config"),
  saveWatchlists: (watchlists) =>
    requestJson<WatchlistsConfig>("/api/config/watchlists", {
      method: "PUT",
      body: JSON.stringify(watchlists),
    }),
  fetchSnapshots: (symbols) =>
    requestJson<MarketSnapshot[]>("/api/market/snapshots", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
  getHistory: (symbol, range) =>
    requestJson<PriceSeries>(
      `/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`,
    ),
  evaluateRatePlan: (input) =>
    requestJson<RatePlanEvaluation>("/api/rate-plan/evaluate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  recommendWatchlist: (input) =>
    requestJson<RecommendationCandidate[]>("/api/watchlists/recommendations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
