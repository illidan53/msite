import { describe, expect, it } from "vitest";
import { ruleCatalog } from "../../shared/strategyRules";
import { ruleAccountCurve, ruleDiagnostics } from "./ruleCurves";
import { dailySharpe } from "./stats";
import { testSystem } from "./testFrames";

// AAA closes at 100 + t, AAB at 200 − t; σ = 20%, so q = f/10 exactly.
const classes = [{ id: "a", rows: [["AAA", "AAB"]] }];
const close = (s: string, t: number) => (s === "AAA" ? 100 + t : s === "AAB" ? 200 - t : 400);

describe("rule account curves", () => {
  const system = testSystem({
    classes,
    sessions: 40,
    close,
    sigma: 0.2,
    ruleForecast: (rule, i, t) =>
      rule === "ewmac8" ? (i === 0 ? (t < 10 ? 10 : 20) : -10) : 10,
    costPass: (rule, i) => !(rule === "ewmac8" && i === 1),
  });

  it("holds (f/10)(0.2/σ) to the next own session and charges one-way costs on changes", () => {
    const curve = ruleAccountCurve(system, "ewmac8", 5, 39);
    expect(curve.signed).toHaveLength(34);
    const cost = 3 / 1e4;
    const expected = (t: number, longOnly: boolean) => {
      const rA = (100 + t) / (99 + t) - 1;
      const rB = (200 - t) / (201 - t) - 1;
      const qA = t - 1 < 10 ? 1 : 2;
      const a = qA * rA - (t - 1 === 10 ? cost : 0);
      return longOnly ? a / 2 : (a - rB) / 2;
    };
    curve.signed.forEach((v, k) => expect(v).toBeCloseTo(expected(k + 6, false), 14));
    curve.long.forEach((v, k) => expect(v).toBeCloseTo(expected(k + 6, true), 14));
  });

  it("summarises scale, turnover, cost passes and Sharpe per rule", () => {
    const rules = ruleDiagnostics(system, 5, 39);
    expect(rules.map((r) => r.id)).toEqual(ruleCatalog.map((r) => r.id));
    const ewmac8 = rules[0];
    // t 5–9 at |10| and 10–39 at |20| for AAA; |−10| throughout for AAB.
    expect(ewmac8.meanAbsForecast).toBeCloseTo((5 * 10 + 30 * 20 + 35 * 10) / 70, 12);
    expect(ewmac8.costPassRate).toBe(50);
    expect(ewmac8.turnover).toBe(12);
    expect(ewmac8.scalar).toBe(5.95);
    expect(ewmac8.scalarSource).toBe("book");
    expect(ewmac8.weight).toBe(5);
    const curve = ruleAccountCurve(system, "ewmac8", 5, 39);
    expect(ewmac8.sharpe).toBeCloseTo(dailySharpe(curve.signed) * 16, 12);
    expect(ewmac8.longOnlySharpe).toBeCloseTo(dailySharpe(curve.long) * 16, 12);
    const mr20 = rules.find((r) => r.id === "mr20")!;
    expect(mr20.scalarSource).toBe("pooled");
    expect(mr20.scalar).toBeNull();
  });

  it("correlates weekly forecasts with the mean ewmac forecast", () => {
    const wave = testSystem({
      classes,
      sessions: 300,
      ruleForecast: (rule, i, t) =>
        (rule === "mr5" ? -10 : rule === "relmom40" ? 0 : 10) * Math.sin(t / 7 + i),
    });
    const rules = ruleDiagnostics(wave, 20, 299);
    expect(rules.find((r) => r.id === "ewmac16")!.correlationToTrend).toBeCloseTo(1, 12);
    expect(rules.find((r) => r.id === "mr5")!.correlationToTrend).toBeCloseTo(-1, 12);
    expect(rules.find((r) => r.id === "relmom40")!.correlationToTrend).toBeNull();
  });
});
