import { describe, expect, it } from "vitest";
import {
  benchmarkIds,
  ruleFamilies,
  variantIds,
  type FamilyAdmission,
} from "../../shared/strategy";
import { ruleCatalog, ruleIds } from "../../shared/strategyRules";
import { evaluationStart, runBacktest, trialKey, type ComputeSystem } from "./backtest";
import { configHash } from "./config";
import { buildPortfolio } from "./portfolio";
import { simulate, simulateBuyHold } from "./simulate";
import {
  defaultClasses,
  systemFromPanel,
  testBook,
  testConfig,
  testPanel,
  testSystem,
} from "./testFrames";
import type { EngineOptions } from "./types";

const config = testConfig();

/** Plain OLS of y on x; alpha annualised (×256) in percent, as in PerformanceStats. */
function ols(y: ArrayLike<number>, x: ArrayLike<number>) {
  const n = y.length;
  let mx = 0,
    my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i] / n;
    my += y[i] / n;
  }
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const beta = sxy / sxx;
  return { beta, alpha: (my - beta * mx) * 256 * 100 };
}

/** The family a without_<family> run zeroed, from its rule-weight overrides. */
const droppedFamily = (options?: EngineOptions) =>
  ruleFamilies.find((family) =>
    ruleCatalog.some((r) => r.family === family && options?.ruleWeights?.[r.id] === 0),
  );

describe("evaluation start", () => {
  it("waits for the minimum session and 80% of listed symbols to be eligible", () => {
    expect(evaluationStart(testSystem({ sessions: 400 }), config)).toBe(320);
    const classes = [...defaultClasses, { id: "c", rows: [["CCA", "CCB"]] }];
    const late = testSystem({
      classes,
      sessions: 600,
      eligibleFrom: { AAA: 330, AAB: 330, AAC: 330, BBA: 330, BBB: 330, CCA: 520, CCB: 520 },
      firstBar: { CCA: 500, CCB: 500 },
    });
    // CCA and CCB have no bar yet at 330, so 5 of 5 listed symbols count, not 5 of 7.
    expect(evaluationStart(late, config)).toBe(330);
    expect(evaluationStart(testSystem({ sessions: 300 }), config)).toBe(-1);
  });
});

