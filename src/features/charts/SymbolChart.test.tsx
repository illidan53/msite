import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceSeries } from "../../../shared/types";
import { getCreatedCharts, resetLightweightChartsMock } from "../../test/lightweightChartsMock";
import { SymbolChart } from "./SymbolChart";

afterEach(() => {
  cleanup();
  resetLightweightChartsMock();
  vi.unstubAllGlobals();
});

describe("SymbolChart", () => {
  beforeEach(() => {
    resizeObserverInstances.length = 0;
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("renders symbol and switches to Candles aria-pressed true", async () => {
    const user = userEvent.setup();

    render(<SymbolChart symbol="NVDA" series={priceSeries} range="30d" onRangeChange={() => undefined} />);

    expect(screen.getByLabelText("NVDA chart")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trend" })).toHaveAttribute("aria-pressed", "true");
    expect(getCreatedCharts()[0].addLineSeries).toHaveBeenCalledTimes(1);

    const lineSeries = getCreatedCharts()[0].addLineSeries.mock.results[0].value;
    expect(lineSeries.setData).toHaveBeenCalledWith([
      { time: "2026-05-22", value: 11 },
      { time: "2026-05-23", value: 14 },
    ]);

    await user.click(screen.getByRole("button", { name: "Candles" }));

    expect(screen.getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "true");
    expect(getCreatedCharts()[1].addCandlestickSeries).toHaveBeenCalledTimes(1);

    const candleSeries = getCreatedCharts()[1].addCandlestickSeries.mock.results[0].value;
    expect(candleSeries.setData).toHaveBeenCalledWith([
      { time: "2026-05-22", open: 10, high: 12, low: 9, close: 11 },
      { time: "2026-05-23", open: 11, high: 15, low: 10, close: 14 },
    ]);
  });

  it("calls onRangeChange when a range button is clicked", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();

    render(<SymbolChart symbol="NVDA" series={priceSeries} range="1h" onRangeChange={onRangeChange} />);

    expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "5y" }));

    expect(onRangeChange).toHaveBeenCalledWith("5y");
  });

  it("preserves distinct intraday timestamps for 1d bars on the same date", () => {
    render(<SymbolChart symbol="NVDA" series={intradaySeries} range="1d" onRangeChange={() => undefined} />);

    const lineSeries = getCreatedCharts()[0].addLineSeries.mock.results[0].value;

    expect(lineSeries.setData).toHaveBeenCalledWith([
      { time: 1780061400, value: 11 },
      { time: 1780061700, value: 12 },
    ]);
  });

  it("renders controls and chart container for an empty series", () => {
    render(
      <SymbolChart
        symbol="AMD"
        series={{ symbol: "AMD", range: "1h", bars: [] }}
        range="1h"
        onRangeChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText("AMD chart")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-chart-container")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
  });

  it("removes the chart on unmount", () => {
    const { unmount } = render(
      <SymbolChart symbol="NVDA" series={priceSeries} range="30d" onRangeChange={() => undefined} />,
    );

    const chart = getCreatedCharts()[0];

    unmount();

    expect(chart.remove).toHaveBeenCalledTimes(1);
  });

  it("resizes the chart when the container size changes", () => {
    render(<SymbolChart symbol="NVDA" series={priceSeries} range="30d" onRangeChange={() => undefined} />);

    const chart = getCreatedCharts()[0];

    resizeObserverInstances[0].trigger({ width: 480, height: 260 });

    expect(chart.resize).toHaveBeenCalledWith(480, 260);
  });
});

const priceSeries: PriceSeries = {
  symbol: "NVDA",
  range: "30d",
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

const intradaySeries: PriceSeries = {
  symbol: "NVDA",
  range: "1d",
  bars: [
    {
      timestamp: "2026-05-29T13:30:00.000Z",
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 100,
    },
    {
      timestamp: "2026-05-29T13:35:00.000Z",
      open: 11,
      high: 13,
      low: 10,
      close: 12,
      volume: 150,
    },
  ],
};

interface ResizeObserverSize {
  width: number;
  height: number;
}

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObserverInstances.push(this);
  }

  trigger(size: ResizeObserverSize) {
    this.callback(
      [
        {
          contentRect: {
            width: size.width,
            height: size.height,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this,
    );
  }
}

const resizeObserverInstances: ResizeObserverMock[] = [];
