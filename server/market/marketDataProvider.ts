import type { MarketSnapshot, PriceBar, PriceSeries } from "../../shared/types";
import { ApiError } from "../http/apiError";
import { MemoryCache } from "./memoryCache";
import type { PolygonClient } from "./polygonClient";

const SNAPSHOT_TTL_MS = 15_000;
const HISTORY_TTL_MS = 60_000;
const marketDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/New_York",
  year: "numeric",
});

interface PolygonSnapshotResponse {
  tickers?: PolygonSnapshotTicker[];
}

interface PolygonSnapshotTicker {
  day?: {
    c?: number;
    v?: number;
  };
  name?: string;
  ticker?: string;
  todaysChange?: number;
  todaysChangePerc?: number;
  updated?: number;
}

interface PolygonAggsResponse {
  results?: PolygonAggBar[];
  ticker?: string;
}

interface PolygonAggBar {
  c: number;
  h: number;
  l: number;
  o: number;
  t: number;
  v: number;
}

interface PolygonTickerDetailsResponse {
  results?: {
    market_cap?: number;
    name?: string;
    ticker?: string;
  };
}

interface PolygonTickerListResponse {
  results?: Array<{
    ticker?: string;
  }>;
}

type HistoryRange = PriceSeries["range"];

export class MarketDataProvider {
  private readonly historyCache = new MemoryCache<PriceSeries>();
  private readonly snapshotCache = new MemoryCache<MarketSnapshot[]>();

  constructor(private readonly client: PolygonClient) {}

  async getSnapshots(symbols: string[]): Promise<MarketSnapshot[]> {
    const normalizedSymbols = normalizeSymbols(symbols);
    if (normalizedSymbols.length === 0) {
      return [];
    }

    const cacheKey = `snapshots:${normalizedSymbols.join(",")}`;
    const cached = this.snapshotCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const response = await this.client.getJson<PolygonSnapshotResponse>(
      "/v2/snapshot/locale/us/markets/stocks/tickers",
      { tickers: normalizedSymbols.join(",") },
    );
    const snapshots = (response.tickers ?? []).map(mapSnapshot);

    this.snapshotCache.set(cacheKey, snapshots, SNAPSHOT_TTL_MS);
    return snapshots;
  }

  async getHistory(input: { range: HistoryRange; symbol: string }): Promise<PriceSeries> {
    const symbol = normalizeMarketSymbol(input.symbol);
    const cacheKey = `history:${symbol}:${input.range}`;
    const cached = this.historyCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const aggregateRange = rangeToAggregates(input.range);
    const encodedSymbol = encodeURIComponent(symbol);
    const response = await this.client.getJson<PolygonAggsResponse>(
      `/v2/aggs/ticker/${encodedSymbol}/range/${aggregateRange.multiplier}/${aggregateRange.timespan}/${aggregateRange.from}/${aggregateRange.to}`,
      { adjusted: true, limit: 50_000, sort: "asc" },
    );
    const series: PriceSeries = {
      bars: trimBarsForRange(input.range, (response.results ?? []).map(mapPriceBar)),
      range: input.range,
      symbol: response.ticker?.toUpperCase() ?? symbol,
    };

    this.historyCache.set(cacheKey, series, HISTORY_TTL_MS);
    return series;
  }

  async getTickerDetails(symbol: string): Promise<{ marketCap?: number; name?: string; symbol: string }> {
    const normalizedSymbol = normalizeMarketSymbol(symbol);
    const response = await this.client.getJson<PolygonTickerDetailsResponse>(
      `/v3/reference/tickers/${encodeURIComponent(normalizedSymbol)}`,
    );

    return {
      marketCap: response.results?.market_cap,
      name: response.results?.name,
      symbol: normalizeReferenceTicker(response.results?.ticker) ?? normalizedSymbol,
    };
  }

  async getRelatedTickers(seed: string): Promise<string[]> {
    const normalizedSeed = tryNormalizeMarketSymbol(seed);
    if (normalizedSeed === null) {
      return [];
    }

    const response = await this.client.getJson<PolygonTickerListResponse>(
      `/v1/related-companies/${encodeURIComponent(normalizedSeed)}`,
    );
    return mapReferenceTickers(response.results);
  }

