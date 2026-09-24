import type { PriceBar } from "../../shared/types";
import type {
  Ema200Study,
  Ema200StudyV2,
  Ema200HorizonV2,
  Ema200EventV2,
  Ema200Path,
  Ema200PathSummary,
} from "../../shared/research";
import { newYorkDate } from "../../shared/marketDate";
export const mean = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
export const median = (a: number[]) => {
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
/** All horizons start at the next open. Partial paths remain missing, including hit rates. */
export function forwardPath(
  bars: PriceBar[],
  signal: number,
  sessions: number,
): Ema200Path | null {
  const entry = bars[signal + 1]?.open;
  if (!(entry > 0) || signal + sessions >= bars.length) return null;
  const window = bars.slice(signal + 1, signal + sessions + 1);
  const pct = (value: number) => (value / entry - 1) * 100;
  const hit = window.findIndex((b) => b.high >= entry * 1.05);
  return {
    endReturn: pct(window.at(-1)!.close),
    averageReturn: mean(window.map((b) => pct(b.close)))!,
    maxGain: Math.max(0, ...window.map((b) => pct(b.high))),
    maxLoss: Math.min(0, ...window.map((b) => pct(b.low))),
    hitDay: hit < 0 ? null : hit + 1,
  };
}
export function summarizePaths(paths: Ema200Path[]): Ema200PathSummary {
  const hits = paths.flatMap((p) => (p.hitDay === null ? [] : [p.hitDay]));
  return {
    count: paths.length,
    averageReturn: mean(paths.map((p) => p.averageReturn)),
    maxGain: mean(paths.map((p) => p.maxGain)),
    maxLoss: mean(paths.map((p) => p.maxLoss)),
    hitRate: paths.length ? (hits.length / paths.length) * 100 : null,
    medianHitDay: median(hits),
  };
}
const horizonsList = [5, 10, 20];
function studyBand(
  bars: PriceBar[],
  averages: (number | null)[],
  band: number,
) {
  const events: Ema200EventV2[] = [];
  const groups = new Map<number, 0 | 1>();
  let lastEvent = -Infinity;
  let aboveStreak = 0;
  for (let i = 200; i < bars.length; i++) {
    const reference = averages[i - 1]!;
    aboveStreak =
      bars[i - 1].close > reference * (1 + band) ? aboveStreak + 1 : 0;
    // A new episode needs both 20 elapsed sessions and 3 completed above-band closes.
    if (i - lastEvent <= 20 || (Number.isFinite(lastEvent) && aboveStreak < 3))
      continue;
    if (!aboveStreak) continue;
    // Include deep undercuts and gaps below the line: failures must not disappear.
    const touch = bars[i].low <= reference * (1 + band);
    groups.set(i, touch ? 1 : 0);
    if (!touch) continue;
    lastEvent = i;
    const paths = Object.fromEntries(
      horizonsList.map((h) => [String(h), forwardPath(bars, i, h)]),
    );
    let outcome: Ema200EventV2["outcome"] = "pending";
    if (i + 20 < bars.length) {
      let dipped = false,
        reclaimed = false;
      for (let j = i; j <= i + 20; j++) {
        if (bars[j].low < averages[j - 1]!) dipped = true;
        if (dipped && bars[j].close >= averages[j - 1]!) reclaimed = true;
      }
      const weak = [i + 18, i + 19, i + 20].every(
        (j) => bars[j].close < averages[j - 1]! * (1 - band),
      );
      outcome = weak
        ? "weak"
        : reclaimed
          ? "reclaimed"
          : dipped
            ? "mixed"
            : "near";
    }
    let lowIndex = i;
    let confirmation: Ema200EventV2["confirmation"] = null;
    // First 3-session no-new-low confirmation, observed within the 20-session study window.
    for (let j = i + 1; j <= Math.min(i + 20, bars.length - 1); j++) {
      if (bars[j].low < bars[lowIndex].low) lowIndex = j;
      if (j - lowIndex >= 3) {
        confirmation = {
          date: newYorkDate(bars[j].timestamp)!,
          lowDate: newYorkDate(bars[lowIndex].timestamp)!,
          low: bars[lowIndex].low,
          entryDate: bars[j + 1] ? newYorkDate(bars[j + 1].timestamp) : null,
          entryPrice: bars[j + 1]?.open > 0 ? bars[j + 1].open : null,
          paths: Object.fromEntries(
            horizonsList.map((h) => [String(h), forwardPath(bars, j, h)]),
          ),
        };
        break;
      }
    }
    events.push({
      date: newYorkDate(bars[i].timestamp)!,
      referenceEma: reference,
      lowDistance: (bars[i].low / reference - 1) * 100,
      entryDate: bars[i + 1] ? newYorkDate(bars[i + 1].timestamp) : null,
      entryPrice: bars[i + 1]?.open > 0 ? bars[i + 1].open : null,
      returns: Object.fromEntries(
        horizonsList.map((h) => [
          String(h),
          paths[String(h)]?.endReturn ?? null,
        ]),
      ),
      paths,
      outcome,
      confirmation,
    });
  }
  const horizons = horizonsList.map((sessions) =>
    summarizeHorizon(bars, groups, sessions),
  );
  return { events, groups, horizons };
}
/** Event (1) versus background (0) comparison for fully observed windows only. */
export function summarizeHorizon(
  bars: PriceBar[],
  groups: Map<number, 0 | 1>,
  sessions: number,
): Ema200HorizonV2 {
  const event: number[] = [],
    control: number[] = [],
    paths: Ema200Path[] = [];
  for (const [i, group] of groups) {
    const path = forwardPath(bars, i, sessions);
    if (!path) continue;
    (group ? event : control).push(path.endReturn);
    if (group) paths.push(path);
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
    ...summarizePaths(paths),
  };
}
export function calculateEma200Study(
  bars: PriceBar[],
  basis: Ema200Study["basis"] = "snapshot",
): Ema200StudyV2 {
  const averages = ema200(bars.map((b) => b.close));
  const { events, groups, horizons } = studyBand(bars, averages, 0.03);
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
        value = forwardPath(bars, i, 20)?.endReturn ?? null;
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
    version: 2,
    bandPercent: 3,
    targetPercent: 5,
    sensitivity: [1, 3, 5].map((bandPercent) => ({
      bandPercent,
      horizon:
        bandPercent === 3
          ? horizons[2]
          : studyBand(bars, averages, bandPercent / 100).horizons[2],
    })),
    confirmed: horizonsList.map((sessions) => {
      const paths = events.flatMap((e) => {
        const p = e.confirmation?.paths[String(sessions)];
        return p ? [p] : [];
      });
      return {
        sessions,
        detected: events.filter((e) => e.confirmation).length,
        meanReturn: mean(paths.map((p) => p.endReturn)),
        positiveRate: paths.length
          ? (paths.filter((p) => p.endReturn > 0).length / paths.length) * 100
          : null,
        path: summarizePaths(paths),
      };
    }),
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
