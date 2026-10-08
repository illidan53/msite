import { describe, expect, it } from "vitest";
import { ruleById } from "../../shared/strategyRules";
import { expectSeries, gaussian, goldenCloses } from "./engineTestUtils";
import { clip } from "./math";
import {
  accelRaw,
  breakoutRaw,
  classIndex,
  ewmacRaw,
  ewmEquilibrium,
  indexTrendRaw,
  mrRaw,
  pooledScalar,
  relmomRaw,
  smaEquilibrium,
} from "./rules";
import { blendedVol } from "./vol";

const _ = NaN;
const at = (series: ArrayLike<number>, indices: number[]) => indices.map((i) => series[i]);
const idx = [0, 1, 9, 10, 11, 31, 63, 64, 100, 150, 199, 250, 299];
const priceVol = (close: Float64Array) => {
  const { blended } = blendedVol(close);
  return close.map((c, k) => (c * blended[k]) / 16);
};
const scaled = (raw: Float64Array, scalar: number) => raw.map((v) => clip(scalar * v, 20));

describe("golden forecasts on the 300-bar series (pandas 3.0.6)", () => {
  const close = goldenCloses();
  const sigmaPrice = priceVol(close);
  it("ewmac16: clip(4.10·(ewm16 − ewm64)/σ_p, ±20)", () => {
    expectSeries(at(scaled(ewmacRaw(close, sigmaPrice, 16), 4.1), idx), [
      _, _, _, 1.2067323728712571, 1.232719069551956, 11.307474702187438, 20, 20, 20,
      4.922852036914356, -20, 11.495862958163478, 8.527445011637996,
    ]);
  });
  it("breakout40: clip(0.70·ewm10(40·(C − mid)/(H − L)), ±20)", () => {
    expectSeries(at(scaled(breakoutRaw(close, 40), 0.7), idx), [
      _, -14.000000000000172, 6.389261136257087, 7.987943754721265, 7.729011289039024,
      12.765992964629575, 13.868308550925862, 13.630340919346734, 13.495810336110681,
      -11.307468347521594, -13.7417210752886, 12.130201218316747, 3.620286807284751,
    ]);
  });
  it("mr5 before the gate: (ewm(com=5)(C) − C)/σ_p", () => {
    const raw = ewmEquilibrium(close, 5).map((e, k) => (e - close[k]) / sigmaPrice[k]);
    expectSeries(at(raw, idx), [
      _, _, _, -1.9564795084825473, -0.5850737056245966, -0.9853809756541199,
      -4.413572379975913, -2.7716959558657313, -2.2004377504925294, 2.3817026728610853,
      1.4748992514693107, -0.49871256415421816, 0.07052564648808267,
    ]);
  });
  it("breakout matches the T3 hand vector (N = 4, no smoothing)", () => {
    const raw = breakoutRaw([100, 102, 101, 104, 103, 99], 1);
    expect(raw[0]).toBeNaN();
    const unsmoothed = [100, 102, 101, 104, 103, 99].map((_, k, p) => {
      const window = p.slice(Math.max(0, k - 3), k + 1);
      const h = Math.max(...window), l = Math.min(...window);
      return h === l ? NaN : (40 * (p[k] - (h + l) / 2)) / (h - l);
    });
    expectSeries(unsmoothed, [_, 20, 0, 20, 6.666666666666667, -20]);
  });
});

/** Smooth exponential trend with mild noise. */
function trend(drift: number | ((k: number) => number), length = 400, seed = 7) {
  const draw = gaussian(seed);
  const close = new Float64Array(length);
  close[0] = 100;
  for (let k = 1; k < length; k++)
    close[k] =
      close[k - 1] * Math.exp((typeof drift === "number" ? drift : drift(k)) + 0.004 * draw());
  return close;
}

describe("rule signs on synthetic trends", () => {
  const up = trend(0.003);
  const down = trend(-0.003);
  it("ewmac and breakout are long an uptrend and short a downtrend", () => {
    for (const fast of [8, 16, 32, 64]) {
      expect(ewmacRaw(up, priceVol(up), fast)[399]).toBeGreaterThan(0);
      expect(ewmacRaw(down, priceVol(down), fast)[399]).toBeLessThan(0);
    }
    for (const horizon of [40, 80, 160, 320]) {
      expect(breakoutRaw(up, horizon)[399]).toBeGreaterThan(5);
      expect(breakoutRaw(down, horizon)[399]).toBeLessThan(-5);
    }
  });
  it("accel is positive when a trend speeds up and negative when it fades", () => {
    const faster = trend((k) => (k < 250 ? 0 : 0.004));
    const fading = trend((k) => (k < 250 ? 0.004 : 0));
    const accel = (close: Float64Array) =>
      accelRaw(ewmacRaw(close, priceVol(close), 32).map((v) => v * 2.79), 32)[320];
    expect(accel(faster)).toBeGreaterThan(0);
    expect(accel(fading)).toBeLessThan(0);
  });
  it("mr20 wants to buy a dip only while the trend is up", () => {
    const close = trend(0.003);
    close[399] = close[398] * 0.9;
    const raw = mrRaw(close, smaEquilibrium(close, 20), priceVol(close), ewmacRaw(close, priceVol(close), 16));
    expect(raw[399]).toBeGreaterThan(0);
  });
});

