import { useLocale } from "../../shared/locale";
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { PriceBar, PriceSeries } from "../../../shared/types";

type ChartMode = "trend" | "candles";

interface ChartSeriesApi {
  setData(data: unknown[]): void;
}

interface SymbolChartApi {
  addSeries(definition: unknown, options?: object): ChartSeriesApi;
  addLineSeries(): ChartSeriesApi;
  addCandlestickSeries(): ChartSeriesApi;
  addHistogramSeries(): ChartSeriesApi;
  subscribeCrosshairMove(handler: (event: { time?: Time }) => void): void;
  remove(): void;
  resize(width: number, height: number): void;
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

const RANGES: Array<{ label: string; value: PriceSeries["range"] }> = [
  { label: "1h", value: "1h" },
  { label: "1d", value: "1d" },
  { label: "5d", value: "5d" },
  { label: "30d", value: "30d" },
  { label: "3months", value: "3month" },
  { label: "1y", value: "1y" },
  { label: "5y", value: "5y" },
];
const CHART_HEIGHT = 380;

export function SymbolChart({
  symbol,
  series,
  range,
  onRangeChange,
}: SymbolChartProps) {
  const { locale, t } = useLocale();
  const [mode, setMode] = useState<ChartMode>("trend");
  const [inspected, setInspected] = useState<PriceBar | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    setInspected(null);
    const intraday = ["1h", "1d", "5d"].includes(range);
    const formatTime = (time: Time, short = false) => {
      const date =
        typeof time === "number"
          ? new Date(time * 1000)
          : new Date(
              typeof time === "string"
                ? time + "T00:00:00Z"
                : `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}T00:00:00Z`,
            );
      return (
        new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
          timeZone: intraday ? "America/New_York" : "UTC",
          ...(short && intraday
            ? {}
            : ({
                year: short ? undefined : "numeric",
                month: "2-digit",
                day: "2-digit",
              } as const)),
          ...(intraday
            ? ({ hour: "2-digit", minute: "2-digit", hour12: false } as const)
            : {}),
        }).format(date) + (!short && intraday ? " ET" : "")
      );
    };
    const container = containerRef.current;
    const chart = createChart(container, {
      localization: {
        locale: locale === "zh" ? "zh-CN" : "en-US",
        timeFormatter: (time: Time) => formatTime(time),
      },
      height: container.clientHeight || CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#626c7c",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "#edf0f5" },
        horzLines: { color: "#edf0f5" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: intraday,
        secondsVisible: false,
        tickMarkMaxCharacterLength: 7,
        tickMarkFormatter: (time: Time, type: number) =>
          intraday && type <= 2 && typeof time === "number"
            ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
                timeZone: "America/New_York",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(time * 1000))
            : type === 0 && !intraday
              ? typeof time === "string"
                ? time.slice(0, 4)
                : formatTime(time)
              : formatTime(time, true),
      },
      width: container.clientWidth || 640,
    }) as unknown as SymbolChartApi;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(([entry]) => {
            const width = Math.floor(entry.contentRect.width);
            const height = Math.floor(entry.contentRect.height) || CHART_HEIGHT;

            if (width > 0) {
              chart.resize(width, height);
            }
          });

    if (mode === "trend") {
      addLineSeries(chart).setData(
        series.bars.map((bar) => toLinePoint(bar, range)),
      );
    } else {
      addCandlestickSeries(chart).setData(
        series.bars.map((bar) => toCandlePoint(bar, range)),
      );
    }

    const byTime = new Map(
      series.bars.map((bar) => [
        String(toChartTime(bar.timestamp, range)),
        bar,
      ]),
    );
    chart.subscribeCrosshairMove((event) => {
      const time = event.time;
      const key =
        typeof time === "object"
          ? `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`
          : String(time);
      setInspected(byTime.get(key) ?? null);
    });
    chart.timeScale().fitContent();
    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      chart.remove();
    };
  }, [mode, range, series.bars, locale]);

  return (
    <section
      className="symbol-chart"
      aria-label={t(`${symbol} chart`, `${symbol} 图表`)}
    >
      <header className="symbol-chart-header">
        <strong>{symbol}</strong>

        <div className="segmented-control" aria-label={t("Chart mode")}>
          <button
            type="button"
            aria-pressed={mode === "trend"}
            onClick={() => setMode("trend")}
          >
            {t("Trend")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "candles"}
            onClick={() => setMode("candles")}
          >
            {t("Candles")}
          </button>
        </div>

        <div
          className="segmented-control chart-range"
          aria-label={t("Chart range")}
        >
          {RANGES.map((rangeOption) => (
            <button
              key={rangeOption.value}
              type="button"
              aria-pressed={range === rangeOption.value}
              onClick={() => onRangeChange(rangeOption.value)}
            >
              {t(rangeOption.label)}
            </button>
          ))}
        </div>
      </header>

      <p className="chart-inspection-readout">
        {inspected ? (
          <>
            {["1h", "1d", "5d"].includes(range)
              ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
                  timeZone: "America/New_York",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(inspected.timestamp)) + " ET"
              : inspected.timestamp.slice(0, 10)}{" "}
            · {t("Open", "开")}: {inspected.open.toFixed(2)} · {t("High", "高")}
            : {inspected.high.toFixed(2)} · {t("Low", "低")}:{" "}
            {inspected.low.toFixed(2)} · {t("Close", "收")}:{" "}
            {inspected.close.toFixed(2)}
          </>
        ) : (
          t(
            "Hover or long-press the chart to inspect date and prices · intraday times in New York time",
            "悬停或长按图表查看日期与价格 · 日内时间为纽约时间",
          )
        )}
      </p>
      <div
        ref={containerRef}
        className="chart-canvas"
        data-testid="symbol-chart-container"
      />
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

  return chart.addSeries(LineSeries, { color: "#5652b5", lineWidth: 2 });
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
  if (range === "1h" || range === "1d" || range === "5d") {
    return Math.floor(Date.parse(timestamp) / 1000);
  }

  return timestamp.slice(0, 10);
}
