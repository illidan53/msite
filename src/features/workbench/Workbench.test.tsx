import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot, PriceSeries, RecommendationCandidate } from "../../../shared/types";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";
import { Workbench } from "./Workbench";

afterEach(() => {
  cleanup();
});

describe("Workbench", () => {
  it("initially polls only expanded row symbols", async () => {
    const fetchSnapshots = vi.fn(async () => []);

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledWith(["NVDA", "AMD"]));
    expect(fetchSnapshots).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Leaders" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Equipment" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Sync paused")).toBeInTheDocument();
  });

  it("shows collapsed row paused state and renders detail when a symbol is selected", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) => priceSeries(symbol, range));

    render(<Workbench api={createApi({ getHistory })} />);

    expect(await screen.findByText("Sync paused")).toBeInTheDocument();
    expect(screen.queryByLabelText("NVDA chart")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "NVDA" }));

    expect(await screen.findByLabelText("NVDA chart")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1M" })).toHaveAttribute("aria-pressed", "true");
    expect(getHistory).toHaveBeenCalledWith("NVDA", "1M");
  });

  it("renders snapshot values in the quote table after refresh", async () => {
    render(<Workbench api={createApi({ fetchSnapshots: vi.fn(async () => marketSnapshots) })} />);

    expect(await screen.findByText("$927.75")).toBeInTheDocument();
    expect(screen.getByText("+2.45%")).toBeInTheDocument();
    expect(screen.getByText("42.1M")).toBeInTheDocument();
    expect(screen.getByText("2026-05-23 14:30 UTC")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Symbol" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Change %" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Volume" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Updated" })).toBeInTheDocument();
  });

  it("fetches history for the selected symbol and selected chart range", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) => priceSeries(symbol, range));

    render(<Workbench api={createApi({ getHistory })} />);

    await user.click(await screen.findByRole("button", { name: "AMD" }));
    await waitFor(() => expect(getHistory).toHaveBeenCalledWith("AMD", "1M"));

    await user.click(screen.getByRole("button", { name: "5D" }));

    await waitFor(() => expect(getHistory).toHaveBeenLastCalledWith("AMD", "5D"));
  });

  it("saves a recommended watchlist and adds it to the rail", async () => {
    const user = userEvent.setup();
    const saveWatchlists = vi.fn(async (watchlists) => watchlists);
    const recommendWatchlist = vi.fn(async () => recommendationCandidates);

    render(<Workbench api={createApi({ recommendWatchlist, saveWatchlists })} />);

    await user.click(await screen.findByRole("button", { name: "New Watchlist" }));
    await user.type(screen.getByLabelText("Name"), "AI Leaders");
    await user.type(screen.getByLabelText("Theme"), "AI chips");
    await user.type(screen.getByLabelText("Pinned symbols"), "nvda");
    await user.click(screen.getByRole("button", { name: "Recommend" }));
    await user.click(await screen.findByRole("checkbox", { name: /TSM/i }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveWatchlists).toHaveBeenCalledWith({
        watchlists: [
          baseWatchlist,
          {
            id: "ai-leaders",
            name: "AI Leaders",
            theme: "AI chips",
            pinnedSymbols: ["NVDA"],
            rows: [
              {
                id: "recommended",
                name: "Recommended",
                expandedByDefault: true,
                symbols: ["NVDA", "TSM"],
              },
            ],
          },
        ],
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Watchlist editor" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI Leaders" })).toBeInTheDocument();
  });

  it("keeps the watchlist editor open and shows an alert when save fails", async () => {
    const user = userEvent.setup();
    const saveWatchlists = vi.fn(async () => {
      throw new Error("Config save failed");
    });

    render(<Workbench api={createApi({ saveWatchlists })} />);

    await user.click(await screen.findByRole("button", { name: "New Watchlist" }));
    await user.type(screen.getByLabelText("Name"), "Compounders");
    await user.type(screen.getByLabelText("Pinned symbols"), "cost");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Config save failed");
    expect(screen.getByRole("dialog", { name: "Watchlist editor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compounders" })).not.toBeInTheDocument();
  });

  it("adds collapsed row symbols to polling when the row is expanded", async () => {
    const user = userEvent.setup();
    const fetchSnapshots = vi.fn(async () => []);

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledWith(["NVDA", "AMD"]));

    await user.click(screen.getByRole("button", { name: "Equipment" }));

    await waitFor(() => expect(fetchSnapshots).toHaveBeenLastCalledWith(["NVDA", "AMD", "ASML"]));
    expect(fetchSnapshots).toHaveBeenCalledTimes(2);
  });

  it("removes collapsed row symbols from the next snapshot request", async () => {
    const user = userEvent.setup();
    const fetchSnapshots = vi.fn(async () => []);

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledWith(["NVDA", "AMD"]));

    await user.click(screen.getByRole("button", { name: "Equipment" }));
    await waitFor(() => expect(fetchSnapshots).toHaveBeenLastCalledWith(["NVDA", "AMD", "ASML"]));

    await user.click(screen.getByRole("button", { name: "Leaders" }));

    await waitFor(() => expect(fetchSnapshots).toHaveBeenLastCalledWith(["ASML"]));
    expect(fetchSnapshots).toHaveBeenCalledTimes(3);
  });

  it("does not fetch snapshots when no configured rows are expanded", async () => {
    const fetchSnapshots = vi.fn(async () => []);

    render(<Workbench api={createApi({ config: noExpandedConfig, fetchSnapshots })} />);

    await screen.findByRole("heading", { name: "Stock Workbench" });

    expect(fetchSnapshots).not.toHaveBeenCalled();
    expect(screen.getAllByText("Sync paused")).toHaveLength(2);
  });

  it("shows a loading state while config is unresolved", () => {
    const api = createApi({ configPromise: new Promise(() => undefined) });

    render(<Workbench api={api} />);

    expect(screen.getByText("Loading watchlists...")).toBeInTheDocument();
  });

  it("renders an accessible error when config loading fails", async () => {
    const api = createApi({ configError: new Error("Config unavailable") });

    render(<Workbench api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Config unavailable");
    expect(screen.queryByText("Loading watchlists...")).not.toBeInTheDocument();
  });

  it("renders an accessible error when snapshot fetching fails", async () => {
    const fetchSnapshots = vi.fn(async () => {
      throw new Error("Snapshots unavailable");
    });

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Snapshots unavailable");
  });

  it("evaluates the refresh budget with active symbol count after config loads", async () => {
    const evaluateRatePlan = vi.fn(async () => ratePlanEvaluation);

    render(<Workbench api={createApi({ evaluateRatePlan })} />);

    await waitFor(() =>
      expect(evaluateRatePlan).toHaveBeenCalledWith({
        ...baseConfig.settings.polygon,
        activeSymbolCount: 2,
        cacheHitRatio: 0.3,
        endpointCount: 1,
        intervalSeconds: 30,
      }),
    );
  });

  it("re-evaluates the refresh budget when the interval changes", async () => {
    const user = userEvent.setup();
    const evaluateRatePlan = vi.fn(async () => ratePlanEvaluation);

    render(<Workbench api={createApi({ evaluateRatePlan })} />);

    await waitFor(() => expect(evaluateRatePlan).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "1m" }));

    await waitFor(() =>
      expect(evaluateRatePlan).toHaveBeenLastCalledWith({
        ...baseConfig.settings.polygon,
        activeSymbolCount: 2,
        cacheHitRatio: 0.3,
        endpointCount: 1,
        intervalSeconds: 60,
      }),
    );
  });
});

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
          { id: "leaders", name: "Leaders", expandedByDefault: true, symbols: ["nvda", "AMD", "nvda"] },
          { id: "equipment", name: "Equipment", expandedByDefault: false, symbols: ["asml"] },
        ],
      },
    ],
  },
};

