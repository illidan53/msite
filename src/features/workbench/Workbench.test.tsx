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

function createApi({
  config = baseConfig,
  configPromise,
  fetchSnapshots = vi.fn(async () => []),
}: {
  config?: WorkbenchConfig;
  configPromise?: Promise<WorkbenchConfig>;
  fetchSnapshots?: WorkbenchApi["fetchSnapshots"];
} = {}): WorkbenchApi {
  const ratePlanEvaluation: Awaited<ReturnType<WorkbenchApi["evaluateRatePlan"]>> = {
    status: "ok",
    plan: "paid",
    intervalSeconds: 30,
    estimatedCallsPerMinute: 2,
    message: "ok",
    disabledIntervals: [],
  };

  return {
    getConfig: vi.fn(async () => configPromise ?? config),
    fetchSnapshots,
    getHistory: vi.fn(async (symbol, range) => ({ symbol, range, bars: [] })),
    evaluateRatePlan: vi.fn(async () => ratePlanEvaluation),
  };
}
