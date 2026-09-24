import type { PriceBar } from "../../shared/types";
import {
  QUANT_MODELS_VERSION,
  type Ema200Path,
  type PullbackEvent,
  type PullbackExit,
  type PullbackExitSummary,
  type PullbackModelId,
  type PullbackStudy,
  type QuantModelSet,
} from "../../shared/research";
import { newYorkDate } from "../../shared/marketDate";
import {
  blockInterval,
  forwardPath,
  mean,
  median,
  summarizeHorizon,
} from "./ema200";

type Series = (number | null)[];
const horizonsList = [5, 10, 20];
/** Rule exits are observed for at most 20 sessions, then closed at that session's close. */
export const EXIT_WINDOW = 20;
const CHART_SESSIONS = 252;

export function sma(values: number[], n: number): Series {
  return values.map((_, i) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += values[j];
    return sum / n;
  });
}
/** Bollinger bands use the population standard deviation of the same closes as the middle band. */
export function bollinger(closes: number[], n: number, k: number) {
  const mid = sma(closes, n);
  const width = mid.map((m, i) => {
    if (m === null) return null;
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += (closes[j] - m) ** 2;
    return k * Math.sqrt(sum / n);
  });
  return {
    mid,
    upper: mid.map((m, i) => (m === null ? null : m + width[i]!)),
    lower: mid.map((m, i) => (m === null ? null : m - width[i]!)),
  };
}
/** Wilder RSI: seeded with the simple mean of the first n changes. Flat prices read 50. */
export function rsi(closes: number[], n: number): Series {
  const out: Series = closes.map(() => null);
  if (closes.length <= n) return out;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= n; i++) {
    const change = closes[i] - closes[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= n;
  loss /= n;
  const value = () =>
    loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  out[n] = value();
  for (let i = n + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(change, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-change, 0)) / n;
    out[i] = value();
  }
  return out;
}

/**
 * Each rule only reads data available at the signal session's close
 * (or, for intraday touches, the prior session's reference line).
 */
