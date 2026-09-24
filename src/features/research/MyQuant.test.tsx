import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ResearchReport, Ema200StudyV2 } from "../../../shared/research";
import { calculateQuantModels } from "../../../server/research/pullback";
import { MyQuant } from "./MyQuant";
const model: Ema200StudyV2 = {
  version: 2,
  bandPercent: 3,
  targetPercent: 5,
  asOf: "2026-09-18",
  dataStart: "2021-09-18",
  fetchedAt: "2026-09-24T12:00:00Z",
  basis: "reconstructed",
  ema: 100,
  close: 110,
  distance: 10,
  status: "insufficient",
  confidenceInterval: null,
  bootstrapSamples: 0,
  horizons: [],
  events: [],
  chart: [],
  confirmed: [],
  sensitivity: [],
};
const legacy: ResearchReport = {
  id: "old-report",
  symbol: "AAPL",
  benchmark: "SPY",
  locale: "en",
  module: "quant",
  createdAt: "2026-09-18T12:00:00Z",
  status: "complete",
  kind: "stock",
  metrics: [],
  prices: [],
  news: [],
  sections: {
    quant: { status: "complete", asOf: "2026-09-18" },
    news: { status: "unavailable" },
    fundamentals: { status: "unavailable" },
    ai: { status: "unavailable" },
  },
  ema200Study: { ...model, version: 1 },
};
// Uptrend with one sharp dip on the latest session: RSI(2) fires today.
const closes = Array.from({ length: 420 }, (_, i) => 100 + 0.1 * i);
closes[419] -= 3;
const quantModels = calculateQuantModels(
  closes.map((close, i) => ({
    timestamp: new Date(Date.UTC(2025, 0, i + 1, 21)).toISOString(),
    open: close,
    close,
    high: close + 0.2,
    low: close - 0.2,
    volume: 100,
  })),
  "reconstructed",
);
const next = { ...legacy, ema200Study: model, quantModels };
// Node's own Web Storage global hides jsdom's, so provide an isolated store per test.
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
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
  window.location.hash = "";
});
it("automatically displays the current model with one request under Strict Mode and no upgrade choice", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => next });
  vi.stubGlobal("fetch", fetcher);
  function Harness() {
    const [report, setReport] = useState(legacy);
    return <MyQuant report={report} canRun onLoaded={setReport} />;
  }
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  await screen.findByText("Rebound path · opportunity and risk");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("/api/research/old-report/models", {
    method: "POST",
  });
  expect(
    screen.queryByRole("button", { name: /Upgrade|Calculate EMA200/ }),
  ).not.toBeInTheDocument();
});
it("does not calculate for read-only visitors, running reports, or ready models", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => next });
  vi.stubGlobal("fetch", fetcher);
  const onLoaded = vi.fn();
  const { rerender } = render(
    <MyQuant report={legacy} canRun={false} onLoaded={onLoaded} />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  rerender(
    <MyQuant
      report={{ ...legacy, status: "running" }}
      canRun
      onLoaded={onLoaded}
    />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  rerender(<MyQuant report={next} canRun onLoaded={onLoaded} />);
  expect(fetcher).not.toHaveBeenCalled();
  rerender(<MyQuant report={legacy} canRun onLoaded={onLoaded} />);
  await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(next));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("only offers retry after an actual failure, without looping on rerenders", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, json: async () => next });
  vi.stubGlobal("fetch", fetcher);
  const onLoaded = vi.fn();
  const { rerender } = render(
    <MyQuant report={legacy} canRun onLoaded={onLoaded} />,
  );
  await screen.findByRole("alert");
  rerender(<MyQuant report={{ ...legacy }} canRun onLoaded={onLoaded} />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Retry loading" }));
  await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(next));
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("ignores a late result after switching reports", async () => {
  let resolve!: (value: unknown) => void;
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...next, id: "other" }),
    });
  vi.stubGlobal("fetch", fetcher);
  const onLoaded = vi.fn();
  const { rerender } = render(
    <MyQuant report={legacy} canRun onLoaded={onLoaded} />,
  );
  rerender(
    <MyQuant report={{ ...legacy, id: "other" }} canRun onLoaded={onLoaded} />,
  );
  await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
  await act(async () => {
    resolve({ ok: true, json: async () => next });
  });
  expect(onLoaded).toHaveBeenCalledTimes(1);
  expect(onLoaded.mock.calls[0][0].id).toBe("other");
});

it("upgrades a saved report that has EMA200 but predates the pullback models", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => next });
  vi.stubGlobal("fetch", fetcher);
  const onLoaded = vi.fn();
  render(
    <MyQuant
      report={{ ...legacy, ema200Study: model }}
      canRun
      onLoaded={onLoaded}
    />,
  );
  await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(next));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("collapses models, remembers the choice, and keeps Consideration inside each model's contents", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const user = userEvent.setup();
  const { unmount } = render(
    <MyQuant report={next} canRun onLoaded={vi.fn()} />,
  );
  const toggles = [
    "EMA200 pullback & rebound",
    "SMA50 pullback in an uptrend",
    "RSI(2) oversold rebound (Connors)",
    "Bollinger lower-band reversion",
  ].map((name) => screen.getByRole("button", { name }));
  expect(toggles.map((b) => b.getAttribute("aria-expanded"))).toEqual([
    "true",
    "false",
    "false",
    "false",
  ]);
  const contents = screen.getByRole("navigation", {
    name: "Model 01 contents",
  });
  expect(
    within(contents)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href")),
  ).toEqual([
    "#ema200-evidence",
    "#ema200-path",
    "#ema200-position",
    "#ema200-events",
    "#ema200-consideration",
  ]);
  const consideration = document.getElementById("ema200-consideration")!;
  expect(consideration).toHaveTextContent("Primary test");
  await user.click(
    within(consideration).getByText("A zone, not an exact price"),
  );
  expect(consideration).toHaveTextContent("not an optimized threshold");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.click(toggles[0]);
  expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("ema200-evidence")).toBeNull();
  // The RSI(2) model fires on the latest session.
  expect(
    within(document.getElementById("model-rsi2")!).getByText("Signal today"),
  ).toBeVisible();
  await user.click(toggles[2]);
  const rsi = document.getElementById("model-rsi2")!;
  expect(rsi).toHaveTextContent("5D endpoint return advantage");
  expect(rsi).toHaveTextContent("Rule exit · Close above SMA5");
  expect(rsi).toHaveTextContent("RSI(2) < 10 · primary");
  expect(
    within(rsi).getByRole("navigation", { name: "Model 03 contents" }),
  ).toHaveTextContent("Consideration");
  unmount();
  render(<MyQuant report={next} canRun onLoaded={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "RSI(2) oversold rebound (Connors)" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getByRole("button", { name: "EMA200 pullback & rebound" }),
  ).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Expand all" }));
  expect(
    screen
      .getAllByRole("button", { expanded: true })
      .filter((b) => b.classList.contains("quant-model-toggle")),
  ).toHaveLength(4);
  await user.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
});
it("opens the model targeted by a contents link", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<MyQuant report={next} canRun onLoaded={vi.fn()} />);
  const toggle = screen.getByRole("button", {
    name: "Bollinger lower-band reversion",
  });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  act(() => {
    window.location.hash = "#bollinger-consideration";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById("bollinger-consideration")).toHaveTextContent(
    "Middle-band exit",
  );
});
