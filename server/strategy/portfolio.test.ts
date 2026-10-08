import { describe, expect, it } from "vitest";
import {
  buildPortfolio,
  clipCorrelation,
  diversificationMultiplier,
  ewmaSeries,
  expandingQuantile,
  instrumentWeights,
  isMonthStart,
  normalisedReturns,
  quadraticForm,
  symmetricEigen,
  weekBlocks,
} from "./portfolio";
import { seededRandom } from "./stats";
import {
  defaultClasses,
  sliceSystem,
  testBook,
  testConfig,
  testPanel,
  systemFromPanel,
  testSystem,
} from "./testFrames";
import { overlayLimitCodes } from "./types";

const config = testConfig();

describe("calendar helpers", () => {
  it("groups sessions by ISO week and finds month starts", () => {
    const dates = ["2024-12-30", "2024-12-31", "2025-01-02", "2025-01-03", "2025-01-06"];
    expect(weekBlocks(dates)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 4 },
    ]);
    expect(dates.map((_, t) => isMonthStart(dates, t))).toEqual([true, false, true, false, false]);
  });
  it("smooths like pandas ewm(adjust=True) and carries through NaN", () => {
    const out = ewmaSeries([1, Number.NaN, 3, 4], 3);
    expect(Array.from(out)).toEqual([1, 1, 2.6, expect.closeTo(5.625 / 1.625, 12)]);
  });
  it("tracks an expanding type-7 quantile", () => {
    expect(Array.from(expandingQuantile([Number.NaN, 3, 1, Number.NaN, 2], 0.5))).toEqual([
      Number.NaN,
      3,
      2,
      2,
      2,
    ]);
    expect(expandingQuantile([3, 1], 0.99)[1]).toBeCloseTo(2.98, 12);
  });
});

describe("instrument weights (AFTS Strategy 4 handcrafting)", () => {
  it("splits top-down across classes, rows and symbols", () => {
    const system = testSystem({ sessions: 30 });
    const weights = instrumentWeights(system);
    // a: rows [AAA, AAB] and [AAC]; b: one row [BBA, BBB].
    expect(system.symbols).toEqual(["AAA", "AAB", "AAC", "BBA", "BBB"]);
    expect(weights.map((w) => w[5])).toEqual([0.125, 0.125, 0.25, 0.25, 0.25]);
  });
  it("renormalises over the symbols eligible that session", () => {
    const system = testSystem({
      sessions: 30,
      eligibleFrom: { AAC: 10, BBA: 20, BBB: 20 },
    });
    const at = (t: number) => instrumentWeights(system).map((w) => w[t]);
    expect(at(5)).toEqual([0.5, 0.5, 0, 0, 0]);
    expect(at(15)).toEqual([0.25, 0.25, 0.5, 0, 0]);
    expect(at(25)).toEqual([0.125, 0.125, 0.25, 0.25, 0.25]);
  });
});

