import { describe, expect, it } from "vitest";
import { expectSeries, lcg } from "./engineTestUtils";
import {
  clip,
  comAlpha,
  cumsum,
  ewmMean,
  ewmStd,
  ffill,
  median,
  quantile,
  rollingMax,
  rollingMean,
  rollingMedian,
  rollingMin,
  rollingQuantile,
  spanAlpha,
} from "./math";

const _ = NaN;
const at = (series: ArrayLike<number>, indices: number[]) => indices.map((i) => series[i]);
// Golden values: pandas 3.0.6 on the same vector (NaN gaps, leading NaN).
const x = [_, 1, 2, _, _, 5, 3, _, 8, 1, 2, 7, _, 4];
/**
 * 300 draws with a NaN gap and isolated NaNs: half-point ticks (many ties, mirrored in pandas),
 * plain noise, or an up-drifting walk whose newest value is often the window's largest.
 */
const draws = (kind: "ticks" | "noise" | "walk") => {
  const uniform = lcg(2026);
  let level = 0;
  const values = Array.from({ length: 300 }, () => {
    const u = uniform();
    return kind === "ticks" ? Math.floor(u * 21) / 2 : kind === "noise" ? u : (level += u - 0.3);
  });
  for (const k of [40, 41, 42, 43, 44, 133, 250]) values[k] = NaN;
  return values;
};

describe("pandas-exact EWMA (adjust=True, ignore_na=False)", () => {
  it("matches ewm(span=3).mean() through NaN gaps", () => {
    expectSeries(ewmMean(x, spanAlpha(3)), [
      _, 1, 1.6666666666666667, 1.6666666666666667, 1.6666666666666667,
      4.473684210526316, 3.549019607843137, 3.549019607843137, 6.731843575418995,
      3.3586206896551722, 2.6240760295670538, 4.897513952308473, 4.897513952308473,
      4.29157738585792,
    ]);
  });
  it("matches ewm(com=5, min_periods=3).mean()", () => {
    expectSeries(ewmMean(x, comAlpha(5), 3), [
      _, _, _, _, _, 3.2216398352676894, 3.1400785575694474, 3.1400785575694474,
      4.823385229847156, 3.700821284775859, 3.2577009606073006, 4.149028162999562,
      4.149028162999562, 4.11096876480395,
    ]);
  });
  it("matches the T4 vectors and keeps decaying through NaN", () => {
    expectSeries(ewmMean([1, 2, 3], spanAlpha(3)), [1, 1.6666667, 2.4285714], 6);
    expectSeries(ewmMean([1, _, 3], spanAlpha(3)), [1, 1, 2.6], 12);
  });
  it("matches ewm(span=3).std() (bias-corrected) through NaN gaps", () => {
    expectSeries(ewmStd(x, spanAlpha(3)), [
      _, _, 0.7071067811865476, 0.7071067811865476, 0.7071067811865476,
      2.336664289109584, 1.4549987204790746, 1.4549987204790746, 3.1111025516870754,
      4.169980572372871, 2.832548462889545, 3.3394126328705602, 3.3394126328705602,
      2.2218718446231485,
    ]);
  });
  it("matches ewm(com=5, min_periods=3).std()", () => {
    expectSeries(ewmStd(x, comAlpha(5), 3), [
      _, _, _, _, _, 2.219577548056398, 1.6599008528359471, 1.6599008528359471,
      2.9571090708275145, 3.1191681350802694, 2.765771136482656, 2.9539386938660535,
      2.9539386938660535, 2.539719135268642,
    ]);
  });
  it("matches the T1 EW std vector (span 32, min_periods 10)", () => {
    const r = [0.01, -0.02, 0.015, 0, -0.01, 0.03, -0.025, 0.005, 0.01, -0.005, 0.02, -0.015];
    const s = ewmStd(r, spanAlpha(32), 10);
    expect(s.slice(0, 9).every(Number.isNaN)).toBe(true);
    expectSeries(s.slice(9), [0.01649194, 0.01671397, 0.01680867], 8);
    expect(ewmStd([0.01, 0.04], spanAlpha(32))[1]).toBeCloseTo(0.03 / Math.SQRT2, 12);
  });
  it("is exact on constant series", () => {
    expect([...ewmMean([5, 5, 5, 5], spanAlpha(10))]).toEqual([5, 5, 5, 5]);
    expectSeries(ewmStd([5, 5, 5], spanAlpha(10)), [_, 0, 0]);
  });
});

