import { describe, expect, it } from "vitest";
import { calculateResearch } from "../../../server/research/quant";
import {
  metricAssessment,
  researchGuideIds,
  researchMetricGuide,
} from "./metricGuides";
import type { ResearchMetric } from "../../../shared/research";

describe("research metric education", () => {
  it("covers every computed metric and the stock / ETF fundamentals in both languages", () => {
    const quant = calculateResearch([], []).metrics.map((m) => m.id);
    const fundamentals =
      "marketCap price_to_earnings price_to_sales ev_to_ebitda debt_to_equity current fcfYield return_on_equity return_on_assets dividend_yield revenue grossMargin operatingMargin revenueGrowth epsGrowth expense aum premium tracking concentration".split(
        " ",
      );
    expect([...quant, ...fundamentals].sort()).toEqual(
      [...researchGuideIds].sort(),
    );
    for (const id of researchGuideIds) {
      const metric: ResearchMetric = {
        id,
        en: id,
        zh: id,
        value: null,
        unit: "number",
        group: "risk",
        note: "Original method",
      };
      for (const locale of ["en", "zh"] as const) {
        const guide = researchMetricGuide(metric, locale);
        for (const field of [
          "meaning",
          "formula",
          "example",
          "caveat",
          "reading",
        ] as const)
          expect(guide[field]!.length).toBeGreaterThan(10);
        expect(guide.caveat).toContain(metric.note);
      }
    }
  });
  it.each([
    ["rsi", 30, "caution"],
    ["rsi", 30.01, "neutral"],
    ["rsi", 69.99, "neutral"],
    ["rsi", 70, "caution"],
    ["vol20", 29.99, "neutral"],
    ["vol60", 30, "caution"],
    ["vol252", 49.99, "caution"],
    ["vol252", 50, "negative"],
    ["drawdown", -9.99, "neutral"],
    ["maxDrawdown", -10, "caution"],
    ["drawdown", -20, "negative"],
    ["highDistance", 0, "neutral"],
    ["rvol", 2, "caution"],
    ["rvol", 0.5, "neutral"],
    ["bbPosition", 100, "neutral"],
    ["bbPosition", 100.01, "caution"],
    ["bbPosition", -1, "caution"],
    ["current", 0.99, "caution"],
    ["current", 1, "neutral"],
    ["beta", -1, "neutral"],
    ["beta", 1.01, "caution"],
    ["return252", -1, "negative"],
    ["return252", 0, "neutral"],
    ["return252", 1, "positive"],
    ["price_to_earnings", 100, "neutral"],
    ["price_to_earnings", 5, "neutral"],
    ["expense", 0.1, "neutral"],
    ["debt_to_equity", -2, "caution"],
  ])(
    "classifies %s at %s without treating every high value as good",
    (id, value, tone) => {
      const reading = metricAssessment({
        id: String(id),
        value: Number(value),
      });
      expect(reading.tone).toBe(tone);
      expect(reading.label.every((text) => text.length > 0)).toBe(true);
    },
  );
  it("keeps missing and nonfinite observations neutral for all metrics", () => {
    for (const id of researchGuideIds)
      for (const value of [null, NaN, Infinity, -Infinity]) {
        expect(metricAssessment({ id, value })).toEqual({
          tone: "neutral",
          label: ["No data", "暂无数据"],
        });
      }
  });
});
