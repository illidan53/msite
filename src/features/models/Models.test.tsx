import { StrictMode } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MODEL_SCAN_VERSION,
  QUANT_MODELS_VERSION,
  type ModelChartSet,
  type ModelFit,
  type ModelScan,
  type ModelScanState,
  type QuantModelId,
} from "../../../shared/research";
import { scanSymbol } from "../../../server/research/modelScan";
import { LocaleProvider } from "../../shared/locale";
import { Models } from "./Models";
import { rankRows, sortRows } from "./fitRanking";

const bars = Array.from({ length: 450 }, (_, i) => {
  const close = 100 + i * 0.03 + 7 * Math.sin(i / 15);
  return {
    timestamp: new Date(Date.UTC(2025, 0, 1, 21) + i * 86400000).toISOString(),
    open: close,
    close,
    high: close + 1,
    low: close - 1,
    volume: 100,
  };
});
const base = scanSymbol(bars);
const fit = (overrides: Partial<ModelFit>): ModelFit => ({
  status: "inconclusive",
  tier: "low",
  score: 0.5,
  primaryHorizon: 20,
  events: 20,
  controls: 600,
  lift: 0.4,
  interval: [-1.2, 2],
  correlation: 0.02,
  meanReturn: 1.1,
  positiveRate: 60,
  hitRate: 40,
  signal: false,
  lastEvent: "2026-08-01",
  sessionsSince: 30,
  regime: true,
  reading: 4.2,
  ...overrides,
});
const fits = (
  ema200: Partial<ModelFit>,
  rsi2: Partial<ModelFit> = {},
): Record<QuantModelId, ModelFit> => ({
  ema200: fit(ema200),
  sma50: fit({ primaryHorizon: 10, tier: "insufficient", score: null }),
  rsi2: fit({ primaryHorizon: 5, ...rsi2 }),
  bollinger: fit({ primaryHorizon: 10 }),
});
const scan: ModelScan = {
  version: MODEL_SCAN_VERSION,
  modelsVersion: QUANT_MODELS_VERSION,
  id: "scan-1",
  status: "partial",
  startedAt: "2026-09-26T21:00:00Z",
  completedAt: "2026-09-26T21:02:00Z",
  asOf: "2026-09-25",
  lists: [
    { id: "semiconductors", name: "Semiconductors" },
    { id: "etf", name: "Sectors & ETFs" },
  ],
  rows: [
    {
      symbol: "AMD",
      lists: ["semiconductors"],
      asOf: "2026-09-25",
      dataStart: "2021-09-27",
      sessions: 1255,
      fits: fits(
        { tier: "moderate", status: "inconclusive", score: 1.4, lift: 2.1 },
        { tier: "contrary", status: "negative", score: -2.4, lift: -1 },
      ),
    },
    {
      symbol: "NVDA",
      lists: ["semiconductors"],
      asOf: "2026-09-25",
      dataStart: "2021-09-27",
      sessions: 1255,
      fits: fits(
        {
          tier: "high",
          status: "positive",
          score: 2.6,
          lift: 3.4,
          interval: [0.8, 6],
        },
        { tier: "low", score: 0.2 },
      ),
    },
    {
      symbol: "SPY",
      lists: ["etf"],
      asOf: "2026-09-25",
      dataStart: "2021-09-27",
      sessions: 1255,
      fits: fits(
        {
          tier: "insufficient",
          status: "insufficient",
          score: null,
          events: 4,
        },
        {
          tier: "high",
          status: "positive",
          score: 3.1,
          signal: true,
          lastEvent: "2026-09-25",
          sessionsSince: 0,
          reading: 6.4,
        },
      ),
    },
  ],
  failures: [{ symbol: "NVTS", message: "PROVIDER_404" }],
};
const chartFor = (symbol: string): ModelChartSet => ({
  symbol,
  ...base.chart,
});
const saved: ModelScanState = { scan, job: null, lastFailure: null };

type Handler = (url: string, method: string) => unknown;
function mockApi(handler: Handler) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(url, init?.method ?? "GET");
    if (typeof result === "number") return { ok: false, status: result };
    return { ok: true, status: 200, json: async () => result };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const routes =
  (state: () => ModelScanState, canRun = false): Handler =>
  (url) => {
    if (url === "/api/research/access")
      return { canRun, clientIp: canRun ? "70.111.76.119" : "198.51.100.7" };
    if (url === "/api/models/scan") return state();
    const chart = url.match(/^\/api\/models\/charts\/(.+)$/);
    if (chart) return chartFor(decodeURIComponent(chart[1]));
    return 404;
  };
const renderModels = () =>
  render(
    <LocaleProvider>
      <Models />
    </LocaleProvider>,
  );