const baseWatchlist = baseConfig.watchlists.watchlists[0];

const noExpandedConfig: WorkbenchConfig = {
  ...baseConfig,
  watchlists: {
    watchlists: [
      {
        ...baseWatchlist,
        rows: baseWatchlist.rows.map((row) => ({
          ...row,
          expandedByDefault: false,
        })),
      },
    ],
  },
};

const ratePlanEvaluation: Awaited<ReturnType<WorkbenchApi["evaluateRatePlan"]>> = {
  status: "ok",
  plan: "paid",
  intervalSeconds: 30,
  estimatedCallsPerMinute: 2,
  message: "ok",
  disabledIntervals: [],
};

function createApi({
  config = baseConfig,
  configError,
  configPromise,
  fetchSnapshots = vi.fn(async () => []),
  getHistory = vi.fn(async (symbol, range) => priceSeries(symbol, range)),
  evaluateRatePlan = vi.fn(async () => ratePlanEvaluation),
  recommendWatchlist = vi.fn(async () => []),
  saveWatchlists = vi.fn(async (watchlists) => watchlists),
}: {
  config?: WorkbenchConfig;
  configError?: Error;
  configPromise?: Promise<WorkbenchConfig>;
  fetchSnapshots?: WorkbenchApi["fetchSnapshots"];
  getHistory?: WorkbenchApi["getHistory"];
  evaluateRatePlan?: WorkbenchApi["evaluateRatePlan"];
  recommendWatchlist?: WorkbenchApi["recommendWatchlist"];
  saveWatchlists?: WorkbenchApi["saveWatchlists"];
} = {}): WorkbenchApi {
  return {
    getConfig: vi.fn(async () => {
      if (configError) {
        throw configError;
      }

      return configPromise ?? config;
    }),
    saveWatchlists,
    fetchSnapshots,
    getHistory,
    evaluateRatePlan,
    recommendWatchlist,
  };
}

const marketSnapshots: MarketSnapshot[] = [
  {
    symbol: "NVDA",
    name: "Nvidia",
    price: 927.75,
    change: 22.18,
    changePercent: 2.45,
    volume: 42_100_000,
    updatedAt: "2026-05-23T14:30:00.000Z",
    timeframe: "DELAYED",
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices",
    price: null,
    change: null,
    changePercent: null,
    volume: null,
    updatedAt: null,
    timeframe: "UNKNOWN",
  },
];

const recommendationCandidates: RecommendationCandidate[] = [
  {
    symbol: "NVDA",
    name: "Nvidia",
    source: "pinned",
    score: 100,
    reasons: ["user pinned"],
  },
  {
    symbol: "TSM",
    name: "Taiwan Semiconductor",
    source: "related",
    score: 80,
    reasons: ["related candidate"],
  },
];

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
