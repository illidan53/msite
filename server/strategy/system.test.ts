import { describe, expect, it } from "vitest";
import type { RuleId } from "../../shared/strategy";
import { ruleCatalog, ruleIds } from "../../shared/strategyRules";
import { buildPanel } from "./calendar";
import {
  barsBefore,
  syntheticBars,
  testBook,
  testConfig,
  weekdays,
  type PathSpec,
} from "./engineTestUtils";
import { effectiveWeights, ruleContributions } from "./forecast";
import { clip, ewmMean, median, spanAlpha } from "./math";
import { computeSystem, ineligibleReasons } from "./system";
import type { SystemFrame } from "./types";

const n = 700;
const dates = weekdays("2022-01-03", n);
const liquid = { vol: 0.3, volume: 1e7 };
const specs: Record<string, PathSpec> = {
  SPY: { seed: 1, drift: 0.0003, vol: 0.18, volume: 8e7 },
  // alpha: six members (the ≥ 5 median rule), one late listing and one with missing bars.
  A1: { seed: 11, drift: 0.002, ...liquid },
  A2: { seed: 12, drift: 0.0008, ...liquid },
  A3: { seed: 13, drift: 0, ...liquid },
  A4: { seed: 14, drift: -0.001, ...liquid },
  A5: { seed: 15, drift: 0.0003, gaps: [300, 301, 302, 450], ...liquid },
  A6: { seed: 16, drift: 0.0008, start: 150, ...liquid },
  // beta: three members (median over whoever trades), one expensive to trade.
  B1: { seed: 21, drift: -0.002, vol: 0.35, volume: 1e7 },
  B2: { seed: 22, drift: -0.001, vol: 0.35, volume: 1e7 },
  B3: { seed: 23, drift: -0.0005, vol: 0.45, volume: 4e4 },
  // gamma: a single member whose prices freeze for a while.
  STALE: { seed: 31, drift: 0.0005, flat: [600, 620], ...liquid },
};
const bars = Object.fromEntries(
  Object.entries(specs).map(([symbol, spec]) => [symbol, syntheticBars(dates, spec)]),
);
const book = testBook({
  alpha: ["A1", "A2", "A3", "A4", "A5", "A6"],
  beta: ["B1", "B2", "B3"],
  gamma: ["STALE", "MISSING"],
});
const panel = buildPanel(bars, "SPY");
const frame = computeSystem(panel, book, testConfig);
const last = n - 1;
const row = (symbol: string) => frame.symbols.indexOf(symbol);

describe("system frame shape", () => {
  it("keeps book order, reports missing symbols and aligns every series to the calendar", () => {
    expect(frame.symbols).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "STALE"]);
    expect(frame.missing).toEqual(["MISSING"]);
    expect(frame.panelIndex.map((p) => panel.symbols[p])).toEqual(frame.symbols);
    expect(frame.classOf).toEqual([...Array(6).fill("alpha"), ...Array(3).fill("beta"), "gamma"]);
    expect(frame.dates).toBe(panel.dates);
    expect(frame.panel).toBe(panel);
    expect(Object.keys(frame.classIndex).sort()).toEqual(["alpha", "beta", "gamma"]);
    for (const series of [frame.sigma, frame.fdm, frame.combined, frame.trendFilter, frame.costBps])
      expect(series.every((s) => s.length === n)).toBe(true);
    for (const rule of ruleIds) {
      expect(frame.forecasts[rule]).toHaveLength(frame.symbols.length);
      expect(frame.scalars[rule]).toHaveLength(n);
      expect(frame.baseWeights[rule]).toBe(ruleCatalog.find((r) => r.id === rule)!.weight);
    }
  });
});