describe("pandas rolling windows", () => {
  it("matches rolling(5, min_periods=3).quantile(0.05 and 0.5), linear", () => {
    expectSeries(rollingQuantile(x, 5, 0.05, 3), [
      _, _, _, _, _, 1.1, 2.1, _, 3.2, 1.3, 1.15, 1.15, 1.15, 1.15,
    ]);
    expectSeries(rollingQuantile(x, 5, 0.5, 3), [
      _, _, _, _, _, 2, 3, _, 5, 4, 2.5, 4.5, 4.5, 3,
    ]);
  });
  it("matches rolling median, mean, max and min", () => {
    expectSeries(rollingMedian(x, 4, 1), [
      _, 1, 1.5, 1.5, 1.5, 3.5, 4, 4, 5, 3, 2, 4.5, 2, 4,
    ]);
    expectSeries(rollingMean(x, 3, 2), [
      _, _, 1.5, 1.5, _, _, 4, 4, 5.5, 4.5, 3.6666666666666665, 3.3333333333333335,
      4.5, 5.5,
    ]);
    expectSeries(rollingMax(x, 3, 1), [_, 1, 2, 2, 2, 5, 5, 5, 8, 8, 8, 7, 7, 7]);
    expectSeries(rollingMin(x, 3, 1), [_, 1, 1, 1, 2, 5, 3, 3, 3, 1, 1, 1, 2, 4]);
  });
  it("matches the T1 vol-floor vector (window 500, min 100, 5% quantile)", () => {
    const falling = Array.from({ length: 200 }, (_, i) => 0.3 - (0.2 * i) / 199);
    const floor = rollingQuantile(falling, 500, 0.05, 100);
    expect(floor.slice(0, 99).every(Number.isNaN)).toBe(true);
    expect(floor[99]).toBeCloseTo(0.20547738693467335, 12);
    expect(floor[150]).toBeCloseTo(0.15678391959798993, 12);
    expect(floor[199]).toBeCloseTo(0.11000000000000003, 12);
  });
  it("matches pandas once the window is full and older values must leave it", () => {
    expectSeries(rollingMedian([5, 4, 3, 2, 1, 9, 8, 7], 3), [_, _, 4, 3, 2, 2, 8, 8]);
    expectSeries(rollingQuantile([5, 4, 3, 2, 1, 9, 8, 7], 3, 0.25), [
      _, _, 3.5, 2.5, 1.5, 1.5, 4.5, 7.5,
    ]);
    const values = draws("ticks");
    const idx = [0, 13, 14, 19, 20, 21, 44, 45, 60, 99, 133, 150, 199, 250, 268, 299];
    expectSeries(at(rollingQuantile(values, 20, 0.05, 15), idx), [
      _, _, 0, 0, 0, 0, 0, 0, 0.375, 0.5, 0.95, 0.45, 0.5, 0.5, 0, 2.4250000000000003,
    ]);
    expectSeries(at(rollingQuantile(values, 20, 0.5, 15), idx), [
      _, _, 5, 4, 5.5, 6.25, 3, 3, 5.75, 5, 6.5, 4, 4, 5.5, 5.5, 4.75,
    ]);
    expectSeries(at(rollingMedian(values, 60, 50), [48, 49, 59, 60, 61, 100, 133, 180, 250, 299]), [
      _, _, 4, 5, 5.5, 5.25, 6, 5, 5, 5.5,
    ]);
  });
  it.each([
    ["ticks", 7, 1],
    ["ticks", 20, 15],
    ["noise", 20, 15],
    ["walk", 20, 15],
    ["walk", 60, 50],
  ] as const)("agrees with sorting every window (%s, window %i, min %i)", (kind, window, minp) => {
    const values = draws(kind);
    const medians = rollingMedian(values, window, minp);
    const lows = rollingQuantile(values, window, 0.05, minp);
    values.forEach((_, i) => {
      const slice = values.slice(Math.max(0, i - window + 1), i + 1);
      const enough = slice.filter(Number.isFinite).length >= minp;
      expect(medians[i], `median ${i}`).toBe(enough ? median(slice) : NaN);
      if (enough) expect(lows[i], `q05 ${i}`).toBeCloseTo(quantile(slice, 0.05), 12);
      else expect(lows[i]).toBeNaN();
    });
  });
  it("returns a repeated constant exactly", () => {
    expect([...rollingMean([3.3, 3.3, 3.3, 3.3], 2)]).toEqual([NaN, 3.3, 3.3, 3.3]);
  });
});

describe("helpers", () => {
  it("computes medians and type-7 quantiles over finite values", () => {
    expect(median([3, _, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([_])).toBeNaN();
    expect(quantile([1, 2, 3, 4, 5], 0.05)).toBeCloseTo(1.2, 12);
    expect(quantile([10, 0, _], 0.3)).toBeCloseTo(3, 12);
  });
  it("cumsums, forward-fills and clips like pandas", () => {
    expectSeries(cumsum([_, 1, _, 2]), [_, 1, _, 3]);
    expectSeries(ffill([_, 1, _, 2, _]), [_, 1, 1, 2, 2]);
    expect([clip(25, 20), clip(-25, 20), clip(3, 20)]).toEqual([20, -20, 3]);
  });
});
