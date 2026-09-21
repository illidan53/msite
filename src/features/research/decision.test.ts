import { describe, expect, it } from "vitest";
import type { ResearchReport } from "../../../shared/research";
import { decisionRules, scoreDecision } from "./decision";
const now = Date.parse("2026-09-21T12:00:00Z");
function report(values: Record<string, number | null> = {}): ResearchReport {
  const defaults = {
    distance200: 6,
    distance50: 6,
    return63: 20,
    excess: 12,
    macdHistogram: 1,
    rsi: 60,
    vol60: 20,
    drawdown: -5,
    dollarVolume: 20000000,
    ...values,
  };
  return {
    id: "test",
    symbol: "AAPL",
    benchmark: "SPY",
    locale: "en",
    module: "quant",
    createdAt: "2026-09-21",
    status: "partial",
    kind: "stock",
    sections: {
      quant: { status: "complete", asOf: "2026-09-18" },
      fundamentals: { status: "unavailable" },
      news: { status: "complete" },
      ai: { status: "unavailable" },
    },
    prices: [{ date: "2026-09-18", close: 100, drawdown: -5 }],
    metrics: Object.entries(defaults).map(([id, value]) => ({
      id,
      value,
      en: id,
      zh: id,
      unit: "number",
      group: "trend",
      note: "",
    })),
    news: [],
  };
}
describe("transparent long-only decision rules", () => {
  it("uses a fixed budget and a traceable strong buy grade", () => {
    const d = scoreDecision(report(), now);
    expect(decisionRules.reduce((s, r) => s + r.weight, 0)).toBe(100);
    expect(d.rawBuy).toBe(95);
    expect(d.sell).toBe(0);
    expect(d.net).toBe(95);
    expect(d.side).toBe("buy");
    expect(d.grade).toBe(3);
  });
  it("reduces buy support once for overlapping risks without creating sell votes", () => {
    const d = scoreDecision(
      report({ vol60: 55, drawdown: -35, dollarVolume: 500000 }),
      now,
    );
    expect(d.factor).toBe(0.5);
    expect(d.buy).toBe(47.5);
    expect(d.sell).toBe(0);
    expect(d.grade).toBe(2);
  });
  it("keeps oversold bearish and does not automatically sell an overbought reading", () => {
    const cold = scoreDecision(report({ rsi: 20 }), now);
    expect(cold.rows.find((r) => r.id === "rsi")?.score).toBe(-2);
    const hot = scoreDecision(report({ rsi: 85 }), now);
    expect(hot.rows.find((r) => r.id === "rsi")?.score).toBe(0);
    expect(hot.factor).toBe(0.5);
    expect(hot.sell).toBe(0);
  });
  it("overrides opposing evidence instead of presenting a misleading directional grade", () => {
    const d = scoreDecision(report({ distance200: -6 }), now);
    expect(d.rawBuy).toBe(70);
    expect(d.sell).toBe(25);
    expect(d.net).toBe(45);
    expect(d.side).toBe("conflict");
    expect(d.grade).toBe(0);
  });
  it("produces sell support for broadly negative trends without requiring short selling", () => {
    const d = scoreDecision(
      report({
        distance200: -6,
        distance50: -6,
        return63: -20,
        excess: -12,
        macdHistogram: -1,
        rsi: 35,
      }),
      now,
    );
    expect(d.side).toBe("sell");
    expect(d.sell).toBe(100);
    expect(d.grade).toBe(3);
  });
  it("does not redistribute missing weights or grade incomplete risk/core data", () => {
    const d = scoreDecision(report({ return63: null }), now);
    expect(d.coverage).toBe(80);
    expect(d.rawBuy).toBe(75);
    expect(d.ready).toBe(true);
    for (const id of [
      "distance200",
      "distance50",
      "vol60",
      "drawdown",
      "dollarVolume",
      "rsi",
    ]) {
      const x = scoreDecision(report({ [id]: null }), now);
      expect(x.ready, id).toBe(false);
      expect(x.side).toBe("unavailable");
    }
    expect(
      scoreDecision(report({ return63: null, excess: null }), now).ready,
    ).toBe(false);
  });
  it("blocks stale, future and unfinished snapshots and rejects nonfinite values", () => {
    for (const date of ["2026-09-01", "2026-10-01", "bad"]) {
      const r = report();
      r.sections.quant.asOf = date;
      expect(scoreDecision(r, now).ready).toBe(false);
    }
    const r = report();
    r.sections.quant.status = "running";
    expect(scoreDecision(r, now).ready).toBe(false);
    expect(scoreDecision(report({ rsi: Infinity }), now).ready).toBe(false);
  });
  it("normalizes MACD using a matching-date closing price only", () => {
    const r = report();
    expect(
      scoreDecision(r, now).rows.find((r) => r.id === "macdNormalized")?.value,
    ).toBe(1);
    r.prices[0].date = "2026-09-17";
    expect(
      scoreDecision(r, now).rows.find((r) => r.id === "macdNormalized")?.value,
    ).toBeNull();
  });
  it.each([
    [-5, -2],
    [-2, 0],
    [2, 0],
    [5, 2],
  ])("honors the exact trend boundary %s", (value, score) => {
    expect(decisionRules[0].score(value)).toBe(score);
  });
});