describe("eligibility", () => {
  it("requires a bar, 256 valid σ values, live prices and an affordable cost", () => {
    const reasons = (symbol: string) => frame.reason[row(symbol)];
    // σ is valid from the 11th session, so the 256th valid value is at session 265.
    expect(reasons("A1")[264]).toBe(2);
    expect(reasons("A1")[265]).toBe(0);
    expect(frame.eligible[row("A1")][265]).toBe(1);
    expect([reasons("A5")[300], reasons("A5")[450]]).toEqual([1, 1]);
    expect(frame.eligible[row("A5")][300]).toBe(0);
    expect(reasons("A6")[149]).toBe(1);
    expect(reasons("A6")[150 + 264]).toBe(2);
    expect(reasons("A6")[150 + 265]).toBe(0);
    // Returns are zero on sessions 600–619; five within the last ten marks prices stale.
    expect(reasons("STALE")[603]).toBe(0);
    expect(reasons("STALE")[604]).toBe(3);
    expect(reasons("STALE")[624]).toBe(3);
    expect(reasons("STALE")[625]).toBe(0);
    expect(ineligibleReasons[3]).toBe("stale");
  });
  it("excludes untraded symbols and symbols whose cost exceeds 0.01 SR per trade", () => {
    const days = weekdays("2024-01-01", 300);
    const small = buildPanel(
      {
        SPY: syntheticBars(days, { seed: 1, volume: 8e7 }),
        LIQUID: syntheticBars(days, { seed: 2, vol: 0.3, volume: 1e7 }),
        ZERO: syntheticBars(days, { seed: 3, vol: 0.3, volume: 0 }),
        // 30 bps at 15% vol is 0.02 SR per trade.
        CALM: syntheticBars(days, { seed: 4, vol: 0.15, volume: 1e4 }),
      },
      "SPY",
    );
    const result = computeSystem(
      small,
      testBook({ c: ["LIQUID", "ZERO", "CALM"] }),
      testConfig,
    );
    expect(result.reason.map((r) => ineligibleReasons[r[299]])).toEqual([null, "illiquid", "cost"]);
    expect(result.costBps[2][299]).toBe(30);
  });
  it("prices trades by the trailing 60-session median dollar-volume tier", () => {
    expect(frame.costBps[row("A1")][last]).toBe(3);
    expect(frame.costBps[row("B3")][last]).toBe(30);
    expect(frame.dollarVolume[row("B3")][last]).toBeLessThan(10e6);
  });
  it("leaves combined forecasts NaN while ineligible", () => {
    expect(frame.combined[row("A1")][264]).toBeNaN();
    expect(frame.combined[row("A5")][300]).toBeNaN();
    expect(frame.combined[row("STALE")][610]).toBeNaN();
    expect(frame.combined[row("A1")][last]).not.toBeNaN();
  });
});

describe("causality", () => {
  const fields = (f: SystemFrame, i: number) => ({
    sigma: f.sigma[i],
    fdm: f.fdm[i],
    combined: f.combined[i],
    eligible: f.eligible[i],
    reason: f.reason[i],
    trendFilter: f.trendFilter[i],
    costBps: f.costBps[i],
    ...Object.fromEntries(ruleIds.map((r) => [`f:${r}`, f.forecasts[r][i]])),
    ...Object.fromEntries(ruleIds.map((r) => [`pass:${r}`, f.costPass[r][i]])),
  });
  it.each([160, 300, 455, 610])("a run on the first %i sessions equals the full run before then", (k) => {
    const prefix = computeSystem(buildPanel(barsBefore(bars, dates[k]), "SPY"), book, testConfig);
    expect(prefix.dates).toEqual(dates.slice(0, k));
    prefix.symbols.forEach((symbol, i) => {
      const full = fields(frame, row(symbol));
      for (const [name, series] of Object.entries(fields(prefix, i)))
        expect(Array.from(series), `${symbol} ${name}`).toEqual(
          Array.from(full[name as keyof typeof full].slice(0, k)),
        );
    });
    for (const rule of ruleIds) {
      expect(Array.from(prefix.scalars[rule])).toEqual(Array.from(frame.scalars[rule].slice(0, k)));
      expect(Array.from(prefix.turnover[rule])).toEqual(Array.from(frame.turnover[rule].slice(0, k)));
    }
    for (const [id, index] of Object.entries(prefix.classIndex))
      expect(Array.from(index)).toEqual(Array.from(frame.classIndex[id].slice(0, k)));
  });
});

