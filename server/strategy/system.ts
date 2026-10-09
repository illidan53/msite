import type { IneligibleReason, RuleId } from "../../shared/strategy";
import { ruleCatalog, type RuleSpec } from "../../shared/strategyRules";
import { gather, monthStarts, ownSessions, scatter, weekEnds } from "./calendar";
import type { BookDefinition, StrategyConfig } from "./config";
import { oneWayCostBps } from "./execution";
import { engineRules, redistributeWeights } from "./forecast";
import {
  clip,
  cumsum,
  diff,
  ewmMean,
  ffill,
  nanSeries,
  rollingMedian,
  spanAlpha,
} from "./math";
import {
  accelRaw,
  breakoutRaw,
  classIndex,
  ewmacRaw,
  indexTrendRaw,
  ewmEquilibrium,
  mrRaw,
  pooledScalar,
  relmomRaw,
  smaEquilibrium,
} from "./rules";
import type { EngineOptions, Panel, Series, SystemFrame } from "./types";
import { blendedVol, normalisedReturns, robustVol, volAttenuation } from "./vol";

/** SystemFrame.reason codes → API reasons (index 0 = eligible). */
export const ineligibleReasons: (IneligibleReason | null)[] = [
  null,
  "no_bar",
  "warmup",
  "stale",
  "illiquid",
  "cost",
];

type RuleKind = "ewmac" | "breakout" | "accel" | "assettrend" | "relmom" | "mr";
const kindOf = (rule: RuleSpec) => rule.id.replace(/\d+$/, "") as RuleKind;
/** Strategy 13 attenuates the trend-like rules only (not accel or mean reversion). */
const attenuated = new Set<RuleKind>(["ewmac", "breakout", "assettrend", "relmom"]);
const ewmacScalar = (fast: number) =>
  ruleCatalog.find((r) => r.id === `ewmac${fast}`)?.scalar ?? NaN;
/** pysystemtrade's off-diagonal fill for correlations without enough history. */
const missingCorrelation = 0.99;
const minCorrelationWeeks = 20;

/** Everything about one symbol that lives on its own sessions. */
interface SymbolState {
  own: Int32Array;
  sigma: Float64Array;
  dollarVolume: Float64Array;
  costBps: Float64Array;
  /** One-way cost in Sharpe-ratio units: bps ÷ median σ_b over 252 sessions. */
  costSharpe: Float64Array;
  reason: Uint8Array;
  trendFilter: Float64Array;
  attenuation: Float64Array | null;
  z: Float64Array;
  raw: Partial<Record<RuleId, Float64Array>>;
}

