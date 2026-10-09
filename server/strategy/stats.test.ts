import { describe, expect, it } from "vitest";
import {
  deflatedSharpe,
  deflatedSharpeProbability,
  drawdowns,
  expectedMaxSharpe,
  monthlySkew,
  NORMAL_TAIL_RATIO,
  normCdf,
  normInv,
  pairedSharpeInterval,
  performanceStats,
  probabilityOfOverfitting,
  regression,
  sampleSkew,
  sharpeDifference,
  tailRatios,
  yearlyReturns,
} from "./stats";
import { sessionDates } from "./testFrames";

// Golden values: pandas 3.0 / numpy 2.5 / scipy 1.18 (scratchpad golden.py).
const pattern = (n: number) =>
  Array.from({ length: n }, (_, t) =>
    t % 9 === 0 ? 0 : 0.01 * Math.sin(0.7 * t) + 0.003 * Math.cos(1.9 * t) - 0.0005,
  );

describe("normal distribution", () => {
  it("matches scipy's CDF to 1e-12", () => {
    const cases: [number, number][] = [
      [-8, 6.22096057427174e-16],
      [-5, 2.8665157187919344e-7],
      [-2.5, 0.006209665325776134],
      [-1, 0.15865525393145707],
      [-0.3, 0.3820885778110474],
      [0, 0.5],
      [0.5, 0.6914624612740131],
      [1.96, 0.9750021048517795],
      [3, 0.9986501019683699],
      [6, 0.9999999990134123],
    ];
    for (const [x, p] of cases) expect(Math.abs(normCdf(x) - p)).toBeLessThan(1e-12);
    expect(normCdf(-5) / 2.8665157187919344e-7).toBeCloseTo(1, 9);
  });
  it("matches scipy's inverse CDF to 1e-9", () => {
    const cases: [number, number][] = [
      [1e-10, -6.361340902404056],
      [1e-5, -4.264890793922825],
      [0.001, -3.090232306167813],
      [0.01, -2.3263478740408408],
      [0.025, -1.9599639845400545],
      [0.3, -0.5244005127080409],
      [0.5, 0],
      [0.7, 0.5244005127080407],
      [0.975, 1.959963984540054],
      [0.999, 3.090232306167813],
      [1 - 1e-6, 4.753424308817087],
    ];
    for (const [p, x] of cases) expect(Math.abs(normInv(p) - x)).toBeLessThan(1e-9);
    expect(normInv(0)).toBe(-Infinity);
    expect(normInv(1.5)).toBeNaN();
  });
  it("defines Carver's tail reference ratio", () => {
    expect(NORMAL_TAIL_RATIO).toBeCloseTo(4.436204423270713, 12);
  });
});

