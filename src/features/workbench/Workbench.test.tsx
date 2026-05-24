import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot, PriceSeries } from "../../../shared/types";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";
import { Workbench } from "./Workbench";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Workbench", () => {
  it("renders a file-backed sector table with API stats and no watchlist creation", async () => {
    const fetchSnapshots = vi.fn(async (symbols: string[]) => symbols.map(snapshotFor));

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledWith(sectorSymbols));

    expect(screen.queryByRole("button", { name: "New Watchlist" })).not.toBeInTheDocument();
    expect(screen.queryByText("Live workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "API usage summary" })).toBeInTheDocument();
    expect(screen.getByText("Tracked symbols")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("stocks-starter has unlimited REST calls for this planner.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Dollar Volume" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Timeframe" })).toBeInTheDocument();
    expect(await screen.findByText("$39.1B")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("renders one toolbar with time span, refresh interval, sort, and rows controls", async () => {
    render(<Workbench api={createApi()} />);

    await screen.findByRole("table", { name: "Semiconductors quotes" });

    const toolbar = screen.getByRole("toolbar", { name: "Table controls" });
    const labels = within(toolbar).getAllByText(/^(Time span|Refresh interval|Sort by|Rows)$/);

    expect(labels.map((label) => label.textContent)).toEqual(["Time span", "Refresh interval", "Sort by", "Rows"]);
    expect(screen.getAllByRole("toolbar", { name: "Table controls" })).toHaveLength(1);
    expect(within(toolbar).getByLabelText("Refresh interval")).toHaveValue("60");
    expect(within(toolbar).getByLabelText("Time span")).toHaveValue("1h");
    expect(
      within(within(toolbar).getByLabelText("Refresh interval")).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["10s", "1m", "5m", "30m", "1h", "1d"]);
    expect(
      within(within(toolbar).getByLabelText("Time span")).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["1h", "1d", "5d", "30d", "3months", "1y", "5y"]);
  });

  it("sorts by heat and paginates the selected sector", async () => {
    const user = userEvent.setup();
    const fetchSnapshots = vi.fn(async (symbols: string[]) => symbols.map(snapshotFor));

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    const quoteTable = await screen.findByRole("table", { name: "Semiconductors quotes" });

    await user.selectOptions(screen.getByLabelText("Sort by"), "heat");

    expect(within(quoteTable).getAllByRole("button")[0]).toHaveTextContent("NVDA");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(within(quoteTable).getByRole("button", { name: "GE" })).toBeInTheDocument();
  });

  it("opens symbol history in an off-canvas detail panel and closes it", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) => priceSeries(symbol, range));

    render(<Workbench api={createApi({ getHistory })} />);

    const quoteTable = await screen.findByRole("table", { name: "Semiconductors quotes" });
    await user.click(within(quoteTable).getByRole("button", { name: "NVDA" }));

    expect(await screen.findByRole("dialog", { name: "NVDA details" })).toBeInTheDocument();
    expect(await screen.findByLabelText("NVDA chart")).toBeInTheDocument();
    expect(getHistory).toHaveBeenCalledWith("NVDA", "1h");

    await user.click(screen.getByRole("button", { name: "Close details" }));

    expect(screen.queryByRole("dialog", { name: "NVDA details" })).not.toBeInTheDocument();
  });

  it("requests new history when the off-canvas chart range changes", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) => priceSeries(symbol, range));

    render(<Workbench api={createApi({ getHistory })} />);

    const quoteTable = await screen.findByRole("table", { name: "Semiconductors quotes" });
    await user.click(within(quoteTable).getByRole("button", { name: "NVDA" }));
    const detailPanel = await screen.findByRole("dialog", { name: "NVDA details" });
    await user.click(within(detailPanel).getByRole("button", { name: "5y" }));

    await waitFor(() => expect(getHistory).toHaveBeenLastCalledWith("NVDA", "5y"));
  });

  it("uses the selected toolbar time span when opening history without changing refresh cadence", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) => priceSeries(symbol, range));
    const evaluateRatePlan = vi.fn(async () => ratePlanEvaluation);

    render(<Workbench api={createApi({ getHistory, evaluateRatePlan })} />);

    const toolbar = await screen.findByRole("toolbar", { name: "Table controls" });
    await user.selectOptions(within(toolbar).getByLabelText("Time span"), "5d");

    const quoteTable = await screen.findByRole("table", { name: "Semiconductors quotes" });
    await user.click(within(quoteTable).getByRole("button", { name: "NVDA" }));

    expect(await screen.findByRole("dialog", { name: "NVDA details" })).toBeInTheDocument();
    await waitFor(() => expect(getHistory).toHaveBeenLastCalledWith("NVDA", "5d"));
    expect(evaluateRatePlan).toHaveBeenCalledWith(expect.objectContaining({ intervalSeconds: 60 }));
  });

  it("polls the newly selected sector as one flattened symbol list", async () => {
    const user = userEvent.setup();
    const fetchSnapshots = vi.fn(async (symbols: string[]) => symbols.map(snapshotFor));

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledWith(sectorSymbols));

    await user.click(screen.getByRole("button", { name: "Consumer Staples" }));

    await waitFor(() => expect(fetchSnapshots).toHaveBeenLastCalledWith(["COST", "WMT", "PG", "KO"]));
    expect(screen.getByRole("table", { name: "Consumer Staples quotes" })).toBeInTheDocument();
  });

  it("shows loading and config errors accessibly", async () => {
    const { unmount } = render(<Workbench api={createApi({ configPromise: new Promise(() => undefined) })} />);

    expect(screen.getByText("Loading watchlists...")).toBeInTheDocument();
    unmount();

    render(<Workbench api={createApi({ configError: new Error("Config unavailable") })} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Config unavailable");
  });

  it("renders an accessible error when snapshot fetching fails", async () => {
    const fetchSnapshots = vi.fn(async () => {
      throw new Error("Snapshots unavailable");
    });

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Snapshots unavailable");
  });

  it("evaluates the refresh budget with selected sector symbol count and default one minute interval", async () => {
    const evaluateRatePlan = vi.fn(async () => ratePlanEvaluation);

    render(<Workbench api={createApi({ evaluateRatePlan })} />);

    await waitFor(() =>
      expect(evaluateRatePlan).toHaveBeenCalledWith({
        ...baseConfig.settings.polygon,
        activeSymbolCount: sectorSymbols.length,
        cacheHitRatio: 0.3,
        endpointCount: 1,
        intervalSeconds: 60,
      }),
    );
  });
});

