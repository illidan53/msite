import type { MarketSnapshot, PriceSeries } from "../../shared/types";
import { MemoryCache } from "./memoryCache";
import type { PolygonClient } from "./polygonClient";

const SNAPSHOT_TTL_MS = 15_000;
const HISTORY_TTL_MS = 60_000;

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
    const symbol = input.symbol.trim().toUpperCase();
    const cacheKey = `history:${symbol}:${input.range}`;
    const cached = this.historyCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const aggregateRange = rangeToAggregates(input.range);
    const response = await this.client.getJson<PolygonAggsResponse>(
      `/v2/aggs/ticker/${symbol}/range/${aggregateRange.multiplier}/${aggregateRange.timespan}/${aggregateRange.from}/${aggregateRange.to}`,
      { adjusted: true, limit: 50_000, sort: "asc" },
    );
    const series: PriceSeries = {
      bars: (response.results ?? []).map(mapPriceBar),
      range: input.range,
      symbol: response.ticker?.toUpperCase() ?? symbol,
    };

    this.historyCache.set(cacheKey, series, HISTORY_TTL_MS);
    return series;
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort();
}

function mapSnapshot(ticker: PolygonSnapshotTicker): MarketSnapshot {
  return {
    change: ticker.todaysChange ?? null,
    changePercent: ticker.todaysChangePerc ?? null,
    name: ticker.name,
    price: ticker.day?.c ?? null,
    symbol: ticker.ticker?.toUpperCase() ?? "",
    timeframe: "DELAYED",
    updatedAt: ticker.updated === undefined ? null : new Date(ticker.updated).toISOString(),
    volume: ticker.day?.v ?? null,
  };
}

function mapPriceBar(bar: PolygonAggBar) {
  return {
    close: bar.c,
    high: bar.h,
    low: bar.l,
    open: bar.o,
    timestamp: new Date(bar.t).toISOString(),
    volume: bar.v,
  };
}

function rangeToAggregates(range: HistoryRange): { from: string; multiplier: number; timespan: "day" | "minute"; to: string } {
  const to = new Date();
  const from = new Date(to);

  switch (range) {
    case "1D":
      from.setDate(to.getDate() - 1);
      break;
    case "5D":
      from.setDate(to.getDate() - 5);
      break;
    case "1M":
      from.setMonth(to.getMonth() - 1);
      break;
    case "3M":
      from.setMonth(to.getMonth() - 3);
      break;
    case "1Y":
      from.setFullYear(to.getFullYear() - 1);
      break;
  }

  const intraday = range === "1D" || range === "5D";

  return {
    from: formatDate(from),
    multiplier: intraday ? 5 : 1,
    timespan: intraday ? "minute" : "day",
    to: formatDate(to),
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