describe("rule signs on trending symbols", () => {
  const f = (rule: RuleId, symbol: string) => frame.forecasts[rule][row(symbol)][last];
  it("absolute trend is long the riser and short the faller", () => {
    for (const rule of ["ewmac32", "ewmac64", "breakout160", "breakout320"] as RuleId[]) {
      expect(f(rule, "A1"), rule).toBeGreaterThan(0);
      expect(f(rule, "B1"), rule).toBeLessThan(0);
    }
  });
  it("sector trend is shared by a class and follows its median member", () => {
    for (const rule of ["assettrend32", "assettrend64"] as RuleId[]) {
      expect(f(rule, "A1")).toBe(f(rule, "A4"));
      expect(f(rule, "B1"), rule).toBeLessThan(0);
      expect(f(rule, "B1")).toBe(f(rule, "B3"));
    }
  });
  it("relative momentum ranks members within their class", () => {
    expect(f("relmom80", "A1")).toBeGreaterThan(0);
    expect(f("relmom80", "A4")).toBeLessThan(0);
    expect(f("relmom80", "B1")).toBeLessThan(f("relmom80", "B3"));
  });
  it("relative momentum is undefined in a one-member class (outperformance is exactly 0)", () => {
    expect(frame.forecasts.relmom40[row("STALE")].every(Number.isNaN)).toBe(true);
    expect(Number.isFinite(frame.forecasts.assettrend16[row("STALE")][last])).toBe(true);
  });
  it("caps every forecast at ±20 and warms each rule up on the symbol's own sessions", () => {
    for (const rule of ruleCatalog) {
      const a6 = frame.forecasts[rule.id][row("A6")];
      expect(a6[150 + rule.warmup - 2]).toBeNaN();
      if (rule.scalar !== null) expect(a6[150 + rule.warmup - 1], rule.id).not.toBeNaN();
      for (const series of frame.forecasts[rule.id])
        expect(series.every((v) => Number.isNaN(v) || Math.abs(v) <= 20)).toBe(true);
    }
  });
});

describe("pooled scalar for mr20", () => {
  it("is NaN until 256 dates have a median, then 10 over the expanding mean", () => {
    const scalar = frame.scalars.mr20;
    const first = scalar.findIndex(Number.isFinite);
    expect(first).toBeGreaterThan(255);
    expect(scalar[first]).toBeGreaterThan(1);
    expect(frame.forecasts.mr20.every((s) => s.slice(0, first).every(Number.isNaN))).toBe(true);
    expect(frame.scalars.mr5.every((v) => v === 9.3)).toBe(true);
  });
});

describe("speed limit (AFTS Strategy 9)", () => {
  const b3 = row("B3");
  it("drops an expensive fast rule but keeps slow ones", () => {
    expect(frame.costPass.ewmac8[b3][last]).toBe(0);
    expect(frame.costPass.ewmac64[b3][last]).toBe(1);
    expect(frame.costPass.ewmac8[row("A1")][last]).toBe(1);
    expect(frame.eligible[b3][last]).toBe(1);
    const weights = effectiveWeights(frame, b3, last);
    expect(weights.ewmac8).toBeUndefined();
    expect(weights.ewmac64).toBeGreaterThan(0);
  });
  it("tests c_SR × T ≤ 0.15 on each month's first session from the previous session's data", () => {
    const own = Array.from(frame.sigma[b3]).flatMap((s, t) => (Number.isFinite(s) ? [t] : []));
    for (let t = 300; t < n; t++) {
      const monthStart = dates[t].slice(0, 7) !== dates[t - 1].slice(0, 7);
      for (const rule of ["ewmac8", "mr5", "ewmac64"] as RuleId[]) {
        const pass = frame.costPass[rule][b3];
        if (!monthStart) {
          expect(pass[t]).toBe(pass[t - 1]);
          continue;
        }
        const previous = own.filter((s) => s < t).slice(-252);
        const sigma = median(previous.map((s) => frame.sigma[b3][s]));
        const costSharpe = frame.costBps[b3][t - 1] / 1e4 / sigma;
        expect(pass[t], `${rule} ${dates[t]}`).toBe(
          costSharpe * frame.turnover[rule][t - 1] > 0.15 ? 0 : 1,
        );
      }
    }
  });
  it("measures turnover as 256 × mean |Δf| / 10 over every symbol's sessions so far", () => {
    let sum = 0,
      count = 0;
    frame.forecasts.ewmac16.forEach((f, i) => {
      // Diffs between consecutive own sessions, so A5's missing bars do not break its series.
      const close = panel.close[frame.panelIndex[i]];
      const own = Array.from(close).flatMap((c, t) => (c > 0 && t <= 400 ? [t] : []));
      for (let k = 1; k < own.length; k++) {
        const change = Math.abs(f[own[k]] - f[own[k - 1]]);
        if (Number.isFinite(change)) {
          sum += change;
          count++;
        }
      }
    });
    expect(frame.turnover.ewmac16[400]).toBeCloseTo((256 * sum) / count / 10, 10);
  });
});

