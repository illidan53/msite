import { describe, expect, it } from "vitest";
import type { PriceBar } from "../../shared/types";
import { QUANT_MODELS_VERSION } from "../../shared/research";
import {
  bollinger,
  calculateQuantModels,
  modelSpecs,
  rsi,
  ruleExit,
  runPullbackStudy,
  sma,
  summarizeExits,
} from "./pullback";

function series(closes: number[]): PriceBar[] {
  return closes.map((close, i) => ({
    timestamp: new Date(Date.UTC(2020, 0, i + 1, 21)).toISOString(),
    open: close,
    close,
    high: close + 0.2,
    low: close - 0.2,
    volume: 100,
  }));
}
const date = (bars: PriceBar[], i: number) => bars[i].timestamp.slice(0, 10);
const spec = (id: string) => modelSpecs.find((s) => s.id === id)!;
const study = (bars: PriceBar[], id: string, parameter?: number) => {
  const s = spec(id);
  return runPullbackStudy(
    bars,
    s.build(bars, parameter ?? s.parameter),
    s.primaryHorizon,
  );
};
const model = (bars: PriceBar[], id: string) =>
  calculateQuantModels(bars).models.find((m) => m.id === id)!;

/** Steady uptrend with a one-day drop at `drop` that pushes RSI(2) far below 10. */
function rsiDip(n = 260, drop = 230) {
  const closes = Array.from({ length: n }, (_, i) => 100 + 0.1 * i);
  closes[drop] = closes[drop] - 3;
  closes[drop + 1] = closes[drop] + 0.1;
  closes[drop + 2] = 125;
  for (let i = drop + 3; i < n; i++) closes[i] = 125 + 0.1 * (i - drop - 2);
  const bars = series(closes);
  bars[drop + 1] = { ...bars[drop + 1], open: 119 };
  return bars;
}

describe("indicator primitives", () => {
  it("computes simple averages, population-SD Bollinger bands and Wilder RSI without future input", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    const bands = bollinger([1, 2, 3, 4], 4, 2);
    expect(bands.mid.at(-1)).toBe(2.5);
    expect(bands.upper.at(-1)).toBeCloseTo(2.5 + 2 * Math.sqrt(1.25), 12);
    expect(bands.lower.at(-1)).toBeCloseTo(2.5 - 2 * Math.sqrt(1.25), 12);
    expect(bands.lower.slice(0, 3)).toEqual([null, null, null]);
    const r = rsi([10, 11, 10, 12], 2);
    expect(r.slice(0, 2)).toEqual([null, null]);
    expect(r[2]).toBe(50);
    expect(r[3]).toBeCloseTo(100 - 100 / (1 + 1.25 / 0.25), 12);
    expect(rsi([5, 5, 5], 2)[2]).toBe(50);
    expect(rsi([1, 2, 3], 2)[2]).toBe(100);
    expect(rsi([1, 2, 3, 0.5], 2).slice(0, 3)).toEqual(rsi([1, 2, 3], 2));
  });
});

