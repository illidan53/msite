import { StrictMode, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ResearchReport, Ema200StudyV2 } from "../../../shared/research";
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
const next = { ...legacy, ema200Study: model };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
