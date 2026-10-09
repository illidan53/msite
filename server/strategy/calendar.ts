import { newYorkDate } from "../../shared/marketDate";
import type { PriceBar } from "../../shared/types";
import type { Panel, Series } from "./types";
import { nanSeries } from "./math";

/**
 * A close-to-close move above +300% or below −80% is treated as a different
 * security (e.g. Polygon's META before 2022-06-09 is the old Roundhill ETF,
 * CORZ before its 2024 relisting, COHR before II-VI took the ticker). History
 * before the last such session is dropped so it cannot distort volatility.
 */
const DISCONTINUITY_UP = 3;
const DISCONTINUITY_DOWN = -0.8;

/**
 * Aligns completed bars (already through `closedBars`) to the benchmark's
 * sessions (spec §2). Bars on other dates are dropped and a missing master
 * date is NaN; symbols left without any bar are omitted from the panel.
 */
export function buildPanel(
  barsBySymbol: Record<string, PriceBar[]>,
  benchmark: string,
): Panel {
  // Most timestamps repeat across symbols, and Intl formatting dominates otherwise.
  const cache = new Map<string, string | null>();
  const dateOf = (bar: PriceBar) => {
    let date = cache.get(bar.timestamp);
    if (date === undefined) cache.set(bar.timestamp, (date = newYorkDate(bar.timestamp)));
    return date;
  };
  const dates = [
    ...new Set(
      (barsBySymbol[benchmark] ?? []).flatMap((bar) => dateOf(bar) ?? []),
    ),
  ].sort();
  if (!dates.length) throw new Error(`Benchmark ${benchmark} has no bars`);
  const position = new Map(dates.map((date, t) => [date, t]));
  const panel: Panel = {
    dates,
    symbols: [],
    index: {},
    open: [],
    high: [],
    low: [],
    close: [],
    volume: [],
    benchmark,
    trimmed: {},
  };
  const order = [
    benchmark,
    ...Object.keys(barsBySymbol).filter((s) => s !== benchmark),
  ];
  for (const symbol of order) {
    const [open, high, low, close, volume] = Array.from({ length: 5 }, () =>
      nanSeries(dates.length),
    );
    let any = false;
    for (const bar of barsBySymbol[symbol]) {
      const t = position.get(dateOf(bar) ?? "");
      if (t === undefined) continue;
      open[t] = bar.open;
      high[t] = bar.high;
      low[t] = bar.low;
      close[t] = bar.close;
      volume[t] = bar.volume;
      any = true;
    }
    if (!any) continue;
    let cut = -1,
      prev = -1;
    for (let t = 0; t < dates.length; t++) {
      if (!(close[t] > 0)) continue;
      const move = prev < 0 ? 0 : close[t] / close[prev] - 1;
      if (move > DISCONTINUITY_UP || move < DISCONTINUITY_DOWN) {
        cut = t;
        panel.trimmed![symbol] = {
          date: dates[t],
          return: Math.round(move * 1e6) / 1e4,
        };
      }
      prev = t;
    }
    if (cut > 0)
      for (const series of [open, high, low, close, volume]) series.fill(Number.NaN, 0, cut);
    panel.index[symbol] = panel.symbols.length;
    panel.symbols.push(symbol);
    panel.open.push(open);
    panel.high.push(high);
    panel.low.push(low);
    panel.close.push(close);
    panel.volume.push(volume);
  }
  return panel;
}

/** Master positions of a symbol's own sessions (dates with a usable close). */
export function ownSessions(close: Series) {
  const own: number[] = [];
  for (let t = 0; t < close.length; t++) if (close[t] > 0) own.push(t);
  return Int32Array.from(own);
}

/** Master series → own-session series. */
export function gather(series: ArrayLike<number>, own: Int32Array) {
  const out = new Float64Array(own.length);
  for (let k = 0; k < own.length; k++) out[k] = series[own[k]];
  return out;
}

/** Own-session series → master series, NaN on dates without a bar. */
export function scatter(values: ArrayLike<number>, own: Int32Array, length: number) {
  const out = nanSeries(length);
  for (let k = 0; k < own.length; k++) out[own[k]] = values[k];
  return out;
}

/** Monday of the ISO week containing a YYYY-MM-DD date; identifies the week. */
export function isoWeek(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/**
 * Index of the last session of every ISO week, in order. A week whose last
 * session is before t is complete at t, so a prefix of the calendar never
 * changes the weeks it reports as complete.
 */
export function weekEnds(dates: string[]) {
  const ends: number[] = [];
  const weeks = dates.map(isoWeek);
  for (let t = 0; t < dates.length; t++)
    if (t === dates.length - 1 || weeks[t + 1] !== weeks[t]) ends.push(t);
  return ends;
}

/** 1 on the first session of each calendar month after the first date (monthly refits). */
export function monthStarts(dates: string[]) {
  const out = new Uint8Array(dates.length);
  for (let t = 1; t < dates.length; t++)
    if (dates[t].slice(0, 7) !== dates[t - 1].slice(0, 7)) out[t] = 1;
  return out;
}