const table = () => screen.getByRole("table", { name: /fit list$/ });
const symbolsInTable = () =>
  within(table())
    .getAllByRole("button", { name: /^Show .+ chart$/ })
    .map((b) => b.textContent);

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map([["msite-language", "en"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("ranks fit tiers first, then score, keeping missing values last", () => {
  const ranked = rankRows(scan, "ema200");
  expect(ranked.map((r) => [r.symbol, r.rank])).toEqual([
    ["NVDA", 1],
    ["AMD", 2],
    ["SPY", 3],
  ]);
  expect(sortRows(ranked, "fit", false).map((r) => r.symbol)).toEqual([
    "SPY",
    "AMD",
    "NVDA",
  ]);
  for (const desc of [true, false])
    expect(sortRows(ranked, "score", desc).at(-1)?.symbol).toBe("SPY");
  expect(sortRows(ranked, "symbol", false).map((r) => r.symbol)).toEqual([
    "AMD",
    "NVDA",
    "SPY",
  ]);
});

it("shows the saved scan read-only with the best-fit chart and switches models", async () => {
  const fetcher = mockApi(routes(() => saved));
  const user = userEvent.setup();
  renderModels();
  await screen.findByRole("heading", { name: "EMA200 pullback & rebound" });
  expect(
    await screen.findByText(/Only authorized IP addresses/),
  ).toHaveTextContent("198.51.100.7");
  expect(
    screen.getByRole("button", { name: "Rescan all symbols" }),
  ).toBeDisabled();
  expect(
    screen.getByText("3 symbols scanned · 1 unavailable", { exact: false }),
  ).toBeInTheDocument();
  expect(symbolsInTable()).toEqual(["NVDA", "AMD", "SPY"]);
  expect(
    screen.getByRole("columnheader", { name: /20D advantage/ }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("img", {
      name: "NVDA · EMA200 pullback & rebound: closing price, reference lines and signals",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Sample chart · best fit for this model"),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Show AMD chart" }));
  expect(
    await screen.findByRole("img", { name: /^AMD · EMA200/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Sample chart · fit rank 2 of 3"),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Back to best fit (NVDA)" }),
  );
  expect(
    await screen.findByRole("img", { name: /^NVDA · EMA200/ }),
  ).toBeInTheDocument();

  await user.selectOptions(
    screen.getByLabelText("Model"),
    "03 · RSI(2) oversold rebound (Connors)",
  );
  expect(storage.get("msite-models-selected")).toBe("rsi2");
  expect(symbolsInTable()).toEqual(["SPY", "NVDA", "AMD"]);
  expect(
    screen.getByRole("columnheader", { name: /5D advantage/ }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("img", { name: /^SPY · RSI\(2\)/ }),
  ).toBeInTheDocument();
  // ETFs are described by their catalog name, and today's signal is highlighted.
  expect(within(table()).getByText("S&P 500")).toBeInTheDocument();
  const signals = screen.getByText("Signal on the latest session");
  expect(
    within(signals.parentElement!).getByRole("button", { name: /SPY/ }),
  ).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});

it("filters by fit tier, list, symbol and today's signal, and sorts columns", async () => {
  mockApi(routes(() => saved));
  const user = userEvent.setup();
  renderModels();
  await screen.findByRole("table", { name: /fit list$/ });
  const tiers = screen.getByRole("group", { name: "Filter the list by fit" });
  await user.click(
    within(tiers).getByRole("button", { name: /^1\s*High fit/ }),
  );
  expect(symbolsInTable()).toEqual(["NVDA"]);
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(symbolsInTable()).toHaveLength(3);

  await user.selectOptions(screen.getByLabelText("List"), "etf");
  expect(symbolsInTable()).toEqual(["SPY"]);
  // Tier counts follow the list filter.
  expect(
    within(tiers).getByRole("button", { name: /^1\s*Insufficient/ }),
  ).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("List"), "all");

  await user.type(screen.getByLabelText("Find symbol"), "am");
  expect(symbolsInTable()).toEqual(["AMD"]);
  await user.clear(screen.getByLabelText("Find symbol"));

  await user.click(screen.getByLabelText("Signal today only"));
  expect(
    screen.getByText("No symbols match these filters."),
  ).toBeInTheDocument();
  await user.click(screen.getByLabelText("Signal today only"));

  const symbolHeader = screen.getByRole("button", { name: "Symbol" });
  await user.click(symbolHeader);
  expect(symbolsInTable()).toEqual(["AMD", "NVDA", "SPY"]);
  expect(symbolHeader.closest("th")).toHaveAttribute("aria-sort", "ascending");
  await user.click(screen.getByRole("button", { name: "Fit score" }));
  expect(symbolsInTable()).toEqual(["NVDA", "AMD", "SPY"]);
  await user.click(screen.getByRole("button", { name: "Fit score" }));
  expect(symbolsInTable()).toEqual(["AMD", "NVDA", "SPY"]);
});

it("starts the first scan once for authorized visitors and shows it when finished", async () => {
  let current: ModelScanState = { scan: null, job: null, lastFailure: null };
  let polls = 0;
  const job = {
    id: "job-1",
    startedAt: "2026-09-27T12:00:00Z",
    total: 249,
    done: 0,
  };
  const fetcher = mockApi((url, method) => {
    if (url === "/api/models/scan" && method === "POST") {
      current = { ...current, job };
      return current;
    }
    if (url === "/api/models/scan" && current.job && ++polls >= 2)
      current = { scan, job: null, lastFailure: null };
    else if (url === "/api/models/scan" && current.job)
      current = { ...current, job: { ...job, done: 120 } };
    return routes(() => current, true)(url, method);
  });
  render(
    <StrictMode>
      <LocaleProvider>
        <Models />
      </LocaleProvider>
    </StrictMode>,
  );
  expect(
    await screen.findByText(/Scanning (0|120) \/ 249 symbols/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  await waitFor(
    () => expect(table()).toBeVisible(),
    { timeout: 5000 },
  );
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Rescan all symbols" }),
  ).toBeEnabled();
});

it("does not auto-retry after a failed scan and explains start limits", async () => {
  mockApi((url, method) => {
    if (url === "/api/models/scan" && method === "POST") return 429;
    return routes(
      () => ({
        scan: null,
        job: null,
        lastFailure: { at: "2026-09-27T12:00:00Z", message: "PROVIDER_503" },
      }),
      true,
    )(url, method);
  });
  const user = userEvent.setup();
  renderModels();
  expect(
    await screen.findByText("The last scan failed (PROVIDER_503).", {
      exact: false,
    }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Scan all symbols" }));
  expect(
    await screen.findByText(/Scan capacity reached \(4 per hour, 12 per day\)/),
  ).toBeInTheDocument();
});