describe("instrument diversification multiplier", () => {
  it("is 1/√(wᵀHw), capped", () => {
    const H = [1, 0.5, 0.5, 1];
    expect(diversificationMultiplier([0.5, 0.5], H, 2.5)).toBeCloseTo(1 / Math.sqrt(0.75), 12);
    expect(diversificationMultiplier([0.5, 0.5], [1, 0, 0, 1], 2.5)).toBeCloseTo(Math.SQRT2, 12);
    // Equal weights over 350 names at ρ = 0.3 (research note vector).
    const n = 350;
    const big = Float64Array.from({ length: n * n }, (_, k) =>
      Math.floor(k / n) === k % n ? 1 : 0.3,
    );
    expect(diversificationMultiplier(new Float64Array(n).fill(1 / n), big, 2.5)).toBeCloseTo(
      1.8197,
      4,
    );
    expect(diversificationMultiplier(new Float64Array(n).fill(1 / n), big, 1.5)).toBe(1.5);
    expect(diversificationMultiplier([0, 0], H, 2.5)).toBeNaN();
  });

  // Three one-symbol classes with σ = 16% so z equals the designed daily shock e.
  const shock = (symbol: string, t: number) => {
    const a = Math.sin(0.9 * t) + 0.5 * Math.sin(0.13 * t);
    if (symbol === "AAA") return a;
    if (symbol === "BBB") return 0.6 * a + 0.8 * Math.sin(1.7 * t + 1);
    return Math.cos(2.3 * t) + 0.3 * Math.sin(0.21 * t + 2);
  };
  const designed = (f: (symbol: string, t: number) => number, symbols: string[], sessions: number) => {
    const closes: Record<string, number[]> = {};
    for (const s of ["SPY", ...symbols]) {
      closes[s] = [100];
      for (let t = 1; t < sessions; t++) closes[s].push(closes[s][t - 1] * (1 + 0.01 * f(s, t)));
    }
    const book = testBook(symbols.map((s) => ({ id: s.toLowerCase(), rows: [[s]] })));
    const panel = testPanel({ symbols, sessions, close: (s, t) => closes[s][t] });
    return systemFromPanel(panel, book, config, { sigma: 0.16 });
  };

  it("matches pandas ewm(span=25).corr on weekly sums, refitted monthly and smoothed (span 125)", () => {
    const system = designed(shock, ["AAA", "BBB", "CCC"], 600);
    const z = normalisedReturns(system);
    expect(z[0][0]).toBeNaN();
    expect(z[1][7]).toBeCloseTo(shock("BBB", 7), 10);
    const { idm } = buildPortfolio(system, config);
    // Golden values from pandas 3.0 (scratchpad idm_golden.py).
    const golden: [number, number][] = [
      [100, 1],
      [150, 1.2073957397628774],
      [200, 1.2773990073052395],
      [300, 1.335598119958188],
      [450, 1.357103179962967],
      [599, 1.348352824322483],
    ];
    for (const [t, value] of golden) expect(idm[t]).toBeCloseTo(value, 10);
  });
  it("is 1 for identical symbols and close to √n for unrelated ones", () => {
    const same = designed((_, t) => Math.sin(0.7 * t), ["AAA", "BBB", "CCC", "DDD"], 500);
    expect(buildPortfolio(same, config).idm[499]).toBeCloseTo(1, 10);
    const symbols = ["AAA", "BBB", "CCC", "DDD"];
    const book = testBook(symbols.map((s) => ({ id: s.toLowerCase(), rows: [[s]] })));
    const panel = testPanel({ symbols, sessions: 2000, seed: 11 });
    const unrelated = systemFromPanel(panel, book, config, { sigma: 0.24 });
    const last = buildPortfolio(unrelated, config).idm[1999];
    expect(last).toBeGreaterThan(1.6);
    expect(last).toBeLessThanOrEqual(2);
  });
});

describe("correlation repair", () => {
  // Floored estimates mixed with the 0.99 fill, as the IDM fit produces them.
  const mixed = (n: number) => {
    const random = seededRandom(9);
    const H = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      H[i * n + i] = 1;
      for (let j = i + 1; j < n; j++)
        H[i * n + j] = H[j * n + i] = random() < 0.3 ? 0.99 : Math.max(0, random() - 0.4);
    }
    return H;
  };
  it("decomposes a symmetric matrix into orthonormal eigenvectors", () => {
    const n = 30;
    const H = mixed(n);
    const { values, vectors } = symmetricEigen(H, n);
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++) {
        let hv = 0,
          dot = 0;
        for (let j = 0; j < n; j++) {
          hv += H[i * n + j] * vectors[k * n + j];
          dot += vectors[i * n + j] * vectors[k * n + j];
        }
        expect(hv).toBeCloseTo(values[k] * vectors[k * n + i], 12);
        expect(dot).toBeCloseTo(i === k ? 1 : 0, 12);
      }
    expect(values.reduce((sum, v) => sum + v, 0)).toBeCloseTo(n, 10);
    expect(Math.min(...values)).toBeLessThan(-1);
  });
  it("keeps PSD matrices and clips indefinite ones to PSD with a unit diagonal", () => {
    const flat = Float64Array.from({ length: 25 }, (_, k) => (k % 6 === 0 ? 1 : 0.99));
    expect(clipCorrelation(flat, 5)).toEqual(flat);
    const n = 30;
    const clipped = clipCorrelation(mixed(n), n);
    expect(Math.min(...symmetricEigen(clipped, n).values)).toBeGreaterThan(-1e-12);
    for (let i = 0; i < n; i++) {
      expect(clipped[i * n + i]).toBe(1);
      for (let j = 0; j < n; j++) {
        expect(clipped[i * n + j]).toBe(clipped[j * n + i]);
        expect(Math.abs(clipped[i * n + j])).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });
});

