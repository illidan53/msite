import { describe, expect, it } from "vitest";
import {
  benchmarkIds,
  ruleFamilies,
  variantIds,
  type FamilyAdmission,
} from "../../shared/strategy";
import { ruleIds } from "../../shared/strategyRules";
import { evaluationStart, runBacktest, trialKey, type ComputeSystem } from "./backtest";
import { configHash } from "./config";
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

    const start = evaluationStart(computeSystem(panel, stocks, config), config);
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
    expect(byId.risk_parity_buy_hold.stats.beta).toBeCloseTo(1, 4);
    expect(byId.risk_parity_buy_hold.stats.alpha).toBeCloseTo(0, 4);
    expect(byId.spy_buy_hold.stats.betaSpy).toBeCloseTo(1, 4);

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
