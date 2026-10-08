import { describe, expect, it } from "vitest";
import { expectSeries, goldenCloses, lcg } from "./engineTestUtils";
import { ewmStd, spanAlpha } from "./math";
import { blendedVol, normalisedReturns, robustVol, volAttenuation } from "./vol";

const _ = NaN;
const at = (series: ArrayLike<number>, indices: number[]) => indices.map((i) => series[i]);
// Golden values: pandas 3.0.6 on the same 300-bar series (see engineTestUtils.goldenCloses).
const idx = [0, 1, 9, 10, 11, 31, 63, 64, 100, 150, 199, 250, 299];

describe("blended volatility (AFTS Strategy 3)", () => {
  const closes = goldenCloses();
  const vol = blendedVol(closes);
  it("reproduces the golden close series bit-for-bit", () => {
    expectSeries(at(closes, idx), [
      100, 98.8612080572173, 100.8016693904518, 101.96124265246037, 100.85961561256173,
      110.35976548900109, 128.1202214272181, 127.13185657413138, 150.9042498914605,
      148.25016942547543, 106.41699935883852, 123.88636282631143, 127.5277948481579,
    ]);
  });
  it("matches pandas: 0.3·rolling(2560).mean(σ) + 0.7·σ, σ = 16·ewm(span 32, min 10).std(r)", () => {
    expectSeries(at(vol.blended, idx), [
      _, _, _, 0.14380312986087485, 0.15224885213987316, 0.14524855507440146,
      0.1257342599893374, 0.13074475211012238, 0.1314292057635382, 0.13880801779868185,
      0.1374015445569476, 0.13721086783314146, 0.12644302923312148,
    ]);
  });
  it("counts valid σ values for eligibility", () => {
    expect([vol.valid[9], vol.valid[10], vol.valid[265], vol.valid[299]]).toEqual([
      0, 1, 256, 290,
    ]);
  });
  it("floors the blend at 5%", () => {
    const flat = Float64Array.from({ length: 40 }, (_, k) => 100 * (1 + (k % 2) * 1e-5));
    expect(blendedVol(flat).blended[39]).toBe(0.05);
  });
});

describe("normalised returns", () => {
  it("divides by the previous session's daily vol (pandas golden)", () => {
    const vol = blendedVol(goldenCloses());
    expectSeries(at(normalisedReturns(vol.returns, vol.blended), idx), [
      _, _, _, _, -1.2021291038454847, -0.2880426629831313, 1.2901729152897956,
      -0.981671008381969, -0.08432459027858408, -1.7575537732107023, 1.334349494277931,
      -0.3401997445252998, -0.3571356962853444,
    ]);
  });
  it("caps |z| at 6", () => {
    const z = normalisedReturns([_, 0.01, 0.5, -0.5], [0.16, 0.16, 0.16, 0.16]);
    expectSeries(z, [_, 1, 6, -6]);
  });
});

describe("robust vol of index changes", () => {
  it("matches pandas robust_vol_calc well past the 500-session floor window", () => {
    // Shrinking regimes, so the floor binds before and after the window fills (pandas golden).
    const uniform = lcg(99);
    const scale = (t: number) => (t < 200 ? 1 : t < 600 ? 0.2 : 0.02);
    const changes = [_, ...Array.from({ length: 899 }, (_, t) => scale(t) * (uniform() - 0.5))];
    const vol = robustVol(changes);
    const points = [9, 10, 108, 109, 150, 300, 499, 500, 600, 610, 620, 640, 700, 899];
    expectSeries(at(vol, points), [
      _, 0.25462787973678763, 0.27185887365546957, 0.27912737918220604, 0.297043027437436,
      0.064284944688784, 0.04767629884311715, 0.048514072747663645, 0.05701101987910344,
      0.046789750265416694, 0.04577804195460696, 0.03738225039470776, 0.008780255006160451,
      0.005643696345395329,
    ], 14);
    const raw = ewmStd(changes, spanAlpha(35), 10);
    for (const t of [300, 610, 620, 640, 700]) expect(vol[t]).toBeGreaterThan(raw[t]);
    expect(vol[899]).toBe(raw[899]);
  });
  it("forward-fills and never divides by zero on a constant index", () => {
    const vol = robustVol([_, ...Array(200).fill(0)]);
    expect(vol[200]).toBe(1e-10);
  });
});

describe("vol attenuation (AFTS Strategy 13)", () => {
  const ramp = (from: number, to: number) =>
    Float64Array.from({ length: 600 }, (_, k) => (k < 10 ? NaN : from + ((to - from) * k) / 599));
  it("is exactly 1 until 256 normalised-vol values exist", () => {
    const m = volAttenuation(ramp(0.2, 0.6));
    expect([...m.slice(0, 265)].every((v) => v === 1)).toBe(true);
    expect(m[265]).not.toBe(1);
  });
  it("scales down in a rising-vol regime and up in a falling one, within [0.5, 2]", () => {
    const rising = volAttenuation(ramp(0.2, 0.6));
    const falling = volAttenuation(ramp(0.6, 0.2));
    expect(rising[599]).toBeGreaterThanOrEqual(0.5);
    expect(rising[599]).toBeLessThan(0.6);
    expect(falling[599]).toBeGreaterThan(1.9);
    expect(falling[599]).toBeLessThanOrEqual(2);
  });
});
