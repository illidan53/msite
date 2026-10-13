import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot, PriceSeries } from "../../../shared/types";
import {
  ApiRequestError,
  type WorkbenchApi,
  type WorkbenchConfig,
} from "../../shared/apiClient";
import {
  latestFixture,
  paperFixture,
  reportFixtures,
  stateFixture,
} from "../strategy/fixtures";
import { Workbench } from "./Workbench";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Workbench", () => {
  it("renders a file-backed sector table with API stats and no watchlist creation", async () => {
    const fetchSnapshots = vi.fn(async (symbols: string[]) =>
      symbols.map(snapshotFor),
    );

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await waitFor(() =>
      expect(fetchSnapshots).toHaveBeenCalledWith(sectorSymbols),
    );

    await userEvent.click(screen.getByText("Data connection"));
    await userEvent.click(screen.getByRole("button", { name: "All columns" }));
    expect(
      screen.queryByRole("button", { name: "New Watchlist" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Live workspace")).not.toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "API usage summary" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tracked symbols")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("Quote requests this session")).toBeInTheDocument();
    expect(
      screen.getByText("History requests this session"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Today's API calls")).not.toBeInTheDocument();
    expect(screen.queryByText("Historical API calls")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "stocks-starter has unlimited REST calls for this planner.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Business" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "AI GPU platforms" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Session Chg" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Session Chg %" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Span Chg" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Span Chg %" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Dollar Volume" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Timeframe" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("$39.1B")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("polls snapshots every minute and reports the browser refresh time when market timestamps stay unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T15:00:00.000Z"));
    const fetchSnapshots = vi.fn(async (symbols: string[]) =>
      symbols.map((symbol) => ({
        ...snapshotFor(symbol),
        updatedAt: "2026-05-26T14:53:00.000Z",
      })),
    );

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await flushEffects();
    expect(fetchSnapshots).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Last refreshed 2026-05-26 15:00 UTC"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("2026-05-26 14:53 UTC").length).toBeGreaterThan(
      0,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchSnapshots).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Last refreshed 2026-05-26 15:01 UTC"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("2026-05-26 14:53 UTC").length).toBeGreaterThan(
      0,
    );
  });

  it("counts quote refreshes as batched workbench requests instead of symbol refresh units", async () => {
    const fetchSnapshots = vi.fn(async (symbols: string[]) =>
      symbols.map(snapshotFor),
    );

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await userEvent.click(await screen.findByText("Data connection"));
    const usageTable = await screen.findByRole("table", {
      name: "API usage summary",
    });

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledTimes(1));
    expect(
      within(usageTable).getByRole("row", {
        name: "Quote requests this session 1",
      }),
    ).toBeInTheDocument();
    expect(
      within(usageTable).getByRole("row", {
        name: "REST requests this session 21",
      }),
    ).toBeInTheDocument();
    expect(within(usageTable).queryByText("41,510")).not.toBeInTheDocument();
  });

  it("renders one toolbar with time span, refresh interval, sort, and rows controls", async () => {
    render(<Workbench api={createApi()} />);

    await screen.findByRole("table", { name: "Semiconductors quotes" });

    const toolbar = screen.getByRole("toolbar", { name: "Table controls" });
    const labels = within(toolbar).getAllByText(
      /^(Time span|Refresh interval|Sort by|Rows)$/,
    );

    expect(labels.map((label) => label.textContent)).toEqual([
      "Time span",
      "Refresh interval",
      "Sort by",
      "Rows",
    ]);
    expect(
      screen.getAllByRole("toolbar", { name: "Table controls" }),
    ).toHaveLength(1);
    expect(within(toolbar).getByLabelText("Refresh interval")).toHaveValue(
      "60",
    );
    expect(within(toolbar).getByLabelText("Time span")).toHaveValue("1h");
    expect(
      within(within(toolbar).getByLabelText("Refresh interval"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["10s", "1m", "5m", "30m", "1h", "1d"]);
    expect(
      within(within(toolbar).getByLabelText("Time span"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["1h", "1d", "5d", "30d", "3months", "1y", "5y"]);
  });

  it("sorts by heat and paginates the selected sector", async () => {
    const user = userEvent.setup();
    const fetchSnapshots = vi.fn(async (symbols: string[]) =>
      symbols.map(snapshotFor),
    );

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    const quoteTable = await screen.findByRole("table", {
      name: "Semiconductors quotes",
    });

    await user.selectOptions(screen.getByLabelText("Sort by"), "heat");

    expect(
      within(quoteTable).getAllByRole("button", { name: /^[A-Z]+$/ })[0],
    ).toHaveTextContent("NVDA");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(
      within(quoteTable).getByRole("button", { name: "GE" }),
    ).toBeInTheDocument();
  });

  it("uses selected time span movement for heat sorting when history is available", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) => {
      if (symbol === "AMD") {
        return priceSeries(symbol, range, [100, 125]);
      }

      if (symbol === "NVDA") {
        return priceSeries(symbol, range, [100, 101]);
      }

      return priceSeries(symbol, range, [100, 100]);
    });

    render(<Workbench api={createApi({ getHistory })} />);

    const quoteTable = await screen.findByRole("table", {
      name: "Semiconductors quotes",
    });
    await waitFor(() =>
      expect(within(quoteTable).getByText("+25.00%")).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByLabelText("Sort by"), "heat");

    await waitFor(() =>
      expect(
        within(quoteTable).getAllByRole("button", { name: /^[A-Z]+$/ })[0],
      ).toHaveTextContent("AMD"),
    );
  });

  it("opens symbol history in an linked detail panel and closes it", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) =>
      priceSeries(symbol, range),
    );

    render(<Workbench api={createApi({ getHistory })} />);

    const quoteTable = await screen.findByRole("table", {
      name: "Semiconductors quotes",
    });
    await user.click(within(quoteTable).getByRole("button", { name: "NVDA" }));

    expect(
      await screen.findByRole("complementary", { name: "NVDA details" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("NVDA chart")).toBeInTheDocument();
    await user.click(screen.getByText("Quote & range details"));
    const detailSummary = await screen.findByRole("table", {
      name: "NVDA detail summary",
    });
    expect(
      within(detailSummary).getByRole("row", {
        name: "Name NVIDIA Corporation",
      }),
    ).toBeInTheDocument();
    expect(
      within(detailSummary).getByRole("row", { name: "Price $927.75" }),
    ).toBeInTheDocument();
    expect(
      within(detailSummary).getByRole("row", { name: "Span Chg +3.00" }),
    ).toBeInTheDocument();
    expect(
      within(detailSummary).getByRole("row", { name: "Range High $15.00" }),
    ).toBeInTheDocument();
    expect(
      within(detailSummary).getByRole("row", { name: "Range Volume 300" }),
    ).toBeInTheDocument();
    expect(getHistory).toHaveBeenCalledWith("NVDA", "1h");

    await user.click(screen.getByRole("button", { name: "Close details" }));

    expect(
      screen.queryByRole("complementary", { name: "NVDA details" }),
    ).not.toBeInTheDocument();
  });

  it("requests new history when the linked chart range changes", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) =>
      priceSeries(symbol, range),
    );

    render(<Workbench api={createApi({ getHistory })} />);

    const quoteTable = await screen.findByRole("table", {
      name: "Semiconductors quotes",
    });
    await user.click(within(quoteTable).getByRole("button", { name: "NVDA" }));
    const detailPanel = await screen.findByRole("complementary", {
      name: "NVDA details",
    });
    await user.click(within(detailPanel).getByRole("button", { name: "5y" }));

    await waitFor(() => expect(getHistory).toHaveBeenCalledWith("NVDA", "5y"));
  });

  it("uses the selected toolbar time span when opening history without changing refresh cadence", async () => {
    const user = userEvent.setup();
    const getHistory = vi.fn(async (symbol, range) =>
      priceSeries(symbol, range),
    );
    const evaluateRatePlan = vi.fn(async () => ratePlanEvaluation);

    render(<Workbench api={createApi({ getHistory, evaluateRatePlan })} />);

    const toolbar = await screen.findByRole("toolbar", {
      name: "Table controls",
    });
    await user.selectOptions(within(toolbar).getByLabelText("Time span"), "5d");

    const quoteTable = await screen.findByRole("table", {
      name: "Semiconductors quotes",
    });
    await user.click(within(quoteTable).getByRole("button", { name: "NVDA" }));

    expect(
      await screen.findByRole("complementary", { name: "NVDA details" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(getHistory).toHaveBeenCalledWith("NVDA", "5d"));
    expect(evaluateRatePlan).toHaveBeenCalledWith(
      expect.objectContaining({ intervalSeconds: 60 }),
    );
  });

  it("loads all menu performances in one batch without refetching on watchlist selection", async () => {
    const user = userEvent.setup();
    const fetchSnapshots = vi.fn(async (symbols: string[]) =>
      symbols.map(snapshotFor),
    );

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    await waitFor(() =>
      expect(fetchSnapshots).toHaveBeenCalledWith(sectorSymbols),
    );

    await user.click(screen.getByRole("button", { name: "Watchlist" }));
    await user.click(screen.getByRole("button", { name: "Consumer Staples" }));

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("table", { name: "Consumer Staples quotes" }),
    ).toBeInTheDocument();
  });

  it("shows colored equal-weight returns for unvisited menus and the selected heading", async () => {
    const watchlists = [
      {
        ...baseConfig.watchlists.watchlists[0],
        id: "first",
        name: "First",
        rows: [
          {
            id: "a",
            name: "a",
            expandedByDefault: true,
            symbols: ["AAA", "BBB", "AAA"],
          },
        ],
      },
      {
        ...baseConfig.watchlists.watchlists[0],
        id: "second",
        name: "Second",
        rows: [
          { id: "b", name: "b", expandedByDefault: true, symbols: ["CCC"] },
        ],
      },
    ];
    const fetchSnapshots = vi.fn(async (symbols: string[]) =>
      symbols.map((symbol) => ({
        ...snapshotFor(symbol),
        sessionChangePercent: symbol === "AAA" ? 3 : symbol === "BBB" ? -1 : -2,
      })),
    );
    const { container } = render(
      <Workbench
        api={createApi({
          config: { ...baseConfig, watchlists: { watchlists } },
          fetchSnapshots,
        })}
      />,
    );
    await waitFor(() =>
      expect(fetchSnapshots).toHaveBeenCalledWith(["AAA", "BBB", "CCC"]),
    );
    await userEvent.click(screen.getByRole("button", { name: "Watchlist" }));
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    expect(within(first).getByText("+1.00%")).toHaveClass("positive-change");
    expect(within(second).getByText("-2.00%")).toHaveClass("negative-change");
    expect(
      container.querySelector(
        ".watchlist-heading-line > .watchlist-performance",
      ),
    ).toHaveTextContent("+1.00%");
    await userEvent.click(second);
    expect(
      container.querySelector(
        ".watchlist-heading-line > .watchlist-performance",
      ),
    ).toHaveTextContent("-2.00%");
    expect(fetchSnapshots).toHaveBeenCalledTimes(1);
  });

  it("removes omitted quotes on refresh instead of reusing their old returns", async () => {
    vi.useFakeTimers();
    const watchlist = {
      ...baseConfig.watchlists.watchlists[0],
      rows: [
        {
          id: "a",
          name: "a",
          expandedByDefault: true,
          symbols: ["AAA", "BBB"],
        },
      ],
    };
    let complete = true;
    const fetchSnapshots = vi.fn(async () =>
      (complete ? ["AAA", "BBB"] : ["AAA"]).map((symbol) => ({
        ...snapshotFor(symbol),
        sessionChangePercent: symbol === "AAA" ? 2 : -2,
      })),
    );
    const { container } = render(
      <Workbench
        api={createApi({
          config: { ...baseConfig, watchlists: { watchlists: [watchlist] } },
          fetchSnapshots,
        })}
      />,
    );
    await flushEffects();
    expect(
      container.querySelector(
        ".watchlist-heading-line > .watchlist-performance",
      ),
    ).toHaveTextContent("0.00%");
    complete = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      container.querySelector(
        ".watchlist-heading-line > .watchlist-performance",
      ),
    ).toHaveTextContent("+2.00%*");
    expect(
      container.querySelector(".watchlist-performance-caption"),
    ).toHaveTextContent("1/2");
  });

  it("splits large watchlist universes into batches supported by the snapshots endpoint", async () => {
    const symbols = Array.from({ length: 260 }, (_, index) => `S${index}`);
    const config = {
      ...baseConfig,
      watchlists: {
        watchlists: [
          {
            ...baseConfig.watchlists.watchlists[0],
            rows: [
              { id: "all", name: "all", expandedByDefault: true, symbols },
            ],
          },
        ],
      },
    };
    const fetchSnapshots = vi.fn(async (items: string[]) =>
      items.map(snapshotFor),
    );
    render(<Workbench api={createApi({ config, fetchSnapshots })} />);
    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledTimes(2));
    expect(fetchSnapshots.mock.calls.map(([items]) => items.length)).toEqual([
      250, 10,
    ]);
  });

  it("shows loading and config errors accessibly", async () => {
    const { unmount } = render(
      <Workbench
        api={createApi({ configPromise: new Promise(() => undefined) })}
      />,
    );

    expect(screen.getByText("Loading watchlists...")).toBeInTheDocument();
    unmount();

    render(
      <Workbench
        api={createApi({ configError: new Error("Config unavailable") })}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Config unavailable",
    );
  });

  it("opens Analytics → Quant System from the rail before Models", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const fetcher = vi.fn(async (url: string) => {
      const json =
        url === "/api/research/access"
          ? { canRun: false, clientIp: null }
          : url === "/api/strategy/state"
            ? stateFixture
            : url === "/api/strategy/latest"
              ? latestFixture
              : url.startsWith("/api/strategy/reports/")
                ? reportFixtures[0]
                : url.startsWith("/api/strategy/paper/")
                  ? paperFixture()
                  : null;
      return json
        ? { ok: true, status: 200, json: async () => json }
        : { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    try {
      render(<Workbench api={createApi()} />);
      const menu = await screen.findByRole("button", { name: "Models" });
      const quant = screen.getByRole("button", { name: "Quant System" });
      expect(
        quant.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await user.click(quant);
      expect(quant).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("heading", { name: "Quant System", level: 2 }),
      ).toBeInTheDocument();
      expect(screen.getByText("ANALYTICS / QUANT SYSTEM")).toBeInTheDocument();
      expect(
        await screen.findByRole("tab", { name: "Overview" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        await screen.findByRole("heading", { name: "System status" }),
      ).toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledWith(
        "/api/strategy/state",
        expect.objectContaining({ method: "GET" }),
      );
    } finally {
      // Unmount first so late chart effects never run without the stubs.
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("renders an accessible error when snapshot fetching fails", async () => {
    const fetchSnapshots = vi.fn(async () => {
      throw new Error("Snapshots unavailable");
    });

    render(<Workbench api={createApi({ fetchSnapshots })} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Snapshots unavailable",
    );
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

  it("filters the quote table by sub-sector from a sliding bar", async () => {
    const user = userEvent.setup();
    const [semis, staples] = baseConfig.watchlists.watchlists;
    const config: WorkbenchConfig = {
      ...baseConfig,
      watchlists: {
        watchlists: [
          {
            ...semis,
            subsectors: [
              {
                id: "ai-chips",
                name: "AI chips",
                description: "GPU and custom AI accelerator (ASIC) designers",
                symbols: ["NVDA", "AMD"],
              },
              { id: "equipment", name: "Equipment & test", symbols: ["ASML"] },
            ],
          },
          staples,
        ],
      },
    };
    const addWatchlistSymbol = vi.fn<WorkbenchApi["addWatchlistSymbol"]>(
      async (_id, { symbol }) => ({ symbol, watchlists: config.watchlists }),
    );
    render(
      <Workbench
        api={createApi({
          config,
          getSession: async () => ({
            user: { provider: "google", email: "alice@example.com" },
            providers: ["google", "microsoft"],
          }),
          addWatchlistSymbol,
        })}
      />,
    );

    const bar = await screen.findByRole("group", { name: "Sub-sectors" });
    const table = screen.getByRole("table", { name: "Semiconductors quotes" });
    const option = (name: RegExp) => within(bar).getByRole("button", { name });
    expect(option(/^All/)).toHaveAttribute("aria-pressed", "true");
    expect(within(table).getAllByRole("button", { name: /^[A-Z.]+$/ })).toHaveLength(20);
    expect(
      within(bar).getByRole("button", { name: "Previous sub-sector" }),
    ).toBeDisabled();

    await user.click(option(/^AI chips/));
    expect(option(/^AI chips/)).toHaveAttribute("aria-pressed", "true");
    expect(
      within(table)
        .getAllByRole("button", { name: /^[A-Z.]+$/ })
        .map((button) => button.textContent),
    ).toEqual(["NVDANVIDIA Corporation", "AMDAdvanced Micro Devices"]);
    expect(
      screen.getByText(/^2 symbols · GPU and custom AI accelerator \(ASIC\) designers/),
    ).toBeInTheDocument();
    // The whole-list heading is unchanged by the filter.
    expect(screen.getByText(/^23 symbols/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit list" }));
    const editor = screen.getByRole("region", { name: "Edit watchlist" });
    expect(within(editor).getByRole("checkbox", { name: "AI chips" })).toBeChecked();
    expect(
      within(editor).getByRole("checkbox", { name: "Equipment & test" }),
    ).not.toBeChecked();
    await user.type(within(editor).getByLabelText("Symbol"), "tsm");
    await user.click(within(editor).getByRole("button", { name: "Add stock" }));
    expect(addWatchlistSymbol).toHaveBeenCalledWith("semis", {
      symbol: "TSM",
      rowId: "leaders",
      description: undefined,
      subsectors: ["ai-chips"],
    });

    await user.click(within(bar).getByRole("button", { name: "Next sub-sector" }));
    expect(option(/^Equipment & test/)).toHaveAttribute("aria-pressed", "true");
    expect(within(table).getByRole("button", { name: "ASML" })).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "NVDA" })).not.toBeInTheDocument();
    expect(
      within(bar).getByRole("button", { name: "Next sub-sector" }),
    ).toBeDisabled();
    option(/^Equipment & test/).focus();
    await user.keyboard("{ArrowLeft}");
    expect(option(/^AI chips/)).toHaveAttribute("aria-pressed", "true");
    expect(option(/^AI chips/)).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Watchlist" }));
    await user.click(screen.getByRole("button", { name: "Consumer Staples" }));
    expect(
      screen.queryByRole("group", { name: "Sub-sectors" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Semiconductors" }));
    expect(
      within(screen.getByRole("group", { name: "Sub-sectors" })).getByRole(
        "button",
        { name: /^All/ },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("hides editing and sign-in when the server has no sign-in providers", async () => {
    const getSession = vi.fn(async () => ({ user: null, providers: [] }));
    render(<Workbench api={createApi({ getSession })} />);

    await screen.findByRole("table", { name: "Semiconductors quotes" });
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Edit list" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign in" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove / }),
    ).not.toBeInTheDocument();
  });

  it("asks signed-out visitors to sign in with Google or Microsoft before editing", async () => {
    const user = userEvent.setup();
    render(
      <Workbench
        api={createApi({
          getSession: async () => ({
            user: null,
            providers: ["google", "microsoft"],
          }),
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Edit list" }));
    const prompt = screen.getByRole("region", { name: "Edit watchlist" });
    expect(
      within(prompt).getByRole("link", { name: "Continue with Google (Gmail)" }),
    ).toHaveAttribute("href", "/api/auth/login/google?returnTo=%2F");
    expect(
      within(prompt).getByRole("link", {
        name: "Continue with Microsoft (Outlook)",
      }),
    ).toHaveAttribute("href", "/api/auth/login/microsoft?returnTo=%2F");
    expect(within(prompt).queryByLabelText("Symbol")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove / }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const panel = screen.getByRole("group", { name: "Account" });
    expect(within(panel).getAllByRole("link", { name: /^Continue with/ })).toHaveLength(2);
    expect(within(panel).getByRole("link", { name: "Privacy" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Account" })).not.toBeInTheDocument();
  });

  it("signs out, returns to the default lists and leaves edit mode", async () => {
    const user = userEvent.setup();
    const [semis, staples] = baseConfig.watchlists.watchlists;
    const personal: WorkbenchConfig = {
      ...baseConfig,
      watchlists: {
        watchlists: [
          semis,
          { ...staples, rows: [{ ...staples.rows[0], symbols: ["COST", "PLTR"] }] },
        ],
      },
    };
    let signedIn = true;
    const logout = vi.fn(async () => {
      signedIn = false;
    });
    const getConfig = vi.fn(async () => (signedIn ? personal : baseConfig));
    const api = createApi({
      getSession: async () => ({
        user: { provider: "microsoft", email: "bob@outlook.com" },
        providers: ["google", "microsoft"],
      }),
      logout,
    });
    api.getConfig = getConfig;
    render(<Workbench api={api} />);

    await user.click(await screen.findByRole("button", { name: "Watchlist" }));
    await user.click(screen.getByRole("button", { name: "Consumer Staples" }));
    const table = screen.getByRole("table", { name: "Consumer Staples quotes" });
    expect(within(table).getByRole("button", { name: "PLTR" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit list" }));
    expect(
      screen.getByText(/^Saved to your account \(bob@outlook\.com\)/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "bob@outlook.com" }));
    expect(
      screen.getByText("Signed in with Microsoft (Outlook)", { exact: false }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(table).queryByRole("button", { name: "PLTR" })).not.toBeInTheDocument(),
    );
    expect(within(table).getByRole("button", { name: "WMT" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Symbol")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("deletes the account's data after a second click and returns to the default lists", async () => {
    const user = userEvent.setup();
    const deleteAccount = vi.fn(async () => undefined);
    render(
      <Workbench
        api={createApi({
          getSession: async () => ({
            user: { provider: "google", email: "alice@example.com" },
            providers: ["google"],
          }),
          deleteAccount,
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "alice@example.com" }));
    const panel = screen.getByRole("group", { name: "Account" });
    expect(within(panel).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy.html",
    );
    await user.click(within(panel).getByRole("button", { name: "Delete my data" }));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(
      within(panel).getByText(/permanently deletes your saved watchlist edits/),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Click again to delete" }),
    ).toHaveAccessibleDescription(/permanently deletes your saved watchlist edits/);
    await user.click(within(panel).getByRole("button", { name: "Click again to delete" }));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Account" })).getByRole("status"),
    ).toHaveTextContent("Your data was deleted and you are signed out on every device.");
  });

  it("keeps the session and explains it in the account menu when sign-out fails", async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {
      throw new ApiRequestError("failed", 502);
    });
    render(
      <Workbench
        api={createApi({
          getSession: async () => ({
            user: { provider: "google", email: "alice@example.com" },
            providers: ["google"],
          }),
          logout,
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "alice@example.com" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const panel = screen.getByRole("group", { name: "Account" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Could not sign out. Try again.",
    );
    expect(within(panel).getByRole("button", { name: "Sign out" })).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "alice@example.com" })).toHaveFocus();
  });

  it("returns to the list and edit mode it was on when sign-in started", async () => {
    const user = userEvent.setup();
    const signedOut = render(
      <Workbench
        api={createApi({
          getSession: async () => ({ user: null, providers: ["google"] }),
        })}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Watchlist" }));
    await user.click(screen.getByRole("button", { name: "Consumer Staples" }));
    await user.click(screen.getByRole("button", { name: "Edit list" }));
    const link = screen.getByRole("link", { name: "Continue with Google (Gmail)" });
    // jsdom cannot navigate; the click handler still runs first.
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    signedOut.unmount();
    // The provider sends the browser back to returnTo, carrying the nonce.
    const returnTo = new URL(link.getAttribute("href")!, "https://x.test").searchParams.get(
      "returnTo",
    )!;
    expect(returnTo).toMatch(/^\/\?signin=[a-z0-9]+$/);
    window.history.replaceState(null, "", returnTo);

    render(
      <Workbench
        api={createApi({
          getSession: async () => ({
            user: { provider: "google", email: "alice@example.com" },
            providers: ["google"],
          }),
        })}
      />,
    );
    expect(
      await screen.findByRole("table", { name: "Consumer Staples quotes" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Symbol")).toBeInTheDocument();
    // The saved context is used once, and the nonce leaves the address bar.
    expect(window.sessionStorage.getItem("msite-sign-in-context")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("ignores a saved sign-in context without the matching return nonce", async () => {
    window.sessionStorage.setItem(
      "msite-sign-in-context",
      JSON.stringify({
        page: "watchlist",
        watchlistId: "consumer-staples",
        editing: true,
        nonce: "abandoned",
        savedAt: Date.now(),
      }),
    );
    render(<Workbench api={createApi()} />);
    expect(
      await screen.findByRole("table", { name: "Semiconductors quotes" }),
    ).toBeInTheDocument();
    window.sessionStorage.clear();
  });

  it("never shows personal lists from an edit that finishes after sign-out", async () => {
    const user = userEvent.setup();
    const [semis, staples] = baseConfig.watchlists.watchlists;
    const personal: WorkbenchConfig["watchlists"] = {
      watchlists: [{ ...semis, rows: [{ ...semis.rows[0], symbols: ["PERSONAL"] }] }, staples],
    };
    let finishRemove!: () => void;
    const removeWatchlistSymbol = vi.fn(
      () =>
        new Promise<{ symbol: string; watchlists: WorkbenchConfig["watchlists"] }>((resolve) => {
          finishRemove = () => resolve({ symbol: "AMD", watchlists: personal });
        }),
    );
    render(
      <Workbench
        api={createApi({
          getSession: async () => ({
            user: { provider: "google", email: "alice@example.com" },
            providers: ["google"],
          }),
          removeWatchlistSymbol,
        })}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Edit list" }));
    const table = screen.getByRole("table", { name: "Semiconductors quotes" });
    await user.click(within(table).getByRole("button", { name: "Remove AMD" }));
    await user.click(screen.getByRole("button", { name: "alice@example.com" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("button", { name: "Sign in" });

    await act(async () => finishRemove());
    expect(within(table).queryByRole("button", { name: "PERSONAL" })).not.toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "AMD" })).toBeInTheDocument();
  });

  it("explains a failed sign-in once and removes it from the address bar", async () => {
    window.history.replaceState(null, "", "/?tab=x&login=failed");
    const user = userEvent.setup();
    render(<Workbench api={createApi()} />);

    expect(
      await screen.findByText(/^Sign-in did not complete\. Try again\./),
    ).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=x");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/^Sign-in did not complete/)).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("resets a list after a second click and recovers from an expired session", async () => {
    const user = userEvent.setup();
    const resetWatchlist = vi.fn(async () => ({ watchlists: baseConfig.watchlists }));
    const removeWatchlistSymbol = vi.fn(async () => {
      throw new ApiRequestError("failed", 401, "AUTH_REQUIRED");
    });
    render(
      <Workbench
        api={createApi({
          getSession: async () => ({
            user: { provider: "google", email: "alice@example.com" },
            providers: ["google"],
          }),
          resetWatchlist,
          removeWatchlistSymbol,
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Edit list" }));
    const reset = screen.getByRole("button", { name: "Reset to default list" });
    await user.click(reset);
    expect(resetWatchlist).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Click again to reset" }));
    expect(resetWatchlist).toHaveBeenCalledWith("semis");
    expect(
      await screen.findByText("Semiconductors is back to the default list."),
    ).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Semiconductors quotes" });
    await user.click(within(table).getByRole("button", { name: "Remove AMD" }));
    expect(
      await screen.findByText("Your session has ended. Sign in again to keep editing."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue with Google (Gmail)" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: /^Remove / }),
    ).not.toBeInTheDocument();
  });

  it("adds, removes and restores stocks in the selected watchlist", async () => {
    const user = userEvent.setup();
    const staples = baseConfig.watchlists.watchlists[1];
    const withStaples = (symbols: string[]): WorkbenchConfig["watchlists"] => ({
      watchlists: [
        baseConfig.watchlists.watchlists[0],
        { ...staples, rows: [{ ...staples.rows[0], symbols }] },
      ],
    });
    const addWatchlistSymbol = vi.fn<WorkbenchApi["addWatchlistSymbol"]>(
      async (_id, { symbol }) => {
        if (symbol === "ZZZZ")
          throw new ApiRequestError("failed", 404, "UNKNOWN_SYMBOL");
        return symbol === "PLTR"
          ? {
              symbol,
              name: "Palantir",
              watchlists: withStaples(["COST", "WMT", "PG", "KO", "PLTR"]),
            }
          : { symbol, watchlists: withStaples(["COST", "WMT", "PG", "KO", "PLTR"]) };
      },
    );
    const removeWatchlistSymbol = vi.fn<WorkbenchApi["removeWatchlistSymbol"]>(
      async (_id, symbol) => ({
        symbol,
        watchlists: withStaples(["COST", "WMT", "PG", "PLTR"]),
      }),
    );
    const fetchSnapshots = vi.fn(async (symbols: string[]) =>
      symbols.map(snapshotFor),
    );
    render(
      <Workbench
        api={createApi({
          fetchSnapshots,
          getSession: async () => ({
            user: { provider: "google", email: "alice@example.com" },
            providers: ["google", "microsoft"],
          }),
          addWatchlistSymbol,
          removeWatchlistSymbol,
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Watchlist" }));
    await user.click(screen.getByRole("button", { name: "Consumer Staples" }));
    const toggle = await screen.findByRole("button", { name: "Edit list" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const editor = screen.getByRole("region", { name: "Edit watchlist" });

    await user.type(within(editor).getByLabelText("Symbol"), "1abc");
    await user.click(within(editor).getByRole("button", { name: "Add stock" }));
    expect(
      within(editor).getByText("Enter a ticker such as PLTR or BRK.B."),
    ).toBeInTheDocument();
    expect(addWatchlistSymbol).not.toHaveBeenCalled();

    await user.clear(within(editor).getByLabelText("Symbol"));
    await user.type(within(editor).getByLabelText("Symbol"), "zzzz");
    await user.click(within(editor).getByRole("button", { name: "Add stock" }));
    expect(
      await within(editor).findByText("No listed security matches ZZZZ."),
    ).toBeInTheDocument();

    await user.clear(within(editor).getByLabelText("Symbol"));
    await user.type(within(editor).getByLabelText("Symbol"), "pltr");
    await user.type(
      within(editor).getByLabelText("Business (optional)"),
      "Data analytics software",
    );
    await user.click(within(editor).getByRole("button", { name: "Add stock" }));
    expect(addWatchlistSymbol).toHaveBeenLastCalledWith("consumer-staples", {
      symbol: "PLTR",
      rowId: "staples",
      description: "Data analytics software",
    });
    expect(
      await within(editor).findByText("Added PLTR (Palantir) to Staples."),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Consumer Staples quotes" });
    expect(within(table).getByRole("button", { name: "PLTR" })).toBeInTheDocument();
    expect(within(editor).getByLabelText("Symbol")).toHaveValue("");
    await waitFor(() =>
      expect(fetchSnapshots).toHaveBeenLastCalledWith(
        expect.arrayContaining(["PLTR"]),
      ),
    );

    await user.click(within(table).getByRole("button", { name: "KO" }));
    await user.click(within(table).getByRole("button", { name: "Remove KO" }));
    expect(removeWatchlistSymbol).toHaveBeenCalledWith("consumer-staples", "KO");
    expect(
      await within(editor).findByText("Removed KO from Consumer Staples."),
    ).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "KO" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "KO details" }),
    ).not.toBeInTheDocument();

    await user.click(within(editor).getByRole("button", { name: "Undo" }));
    expect(addWatchlistSymbol).toHaveBeenLastCalledWith("consumer-staples", {
      symbol: "KO",
      rowId: "staples",
      description: undefined,
    });
    expect(await within(editor).findByText("Restored KO.")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "KO" })).toBeInTheDocument();

    await user.click(toggle);
    expect(
      screen.queryByRole("region", { name: "Edit watchlist" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "Remove KO" }),
    ).not.toBeInTheDocument();
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
        symbolDescriptions: {
          NVDA: "AI GPU platforms",
          AMD: "AI accelerator chips",
        },
        rows: [
          {
            id: "leaders",
            name: "Leaders",
            expandedByDefault: true,
            symbols: ["nvda", "AMD", "ASML", "NVDA"],
          },
          {
            id: "market",
            name: "Market",
            expandedByDefault: true,
            symbols: sectorSymbols.slice(3),
          },
        ],
      },
      {
        id: "consumer-staples",
        name: "Consumer Staples",
        pinnedSymbols: ["COST"],
        rows: [
          {
            id: "staples",
            name: "Staples",
            expandedByDefault: true,
            symbols: ["COST", "WMT", "PG", "KO"],
          },
        ],
      },
    ],
  },
};

const ratePlanEvaluation: Awaited<
  ReturnType<WorkbenchApi["evaluateRatePlan"]>
> = {
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
  getSession = vi.fn(async () => ({ user: null, providers: [] })),
  logout = vi.fn(async () => undefined),
  deleteAccount = vi.fn(async () => undefined),
  resetWatchlist = vi.fn(async () => {
    throw new Error("Unexpected watchlist reset");
  }),
  addWatchlistSymbol = vi.fn(async () => {
    throw new Error("Unexpected watchlist edit");
  }),
  removeWatchlistSymbol = vi.fn(async () => {
    throw new Error("Unexpected watchlist edit");
  }),
}: {
  config?: WorkbenchConfig;
  configError?: Error;
  configPromise?: Promise<WorkbenchConfig>;
  fetchSnapshots?: WorkbenchApi["fetchSnapshots"];
  getHistory?: WorkbenchApi["getHistory"];
  evaluateRatePlan?: WorkbenchApi["evaluateRatePlan"];
  getSession?: WorkbenchApi["getSession"];
  logout?: WorkbenchApi["logout"];
  deleteAccount?: WorkbenchApi["deleteAccount"];
  resetWatchlist?: WorkbenchApi["resetWatchlist"];
  addWatchlistSymbol?: WorkbenchApi["addWatchlistSymbol"];
  removeWatchlistSymbol?: WorkbenchApi["removeWatchlistSymbol"];
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
    getSession,
    logout,
    deleteAccount,
    resetWatchlist,
    addWatchlistSymbol,
    removeWatchlistSymbol,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
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
    sessionChange: overrides[symbol]?.change ?? 0.5,
    sessionChangePercent: overrides[symbol]?.changePercent ?? 0.5,
    volume: overrides[symbol]?.volume ?? 1_000_000 + Math.max(index, 0) * 1_000,
    updatedAt: "2026-05-23T14:30:00.000Z",
    timeframe: "DELAYED",
  };
}

function priceSeries(
  symbol: string,
  range: PriceSeries["range"],
  closes = [11, 14],
): PriceSeries {
  return {
    symbol,
    range,
    bars: [
      {
        timestamp: "2026-05-22T13:30:00.000Z",
        open: closes[0] - 1,
        high: closes[0] + 1,
        low: closes[0] - 2,
        close: closes[0],
        volume: 100,
      },
      {
        timestamp: "2026-05-23T13:30:00.000Z",
        open: closes[1] - 1,
        high: closes[1] + 1,
        low: closes[1] - 2,
        close: closes[1],
        volume: 200,
      },
    ],
  };
}