describe("RSI(2) oversold pullback", () => {
  it("fires in an uptrend, enters next open and exits on the first close above SMA5", () => {
    const bars = rsiDip();
    const result = study(bars, "rsi2");
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.date).toBe(date(bars, 230));
    expect(event.trigger).toBeLessThan(10);
    expect(event.entryPrice).toBe(119);
    expect(event.entryDate).toBe(date(bars, 231));
    expect(event.returns["5"]).toBeCloseTo((bars[235].close / 119 - 1) * 100);
    expect(event.exit).toMatchObject({
      date: date(bars, 232),
      sessions: 2,
      reason: "reverted",
    });
    expect(event.exit!.return).toBeCloseTo((125 / 119 - 1) * 100, 5);
    // Background: uptrend days that were not already oversold and did not trigger.
    expect(result.groups.get(229)).toBe(0);
    for (let i = 231; i <= 235; i++) expect(result.groups.has(i)).toBe(false);
  });
  it("ignores oversold readings below SMA200", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 200 - 0.1 * i);
    closes[230] -= 3;
    expect(study(series(closes), "rsi2").events).toHaveLength(0);
  });
  it("keeps a prolonged oversold decline in one episode until a close above SMA5 re-arms it", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + 0.3 * i);
    // Day 230 drops hard, then 231-241 grind lower; every close stays below SMA5.
    for (let i = 230; i < 242; i++) closes[i] = 164.7 - (i - 230) * 1.5;
    // A brief RSI(2) uptick without reclaiming SMA5, then another oversold drop.
    closes[242] = closes[241] + 0.5;
    closes[243] = closes[242] - 3;
    // A slow recovery closes above SMA5, then a fresh drop after the cooldown.
    for (let i = 244; i < 300; i++) closes[i] = closes[243] + 0.3 * (i - 243);
    closes[270] -= 4;
    const bars = series(closes);
    const result = study(bars, "rsi2");
    const r2 = rsi(closes, 2);
    expect(r2[242]).toBeGreaterThanOrEqual(10);
    expect(r2[243]).toBeLessThan(10);
    expect(closes[243]).toBeGreaterThan(sma(closes, 200)[243]!);
    expect(result.events.map((e) => e.date)).toEqual([
      date(bars, 230),
      date(bars, 270),
    ]);
  });
  it("cannot change a matured event when later prices change", () => {
    const original = rsiDip(300);
    const before = study(original.slice(0, 255), "rsi2").events[0];
    const changed = original.map((b, i) =>
      i >= 255 ? { ...b, open: 999, close: 999, high: 1000, low: 998 } : b,
    );
    expect(study(changed, "rsi2").events[0]).toEqual(before);
  });
  it("leaves unfinished windows and rule exits missing instead of counting them", () => {
    const bars = rsiDip(236);
    const event = study(bars, "rsi2").events[0];
    expect(event.returns["5"]).not.toBeNull();
    expect(event.returns["10"]).toBeNull();
    // The close above SMA5 already happened, but the 20-session window is not complete.
    expect(event.exit).toBeNull();
    expect(model(bars, "rsi2").exit.count).toBe(0);
  });
});

describe("SMA50 pullback", () => {
  const trend = (n = 300) => Array.from({ length: n }, (_, i) => 100 + 0.3 * i);
  it("uses the prior SMA50 ±2% zone, keeps undercuts and exits on recovery of the pre-pullback high", () => {
    const closes = trend();
    closes[240] = 150;
    closes[241] = 169;
    const bars = series(closes);
    const reference = sma(closes, 50)[239]!;
    bars[240] = { ...bars[240], low: 149 };
    const result = study(bars, "sma50");
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.date).toBe(date(bars, 240));
    expect(event.trigger).toBeCloseTo((149 / reference - 1) * 100, 5);
    expect(event.trigger).toBeLessThan(0);
    expect(event.exit?.date).toBe(date(bars, 242));
    expect(event.exit?.reason).toBe("reverted");
    expect(event.exit?.sessions).toBe(2);
  });
  it("requires an approach from above in an SMA50 > SMA200 regime", () => {
    const falling = Array.from({ length: 300 }, (_, i) => 200 - 0.3 * i);
    expect(study(series(falling), "sma50").events).toHaveLength(0);
    const flat = Array(300).fill(100);
    expect(study(series(flat), "sma50").groups.size).toBe(0);
  });
  it("reports wider bands as separate samples", () => {
    const closes = trend();
    const bars = series(closes);
    const reference = sma(closes, 50)[239]!;
    bars[240] = { ...bars[240], low: reference * 1.025 };
    expect(
      [1, 2, 3].map((band) => study(bars, "sma50", band).events.length),
    ).toEqual([0, 0, 1]);
    const result = model(bars, "sma50");
    expect(result.sensitivity.map((s) => s.parameter)).toEqual([1, 2, 3]);
    expect(result.sensitivity[1].horizon).toEqual(
      result.horizons.find((h) => h.sessions === 10),
    );
  });
});