describe("sizing and the risk overlay", () => {
  it("sizes a = IDM·w·τ/σ and x = a·F⁺/10 with the long-only floor", () => {
    const system = testSystem({
      sessions: 40,
      sigma: 0.4,
      forecast: (i) => [10, 20, -5, 15, 0][i],
    });
    const frame = buildPortfolio(system, config);
    const t = 20;
    expect(frame.idm[t]).toBe(1);
    const w = [0.125, 0.125, 0.25, 0.25, 0.25];
    const a = w.map((wi) => (wi * 0.2) / 0.4);
    expect(frame.averageWeight.map((s) => s[t])).toEqual(a.map((v) => expect.closeTo(v, 12)));
    expect(frame.forecast.map((s) => s[t])).toEqual([10, 20, 0, 15, 0]);
    expect(frame.targetWeight.map((s) => s[t])).toEqual(
      [10, 20, 0, 15, 0].map((f, i) => expect.closeTo((a[i] * f) / 10, 12)),
    );
    expect(frame.multiplier[t]).toBe(1);
    expect(overlayLimitCodes[frame.limit[t]]).toBeNull();

    const longShort = buildPortfolio(system, config, { longShort: true });
    expect(longShort.targetWeight[2][t]).toBeCloseTo((a[2] * -5) / 10, 12);
    const parity = buildPortfolio(system, config, { constantForecast: 10 });
    expect(parity.targetWeight.map((s) => s[t])).toEqual(a.map((v) => expect.closeTo(v, 12)));
    const filtered = buildPortfolio(
      testSystem({ sessions: 40, sigma: 0.4, trendFilter: (i) => (i % 2 ? 0 : 10) }),
      config,
      { trendFilter: true },
    );
    expect(filtered.forecast.map((s) => s[t])).toEqual([10, 0, 10, 0, 10]);
  });
  it("caps single names and scales everything down when gross exceeds 100%", () => {
    // σ = 5%: every name wants far more than the 25% cap; 5 × 25% = 125% gross.
    const frame = buildPortfolio(testSystem({ sessions: 40, sigma: 0.05 }), config);
    const t = 30;
    expect(frame.multiplier[t]).toBeCloseTo(0.8, 12);
    expect(overlayLimitCodes[frame.limit[t]]).toBe("gross");
    expect(frame.targetWeight.map((s) => s[t])).toEqual(Array(5).fill(expect.closeTo(0.2, 12)));
    expect(frame.gross[t]).toBeCloseTo(1, 12);
    expect(frame.averageWeight[2][t]).toBeCloseTo(((0.25 * 0.2) / 0.05) * 0.8, 12);
  });
  it("binds on normal risk √(xᵀDHDx) with the conservative 0.99 correlation before a fit", () => {
    const frame = buildPortfolio(testSystem({ sessions: 40, sigma: 0.8, forecast: () => 20 }), config);
    const t = 30;
    const x = [0.125, 0.125, 0.25, 0.25, 0.25].map((w) => ((w * 0.2) / 0.8) * 2);
    let risk = 0;
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) risk += x[i] * 0.8 * x[j] * 0.8 * (i === j ? 1 : 0.99);
    expect(overlayLimitCodes[frame.limit[t]]).toBe("normal_risk");
    expect(frame.multiplier[t]).toBeCloseTo((1.75 * 0.2) / Math.sqrt(risk), 12);
  });
  // Every pair at the pre-fit 0.99: risk = √(Σᵢⱼ xᵢsᵢ·xⱼsⱼ·Hᵢⱼ).
  const preFitRisk = (x: number[], s: number[]) => {
    let sum = 0;
    for (let i = 0; i < x.length; i++)
      for (let j = 0; j < x.length; j++) sum += x[i] * s[i] * x[j] * s[j] * (i === j ? 1 : 0.99);
    return Math.sqrt(sum);
  };
  const w = [0.125, 0.125, 0.25, 0.25, 0.25];
  it("binds on correlation shock Σ|x|σ when the other limits are loose", () => {
    // At 120% vol and forecast 50, Σ|x|σ = τ·5 = 1 > 4τ while gross is 5/6.
    const overlay = { gross: 10, normalRisk: 10, correlationShock: 4, jumpRisk: 10 };
    const loose = { ...config, engine: { ...config.engine, overlay } };
    const frame = buildPortfolio(
      testSystem({ sessions: 40, sigma: 1.2, forecast: () => 50, config: loose }),
      loose,
    );
    const t = 30;
    const x = w.map((wi) => ((wi * 0.2) / 1.2) * 5);
    const shock = x.reduce((sum, xi) => sum + xi * 1.2, 0);
    expect(shock).toBeCloseTo(1, 12);
    expect(overlayLimitCodes[frame.limit[t]]).toBe("correlation_shock");
    expect(frame.multiplier[t]).toBeCloseTo((4 * 0.2) / shock, 12);
    expect(frame.targetWeight.map((s) => s[t])).toEqual(x.map((v) => expect.closeTo(v * 0.8, 12)));
  });
  it("binds on jump risk with the expanding 99th-percentile σ after an early spike", () => {
    // σ was 150% for the first 20 sessions and is 20% now; forecast 8 keeps gross at 0.8.
    const frame = buildPortfolio(
      testSystem({ sessions: 40, sigma: (_, t) => (t < 20 ? 1.5 : 0.2), forecast: () => 8 }),
      config,
    );
    const t = 30;
    const x = w.map((wi) => ((wi * 0.2) / 0.2) * 0.8);
    const normal = preFitRisk(x, Array(5).fill(0.2));
    const jump = preFitRisk(x, Array(5).fill(1.5));
    expect(normal).toBeLessThan(1.75 * 0.2);
    expect(jump).toBeGreaterThan(4 * 0.2);
    expect(overlayLimitCodes[frame.limit[t]]).toBe("jump_risk");
    expect(frame.multiplier[t]).toBeCloseTo((4 * 0.2) / jump, 12);
    expect(frame.gross[t]).toBeCloseTo(0.8 * frame.multiplier[t], 12);
    // Once the spike is a small enough share of history, the quantile drops and nothing binds.
    const later = buildPortfolio(
      testSystem({ sessions: 3000, sigma: (_, t) => (t < 20 ? 1.5 : 0.2), forecast: () => 8 }),
      config,
    );
    expect(overlayLimitCodes[later.limit[2999]]).not.toBe("jump_risk");
  });
  it("measures signed risk on the PSD-repaired correlation", () => {
    // AAA and BBB move exactly opposite (ρ = −1, floored to 0); CCC lists at 450,
    // so its pairs are still unfitted (0.99) at 480. That H is indefinite.
    const symbols = ["AAA", "BBB", "CCC"];
    const book = testBook(symbols.map((s) => ({ id: s.toLowerCase(), rows: [[s]] })), {
      maxPositionWeight: 10,
    });
    const closes: Record<string, number[]> = {};
    for (const s of ["SPY", ...symbols]) {
      closes[s] = [100];
      for (let t = 1; t < 500; t++) {
        const a = Math.sin(0.9 * t) + 0.5 * Math.sin(0.13 * t);
        const e = s === "AAA" ? a : s === "BBB" ? -a : Math.cos(2.3 * t);
        closes[s].push(closes[s][t - 1] * (1 + 0.01 * e));
      }
    }
    const panel = testPanel({
      symbols,
      sessions: 500,
      close: (s, t) => closes[s][t],
      firstBar: { CCC: 450 },
    });
    // Only normal risk can bind: x ∝ (1.8, 0.2, −1.4) has xᵀHx < 0.
    const overlay = { gross: 10, normalRisk: 1.75, correlationShock: 10, jumpRisk: 10 };
    const loose = { ...config, engine: { ...config.engine, overlay } };
    const system = systemFromPanel(panel, book, loose, {
      sigma: 0.16,
      forecast: (i) => [90, 10, -70][i],
    });
    const frame = buildPortfolio(system, loose, { longShort: true });
    const t = 480;
    const x = [90, 10, -70].map(
      (f, i) => ((frame.idm[t] * frame.instrumentWeight[i][t] * 0.2) / 0.16) * (f / 10),
    );
    const H = [1, 0, 0.99, 0, 1, 0.99, 0.99, 0.99, 1];
    expect(quadraticForm(H, [0, 1, 2], x)).toBeLessThan(0);
    // Clipping by hand: H = v₁v₁ᵀ + (1 + 0.99√2)·v₊v₊ᵀ + (1 − 0.99√2)·v₋v₋ᵀ with
    // v₁ = (1, −1, 0)/√2 and v₊ = (½, ½, 1/√2); drop v₋, rescale to a unit diagonal.
    const lambda = 1 + 0.99 * Math.SQRT2;
    const d12 = 0.5 + lambda / 4,
      d3 = lambda / 2;
    const r12 = (-0.5 + lambda / 4) / d12;
    const r13 = lambda / 2 / Math.SQRT2 / Math.sqrt(d12 * d3);
    const clipped = [1, r12, r13, r12, 1, r13, r13, r13, 1];
    expect(Array.from(clipCorrelation(H, 3))).toEqual(clipped.map((v) => expect.closeTo(v, 12)));
    const risk = 0.16 * Math.sqrt(quadraticForm(clipped, [0, 1, 2], x));
    expect(risk).toBeGreaterThan(1.75 * 0.2);
    expect(overlayLimitCodes[frame.limit[t]]).toBe("normal_risk");
    expect(frame.multiplier[t]).toBeCloseTo((1.75 * 0.2) / risk, 10);
    // Long-only weights keep H itself (non-negative entries, so xᵀHx ≥ 0).
    const longOnly = buildPortfolio(system, loose);
    const longRisk = 0.16 * Math.sqrt(quadraticForm(H, [0, 1, 2], [x[0], x[1], 0]));
    expect(overlayLimitCodes[longOnly.limit[t]]).toBe("normal_risk");
    expect(longOnly.multiplier[t]).toBeCloseTo((1.75 * 0.2) / longRisk, 10);
  });
  it("is zero for ineligible symbols", () => {
    const frame = buildPortfolio(testSystem({ sessions: 40, eligibleFrom: { BBB: 30 } }), config);
    expect(frame.instrumentWeight[4][10]).toBe(0);
    expect(frame.targetWeight[4][10]).toBe(0);
    expect(frame.forecast[4][10]).toBeNaN();
    expect(frame.targetWeight[4][35]).toBeGreaterThan(0);
  });
});