describe("combination", () => {
  it("is clip(FDM × Σ w f) with the redistributed weights, and the drivers add up to it", () => {
    for (const symbol of ["A1", "B3", "STALE"]) {
      const i = row(symbol);
      const weights = effectiveWeights(frame, i, last);
      const blend = Object.entries(weights).reduce(
        (sum, [rule, w]) => sum + w! * frame.forecasts[rule as RuleId][i][last],
        0,
      );
      expect(frame.combined[i][last]).toBeCloseTo(clip(frame.fdm[i][last] * blend, 20), 12);
      const drivers = ruleContributions(frame, i, last);
      expect(drivers.reduce((sum, d) => sum + d.contribution, 0)).toBeCloseTo(
        frame.fdm[i][last] * blend,
        12,
      );
    }
  });
  it("uses FDM 1 before the first correlation fit, then a capped diversification gain", () => {
    expect(frame.fdm[row("A1")][60]).toBe(1);
    const late = frame.fdm.map((f) => f[last]);
    expect(late.every((v) => v > 1.05 && v <= 2.5)).toBe(true);
  });
  it("redistributes a zero-weighted family (without_<family> variants)", () => {
    const variant = computeSystem(panel, book, testConfig, { ruleWeights: { mr5: 0, mr20: 0 } });
    expect(variant.baseWeights.mr5).toBe(0);
    expect(Array.from(variant.forecasts.mr5[0])).toEqual(Array.from(frame.forecasts.mr5[0]));
    const weights = effectiveWeights(variant, row("A1"), last);
    expect(weights.mr5).toBeUndefined();
    expect(Object.values(weights).reduce((s, w) => s + w!, 0)).toBeCloseTo(1, 12);
  });
});

describe("trend filter and vol attenuation", () => {
  it("trendFilter is 10 when EWMA64 ≥ EWMA256, else 0, after 256 own sessions", () => {
    const check = (symbol: string, start: number) => {
      const i = row(symbol);
      const close = panel.close[panel.index[symbol]].slice(start);
      const fast = ewmMean(close, spanAlpha(64));
      const slow = ewmMean(close, spanAlpha(256));
      const filter = frame.trendFilter[i];
      expect(filter[start + 254]).toBeNaN();
      for (let k = 255; k < close.length; k++)
        expect(filter[start + k]).toBe(fast[k] >= slow[k] ? 10 : 0);
    };
    check("A1", 0);
    check("A6", 150);
    expect(frame.trendFilter[row("A1")][last]).toBe(10);
    expect(frame.trendFilter[row("B1")][last]).toBe(0);
  });
  it("multiplies trend-like raw forecasts by one per-symbol M, leaving accel and mr alone", () => {
    const attenuated = computeSystem(panel, book, testConfig, { volAttenuation: true });
    const i = row("A3");
    let differs = 0;
    for (let t = 0; t < n; t++) {
      const ratios: number[] = [];
      for (const rule of ruleCatalog) {
        const base = frame.forecasts[rule.id][i][t];
        const value = attenuated.forecasts[rule.id][i][t];
        if (Number.isNaN(base)) {
          expect(value).toBeNaN();
          continue;
        }
        if (/^(accel|mr)/.test(rule.id)) expect(value).toBe(base);
        else if (Math.abs(base) < 19 && Math.abs(value) < 19 && Math.abs(base) > 0.5)
          ratios.push(value / base);
      }
      // V is valid from the 11th session, so M is exactly 1 until the 256th value at 265.
      if (t < 265) ratios.forEach((r) => expect(r).toBeCloseTo(1, 12));
      ratios.forEach((r) => expect(r).toBeCloseTo(ratios[0], 9));
      if (ratios.length && Math.abs(ratios[0] - 1) > 1e-6) differs++;
      ratios.forEach((r) => {
        expect(r).toBeGreaterThanOrEqual(0.5);
        expect(r).toBeLessThanOrEqual(2);
      });
    }
    expect(differs).toBeGreaterThan(100);
  });
});