describe("Bollinger lower-band reversion", () => {
  it("fires on a close below the lower band and exits when the close regains the middle band", () => {
    const closes = Array.from(
      { length: 300 },
      (_, i) => 100 + 0.3 * i + (i % 2 ? 0.5 : -0.5),
    );
    closes[240] -= 10;
    const bars = series(closes);
    const bands = bollinger(closes, 20, 2);
    const result = study(bars, "bollinger");
    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe(date(bars, 240));
    expect(result.events[0].trigger).toBeCloseTo(
      (closes[240] / bands.lower[240]! - 1) * 100,
      5,
    );
    expect(result.events[0].exit).toMatchObject({
      date: date(bars, 241),
      sessions: 1,
      reason: "reverted",
    });
    expect(study(bars, "bollinger", 2.5).events.length).toBeLessThanOrEqual(1);
  });
});

describe("rule exits and evidence", () => {
  it("closes at session 20 when the reversion level is never reached", () => {
    const bars = series(Array.from({ length: 30 }, (_, i) => 100 - i));
    expect(ruleExit(bars, 0, () => false)).toEqual({
      date: date(bars, 20),
      sessions: 20,
      return: (80 / 99 - 1) * 100,
      reason: "time",
    });
    expect(ruleExit(bars, 9, () => false)?.sessions).toBe(20);
    expect(ruleExit(bars, 10, () => true)).toBeNull();
    bars[1] = { ...bars[1], open: 0 };
    expect(ruleExit(bars, 0, () => true)).toBeNull();
    expect(
      summarizeExits([
        { exit: { date: "a", sessions: 2, return: 4, reason: "reverted" } },
        { exit: { date: "b", sessions: 20, return: -6, reason: "time" } },
        { exit: null },
      ] as never),
    ).toEqual({
      count: 2,
      revertedRate: 50,
      meanReturn: -1,
      winRate: 50,
      medianSessions: 11,
      worstReturn: -6,
    });
  });
  it("distinguishes positive and negative evidence when enough mature events exist", () => {
    const make = (entryMultiplier: number) => {
      const closes = Array.from({ length: 1600 }, (_, i) => 100 + 0.2 * i);
      for (let i = 300; i < 1580; i += 40) closes[i] -= 3;
      const bars = series(closes);
      for (let i = 300; i < 1580; i += 40)
        bars[i + 1] = {
          ...bars[i + 1],
          open: bars[i + 1].close * entryMultiplier,
        };
      return model(bars, "rsi2");
    };
    const positive = make(0.9),
      negative = make(1.1);
    const primary = positive.horizons.find((h) => h.sessions === 5)!;
    expect(primary.events).toBeGreaterThanOrEqual(12);
    expect(primary.controls).toBeGreaterThanOrEqual(252);
    expect(positive.status).toBe("positive");
    expect(positive.confidenceInterval![0]).toBeGreaterThan(0);
    expect(negative.status).toBe("negative");
    expect(negative.confidenceInterval![1]).toBeLessThan(0);
  });
  it("aligns chart series, marks the current signal and handles short histories", () => {
    const closes = Array.from({ length: 400 }, (_, i) => 100 + 0.1 * i);
    closes[399] -= 3;
    const set = calculateQuantModels(series(closes), "reconstructed");
    expect(set.version).toBe(QUANT_MODELS_VERSION);
    expect(set.basis).toBe("reconstructed");
    expect(set.chart.dates).toHaveLength(252);
    expect(set.chart.dates.at(-1)).toBe(set.asOf);
    for (const m of set.models) {
      for (const values of Object.values(m.chart.lines))
        expect(values).toHaveLength(252);
      expect(m.chart.events.every((i) => i >= 0 && i < 252)).toBe(true);
    }
    const r2 = set.models.find((m) => m.id === "rsi2")!;
    expect(r2.current.signal).toBe(true);
    expect(r2.current.regime).toBe(true);
    expect(r2.current.sessionsSince).toBe(0);
    expect(r2.current.readings.rsi2).toBeLessThan(10);
    expect(r2.chart.oscillator?.threshold).toBe(10);
    expect(r2.chart.events.at(-1)).toBe(251);
    const short = calculateQuantModels(series([100, 101, 102]));
    for (const m of short.models) {
      expect(m.events).toHaveLength(0);
      expect(m.status).toBe("insufficient");
      expect(m.current.regime).toBeNull();
    }
    expect(calculateQuantModels([]).models[0].current.readings).toEqual({});
  });
});
