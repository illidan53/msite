import type { RuleDiagnostics, RuleId } from "../../shared/strategy";
import { ruleCatalog } from "../../shared/strategyRules";
import { weekNumber } from "./portfolio";
import { correlation, dailySharpe } from "./stats";
import type { SystemFrame } from "./types";

/**
 * Per-rule diagnostics over the evaluation window, from SystemFrame fields
 * only. The rule account curve follows pysystemtrade's per-forecast curves:
 * a notional position of (f/10)·(τ/σ) with an arbitrary τ of 0.2, held from
 * one own session's close to the next, minus one-way costs on its changes.
 */

const CURVE_TAU = 0.2;
const trendRules: RuleId[] = ["ewmac8", "ewmac16", "ewmac32", "ewmac64"];

/** Rules behind the AFTS Strategy 27 sign gate (0 while they disagree with ewmac16). */
export const signGatedRules = new Set(
  ruleCatalog.filter((rule) => rule.params.gate !== undefined).map((rule) => rule.id),
);

/** Pooled mean |f| over eligible symbol-sessions in the window; `nonZero` skips exact zeros. */
export function meanAbsForecast(
  system: SystemFrame,
  rule: RuleId,
  startIndex: number,
  endIndex = system.dates.length - 1,
  nonZero = false,
) {
  let sum = 0,
    count = 0;
  system.forecasts[rule].forEach((forecast, i) => {
    const eligible = system.eligible[i];
    for (let t = Math.max(0, startIndex); t <= endIndex; t++)
      if (eligible[t] === 1 && Number.isFinite(forecast[t]) && !(nonZero && forecast[t] === 0)) {
        sum += Math.abs(forecast[t]);
        count++;
      }
  });
  return count ? sum / count : null;
}

/**
 * Mean |f| over the population the rule's scalar was calibrated on, for the
 * forecast_scale check. A gated rule's scalar targets 10 while the gate is
 * open (mr5's 9.3 is the ungated Strategy 26 scalar; the pooled scalar
 * counts nonzero values only), so its gate-closed zeros, about half of
 * symbol-days, would pull the realised mean to about 5 and keep the warning
 * on permanently.
 */
export function calibratedMeanAbsForecast(
  system: SystemFrame,
  rule: RuleId,
  startIndex: number,
  endIndex = system.dates.length - 1,
) {
  return meanAbsForecast(system, rule, startIndex, endIndex, signGatedRules.has(rule));
}

/**
 * Daily pooled rule returns after the window start, signed and long-only:
 * the mean over symbols eligible at the decision session, plus symbols whose
 * notional was cut to 0 there because they left eligibility (their exit cost
 * lands on the next session, like any other change). Days without either are
 * skipped.
 */
export function ruleAccountCurve(
  system: SystemFrame,
  rule: RuleId,
  startIndex: number,
  endIndex = system.dates.length - 1,
) {
  const T = system.dates.length;
  const signed = new Float64Array(T);
  const long = new Float64Array(T);
  const count = new Uint32Array(T);
  system.symbols.forEach((_, i) => {
    const close = system.panel.close[system.panelIndex[i]];
    const forecast = system.forecasts[rule][i];
    const sigma = system.sigma[i];
    const eligible = system.eligible[i];
    const costBps = system.costBps[i];
    let prev = -1,
      q = 0,
      qLong = 0,
      dq = 0,
      dqLong = 0;
    for (let t = 0; t <= endIndex; t++) {
      if (!(close[t] > 0)) continue;
      if (prev >= startIndex && (eligible[prev] === 1 || dq > 0)) {
        const r = close[t] / close[prev] - 1;
        const c = (Number.isFinite(costBps[prev]) ? costBps[prev] : 0) / 1e4;
        signed[t] += q * r - dq * c;
        long[t] += qLong * r - dqLong * c;
        count[t]++;
      }
      const next =
        eligible[t] === 1 && Number.isFinite(forecast[t]) && sigma[t] > 0
          ? (forecast[t] / 10) * (CURVE_TAU / sigma[t])
          : 0;
      dq = Math.abs(next - q);
      dqLong = Math.abs(Math.max(0, next) - qLong);
      q = next;
      qLong = Math.max(0, next);
      prev = t;
    }
  });
  const days = Math.max(0, endIndex - startIndex);
  const out = { signed: new Float64Array(days), long: new Float64Array(days) };
  let k = 0;
  for (let t = startIndex + 1; t <= endIndex; t++)
    if (count[t]) {
      out.signed[k] = signed[t] / count[t];
      out.long[k] = long[t] / count[t];
      k++;
    }
  return { signed: out.signed.subarray(0, k), long: out.long.subarray(0, k) };
}

export function ruleDiagnostics(
  system: SystemFrame,
  startIndex: number,
  endIndex = system.dates.length - 1,
): RuleDiagnostics[] {
  const n = system.symbols.length;
  const { dates, eligible } = system;
  // Last session of each ISO week inside the window; the trend reference is the
  // mean of the finite ewmac forecasts there.
  const weekEnds: number[] = [];
  for (let t = Math.max(0, startIndex); t <= endIndex; t++)
    if (t === endIndex || weekNumber(dates[t + 1]) !== weekNumber(dates[t]))
      weekEnds.push(t);
  const trend = weekEnds.flatMap((t) =>
    Array.from({ length: n }, (_, i) => {
      if (eligible[i][t] !== 1) return Number.NaN;
      let sum = 0,
        count = 0;
      for (const id of trendRules) {
        const f = system.forecasts[id][i][t];
        if (Number.isFinite(f)) {
          sum += f;
          count++;
        }
      }
      return count ? sum / count : Number.NaN;
    }),
  );
  const nullable = (v: number) => (Number.isFinite(v) ? v : null);

  return ruleCatalog.map((rule): RuleDiagnostics => {
    const forecast = system.forecasts[rule.id];
    let live = 0,
      passing = 0;
    for (let i = 0; i < n; i++)
      if (eligible[i][endIndex] === 1) {
        live++;
        if (system.costPass[rule.id][i][endIndex] === 1) passing++;
      }
    const curve = ruleAccountCurve(system, rule.id, startIndex, endIndex);
    const weekly = weekEnds.flatMap((t) =>
      Array.from({ length: n }, (_, i) =>
        eligible[i][t] === 1 ? forecast[i][t] : Number.NaN,
      ),
    );
    return {
      id: rule.id,
      family: rule.family,
      scalar: nullable(system.scalars[rule.id][endIndex]),
      scalarSource: rule.scalar === null ? "pooled" : "book",
      meanAbsForecast: meanAbsForecast(system, rule.id, startIndex, endIndex),
      turnover: nullable(system.turnover[rule.id][endIndex]),
      costPassRate: live ? (passing / live) * 100 : null,
      sharpe: nullable(dailySharpe(curve.signed) * 16),
      longOnlySharpe: nullable(dailySharpe(curve.long) * 16),
      correlationToTrend: nullable(correlation(weekly, trend)),
      weight: system.baseWeights[rule.id],
    };
  });
}