describe("causality", () => {
  it("never changes a past value when sessions are appended", () => {
    const system = testSystem({
      sessions: 700,
      classes: [
        ...defaultClasses,
        { id: "c", rows: [["CCA", "CCB", "CCC"], ["CCD"]] },
      ],
      eligibleFrom: { AAA: 0, AAB: 60, AAC: 300, BBA: 0, BBB: 450, CCA: 0, CCB: 20, CCC: 0, CCD: 610 },
      gaps: { CCC: [100, 101, 102, 400], BBA: [250] },
      sigma: (i, t) => 0.15 + 0.05 * Math.sin(t / 40 + i),
      forecast: (i, t) => 15 * Math.sin(t / 25 + i * 1.3),
    });
    const full = buildPortfolio(system, config);
    for (const length of [333, 520, 650]) {
      const prefix = buildPortfolio(sliceSystem(system, length), config);
      const head = (a: ArrayLike<number>) => Array.from(a).slice(0, length);
      expect(Array.from(prefix.idm)).toEqual(head(full.idm));
      expect(Array.from(prefix.multiplier)).toEqual(head(full.multiplier));
      expect(Array.from(prefix.limit)).toEqual(head(full.limit));
      expect(Array.from(prefix.gross)).toEqual(head(full.gross));
      prefix.targetWeight.forEach((series, i) => {
        expect(Array.from(series)).toEqual(head(full.targetWeight[i]));
        expect(Array.from(prefix.averageWeight[i])).toEqual(head(full.averageWeight[i]));
      });
    }
    // The IDM must have been fitted inside the window for this to mean anything.
    expect(full.idm[650]).toBeGreaterThan(1.05);
  });
});