describe("Strategy 27 trend gate", () => {
  const close = [100, 100, 100, 100];
  const equilibrium = [101, 99, 101, 99];
  const sigmaPrice = [1, 1, 1, 1];
  it("keeps reversion that agrees with EWMAC16 and zeroes counter-trend reversion", () => {
    // Below equilibrium (buy) in an uptrend, above (sell) in a downtrend: kept.
    expectSeries(mrRaw(close, equilibrium, sigmaPrice, [2, -2, -2, 2]), [1, -1, 0, 0]);
  });
  it("is NaN while the trend gate is undefined", () => {
    expectSeries(mrRaw(close, equilibrium, sigmaPrice, [_, 1, _, -1]), [_, 0, _, -1]);
  });
});

describe("class index (Strategy 18)", () => {
  it("takes the daily median over members with a z (T4 vector, 3-member class)", () => {
    const { median, index } = classIndex([[1, 2, -3], [_, 0, 1], [-0.5, -1, 0.5]], 3);
    expectSeries(median, [0.25, 0, 0.5]);
    expectSeries(index, [0.25, 0.25, 0.75]);
  });
  it("needs 5 members with a z once the class has 5, but only 1 while it has fewer", () => {
    // Members 0–2 trade from day 0; members 3–5 list on day 2; member 5 misses day 4.
    const z = [
      [1, 1, 1, 1, 1, 1],
      [2, 2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3, _],
      [_, _, 4, 4, _, 4],
      [_, _, 5, 5, _, _],
      [_, _, 6, _, _, _],
    ];
    const { median, index } = classIndex(z, 6);
    // Day 0–1: 3 members so far → median of all; day 2: all 6; day 3: 5 of 6;
    // day 4: 3 of 6 → NaN; day 5: 3 of 6 → NaN (gaps count as 0 in the index).
    expectSeries(median, [2, 2, 3.5, 3, _, _]);
    expectSeries(index, [2, 4, 7.5, 10.5, 10.5, 10.5]);
  });
  it("is NaN before the first median and a single member gives that member's z", () => {
    const { index } = classIndex([[_, _, 0.5, -0.2]], 4);
    expectSeries(index, [_, _, 0.5, 0.3]);
  });
  it("trend on the index: EWMAC over the robust vol of its changes", () => {
    const index = Float64Array.from({ length: 400 }, (_, t) => 0.05 * t);
    const raw = indexTrendRaw(index, new Float64Array(400).fill(1), 16);
    // Steady state of EWMA16 − EWMA64 on a line of slope c is c·(64 − 16)/2.
    expect(raw[399]).toBeCloseTo(0.05 * 24, 3);
  });
});

describe("relative momentum (Strategy 19)", () => {
  it("reproduces the T4 constant-outperformance vector", () => {
    const n = 200;
    const own = Float64Array.from({ length: n }, (_, t) => 0.1 * t);
    const index = new Float64Array(n);
    for (const [horizon, expected] of [
      [40, 11.7779],
      [80, 15.9878],
    ] as const) {
      const raw = relmomRaw(own, index, horizon);
      // O_0 = 0 is dropped, so the first momentum value is at H + 1.
      expect(raw[horizon]).toBeNaN();
      const f = ruleById[`relmom${horizon}`].scalar! * raw[n - 1];
      expect(f).toBeCloseTo(expected, 2);
    }
  });
  it("is antisymmetric in a two-member class", () => {
    const a = Float64Array.from({ length: 120 }, (_, t) => Math.sin(t / 9) + 0.02 * t);
    const b = Float64Array.from({ length: 120 }, (_, t) => Math.cos(t / 7) - 0.01 * t);
    const { index } = classIndex([diffs(a), diffs(b)], 120);
    const ra = relmomRaw(cumulative(diffs(a)), index, 40);
    const rb = relmomRaw(cumulative(diffs(b)), index, 40);
    expect(ra[119]).toBeCloseTo(-rb[119], 12);
    expect(ra[119]).not.toBe(0);
  });
});

const diffs = (x: Float64Array) => x.map((v, t) => (t ? v - x[t - 1] : NaN));
const cumulative = (z: Float64Array) => {
  let sum = 0;
  return z.map((v) => (v === v ? (sum += v) : NaN));
};

describe("pooled forecast scalar", () => {
  it("is 10 over the expanding mean of daily median |raw|, dropping zeros, no backfill", () => {
    const raws = [
      [2, 0, _, 4],
      [-4, 1, _, 0],
      [_, 3, _, -2],
    ];
    // Daily medians: 3, 2, (none), 3 → running means 3, 2.5, 2.5, 2.667.
    expectSeries(pooledScalar(raws, 4, 1), [10 / 3, 4, 4, 10 / (8 / 3)]);
    expectSeries(pooledScalar(raws, 4, 3), [_, _, _, 10 / (8 / 3)]);
  });
});