describe("performance statistics", () => {
  const dates = sessionDates(90, "2023-01-02");
  const returns = pattern(90);
  const stats = performanceStats({ dates, returns });
  it("annualises Carver-style and reports percent units", () => {
    expect(stats.sessions).toBe(90);
    expect(stats.start).toBe("2023-01-02");
    expect(stats.end).toBe("2023-05-05");
    expect(stats.annualReturn).toBeCloseTo(-13.062456707390876, 10);
    expect(stats.annualVol).toBeCloseTo(11.79600549623977, 10);
    expect(stats.sharpe).toBeCloseTo(-1.1073627179603143, 10);
    expect(stats.sharpeError).toBeCloseTo(1.6885665389928433, 10);
    expect(stats.sortino).toBeCloseTo(-2.4638495324359164, 10);
    expect(stats.hitRate).toBeCloseTo(48.75, 10);
  });
  it("measures drawdowns on compounded equity with the high-water mark at 100", () => {
    expect(stats.maxDrawdown).toBeCloseTo(7.1746471029952215, 10);
    expect(stats.averageDrawdown).toBeCloseTo(3.4975839110186384, 10);
    expect(stats.totalReturn).toBeCloseTo(-4.720528980736859, 10);
    expect(stats.cagr).toBeCloseTo(-13.375991622785211, 9);
    expect(stats.calmar).toBeCloseTo(-1.8643413997604281, 9);
    // A first-day loss is a drawdown; a later full recovery is not.
    expect(drawdowns([-0.01, 0.01])).toMatchObject({ max: 1 });
    expect(drawdowns([0.01, -0.01, 0.02]).max).toBeCloseTo(1, 12);
  });
  it("uses pandas G1 monthly skew and demeaned, zero-free tail ratios", () => {
    expect(stats.monthlySkew).toBeCloseTo(0.4688417576763477, 10);
    expect(stats.lowerTail).toBeCloseTo(0.4286819222909649, 10);
    expect(stats.upperTail).toBeCloseTo(0.4688886217683627, 10);
    expect(monthlySkew(dates, returns)).toBeCloseTo(0.4688417576763477, 10);
    expect(sampleSkew([1, 2, 3, 4, 10])).toBeCloseTo(1.697056, 6);
    const uniform = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(tailRatios(uniform).lower).toBeCloseTo(0.55227, 5);
    expect(tailRatios(uniform).upper).toBeCloseTo(0.55227, 5);
    // Flat days never change the tail ratios.
    expect(tailRatios([...uniform, 0, 0, 0])).toEqual(tailRatios(uniform));
  });
  it("derives costs, turnover, gross and overlay binding from fractions of equity", () => {
    const n = 10;
    const full = performanceStats({
      dates: sessionDates(n),
      returns: Array.from({ length: n }, (_, t) => (t % 2 ? 0.01 : -0.005)),
      cost: Array(n).fill(0.0001),
      traded: Array(n).fill(0.02),
      gross: Array(n).fill(0.8),
      multiplier: [1, 1, 0.9, 1, 1, 1, 1, 0.5, 1, 1],
    });
    expect(full.annualCost).toBeCloseTo(2.56, 10);
    expect(full.costSharpe).toBeCloseTo(2.56 / full.annualVol!, 10);
    expect(full.turnover).toBeCloseTo((0.02 * 256) / 0.8, 10);
    expect(full.averageGross).toBeCloseTo(80, 10);
    expect(full.overlayBinding).toBeCloseTo(20, 10);
    expect(full.alpha).toBeNull();
  });
  it("regresses daily returns for alpha (×256, percent) and beta", () => {
    const x = pattern(300);
    const y = x.map((v) => 0.0002 + 0.5 * v);
    const fit = regression(y, x);
    expect(fit.beta).toBeCloseTo(0.5, 12);
    expect(fit.alpha * 256).toBeCloseTo(0.0512, 12);
    expect(fit.correlation).toBeCloseTo(1, 12);
    const stats = performanceStats({ dates: sessionDates(300), returns: y, riskParity: x, spy: x });
    expect(stats.alpha).toBeCloseTo(5.12, 9);
    expect(stats.betaSpy).toBeCloseTo(0.5, 12);
  });
  it("compounds calendar-year returns", () => {
    const years = yearlyReturns(
      ["2023-12-28", "2023-12-29", "2024-01-02", "2024-01-03"],
      [0.1, 0.1, -0.5, 0.2],
    );
    expect(years[0].year).toBe(2023);
    expect(years[0].return).toBeCloseTo(21, 10);
    expect(years[1].return).toBeCloseTo(-40, 10);
  });
  it("returns nulls rather than NaN when undefined", () => {
    const flat = performanceStats({ dates: sessionDates(5), returns: [0, 0, 0, 0, 0] });
    expect(flat.sharpe).toBeNull();
    expect(flat.maxDrawdown).toBe(0);
    expect(flat.hitRate).toBeNull();
    expect(flat.calmar).toBeNull();
  });
});

describe("Sharpe-difference tests", () => {
  const a = Array.from({ length: 500 }, (_, t) => 0.004 * Math.sin(0.31 * t) + 0.0006);
  const b = Array.from(
    { length: 500 },
    (_, t) => 0.003 * Math.sin(0.31 * t + 0.4) + 0.002 * Math.cos(0.17 * t) + 0.0002,
  );
  it("computes the Jobson–Korkie/Memmel z on daily Sharpe ratios", () => {
    const d = sharpeDifference(a, b);
    expect(d.difference).toBeCloseTo(2.2387996794374176, 10);
    expect(d.z).toBeCloseTo(4.4794766279613345, 9);
    expect(d.p! / 7.482628239012502e-6).toBeCloseTo(1, 6);
  });
  it("bootstraps a deterministic paired interval around the difference", () => {
    const first = pairedSharpeInterval(a, b);
    expect(first).toEqual(pairedSharpeInterval(a, b));
    expect(first![0]).toBeLessThan(2.2387996794374176);
    expect(first![1]).toBeGreaterThan(2.2387996794374176);
    expect(pairedSharpeInterval(a, b, { seed: 1 })).not.toEqual(first);
    // Identical series: the paired difference is exactly zero in every resample.
    expect(pairedSharpeInterval(a, a)).toEqual([0, 0]);
    expect(sharpeDifference(a, a)).toMatchObject({ difference: 0, z: null, p: null });
  });
  it("gives no interval below two 42-session blocks instead of a point", () => {
    // At n ≤ 42 every resample is the sample itself: [d, d] would look certain.
    for (const n of [10, 42, 83])
      expect(pairedSharpeInterval(a.slice(0, n), b.slice(0, n))).toBeNull();
    const d = sharpeDifference(a.slice(0, 40), b.slice(0, 40));
    expect(d.interval).toBeNull();
    expect(d.difference).not.toBeNull();
    const two = pairedSharpeInterval(a.slice(0, 84), b.slice(0, 84))!;
    expect(two[1] - two[0]).toBeGreaterThan(0.1);
    expect(pairedSharpeInterval(a, b, { block: 5 })).not.toBeNull();
    expect(pairedSharpeInterval(a.slice(0, 9), b.slice(0, 9), { block: 5 })).toBeNull();
  });
});