describe("runBacktest", () => {
  const symbols = ["AAA", "AAB", "AAC", "BBA", "BBB", "LATE"];
  const panel = testPanel({ symbols, sessions: 700, firstBar: { LATE: 450 }, seed: 3 });
  // A +60% gap in AAB is reported as a price jump.
  const aab = panel.index.AAB;
  for (let t = 600; t < 700; t++) {
    panel.close[aab][t] *= 1.6;
    panel.open[aab][t] *= 1.6;
  }
  const stocks = testBook(
    [
      { id: "a", rows: [["AAA", "AAB"], ["AAC"]] },
      { id: "b", rows: [["BBA", "BBB"], ["LATE", "ZZZ"]] },
    ],
    { id: "stocks" },
  );
  const sectors = testBook([{ id: "s", rows: [["AAA", "BBA", "BBB"]] }], {
    id: "sectors",
    riskTarget: 0.15,
  });
  const calls: (EngineOptions | undefined)[] = [];
  const computeSystem: ComputeSystem = (p, book, c, options) => {
    calls.push(options);
    return systemFromPanel(
      p,
      book,
      c,
      {
        sigma: (i, t) => 0.22 + 0.04 * Math.sin(t / 50 + i),
        eligibleFrom: { LATE: 450 + 256 },
        ruleForecast: (rule, i, t) =>
          12 * Math.sin(t / (8 + 3 * ruleIds.indexOf(rule)) + i) + 3,
      },
      options,
    );
  };

  it("runs every variant and benchmark on one aligned evaluation window", async () => {
    const events: string[] = [];
    setImmediate(() => events.push("tick"));
    const hash = configHash(config, [stocks, sectors]);
    const result = await runBacktest({
      panel,
      books: [stocks, sectors],
      config,
      computeSystem,
      priorTrials: ["old:core:abc123", trialKey("stocks", "core", hash)],
      failures: [
        { symbol: "ZZZ", message: "HTTP 404" },
        { symbol: "QQQ", message: "not in any book" },
      ],
      onProgress: (done, total) => events.push(`${done}/${total}`),
    });

    // Progress for 2 books × 12 runs, yielding to the event loop in between.
    const progress = events.filter((e) => e !== "tick");
    expect(progress).toHaveLength(24);
    expect(progress.at(-1)).toBe("24/24");
    expect(events.indexOf("tick")).toBeGreaterThan(0);
    expect(events.indexOf("tick")).toBeLessThan(events.length - 1);

    // One core system per book is reused; engine variants get their own.
    expect(calls.filter((c) => c === undefined)).toHaveLength(2);
    expect(calls).toContainEqual({ volAttenuation: true });
    expect(calls).toContainEqual({ ruleWeights: { mr5: 0, mr20: 0 } });
    expect(calls).toHaveLength(12);

    expect(result.trialKeys).toHaveLength(18);
    expect(result.trialKeys).toContain(`sectors:without_trend:${hash}`);
    const [report, sectorReport] = result.books;
    expect(report.book).toBe("stocks");
    expect(sectorReport.riskTarget).toBe(15);

    const coreSystem = computeSystem(panel, stocks, config);
    const start = evaluationStart(coreSystem, config);
    expect(start).toBe(320);
    expect(report.window).toEqual({
      dataStart: panel.dates[0],
      start: panel.dates[start],
      end: panel.dates[699],
      sessions: 700 - start,
    });
    expect(report.dates).toEqual(panel.dates.slice(start));

    expect(report.runs.map((r) => r.id)).toEqual([...variantIds, ...benchmarkIds]);
    for (const run of report.runs) {
      expect(run.curve).toHaveLength(report.dates.length);
      expect(run.curve[0]).toBe(100);
      expect(run.stats.sessions).toBe(report.dates.length);
      expect(run.stats.start).toBe(report.window.start);
      expect(run.stats.sharpe).not.toBeNull();
      expect(run.yearly.map((y) => y.year)).toEqual([2023, 2024]);
      expect(run.kind).toBe((variantIds as string[]).includes(run.id) ? "variant" : "benchmark");
    }
    const byId = Object.fromEntries(report.runs.map((r) => [r.id, r]));
    expect(byId.core.curve).not.toEqual(byId.long_short.curve);
    expect(byId.core.curve).not.toEqual(byId.whole_shares.curve);
    expect(byId.core.curve).not.toEqual(byId.without_trend.curve);
    expect(byId.core.stats.overlayBinding).not.toBeNull();
    expect(byId.spy_buy_hold.stats.overlayBinding).toBeNull();
    // Core's alpha and beta against an independent regression on re-simulated returns.
    const simOptions = { capital: stocks.capital, startIndex: start };
    const window = (r: Float64Array) => r.slice(start);
    const coreFrame = buildPortfolio(coreSystem, config);
    const coreReturns = window(simulate(coreFrame, config, simOptions).returns);
    const parity = buildPortfolio(coreSystem, config, { constantForecast: 10 });
    const vsParity = ols(coreReturns, window(simulate(parity, config, simOptions).returns));
    const vsSpy = ols(coreReturns, window(simulateBuyHold(coreSystem, config, simOptions).returns));
    expect(vsParity.beta).toBeGreaterThan(0.1);
    expect(byId.core.stats.beta).toBeCloseTo(vsParity.beta, 3);
    expect(byId.core.stats.alpha).toBeCloseTo(vsParity.alpha, 3);
    expect(byId.core.stats.betaSpy).toBeCloseTo(vsSpy.beta, 3);
    expect(byId.core.stats.alphaSpy).toBeCloseTo(vsSpy.alpha, 3);

    const { tests } = report;
    expect(tests.sharpeDifferences.map((d) => d.b)).toEqual([
      "risk_parity_buy_hold",
      "spy_buy_hold",
      "equal_weight_buy_hold",
    ]);
    for (const d of tests.sharpeDifferences) {
      expect(d.a).toBe("core");
      expect(d.interval).not.toBeNull();
      expect(d.p).not.toBeNull();
    }
    expect(tests.families.map((f) => f.family)).toEqual(ruleFamilies);
    const statuses: FamilyAdmission[] = ["adds", "neutral", "detracts"];
    for (const f of tests.families) expect(statuses).toContain(f.status);
    // The status follows the interval: see "family admission" below for each case.
    for (const f of tests.families)
      expect(f.status).toBe(
        f.interval![0] > 0 ? "adds" : f.interval![1] < 0 ? "detracts" : "neutral",
      );
    // 18 keys this run plus one older distinct key, plus the 4 legacy event studies.
    expect(tests.deflatedSharpe.trials).toBe(23);
    expect(tests.deflatedSharpe.probability).not.toBeNull();
    expect(tests.overfitting).toMatchObject({ splits: 252, variants: 9 });
    expect(tests.overfitting.probability).not.toBeNull();

    expect(report.rules.map((r) => r.id)).toEqual(ruleIds);
    expect(report.symbols.map((s) => s.symbol)).toEqual(["AAA", "AAB", "AAC", "BBA", "BBB", "LATE"]);
    expect(report.classes.map((c) => c.id)).toEqual(["a", "b"]);
    const classA = report.symbols
      .filter((s) => s.class === "a")
      .reduce((sum, s) => sum + s.contribution!, 0);
    expect(report.classes[0].contribution).toBeCloseTo(classA, 3);
    const total = report.symbols.reduce((sum, s) => sum + s.contribution!, 0);
    expect(total).toBeCloseTo(byId.core.curve.at(-1)! - 100, 1);
    expect(report.idm.last).toBeGreaterThan(1);
    expect(report.fdm.last).toBeCloseTo(1.2, 12);
    expect(report.universe).toMatchObject({ symbols: 7, eligibleAtStart: 5 });

    expect(report.dataQuality.failures).toEqual([{ symbol: "ZZZ", message: "HTTP 404" }]);
    expect(report.dataQuality.trimmed).toEqual([]);
    expect(report.dataQuality.jumps).toEqual([
      { symbol: "AAB", date: panel.dates[600], return: expect.any(Number) },
    ]);
    expect(report.dataQuality.jumps[0].return).toBeGreaterThan(40);
    expect(report.dataQuality.shortHistory).toEqual(["LATE"]);
    const codes = report.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["short_window", "data_failures", "price_jumps"]));
    expect(sectorReport.warnings.map((w) => w.code)).not.toContain("data_failures");
  });
});

