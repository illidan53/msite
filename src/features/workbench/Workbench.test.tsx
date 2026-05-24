import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  evaluateRatePlan = vi.fn(async () => ratePlanEvaluation),
}: {
  config?: WorkbenchConfig;
  configError?: Error;
  configPromise?: Promise<WorkbenchConfig>;
  fetchSnapshots?: WorkbenchApi["fetchSnapshots"];
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
    getHistory: vi.fn(async (symbol, range) => ({ symbol, range, bars: [] })),
    evaluateRatePlan,
  };
}