interface Detector {
  start: number;
  /** Regime and "not already in the zone"; defines the background sample. */
  eligible(i: number): boolean;
  trigger(i: number): boolean;
  reading(i: number): number;
  /** A completed close that ends the previous pullback episode. */
  rearm(j: number): boolean;
  /** Reversion reached at close j for the signal at i. */
  exit(i: number, j: number): boolean;
  current(last: number): {
    regime: boolean | null;
    readings: Record<string, number | null>;
  };
  chart(from: number): Omit<PullbackStudy["chart"], "events">;
}
interface ModelSpec {
  id: PullbackModelId;
  parameter: number;
  sensitivity: number[];
  primaryHorizon: number;
  build(bars: PriceBar[], parameter: number): Detector;
}
const gt = (a: number | null | undefined, b: number | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && a > b;
const round = (series: Series, from: number) =>
  series
    .slice(from)
    .map((v) => (v === null ? null : Math.round(v * 1e4) / 1e4));
/** Stored event values keep 6 decimals: far below display precision, much smaller reports. */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const compactPath = (p: Ema200Path | null): Ema200Path | null =>
  p && {
    endReturn: r6(p.endReturn),
    averageReturn: r6(p.averageReturn),
    maxGain: r6(p.maxGain),
    maxLoss: r6(p.maxLoss),
    hitDay: p.hitDay,
  };

export const modelSpecs: ModelSpec[] = [
  {
    id: "sma50",
    parameter: 2,
    sensitivity: [1, 2, 3],
    primaryHorizon: 10,
    build(bars, bandPercent) {
      const closes = bars.map((b) => b.close);
      const s50 = sma(closes, 50),
        s200 = sma(closes, 200);
      const band = 1 + bandPercent / 100;
      const above = (k: number) =>
        gt(closes[k], s50[k] === null ? null : s50[k]! * band);
      return {
        start: 200,
        eligible: (i) => gt(s50[i - 1], s200[i - 1]) && above(i - 1),
        trigger: (i) => bars[i].low <= s50[i - 1]! * band,
        reading: (i) => (bars[i].low / s50[i - 1]! - 1) * 100,
        rearm: (j) => j >= 2 && above(j) && above(j - 1) && above(j - 2),
        exit: (i, j) =>
          closes[j] >= Math.max(...closes.slice(Math.max(0, i - 20), i)),
        current: (last) => ({
          regime:
            s50[last] === null || s200[last] === null
              ? null
              : s50[last]! > s200[last]!,
          readings: {
            distance: s50[last] ? (closes[last] / s50[last]! - 1) * 100 : null,
            sma50: s50[last],
            sma200: s200[last],
            trendGap:
              s50[last] && s200[last]
                ? (s50[last]! / s200[last]! - 1) * 100
                : null,
          },
        }),
        chart: (from) => ({
          lines: { sma50: round(s50, from), sma200: round(s200, from) },
          band: {
            upper: round(
              s50.map((v) => (v === null ? null : v * band)),
              from,
            ),
            lower: round(
              s50.map((v) => (v === null ? null : v * (2 - band))),
              from,
            ),
          },
        }),
      };
    },
  },
  {
    id: "rsi2",
    parameter: 10,
    sensitivity: [5, 10, 15],
    primaryHorizon: 5,
    build(bars, threshold) {
      const closes = bars.map((b) => b.close);
      const r2 = rsi(closes, 2),
        s5 = sma(closes, 5),
        s200 = sma(closes, 200);
      return {
        start: 199,
        eligible: (i) =>
          gt(closes[i], s200[i]) &&
          r2[i - 1] !== null &&
          r2[i - 1]! >= threshold,
        trigger: (i) => r2[i]! < threshold,
        reading: (i) => r2[i]!,
        rearm: (j) => gt(closes[j], s5[j]),
        exit: (_i, j) => gt(closes[j], s5[j]),
        current: (last) => ({
          regime: s200[last] === null ? null : closes[last] > s200[last]!,
          readings: {
            rsi2: r2[last],
            sma5: s5[last],
            sma200: s200[last],
            distance200: s200[last]
              ? (closes[last] / s200[last]! - 1) * 100
              : null,
          },
        }),
        chart: (from) => ({
          lines: { sma200: round(s200, from) },
          oscillator: { values: round(r2, from), threshold },
        }),
      };
    },
  },
  {
    id: "bollinger",
    parameter: 2,
    sensitivity: [1.5, 2, 2.5],
    primaryHorizon: 10,
    build(bars, k) {
      const closes = bars.map((b) => b.close);
      const { mid, upper, lower } = bollinger(closes, 20, k);
      const s200 = sma(closes, 200);
      return {
        start: 199,
        eligible: (i) =>
          gt(closes[i], s200[i]) &&
          lower[i - 1] !== null &&
          closes[i - 1] >= lower[i - 1]!,
        trigger: (i) => closes[i] < lower[i]!,
        reading: (i) => (closes[i] / lower[i]! - 1) * 100,
        rearm: (j) => mid[j] !== null && closes[j] >= mid[j]!,
        exit: (_i, j) => mid[j] !== null && closes[j] >= mid[j]!,
        current: (last) => ({
          regime: s200[last] === null ? null : closes[last] > s200[last]!,
          readings: {
            percentB:
              upper[last] !== null && upper[last]! > lower[last]!
                ? (closes[last] - lower[last]!) / (upper[last]! - lower[last]!)
                : null,
            lower: lower[last],
            mid: mid[last],
            upper: upper[last],
            sma200: s200[last],
          },
        }),
        chart: (from) => ({
          lines: { mid: round(mid, from), sma200: round(s200, from) },
          band: { upper: round(upper, from), lower: round(lower, from) },
        }),
      };
    },
  },
];

/** Buy the next open; sell at the first close that reaches the model's reversion level, else at session 20. */
export function ruleExit(
  bars: PriceBar[],
  signal: number,
  reached: (j: number) => boolean,
): PullbackExit | null {
  const entry = bars[signal + 1]?.open;
  // Only fully observed windows count: early reverts must not outnumber still-open losers.
  if (!(entry > 0) || signal + EXIT_WINDOW >= bars.length) return null;
  for (let j = signal + 1; j <= signal + EXIT_WINDOW; j++) {
    const reverted = reached(j);
    if (reverted || j === signal + EXIT_WINDOW)
      return {
        date: newYorkDate(bars[j].timestamp)!,
        sessions: j - signal,
        return: (bars[j].close / entry - 1) * 100,
        reason: reverted ? "reverted" : "time",
      };
  }
  return null;
}
export function runPullbackStudy(
  bars: PriceBar[],
  detector: Detector,
  cooldown: number,
) {
  const events: PullbackEvent[] = [];
  const indices: number[] = [];
  const groups = new Map<number, 0 | 1>();
  let last = -Infinity,
    armed = true;
  for (let i = Math.max(1, detector.start); i < bars.length; i++) {
    if (!armed && i - 1 > last && detector.rearm(i - 1)) armed = true;
    // One episode per pullback: cooldown and a completed rebound must both pass.
    if (i - last <= cooldown || !armed || !detector.eligible(i)) continue;
    const hit = detector.trigger(i);
    groups.set(i, hit ? 1 : 0);
    if (!hit) continue;
    last = i;
    armed = false;
    indices.push(i);
    const paths = Object.fromEntries(
      horizonsList.map((h) => [
        String(h),
        compactPath(forwardPath(bars, i, h)),
      ]),
    );
    const exit = ruleExit(bars, i, (j) => detector.exit(i, j));
    events.push({
      date: newYorkDate(bars[i].timestamp)!,
      trigger: r6(detector.reading(i)),
      entryDate: bars[i + 1] ? newYorkDate(bars[i + 1].timestamp) : null,
      entryPrice: bars[i + 1]?.open > 0 ? bars[i + 1].open : null,
      returns: Object.fromEntries(
        horizonsList.map((h) => [
          String(h),
          paths[String(h)]?.endReturn ?? null,
        ]),
      ),
      paths,
      exit: exit && { ...exit, return: r6(exit.return) },
    });
  }
  return { events, indices, groups };
}
export function summarizeExits(events: PullbackEvent[]): PullbackExitSummary {
  const exits = events.flatMap((e) => (e.exit ? [e.exit] : []));
  const returns = exits.map((e) => e.return);
  const share = (n: number) => (exits.length ? (n / exits.length) * 100 : null);
  return {
    count: exits.length,
    revertedRate: share(exits.filter((e) => e.reason === "reverted").length),
    meanReturn: mean(returns),
    winRate: share(returns.filter((v) => v > 0).length),
    medianSessions: median(exits.map((e) => e.sessions)),
    worstReturn: returns.length ? Math.min(...returns) : null,
  };
}
function runModel(
  bars: PriceBar[],
  spec: ModelSpec,
  from: number,
): PullbackStudy {
  const cooldown = spec.primaryHorizon;
  const detector = spec.build(bars, spec.parameter);
  const { events, indices, groups } = runPullbackStudy(
    bars,
    detector,
    cooldown,
  );
  const horizons = horizonsList.map((h) => summarizeHorizon(bars, groups, h));
  const primary = horizons.find((h) => h.sessions === spec.primaryHorizon)!;
  // Same conservative gates as the EMA200 model, applied to this model's pre-set primary horizon.
  const enough =
    primary.events >= 12 &&
    primary.controls >= 252 &&
    primary.correlation !== null;
  const rows: ({ group: 0 | 1; value: number } | null)[] = [];
  for (let i = detector.start; i < bars.length - spec.primaryHorizon; i++) {
    const group = groups.get(i),
      value = forwardPath(bars, i, spec.primaryHorizon)?.endReturn ?? null;
    rows.push(group === undefined || value === null ? null : { group, value });
  }
  const bootstrap = enough
    ? blockInterval(rows)
    : { interval: null, samples: 0 };
  const ci = bootstrap.interval;
  const status: PullbackStudy["status"] =
    !enough || !ci
      ? "insufficient"
      : ci[0] > 0 && primary.lift! > 0 && primary.meanReturn! > 0
        ? "positive"
        : ci[1] < 0 && primary.lift! < 0
          ? "negative"
          : "inconclusive";
  const last = bars.length - 1;
  const lastIndex = indices.at(-1);
  return {
    id: spec.id,
    parameter: spec.parameter,
    primaryHorizon: spec.primaryHorizon,
    cooldown,
    targetPercent: 5,
    status,
    confidenceInterval: ci,
    bootstrapSamples: bootstrap.samples,
    horizons,
    sensitivity: spec.sensitivity.map((parameter) => ({
      parameter,
      horizon:
        parameter === spec.parameter
          ? primary
          : summarizeHorizon(
              bars,
              runPullbackStudy(bars, spec.build(bars, parameter), cooldown)
                .groups,
              spec.primaryHorizon,
            ),
    })),
    exit: summarizeExits(events),
    events,
    current: {
      signal: lastIndex !== undefined && lastIndex === last,
      ...(last >= 0 ? detector.current(last) : { regime: null, readings: {} }),
      lastEvent: events.at(-1)?.date ?? null,
      sessionsSince: lastIndex === undefined ? null : last - lastIndex,
    },
    chart: {
      ...detector.chart(from),
      events: indices.filter((i) => i >= from).map((i) => i - from),
    },
  };
}
export function calculateQuantModels(
  bars: PriceBar[],
  basis: QuantModelSet["basis"] = "snapshot",
): QuantModelSet {
  const from = Math.max(0, bars.length - CHART_SESSIONS);
  return {
    version: QUANT_MODELS_VERSION,
    asOf: bars.at(-1) ? newYorkDate(bars.at(-1)!.timestamp)! : "",
    dataStart: bars[0] ? newYorkDate(bars[0].timestamp)! : "",
    fetchedAt: new Date().toISOString(),
    basis,
    chart: {
      dates: bars.slice(from).map((b) => newYorkDate(b.timestamp)!),
      close: bars.slice(from).map((b) => b.close),
    },
    models: modelSpecs.map((spec) => runModel(bars, spec, from)),
  };
}
