import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../http/apiError";
import { MarketDataProvider } from "./marketDataProvider";
import { MemoryCache } from "./memoryCache";
import { PolygonClient } from "./polygonClient";

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoryCache", () => {
  it("returns undefined after the entry TTL expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T12:00:00.000Z"));
    const cache = new MemoryCache<number>();

    cache.set("answer", 42, 1_000);

    expect(cache.get("answer")).toBe(42);
    vi.advanceTimersByTime(1_000);
    expect(cache.get("answer")).toBeUndefined();
  });

  it("evicts the oldest entry when maxEntries is exceeded", () => {
    const cache = new MemoryCache<number>({ maxEntries: 2 });

    cache.set("first", 1, 10_000);
    cache.set("second", 2, 10_000);
    cache.set("third", 3, 10_000);

    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe(2);
    expect(cache.get("third")).toBe(3);
  });
});

describe("PolygonClient", () => {
  it("throws a structured error when the API key is missing", async () => {
    const client = new PolygonClient(undefined, vi.fn());

    await expect(client.getJson("/v2/snapshot/locale/us/markets/stocks/tickers")).rejects.toMatchObject({
      code: "POLYGON_API_KEY_MISSING",
      source: "polygon",
      status: 503,
    });
  });

  it("does not expose the API key when Polygon requests fail", async () => {
    const secret = "super-secret-polygon-key";
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    const client = new PolygonClient(secret, fetcher);

    let error: unknown;
    try {
      await client.getJson("/v2/snapshot/locale/us/markets/stocks/tickers", { tickers: "NVDA" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "POLYGON_REQUEST_FAILED",
      source: "polygon",
      status: 401,
    });
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});

describe("MarketDataProvider", () => {
  it("maps snapshot responses to MarketSnapshot DTOs and requests normalized tickers", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          status: "OK",
          tickers: [
            {
              ticker: "NVDA",
              todaysChange: 12.34,
              todaysChangePerc: 2.5,
              updated: 1_716_400_000_000_000_000,
              day: { c: 950, v: 123_456 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    const snapshots = await provider.getSnapshots(["nvda"]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("/v2/snapshot/locale/us/markets/stocks/tickers");
    expect(new URL(String(url)).searchParams.get("tickers")).toBe("NVDA");
    expect(init).toMatchObject({ headers: { accept: "application/json" } });
    expect(snapshots).toEqual([
      {
        symbol: "NVDA",
        price: 950,
        change: 12.34,
        changePercent: 2.5,
        volume: 123_456,
        updatedAt: "2024-05-22T17:46:40.000Z",
        timeframe: "DELAYED",
      },
    ]);
  });

  it("maps nanosecond snapshot timestamps and invalid timestamps safely", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          tickers: [
            { ticker: "NVDA", updated: 1_716_400_000_000_000_000, day: { c: 950, v: 123_456 } },
            { ticker: "AAPL", updated: Number.MAX_VALUE, day: { c: 190, v: 10 } },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    const snapshots = await provider.getSnapshots(["NVDA", "AAPL"]);

    expect(snapshots).toEqual([
      expect.objectContaining({ symbol: "NVDA", updatedAt: "2024-05-22T17:46:40.000Z" }),
      expect.objectContaining({ symbol: "AAPL", updatedAt: null }),
    ]);
  });

  it("maps aggregate bars to PriceSeries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          ticker: "AAPL",
          results: [{ t: 1716400000000, o: 190, h: 195, l: 188, c: 194, v: 1_000 }],
        }),
        { status: 200 },
      ),
    );
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    const series = await provider.getHistory({ symbol: "aapl", range: "1M" });

    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(requestedUrl.pathname).toMatch(/^\/v2\/aggs\/ticker\/AAPL\/range\/1\/day\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/);
    expect(requestedUrl.searchParams.get("adjusted")).toBe("true");
    expect(requestedUrl.searchParams.get("sort")).toBe("asc");
    expect(requestedUrl.searchParams.get("limit")).toBe("50000");
    expect(series).toEqual({
      symbol: "AAPL",
      range: "1M",
      bars: [
        {
          timestamp: "2024-05-22T17:46:40.000Z",
          open: 190,
          high: 195,
          low: 188,
          close: 194,
          volume: 1_000,
        },
      ],
    });
  });

  it("uses 5 minute aggregates for 1D and 5D history ranges", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ticker: "MSFT", results: [] }), { status: 200 }));
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    await provider.getHistory({ symbol: "msft", range: "5D" });

    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(requestedUrl.pathname).toMatch(/^\/v2\/aggs\/ticker\/MSFT\/range\/5\/minute\//);
  });

  it("requests a wider calendar window for intraday history ranges", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T15:30:00.000Z"));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ticker: "MSFT", results: [] }), { status: 200 }));
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    await provider.getHistory({ symbol: "msft", range: "1D" });
    await provider.getHistory({ symbol: "msft", range: "5D" });

    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe("/v2/aggs/ticker/MSFT/range/5/minute/2026-05-19/2026-05-26");
    expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe("/v2/aggs/ticker/MSFT/range/5/minute/2026-05-16/2026-05-26");
  });

  it("trims 1D history to the latest returned trading date", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          ticker: "MSFT",
          results: [
            { t: Date.UTC(2026, 4, 22, 14, 0), o: 1, h: 2, l: 1, c: 2, v: 100 },
            { t: Date.UTC(2026, 4, 26, 14, 0), o: 3, h: 4, l: 3, c: 4, v: 200 },
            { t: Date.UTC(2026, 4, 26, 15, 0), o: 5, h: 6, l: 5, c: 6, v: 300 },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    const series = await provider.getHistory({ symbol: "msft", range: "1D" });

    expect(series.bars.map((bar) => bar.timestamp)).toEqual(["2026-05-26T14:00:00.000Z", "2026-05-26T15:00:00.000Z"]);
  });

  it("rejects path-breaking history symbols with a structured error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ticker: "AAPL", results: [] }), { status: 200 }));
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    await expect(provider.getHistory({ symbol: "AAPL/../../MSFT?x#y", range: "1M" })).rejects.toMatchObject({
      code: "INVALID_MARKET_SYMBOL",
      source: "polygon",
      status: 400,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([".", ".."])("rejects dot-only history symbol %s with a structured error", async (symbol) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ticker: "AAPL", results: [] }), { status: 200 }));
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    await expect(provider.getHistory({ symbol, range: "1M" })).rejects.toMatchObject({
      code: "INVALID_MARKET_SYMBOL",
      source: "polygon",
      status: 400,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows dot and hyphen history symbols in a safe path segment", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ticker: "BRK.B-A", results: [] }), { status: 200 }));
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    await provider.getHistory({ symbol: " brk.b-a ", range: "1M" });

    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toMatch(/^\/v2\/aggs\/ticker\/BRK\.B-A\/range\/1\/day\//);
  });

  it.each(["AAPL,NVDA", "AAPL/../NVDA", "AAPL\u0000NVDA", "AAPL\nNVDA"])(
    "rejects invalid snapshot symbol %s with a structured error",
    async (symbol) => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ tickers: [] }), { status: 200 }));
      const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

      await expect(provider.getSnapshots([symbol])).rejects.toMatchObject({
        code: "INVALID_MARKET_SYMBOL",
        source: "polygon",
        status: 400,
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("caches snapshots by the normalized symbol set", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          tickers: [
            { ticker: "AAPL", day: { c: 190, v: 10 } },
            { ticker: "NVDA", day: { c: 950, v: 20 } },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    await provider.getSnapshots(["nvda", "AAPL", "nvda"]);
    await provider.getSnapshots(["aapl", "NVDA"]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("tickers")).toBe("AAPL,NVDA");
  });
});