const sectorSymbols = [
  "NVDA",
  "AMD",
  "ASML",
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "META",
  "TSLA",
  "COST",
  "WMT",
  "PG",
  "KO",
  "PEP",
  "JPM",
  "BAC",
  "XOM",
  "CVX",
  "UNH",
  "LLY",
  "GE",
  "CAT",
  "RTX",
];

const baseConfig: WorkbenchConfig = {
  settings: {
    polygon: {
      plan: "paid",
      paidPlanName: "stocks-starter",
      warningThreshold: 0.75,
      hardThreshold: 0.95,
    },
  },
  watchlists: {
    watchlists: [
      {
        id: "semis",
        name: "Semiconductors",
        pinnedSymbols: ["NVDA"],
        rows: [
          { id: "leaders", name: "Leaders", expandedByDefault: true, symbols: ["nvda", "AMD", "ASML", "NVDA"] },
          { id: "market", name: "Market", expandedByDefault: true, symbols: sectorSymbols.slice(3) },
        ],
      },
      {
        id: "consumer-staples",
        name: "Consumer Staples",
        pinnedSymbols: ["COST"],
        rows: [
          { id: "staples", name: "Staples", expandedByDefault: true, symbols: ["COST", "WMT", "PG", "KO"] },
        ],
      },
    ],
  },
};

const ratePlanEvaluation: Awaited<ReturnType<WorkbenchApi["evaluateRatePlan"]>> = {
  status: "ok",
  plan: "paid",
  intervalSeconds: 60,
  estimatedCallsPerMinute: 1,
  message: "stocks-starter has unlimited REST calls for this planner.",
  disabledIntervals: [],
};

function createApi({
  config = baseConfig,
  configError,
  configPromise,
  fetchSnapshots = vi.fn(async (symbols: string[]) => symbols.map(snapshotFor)),
  getHistory = vi.fn(async (symbol, range) => priceSeries(symbol, range)),
  evaluateRatePlan = vi.fn(async () => ratePlanEvaluation),
}: {
  config?: WorkbenchConfig;
  configError?: Error;
  configPromise?: Promise<WorkbenchConfig>;
  fetchSnapshots?: WorkbenchApi["fetchSnapshots"];
  getHistory?: WorkbenchApi["getHistory"];
  evaluateRatePlan?: WorkbenchApi["evaluateRatePlan"];
} = {}): WorkbenchApi {
  return {
    getConfig: vi.fn(async () => {
      if (configError) {
        throw configError;
      }

      return configPromise ?? config;
    }),
    fetchSnapshots,
    getHistory,
    evaluateRatePlan,
  };
}

function snapshotFor(symbol: string): MarketSnapshot {
  const overrides: Record<string, Partial<MarketSnapshot>> = {
    NVDA: {
      name: "NVIDIA Corporation",
      price: 927.75,
      change: 22.18,
      changePercent: 2.45,
      volume: 42_100_000,
    },
    AMD: {
      name: "Advanced Micro Devices",
      price: 164.1,
      change: -1.31,
      changePercent: -0.8,
      volume: 35_000_000,
    },
    ASML: {
      name: "ASML Holding",
      price: 956.24,
      change: 12.91,
      changePercent: 1.35,
      volume: 1_200_000,
    },
  };
  const index = sectorSymbols.indexOf(symbol);
  const fallbackPrice = 100 + Math.max(index, 0);

  return {
    symbol,
    name: overrides[symbol]?.name ?? `${symbol} Inc.`,
    price: overrides[symbol]?.price ?? fallbackPrice,
    change: overrides[symbol]?.change ?? 0.5,
    changePercent: overrides[symbol]?.changePercent ?? 0.5,
    volume: overrides[symbol]?.volume ?? 1_000_000 + Math.max(index, 0) * 1_000,
    updatedAt: "2026-05-23T14:30:00.000Z",
    timeframe: "DELAYED",
  };
}

function priceSeries(symbol: string, range: PriceSeries["range"]): PriceSeries {
  return {
    symbol,
    range,
    bars: [
      {
        timestamp: "2026-05-22T13:30:00.000Z",
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 100,
      },
      {
        timestamp: "2026-05-23T13:30:00.000Z",
        open: 11,
        high: 15,
        low: 10,
        close: 14,
        volume: 200,
      },
    ],
  };
}
