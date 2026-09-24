import type { PriceBar } from "../../shared/types";
import type {
  Ema200Study,
  Ema200Horizon,
  Ema200Event,
} from "../../shared/research";
import { newYorkDate } from "../../shared/marketDate";
const mean = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const median = (a: number[]) => {
  if (!a.length) return null;
  const sorted = [...a].sort((a, b) => a - b);
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.floor(sorted.length / 2)]) /
    2
  );
};
export function ema200(closes: number[]): (number | null)[] {
  let value: number | null = null;
  return closes.map((close, i) => {
    if (i === 199)
      value = closes.slice(0, 200).reduce((s, v) => s + v, 0) / 200;
    else if (i > 199) value = value! + ((close - value!) * 2) / 201;
    return value;
  });
}
export function association(events: number[], controls: number[]) {
  const a = mean(events),
    b = mean(controls);
  const all = [...events, ...controls],
    avg = mean(all);
  const variance =
    avg === null
      ? 0
      : all.reduce((sum, v) => sum + (v - avg) ** 2, 0) / all.length;
  return {
    lift: a === null || b === null ? null : a - b,
    correlation:
      a === null || b === null || variance === 0
        ? null
        : Math.max(
            -1,
            Math.min(
              1,
              (((a - b) / Math.sqrt(variance)) *
                Math.sqrt(events.length * controls.length)) /
                all.length,
            ),
          ),
  };
}
// Resample contiguous calendar-session blocks, including ineligible slots.
// This preserves local dependence from overlapping 20-session return windows.
export function blockInterval(
  rows: ({ group: 0 | 1; value: number } | null)[],
) {
  let seed = 0x2002026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const effects: number[] = [];
  const length = Math.min(42, rows.length);
  if (!length) return { interval: null, samples: 0 };
  for (let sample = 0; sample < 1000; sample++) {
    let a = 0,
      b = 0,
      na = 0,
      nb = 0,
      used = 0;
    while (used < rows.length) {
      const start = Math.floor(random() * (rows.length - length + 1));
      for (let j = 0; j < length && used < rows.length; j++, used++) {
        const r = rows[start + j];
        if (!r) continue;
        if (r.group) {
          a += r.value;
          na++;
        } else {
          b += r.value;
          nb++;
        }
      }
    }
    if (na >= 2 && nb >= 2) effects.push(a / na - b / nb);
  }
  effects.sort((a, b) => a - b);
  const quantile = (p: number) => {
    const index = (effects.length - 1) * p,
      lo = Math.floor(index);
    return (
      effects[lo] + (effects[Math.ceil(index)] - effects[lo]) * (index - lo)
    );
  };
  return {
    interval:
      effects.length >= 950
        ? ([quantile(0.025), quantile(0.975)] as [number, number])
        : null,
    samples: effects.length,
  };
}
export function calculateEma200Study(
  bars: PriceBar[],
  basis: Ema200Study["basis"] = "snapshot",
): Ema200Study {
  const averages = ema200(bars.map((b) => b.close));
  const events: Ema200Event[] = [];
  const groups = new Map<number, 0 | 1>();
  let lastEvent = -Infinity;
  const forward = (i: number, h: number) =>
    i + h < bars.length && bars[i + 1].open > 0
      ? (bars[i + h].close / bars[i + 1].open - 1) * 100
      : null;
  for (let i = 200; i < bars.length; i++) {
    const reference = averages[i - 1]!;
    if (bars[i - 1].close <= reference * 1.01 || i - lastEvent <= 20) continue;
    const touch =
      bars[i].low <= reference * 1.01 && bars[i].high >= reference * 0.99;
    groups.set(i, touch ? 1 : 0);
    if (!touch) continue;
    lastEvent = i;
    events.push({
      date: newYorkDate(bars[i].timestamp)!,
      referenceEma: reference,
      entryDate: bars[i + 1] ? newYorkDate(bars[i + 1].timestamp) : null,
      entryPrice: bars[i + 1]?.open > 0 ? bars[i + 1].open : null,
      returns: Object.fromEntries(
        [5, 10, 20].map((h) => [String(h), forward(i, h)]),
      ),
    });
  }
  const horizons: Ema200Horizon[] = [5, 10, 20].map((sessions) => {
    const event: number[] = [],
      control: number[] = [];
    for (const [i, group] of groups) {
      const value = forward(i, sessions);
      if (value !== null) (group ? event : control).push(value);
    }
    return {
      sessions,
      events: event.length,
      controls: control.length,
      meanReturn: mean(event),
      medianReturn: median(event),
      positiveRate: event.length
        ? (event.filter((v) => v > 0).length / event.length) * 100
        : null,
      controlMean: mean(control),
      ...association(event, control),
    };
  });
  const primary = horizons[2];
  // Conservative, explicit sample gates; not a guarantee of power or independence.
  const enough =
    primary.events >= 12 &&
    primary.controls >= 252 &&
    primary.correlation !== null;
  const rows = bars
    .slice(200, Math.max(200, bars.length - 20))
    .map((_, offset) => {
      const i = offset + 200,
        group = groups.get(i),
        value = forward(i, 20);
      return group === undefined || value === null ? null : { group, value };
    });
  const bootstrap = enough
    ? blockInterval(rows)
    : { interval: null, samples: 0 };
  const ci = bootstrap.interval;
  const status: Ema200Study["status"] =
    !enough || !ci
      ? "insufficient"
      : ci[0] > 0 && primary.lift! > 0 && primary.meanReturn! > 0
        ? "positive"
        : ci[1] < 0 && primary.lift! < 0
          ? "negative"
          : "inconclusive";
  const close = bars.at(-1)?.close ?? null,
    ema = averages.at(-1) ?? null;
  const touchDates = new Set(events.map((e) => e.date));
  return {
    version: 1,
    asOf: bars.at(-1) ? newYorkDate(bars.at(-1)!.timestamp)! : "",
    dataStart: bars[0] ? newYorkDate(bars[0].timestamp)! : "",
    fetchedAt: new Date().toISOString(),
    basis,
    ema,
    close,
    distance:
      ema !== null && ema > 0 && close !== null
        ? (close / ema - 1) * 100
        : null,
    status,
    confidenceInterval: ci,
    bootstrapSamples: bootstrap.samples,
    horizons,
    events,
    chart: bars
      .map((b, i) => ({
        date: newYorkDate(b.timestamp)!,
        close: b.close,
        ema: averages[i],
        touch: touchDates.has(newYorkDate(b.timestamp)!),
      }))
      .slice(-252),
  };
}