  async searchTickers(query: string): Promise<string[]> {
    const response = await this.client.getJson<PolygonTickerListResponse>("/v3/reference/tickers", {
      active: true,
      limit: 50,
      market: "stocks",
      search: query,
    });
    return mapReferenceTickers(response.results);
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map(normalizeMarketSymbol))].sort();
}

function normalizeMarketSymbol(symbol: string): string {
  const normalized = tryNormalizeMarketSymbol(symbol);
  if (normalized === null) {
    throw new ApiError(400, "INVALID_MARKET_SYMBOL", "Invalid market symbol", { source: "polygon" });
  }

  return normalized;
}

function tryNormalizeMarketSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  if (!/^(?=.*[A-Z0-9])[A-Z0-9.-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function mapReferenceTickers(results: Array<{ ticker?: string }> | undefined): string[] {
  return results?.flatMap((item) => normalizeReferenceTicker(item.ticker) ?? []) ?? [];
}

function normalizeReferenceTicker(ticker: string | undefined): string | undefined {
  const normalized = ticker?.trim().toUpperCase();
  return normalized === "" ? undefined : normalized;
}

function mapSnapshot(ticker: PolygonSnapshotTicker): MarketSnapshot {
  return {
    change: ticker.todaysChange ?? null,
    changePercent: ticker.todaysChangePerc ?? null,
    name: ticker.name,
    price: ticker.day?.c ?? null,
    symbol: ticker.ticker?.toUpperCase() ?? "",
    timeframe: "DELAYED",
    updatedAt: timestampNsToIso(ticker.updated),
    volume: ticker.day?.v ?? null,
  };
}

function timestampNsToIso(timestampNs: number | undefined): string | null {
  if (timestampNs === undefined || !Number.isFinite(timestampNs)) {
    return null;
  }

  const milliseconds = Math.trunc(timestampNs / 1_000_000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function mapPriceBar(bar: PolygonAggBar): PriceBar {
  return {
    close: bar.c,
    high: bar.h,
    low: bar.l,
    open: bar.o,
    timestamp: new Date(bar.t).toISOString(),
    volume: bar.v,
  };
}

function trimBarsForRange(range: HistoryRange, bars: PriceBar[]): PriceBar[] {
  if (range !== "1d" || bars.length === 0) {
    return bars;
  }

  const latestMarketDate = bars.reduce((latest, bar) => {
    const marketDate = formatMarketDate(bar.timestamp);
    return marketDate > latest ? marketDate : latest;
  }, formatMarketDate(bars[0].timestamp));
  return bars.filter((bar) => formatMarketDate(bar.timestamp) === latestMarketDate);
}

function formatMarketDate(timestamp: string): string {
  const parts = marketDateFormatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function rangeToAggregates(range: HistoryRange): { from: string; multiplier: number; timespan: "day" | "minute"; to: string } {
  const to = new Date();
  const from = new Date(to);
  let multiplier = 1;
  let timespan: "day" | "minute" = "day";

  switch (range) {
    case "1h":
      from.setHours(to.getHours() - 1);
      timespan = "minute";
      break;
    case "3h":
      from.setHours(to.getHours() - 3);
      timespan = "minute";
      break;
    case "6h":
      from.setHours(to.getHours() - 6);
      timespan = "minute";
      break;
    case "1d":
      from.setDate(to.getDate() - 7);
      multiplier = 5;
      timespan = "minute";
      break;
    case "5d":
      from.setDate(to.getDate() - 10);
      multiplier = 5;
      timespan = "minute";
      break;
    case "30d":
      from.setMonth(to.getMonth() - 1);
      break;
    case "2month":
      from.setMonth(to.getMonth() - 2);
      break;
    case "3month":
      from.setMonth(to.getMonth() - 3);
      break;
    case "6month":
      from.setMonth(to.getMonth() - 6);
      break;
    case "1y":
      from.setFullYear(to.getFullYear() - 1);
      break;
    case "5y":
      from.setFullYear(to.getFullYear() - 5);
      break;
  }

  // Intraday ranges intentionally request extra calendar days so weekends and market holidays do not under-fetch bars.
  return {
    from: formatDate(from),
    multiplier,
    timespan,
    to: formatDate(to),
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