function symbolState(
  panel: Panel,
  row: number,
  config: StrategyConfig,
  volAttenuationOn: boolean,
): SymbolState {
  const own = ownSessions(panel.close[row]);
  const close = gather(panel.close[row], own);
  const volume = gather(panel.volume[row], own);
  const vol = blendedVol(close);
  const sigmaPrice = close.map((c, k) => (c * vol.blended[k]) / 16);
  const dollarVolume = rollingMedian(
    close.map((c, k) => c * volume[k]),
    60,
    1,
  );
  const isBenchmark = panel.symbols[row] === panel.benchmark;
  const costBps = dollarVolume.map((dv, k) =>
    oneWayCostBps(config.costs, dv, "buy", panel.dates[own[k]], isBenchmark),
  );
  const sigmaMedian = rollingMedian(vol.blended, 252, 1);
  const costSharpe = costBps.map((bps, k) => bps / 1e4 / sigmaMedian[k]);

  const { engine } = config;
  const reason = new Uint8Array(own.length);
  let zeros = 0;
  for (let k = 0; k < own.length; k++) {
    if (vol.returns[k] === 0) zeros++;
    if (k >= 10 && vol.returns[k - 10] === 0) zeros--;
    reason[k] =
      vol.valid[k] < engine.eligibilitySessions
        ? 2
        : zeros >= 5
          ? 3
          : !(dollarVolume[k] > 0)
            ? 4
            : costSharpe[k] > engine.instrumentCostLimitSharpe
              ? 5
              : 0;
  }

  const ewma64 = ewmMean(close, spanAlpha(64));
  const ewma256 = ewmMean(close, spanAlpha(256));
  const trendFilter = ewma64.map((fast, k) =>
    k + 1 < 256 ? NaN : fast >= ewma256[k] ? 10 : 0,
  );

  const ewmacs = new Map<number, Float64Array>();
  const ewmac = (fast: number) => {
    let raw = ewmacs.get(fast);
    if (!raw) ewmacs.set(fast, (raw = ewmacRaw(close, sigmaPrice, fast)));
    return raw;
  };
  const raw: SymbolState["raw"] = {};
  for (const rule of ruleCatalog) {
    const { params } = rule;
    switch (kindOf(rule)) {
      case "ewmac":
        raw[rule.id] = ewmac(params.fast);
        break;
      case "breakout":
        raw[rule.id] = breakoutRaw(close, params.horizon);
        break;
      case "accel": {
        const scalar = ewmacScalar(params.fast);
        raw[rule.id] = accelRaw(
          ewmac(params.fast).map((v) => v * scalar),
          params.fast,
        );
        break;
      }
      case "mr": {
        const equilibrium =
          params.com !== undefined
            ? ewmEquilibrium(close, params.com)
            : smaEquilibrium(close, params.window);
        raw[rule.id] = mrRaw(close, equilibrium, sigmaPrice, ewmac(params.gate));
        break;
      }
      // Class rules (assettrend, relmom) are filled from the class index.
    }
  }
  return {
    own,
    sigma: vol.blended,
    dollarVolume,
    costBps,
    costSharpe,
    reason,
    trendFilter,
    attenuation: volAttenuationOn ? volAttenuation(vol.blended) : null,
    z: normalisedReturns(vol.returns, vol.blended),
    raw,
  };
}

/**
 * Spec §3: volatility, rule forecasts, speed limits, eligibility, forecast
 * combination with the FDM, and the Strategy 5 filter for one book. Every
 * value at session t depends only on bars up to t; monthly refits (speed
 * limit, forecast correlations) use only sessions before the refit session.
 */
