import { CandlestickSeries, LineSeries, createChart } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { PriceBar, PriceSeries } from "../../../shared/types";

type ChartMode = "trend" | "candles";

interface ChartSeriesApi {
  setData(data: unknown[]): void;
}

interface SymbolChartApi {
  addSeries(definition: unknown): ChartSeriesApi;
  addLineSeries(): ChartSeriesApi;
  addCandlestickSeries(): ChartSeriesApi;
  addHistogramSeries(): ChartSeriesApi;
  remove(): void;
  timeScale(): {
    fitContent(): void;
  };
}

export interface SymbolChartProps {
  symbol: string;
  series: PriceSeries;
  range: PriceSeries["range"];
  onRangeChange(range: PriceSeries["range"]): void;
}

const RANGES: PriceSeries["range"][] = ["1D", "5D", "1M", "3M", "1Y"];

export function SymbolChart({ symbol, series, range, onRangeChange }: SymbolChartProps) {
  const [mode, setMode] = useState<ChartMode>("trend");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      height: 300,
      width: containerRef.current.clientWidth || 640,
    }) as unknown as SymbolChartApi;

    if (mode === "trend") {
      addLineSeries(chart).setData(series.bars.map((bar) => toLinePoint(bar, range)));
    } else {
      addCandlestickSeries(chart).setData(series.bars.map((bar) => toCandlePoint(bar, range)));
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [mode, range, series.bars]);

  return (
    <section className="symbol-chart" aria-label={`${symbol} chart`}>
      <header className="symbol-chart-header">
        <strong>{symbol}</strong>

        <div className="segmented-control" aria-label="Chart mode">
          <button type="button" aria-pressed={mode === "trend"} onClick={() => setMode("trend")}>
            Trend
          </button>
          <button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>
            Candles
          </button>
        </div>

        <div className="segmented-control" aria-label="Chart range">
          {RANGES.map((rangeOption) => (
            <button
              key={rangeOption}
              type="button"
              aria-pressed={range === rangeOption}
              onClick={() => onRangeChange(rangeOption)}
            >
              {rangeOption}
            </button>
          ))}
        </div>
      </header>

      <div ref={containerRef} className="chart-canvas" data-testid="symbol-chart-container" />
    </section>
  );
}

function toLinePoint(bar: PriceBar, range: PriceSeries["range"]) {
  return {
    time: toChartTime(bar.timestamp, range),
    value: bar.close,
  };
}

function addLineSeries(chart: SymbolChartApi) {
  if (typeof chart.addLineSeries === "function") {
    return chart.addLineSeries();
  }

  return chart.addSeries(LineSeries);
}

function addCandlestickSeries(chart: SymbolChartApi) {
  if (typeof chart.addCandlestickSeries === "function") {
    return chart.addCandlestickSeries();
  }

  return chart.addSeries(CandlestickSeries);
}

function toCandlePoint(bar: PriceBar, range: PriceSeries["range"]) {
  return {
    time: toChartTime(bar.timestamp, range),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

function toChartTime(timestamp: string, range: PriceSeries["range"]) {
  if (range === "1D" || range === "5D") {
    return Math.floor(Date.parse(timestamp) / 1000);
  }

  return timestamp.slice(0, 10);
}