describe("deflated Sharpe ratio (Bailey & López de Prado 2014)", () => {
  // Paper example: SR 2.5 a year over 250-day years, T = 1250, V[SR] = 0.5 a year.
  const sr = 2.5 / Math.sqrt(250);
  const variance = 0.5 / 250;
  it("reproduces the paper's worked example", () => {
    const sr0 = expectedMaxSharpe(variance, 100);
    expect(sr0).toBeCloseTo(0.11317200186513214, 9);
    expect(deflatedSharpeProbability(sr, sr0, 1250, -3, 10)).toBeCloseTo(0.9003968344493904, 9);
    const sr46 = expectedMaxSharpe(variance, 46);
    expect(sr46).toBeCloseTo(0.10036237061765357, 9);
    expect(deflatedSharpeProbability(sr, sr46, 1250, -3, 10)).toBeCloseTo(0.9505017068755787, 9);
    const sr88 = expectedMaxSharpe(variance, 88);
    expect(deflatedSharpeProbability(sr, sr88, 1250, 0, 3)).toBeCloseTo(0.9504908166760138, 9);
  });
  it("deflates by N̂ = ρ̄ + (1 − ρ̄)N across the run's variants", () => {
    const base = pattern(400).map((v) => v + 0.001);
    const variants = [0, 1, 2, 3].map((k) =>
      base.map((v, t) => v + 0.002 * Math.sin(0.9 * t + k)),
    );
    const result = deflatedSharpe({ returns: variants[0], variants, trials: 40 });
    expect(result.trials).toBe(40);
    expect(result.effectiveTrials).toBeGreaterThan(1);
    expect(result.effectiveTrials).toBeLessThan(40);
    expect(result.benchmarkSharpe).toBeGreaterThan(0);
    expect(result.probability).toBeGreaterThan(0);
    expect(result.probability).toBeLessThan(1);
    // More trials can only make the same record less convincing.
    const more = deflatedSharpe({ returns: variants[0], variants, trials: 400 });
    expect(more.probability!).toBeLessThan(result.probability!);
  });
});

describe("probability of backtest overfitting (CSCV)", () => {
  it("matches an independent pandas CSCV on a toy matrix", () => {
    const columns = Array.from({ length: 6 }, (_, n) =>
      Array.from(
        { length: 400 },
        (_, t) => 0.01 * Math.sin(0.37 * t * (n + 1) + n) + 0.0002 * n * Math.cos(0.05 * t),
      ),
    );
    const result = probabilityOfOverfitting(columns, 10);
    expect(result.splits).toBe(252);
    expect(result.variants).toBe(6);
    expect(result.probability).toBeCloseTo(0.7817460317460317, 12);
  });
  it("is zero when one variant is best in every block", () => {
    const noise = (k: number) =>
      Array.from({ length: 200 }, (_, t) => 0.01 * Math.sin(1.3 * t + k));
    const columns = [noise(0), noise(1), noise(2)].map((c, k) =>
      c.map((v) => v + 0.004 * (k === 2 ? 1 : 0)),
    );
    expect(probabilityOfOverfitting(columns, 10).probability).toBe(0);
  });
  it("needs enough data for the blocks", () => {
    expect(probabilityOfOverfitting([[0.1, 0.2], [0.2, 0.1]], 10)).toEqual({
      probability: null,
      splits: 0,
      variants: 2,
    });
  });
});