export function computeSystem(
  panel: Panel,
  book: BookDefinition,
  config: StrategyConfig,
  options: EngineOptions = {},
): SystemFrame {
  const { dates } = panel;
  const n = dates.length;
  const { engine } = config;
  const cap = engine.forecastCap;
  const symbols = book.symbols.filter((s) => Object.hasOwn(panel.index, s));
  const missing = book.symbols.filter((s) => !Object.hasOwn(panel.index, s));
  const panelIndex = symbols.map((s) => panel.index[s]);
  const classOf = symbols.map((s) => book.classOf[s]);
  const states = panelIndex.map((row) =>
    symbolState(panel, row, config, options.volAttenuation ?? false),
  );
  const byRule = <T>(make: (rule: RuleSpec) => T) =>
    Object.fromEntries(ruleCatalog.map((rule) => [rule.id, make(rule)])) as Record<
      RuleId,
      T
    >;
  const baseWeights = byRule((rule) => options.ruleWeights?.[rule.id] ?? rule.weight);

  // Class rules: index, its trend (broadcast) and each member's outperformance.
  const classIndexById: Record<string, Series> = {};
  const classRules = ruleCatalog.filter((r) => ["assettrend", "relmom"].includes(kindOf(r)));
  for (const id of [...new Set(classOf)]) {
    const members = symbols.flatMap((_, i) => (classOf[i] === id ? [i] : []));
    const { index } = classIndex(
      members.map((i) => scatter(states[i].z, states[i].own, n)),
      n,
    );
    classIndexById[id] = index;
    const vol = robustVol(diff(index));
    const start = index.findIndex((v) => v === v);
    for (const rule of classRules.filter((r) => kindOf(r) === "assettrend")) {
      // The index EWMAs need the rule's warm-up on the index itself, not just on the member.
      const trend = indexTrendRaw(index, vol, rule.params.fast).map((v, t) =>
        start >= 0 && t - start + 1 >= rule.warmup ? v : NaN,
      );
      for (const i of members) states[i].raw[rule.id] = gather(trend, states[i].own);
    }
    for (const i of members) {
      const { own, z, raw } = states[i];
      const normalisedPrice = ffill(scatter(cumsum(z), own, n));
      for (const rule of classRules.filter((r) => kindOf(r) === "relmom"))
        raw[rule.id] = gather(relmomRaw(normalisedPrice, index, rule.params.horizon), own);
    }
  }

  // Scaling: attenuate trend-like raws (variant), apply the scalar in force, cap, warm up.
  const adjustedRaw = byRule((rule) =>
    states.map(({ raw, attenuation }) => {
      const values = raw[rule.id]!;
      return attenuation && attenuated.has(kindOf(rule))
        ? values.map((v, k) => v * attenuation[k])
        : values;
    }),
  );
  const scalars = byRule((rule) =>
    rule.scalar !== null
      ? new Float64Array(n).fill(rule.scalar)
      : pooledScalar(
          adjustedRaw[rule.id].map((values, i) => scatter(values, states[i].own, n)),
          n,
        ),
  );
  const forecasts = byRule((rule) =>
    states.map(({ own }, i) => {
      const values = adjustedRaw[rule.id][i];
      const scalar = scalars[rule.id];
      const out = nanSeries(n);
      for (let k = rule.warmup - 1; k < own.length; k++) {
        const f = clip(scalar[own[k]] * values[k], cap);
        if (f === f) out[own[k]] = f;
      }
      return out;
    }),
  );

  // Pooled expanding forecast turnover (signed capped forecasts, own-session diffs).
  const turnover = byRule((rule) => {
    const sums = new Float64Array(n);
    const counts = new Float64Array(n);
    states.forEach(({ own }, i) => {
      const f = forecasts[rule.id][i];
      for (let k = 1; k < own.length; k++) {
        const change = Math.abs(f[own[k]] - f[own[k - 1]]);
        if (change === change) {
          sums[own[k]] += change;
          counts[own[k]]++;
        }
      }
    });
    const out = nanSeries(n);
    for (let t = 0, sum = 0, count = 0; t < n; t++) {
      sum += sums[t];
      count += counts[t];
      if (count) out[t] = (256 * sum) / count / 10;
    }
    return out;
  });

  // Speed limit, refitted on each month's first session from the previous session's data.
  const refits = monthStarts(dates);
  const costPass = byRule((rule) =>
    states.map(({ own, costSharpe }) => {
      const costs = ffill(scatter(costSharpe, own, n));
      const pass = new Uint8Array(n);
      for (let t = 0, current = 1; t < n; t++) {
        if (refits[t])
          current = costs[t - 1] * turnover[rule.id][t - 1] > engine.ruleCostLimitSharpe ? 0 : 1;
        pass[t] = current;
      }
      return pass;
    }),
  );

  // Forecast correlations: weekly samples pooled over symbols, expanding, refitted monthly.
  const R = engineRules.length;
  const [rows, sumX, sumY, sumXX, sumYY, sumXY, weeks] = Array.from(
    { length: 7 },
    () => new Float64Array(R * R),
  );
  const lastWeek = new Float64Array(R * R).fill(-1);
  const sample = new Float64Array(R);
  const addWeek = (t: number, week: number) => {
    for (let i = 0; i < symbols.length; i++) {
      for (let j = 0; j < R; j++) sample[j] = forecasts[engineRules[j]][i][t];
      for (let j = 0; j < R; j++) {
        const x = sample[j];
        if (x !== x) continue;
        for (let l = j + 1; l < R; l++) {
          const y = sample[l];
          if (y !== y) continue;
          const p = j * R + l;
          rows[p]++;
          sumX[p] += x;
          sumY[p] += y;
          sumXX[p] += x * x;
          sumYY[p] += y * y;
          sumXY[p] += x * y;
          if (lastWeek[p] !== week) {
            lastWeek[p] = week;
            weeks[p]++;
          }
        }
      }
    }
  };
  const fitCorrelation = () => {
    const h = new Float64Array(R * R).fill(missingCorrelation);
    let fitted = false;
    for (let j = 0; j < R; j++) {
      h[j * R + j] = 1;
      for (let l = j + 1; l < R; l++) {
        const p = j * R + l;
        if (weeks[p] < minCorrelationWeeks) continue;
        const m = rows[p];
        const denominator = Math.sqrt(
          (m * sumXX[p] - sumX[p] ** 2) * (m * sumYY[p] - sumY[p] ** 2),
        );
        if (!(denominator > 0)) continue;
        h[p] = h[l * R + j] = Math.max(
          0,
          Math.min(1, (m * sumXY[p] - sumX[p] * sumY[p]) / denominator),
        );
        fitted = true;
      }
    }
    return fitted ? h : null;
  };
  const weekly = weekEnds(dates);
  const correlationAt: (Float64Array | null)[] = new Array(n);
  for (let t = 0, w = 0, h: Float64Array | null = null; t < n; t++) {
    if (refits[t]) {
      while (w < weekly.length && weekly[w] < t) addWeek(weekly[w], w++);
      h = fitCorrelation() ?? h;
    }
    correlationAt[t] = h;
  }

  // Combination: redistributed weights, FDM (1 before the first fit), cap.
  const base = engineRules.map((rule) => baseWeights[rule]);
  const available = new Uint8Array(R);
  const weights = new Float64Array(R);
  const voting = new Int32Array(R);
  const fdm: Series[] = [];
  const combined: Series[] = [];
  states.forEach(({ own, reason }, i) => {
    const ruleForecasts = engineRules.map((rule) => forecasts[rule][i]);
    const rulePasses = engineRules.map((rule) => costPass[rule][i]);
    const rawFdm = nanSeries(own.length);
    const blend = nanSeries(own.length);
    for (let k = 0; k < own.length; k++) {
      const t = own[k];
      for (let j = 0; j < R; j++) {
        const f = ruleForecasts[j][t];
        available[j] = base[j] > 0 && f === f && rulePasses[j][t] ? 1 : 0;
      }
      const h = correlationAt[t];
      if (!redistributeWeights(base, available, weights)) {
        if (!h) rawFdm[k] = 1;
        continue;
      }
      let sum = 0,
        count = 0;
      for (let j = 0; j < R; j++)
        if (weights[j]) {
          sum += weights[j] * ruleForecasts[j][t];
          voting[count++] = j;
        }
      blend[k] = sum;
      if (!h) {
        rawFdm[k] = 1;
        continue;
      }
      let variance = 0;
      for (let a = 0; a < count; a++)
        for (let b = 0; b < count; b++)
          variance += weights[voting[a]] * weights[voting[b]] * h[voting[a] * R + voting[b]];
      rawFdm[k] = Math.min(engine.diversificationCap, 1 / Math.sqrt(variance));
    }
    const smoothed = ewmMean(rawFdm, spanAlpha(125));
    fdm.push(scatter(smoothed, own, n));
    combined.push(
      scatter(
        blend.map((b, k) => (reason[k] === 0 ? clip(smoothed[k] * b, cap) : NaN)),
        own,
        n,
      ),
    );
  });

  return {
    book,
    panel,
    dates,
    symbols,
    classOf,
    panelIndex,
    missing,
    sigma: states.map(({ sigma, own }) => scatter(sigma, own, n)),
    dollarVolume: states.map(({ dollarVolume, own }) =>
      ffill(scatter(dollarVolume, own, n)),
    ),
    // Held through sessions without a bar so an order waiting for one is still costed.
    costBps: states.map(({ costBps, own }) => ffill(scatter(costBps, own, n))),
    eligible: states.map(({ reason, own }) => {
      const out = new Uint8Array(n);
      own.forEach((t, k) => (out[t] = reason[k] === 0 ? 1 : 0));
      return out;
    }),
    reason: states.map(({ reason, own }) => {
      const out = new Uint8Array(n).fill(1);
      own.forEach((t, k) => (out[t] = reason[k]));
      return out;
    }),
    baseWeights,
    forecasts,
    costPass,
    scalars,
    turnover,
    fdm,
    combined,
    trendFilter: states.map(({ trendFilter, own }) => scatter(trendFilter, own, n)),
    classIndex: classIndexById,
  };
}
