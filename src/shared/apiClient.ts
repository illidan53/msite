import type {
  MarketSnapshot,
  PriceSeries,
  RatePlanEvaluation,
  SettingsConfig,
  WatchlistEditResult,
  WatchlistsConfig,
} from "../../shared/types";

export interface WorkbenchConfig {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
}

export interface WorkbenchApi {
  getConfig(): Promise<WorkbenchConfig>;
  fetchSnapshots(symbols: string[]): Promise<MarketSnapshot[]>;
  getHistory(symbol: string, range: PriceSeries["range"]): Promise<PriceSeries>;
  evaluateRatePlan(input: unknown): Promise<RatePlanEvaluation>;
  /** Whether this visitor may edit watchlists (the research IP allowlist). */
  getEditAccess(): Promise<{ canEdit: boolean; clientIp: string | null }>;
  addWatchlistSymbol(
    watchlistId: string,
    input: { symbol: string; rowId: string; description?: string },
  ): Promise<WatchlistEditResult>;
  removeWatchlistSymbol(
    watchlistId: string,
    symbol: string,
  ): Promise<WatchlistEditResult>;
}

/** A failed API request; `code` is the server's error code when it sent one. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, { ...init, cache: init?.cache ?? "no-store", headers });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      code?: unknown;
    } | null;
    throw new ApiRequestError(
      formatRequestError(url, init?.method ?? "GET", response),
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
    );
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
  getEditAccess: () =>
    requestJson<{ canRun: boolean; clientIp: string | null }>(
      "/api/research/access",
    ).then(({ canRun, clientIp }) => ({ canEdit: canRun, clientIp })),
  addWatchlistSymbol: (watchlistId, input) =>
    requestJson<WatchlistEditResult>(
      `/api/watchlists/${encodeURIComponent(watchlistId)}/symbols`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  removeWatchlistSymbol: (watchlistId, symbol) =>
    requestJson<WatchlistEditResult>(
      `/api/watchlists/${encodeURIComponent(watchlistId)}/symbols/${encodeURIComponent(symbol)}`,
      { method: "DELETE" },
    ),
};