describe("family admission and report warnings", () => {
  const symbols = ["AAA", "AAB", "AAC", "BBA", "BBB"];
  // Every symbol swings ±15% on a 40-session cycle, so seeing three sessions ahead pays.
  const wave = (s: string, t: number) =>
    100 * (1 + 0.15 * Math.sin((2 * Math.PI * t) / 40 + symbols.indexOf(s)));
  const panel = testPanel({ symbols, sessions: 700, close: wave });
  const book = testBook(defaultClasses);
  // Core holds everything at forecast 10. Dropping trend leaves a forecast that
  // knows the next three sessions backwards (core beats it: trend "adds");
  // dropping mean reversion leaves one that knows them (it beats core:
  // "detracts"); the other two variants equal core exactly ("neutral").
  const computeSystem: ComputeSystem = (p, b, c, options) => {
    const dropped = droppedFamily(options);
    const edge = dropped === "trend" ? -20 : dropped === "mean_reversion" ? 20 : 0;
    return systemFromPanel(
      p,
      b,
      c,
      {
        forecast: (i, t) =>
          edge ? edge * Math.sign(wave(b.symbols[i], t + 3) - wave(b.symbols[i], t)) : 10,
        // Off-scale ewmac8; mr5 gated half the time at |f| = 10 (in scale with
        // the gate open); mr20 gated with |f| = 16 when open (off scale).
        ruleForecast: (rule, _, t) =>
          rule === "ewmac8"
            ? 5
            : rule === "mr5"
              ? (t % 2) * 10
              : rule === "mr20"
                ? (t % 2) * -16
                : 10,
      },
      options,
    );
  };

  it("adds, detracts or is neutral by the paired interval, and warns", async () => {
    const { books } = await runBacktest({
      panel,
      books: [book],
      config,
      computeSystem,
      priorTrials: [],
      failures: [],
    });
    const [report] = books;
    expect(report.window.sessions).toBe(380);
    const families = Object.fromEntries(report.tests.families.map((f) => [f.family, f]));
    expect(families.trend.status).toBe("adds");
    expect(families.trend.interval![0]).toBeGreaterThan(0);
    expect(families.mean_reversion.status).toBe("detracts");
    expect(families.mean_reversion.interval![1]).toBeLessThan(0);
    for (const family of ["sector_trend", "relative_momentum"] as const)
      expect(families[family]).toEqual({
        family,
        difference: 0,
        interval: [0, 0],
        status: "neutral",
      });

    const warnings = Object.fromEntries(report.warnings.map((w) => [w.code, w.detail]));
    expect(warnings.family_detracts).toBe("mean_reversion");
    // Locale-neutral details: ids and 1-dp numbers, no English words.
    expect(warnings.forecast_scale).toBe("ewmac8 5.0, mr20 16.0");
    expect(warnings.short_window).toBe("380");
    // The report still shows mr5's realised scale, gate-closed zeros included,
    // next to the gate-open scale that the warning (and the 7–13 check) uses.
    const rule = (id: string) => report.rules.find((r) => r.id === id)!;
    expect(rule("mr5").meanAbsForecast).toBeCloseTo(5, 1);
    expect(rule("mr5").gateOpenMeanAbsForecast).toBe(10);
    expect(rule("mr20").gateOpenMeanAbsForecast).toBe(16);
    expect(rule("ewmac8").gateOpenMeanAbsForecast).toBeNull();
    expect(rule("ewmac8").meanAbsForecast).toBe(5);
  });

  it("reports trimmed history apart from load failures, with locale-neutral details", async () => {
    // AAA gaps up 50% on twelve sessions (and eases back ten sessions later).
    const jumpy = testPanel({ symbols, sessions: 700, close: wave });
    const aaa = jumpy.index.AAA;
    for (let k = 0; k < 12; k++)
      for (let t = 400 + 20 * k; t < 410 + 20 * k; t++) jumpy.close[aaa][t] *= 1.5;
    // AAB's history before session 100 was dropped at a 1394.7197% print.
    jumpy.close[jumpy.index.AAB].fill(Number.NaN, 0, 100);
    jumpy.trimmed = {
      AAB: { date: jumpy.dates[100], return: 1394.7197 },
      QQQ: { date: jumpy.dates[50], return: -83.7503 },
    };
    const withMissing = testBook([...defaultClasses, { id: "z", rows: [["ZZZ"]] }]);
    // Costs far over budget: 3% a trade on a forecast that flips every session.
    const costly = testConfig();
    for (const tier of costly.costs.tiers) tier.bps = 300;
    const flipping: ComputeSystem = (p, b, c, options) =>
      systemFromPanel(p, b, c, { forecast: (i, t) => (t % 2 ? 20 : -20) }, options);
    const { books } = await runBacktest({
      panel: jumpy,
      books: [withMissing],
      config: costly,
      computeSystem: flipping,
      priorTrials: [],
      failures: [],
    });
    const [report] = books;

    // AAB loaded and is traded: it is trimmed, not a failure; QQQ is not in the book.
    expect(report.dataQuality.failures).toEqual([{ symbol: "ZZZ", message: "No bars" }]);
    expect(report.dataQuality.trimmed).toEqual([
      { symbol: "AAB", date: jumpy.dates[100], return: 1394.7197 },
    ]);
    expect(report.symbols.find((s) => s.symbol === "AAB")!.trades).toBeGreaterThan(0);
    expect(report.dataQuality.jumps).toHaveLength(12);

    const warnings = Object.fromEntries(report.warnings.map((w) => [w.code, w.detail]));
    expect(warnings.data_failures).toBe("ZZZ");
    expect(warnings.history_trimmed).toBe(`AAB ${jumpy.dates[100]} +1394.7%`);
    // The ten largest jumps to 1 dp, then how many more.
    const jumps = warnings.price_jumps.split(", ");
    expect(jumps).toHaveLength(11);
    for (const jump of jumps.slice(0, 10))
      expect(jump).toMatch(/^AAA \d{4}-\d{2}-\d{2} \+\d+\.\d%$/);
    expect(jumps[10]).toBe("… +2");
    const sizes = jumps.slice(0, 10).map((j) => Number(j.split(" ")[2].slice(0, -1)));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    const core = report.runs.find((r) => r.id === "core")!.stats;
    expect(core.costSharpe!).toBeGreaterThan(core.sharpe! / 3);
    expect(warnings.cost_budget).toBe(`${core.costSharpe!.toFixed(2)}/${core.sharpe!.toFixed(2)}`);
    expect(warnings.short_window).toBe("380");
    for (const { detail } of report.warnings)
      expect(detail).not.toMatch(/total|gate|session|cost|Sharpe|SR|History|dropped|\d\.\d{2,}%/);
  });

  it("reports no intervals and no admission on a window shorter than two blocks", async () => {
    const short = testPanel({ symbols, sessions: 400, close: wave });
    const { books } = await runBacktest({
      panel: short,
      books: [book],
      config,
      computeSystem,
      priorTrials: [],
      failures: [],
    });
    const [report] = books;
    expect(report.window.sessions).toBe(80);
    for (const d of report.tests.sharpeDifferences) {
      expect(d.interval).toBeNull();
      expect(d.difference).not.toBeNull();
    }
    for (const f of report.tests.families) {
      expect(f.interval).toBeNull();
      expect(f.status).toBe("insufficient");
    }
  });
});
