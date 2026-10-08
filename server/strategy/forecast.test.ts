import { describe, expect, it } from "vitest";
import type { RuleId } from "../../shared/strategy";
import { ruleCatalog, ruleIds } from "../../shared/strategyRules";
import { testBook } from "./engineTestUtils";
import { effectiveWeights, familyForecasts, ruleContributions } from "./forecast";
import type { SystemFrame } from "./types";

/** One symbol, one session: every rule votes 10 unless told otherwise. */
function stubFrame({
  forecasts = {},
  costFailed = [],
  weights = {},
  fdm = 1.5,
}: {
  forecasts?: Partial<Record<RuleId, number>>;
  costFailed?: RuleId[];
  weights?: Partial<Record<RuleId, number>>;
  fdm?: number;
}): SystemFrame {
  const byRule = <T>(make: (rule: RuleId) => T) =>
    Object.fromEntries(ruleIds.map((rule) => [rule, make(rule)])) as Record<RuleId, T>;
  const one = (value: number) => [Float64Array.of(value)];
  return {
    book: testBook({ c: ["AAA"] }),
    panel: {
      dates: ["2026-10-07"],
      symbols: ["AAA"],
      index: { AAA: 0 },
      open: one(1),
      high: one(1),
      low: one(1),
      close: one(1),
      volume: one(1),
      benchmark: "SPY",
    },
    dates: ["2026-10-07"],
    symbols: ["AAA"],
    classOf: ["c"],
    panelIndex: [0],
    missing: [],
    sigma: one(0.3),
    dollarVolume: one(1e9),
    costBps: one(3),
    eligible: [Uint8Array.of(1)],
    reason: [Uint8Array.of(0)],
    baseWeights: byRule((rule) => weights[rule] ?? ruleCatalog.find((r) => r.id === rule)!.weight),
    forecasts: byRule((rule) => one(forecasts[rule] ?? 10)),
    costPass: byRule((rule) => [Uint8Array.of(costFailed.includes(rule) ? 0 : 1)]),
    scalars: byRule(() => Float64Array.of(1)),
    turnover: byRule(() => Float64Array.of(1)),
    fdm: one(fdm),
    combined: one(NaN),
    trendFilter: one(10),
    classIndex: { c: Float64Array.of(0) },
  };
}

const total = (weights: Partial<Record<RuleId, number>>) =>
  Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
const trendRules: RuleId[] = ruleCatalog.filter((r) => r.family === "trend").map((r) => r.id);

describe("effective weights (spec §3.4)", () => {
  it("are the catalog weights as fractions when every rule votes", () => {
    const weights = effectiveWeights(stubFrame({}), 0, 0);
    expect(total(weights)).toBeCloseTo(1, 12);
    expect(weights.ewmac8).toBeCloseTo(0.05, 12);
    expect(weights.accel32).toBeCloseTo(0.025, 12);
    expect(weights.assettrend16).toBeCloseTo(1 / 12, 12);
    expect(weights.relmom40).toBeCloseTo(0.1, 12);
  });
  it("hands an unavailable rule's weight to its own family first, pro rata", () => {
    const weights = effectiveWeights(stubFrame({ forecasts: { ewmac8: NaN } }), 0, 0);
    expect(weights.ewmac8).toBeUndefined();
    // Trend keeps its 45%, now spread over 40 points of remaining trend weight.
    expect(weights.ewmac16).toBeCloseTo((0.45 * 5) / 40, 12);
    expect(weights.accel64).toBeCloseTo((0.45 * 2.5) / 40, 12);
    expect(weights.relmom80).toBeCloseTo(0.1, 12);
    expect(total(weights)).toBeCloseTo(1, 12);
  });
  it("spreads a wholly unavailable family across the other families, pro rata", () => {
    const weights = effectiveWeights(
      stubFrame({ costFailed: ["mr5", "mr20"], forecasts: { ewmac8: NaN } }),
      0,
      0,
    );
    expect(weights.mr5).toBeUndefined();
    expect(weights.relmom40).toBeCloseTo(0.1 / 0.9, 12);
    expect(weights.assettrend32).toBeCloseTo(1 / 12 / 0.9, 12);
    expect(weights.ewmac16).toBeCloseTo((0.45 / 0.9) * (5 / 40), 12);
    expect(total(weights)).toBeCloseTo(1, 12);
  });
  it("drops rules whose override weight is 0 (without_<family> variants)", () => {
    const weights = effectiveWeights(
      stubFrame({ weights: Object.fromEntries(trendRules.map((r) => [r, 0])) }),
      0,
      0,
    );
    expect(trendRules.every((r) => weights[r] === undefined)).toBe(true);
    expect(weights.relmom40).toBeCloseTo(0.1 / 0.55, 12);
    expect(total(weights)).toBeCloseTo(1, 12);
  });
  it("is empty when no rule votes", () => {
    const forecasts = Object.fromEntries(ruleIds.map((r) => [r, NaN]));
    expect(effectiveWeights(stubFrame({ forecasts }), 0, 0)).toEqual({});
    expect(ruleContributions(stubFrame({ forecasts }), 0, 0)).toEqual([]);
  });
});

describe("family forecasts and contributions", () => {
  const frame = stubFrame({
    forecasts: { ewmac8: 20, ewmac16: -4, relmom40: 6, relmom80: 2, mr5: 0, mr20: NaN },
    costFailed: ["breakout40"],
  });
  it("averages each family's capped forecasts by base weight over voting rules", () => {
    const families = familyForecasts(frame, 0, 0);
    // Trend: breakout40 is filtered, leaving 7 rules at 5 and 2 accels at 2.5 (40 points).
    expect(families.trend).toBeCloseTo((5 * 20 + 5 * -4 + 5 * 10 * 5 + 2.5 * 10 * 2) / 40, 12);
    expect(families.relative_momentum).toBeCloseTo(4, 12);
    expect(families.mean_reversion).toBe(0);
    expect(families.sector_trend).toBeCloseTo(10, 12);
    expect(familyForecasts(stubFrame({ costFailed: ["mr5", "mr20"] }), 0, 0).mean_reversion).toBeNull();
  });
  it("gives FDM × w × f per voting rule, largest first, summing to the combined blend", () => {
    const contributions = ruleContributions(frame, 0, 0);
    const weights = effectiveWeights(frame, 0, 0);
    expect(contributions[0].rule).toBe("ewmac8");
    expect(contributions[0].contribution).toBeCloseTo(1.5 * ((0.45 * 5) / 40) * 20, 12);
    expect(contributions.find((c) => c.rule === "relmom40")!.contribution).toBeCloseTo(
      1.5 * weights.relmom40! * 6,
      12,
    );
    expect(contributions.map((c) => c.rule)).not.toContain("breakout40");
    expect(contributions.map((c) => c.rule)).not.toContain("mr20");
    const sizes = contributions.map((c) => Math.abs(c.contribution));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    const blend = Object.entries(weights).reduce(
      (sum, [rule, w]) => sum + w! * frame.forecasts[rule as RuleId][0][0],
      0,
    );
    expect(contributions.reduce((sum, c) => sum + c.contribution, 0)).toBeCloseTo(1.5 * blend, 12);
  });
});
