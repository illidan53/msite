import type { BacktestTests, PerformanceStats } from "../../shared/strategy";

/**
 * Performance statistics and significance tests for backtest reports.
 * Inputs are daily returns as fractions; outputs follow shared/strategy.ts
 * units (percent). Annualisation is Carver's: mean × 256, std × 16.
 */

const DAYS = 256;
const ROOT_DAYS = 16;
const EULER_GAMMA = 0.5772156649015329;

/**
 * Standard normal CDF: Hart (1968) double-precision rational approximation
 * as given by West (2005), absolute error below 1e-14 on the whole line.
 */
export function normCdf(x: number) {
  if (Number.isNaN(x)) return Number.NaN;
  const z = Math.abs(x);
  let tail = 0;
  if (z < 37) {
    const e = Math.exp(-(z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      tail = (e * n) / d;
    } else {
      let b = z + 0.65;
      b = z + 4 / b;
      b = z + 3 / b;
      b = z + 2 / b;
      b = z + 1 / b;
      tail = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - tail : tail;
}

const acklamA = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
];
const acklamB = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
];
const acklamC = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
];
const acklamD = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416,
];

/**
 * Inverse standard normal CDF: Acklam's rational approximation (relative
 * error 1.15e-9) refined by one Halley step against normCdf. The upper half
 * is computed by symmetry so tail precision does not depend on 1 − Φ.
 */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return Number.NaN;
  }
  if (p > 0.5) return -normInv(1 - p);
  let x: number;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((acklamC[0] * q + acklamC[1]) * q + acklamC[2]) * q + acklamC[3]) * q +
        acklamC[4]) *
        q +
        acklamC[5]) /
      ((((acklamD[0] * q + acklamD[1]) * q + acklamD[2]) * q + acklamD[3]) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((acklamA[0] * r + acklamA[1]) * r + acklamA[2]) * r + acklamA[3]) * r +
        acklamA[4]) *
        r +
        acklamA[5]) *
        q) /
      (((((acklamB[0] * r + acklamB[1]) * r + acklamB[2]) * r + acklamB[3]) * r +
        acklamB[4]) *
        r +
        1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Φ⁻¹(0.01) / Φ⁻¹(0.30): the Gaussian reference for Carver's tail ratios (≈ 4.4362). */
export const NORMAL_TAIL_RATIO = normInv(0.01) / normInv(0.3);

const finiteValues = (values: ArrayLike<number>) => {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++)
    if (Number.isFinite(values[i])) out.push(values[i]);
  return out;
};
const meanOf = (values: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return values.length ? sum / values.length : Number.NaN;
};
/** Sample standard deviation (ddof = 1). */
const stdOf = (values: ArrayLike<number>) => {
  if (values.length < 2) return Number.NaN;
  const m = meanOf(values);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (values[i] - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
};
/** Type-7 (linear interpolation) quantile of ascending values. */
export function quantileSorted(sorted: ArrayLike<number>, p: number) {
  if (!sorted.length) return Number.NaN;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
const nullable = (value: number) => (Number.isFinite(value) ? value : null);

/** Daily Sharpe ratio (mean ÷ sample std); NaN when undefined. */
export function dailySharpe(returns: ArrayLike<number>) {
  const sd = stdOf(returns);
  return sd > 0 ? meanOf(returns) / sd : Number.NaN;
}

/** Biased sample skewness g1 and raw kurtosis m4/m2² (3 for a normal). */
export function moments(values: ArrayLike<number>) {
  const m = meanOf(values);
  let m2 = 0,
    m3 = 0,
    m4 = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  const n = values.length;
  m2 /= n;
  m3 /= n;
  m4 /= n;
  return {
    skew: m2 > 0 ? m3 / m2 ** 1.5 : Number.NaN,
    kurtosis: m2 > 0 ? m4 / (m2 * m2) : Number.NaN,
  };
}

/** pandas Series.skew(): bias-corrected G1 = g1·√(n(n−1))/(n−2). */
export function sampleSkew(values: ArrayLike<number>) {
  const n = values.length;
  if (n < 3) return Number.NaN;
  return (moments(values).skew * Math.sqrt(n * (n - 1))) / (n - 2);
}

/** Pearson correlation over pairs where both values are finite. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>) {
  let n = 0,
    sa = 0,
    sb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++)
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      n++;
      sa += a[i];
      sb += b[i];
    }
  if (n < 2) return Number.NaN;
  const ma = sa / n,
    mb = sb / n;
  let cov = 0,
    va = 0,
    vb = 0;
  for (let i = 0; i < length; i++)
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      cov += (a[i] - ma) * (b[i] - mb);
      va += (a[i] - ma) ** 2;
      vb += (b[i] - mb) ** 2;
    }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : Number.NaN;
}

/** Daily OLS y = α + βx; alpha is per day (same units as the inputs). */
export function regression(y: ArrayLike<number>, x: ArrayLike<number>) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { alpha: Number.NaN, beta: Number.NaN, correlation: Number.NaN };
  const mx = meanOf(Array.from({ length: n }, (_, i) => x[i]));
  const my = meanOf(Array.from({ length: n }, (_, i) => y[i]));
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const beta = sxx > 0 ? sxy / sxx : Number.NaN;
  return {
    alpha: my - beta * mx,
    beta,
    correlation: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN,
  };
}

export interface StatsInput {
  /** Session dates aligned with `returns`. */
  dates: string[];
  /** Daily returns as fractions of the previous close's equity. */
  returns: ArrayLike<number>;
  /** Costs paid each session as a fraction of the previous close's equity. */
  cost?: ArrayLike<number>;
  /** Traded value each session as a fraction of the previous close's equity. */
  traded?: ArrayLike<number>;
  /** Σ|position value| ÷ equity at each close. */
  gross?: ArrayLike<number>;
  /** Risk overlay multiplier per session (< 1 when it scaled positions down). */
  multiplier?: ArrayLike<number>;
  /** Benchmark daily returns for the regressions, aligned with `returns`. */
  riskParity?: ArrayLike<number>;
  spy?: ArrayLike<number>;
}

/** Drawdowns on the compounded index with the high-water mark starting at 100. */
export function drawdowns(returns: ArrayLike<number>) {
  let level = 100,
    peak = 100,
    max = 0,
    sum = 0;
  for (let i = 0; i < returns.length; i++) {
    level *= 1 + returns[i];
    peak = Math.max(peak, level);
    const dd = ((peak - level) / peak) * 100;
    max = Math.max(max, dd);
    sum += dd;
  }
  return {
    level,
    max: returns.length ? max : Number.NaN,
    average: returns.length ? sum / returns.length : Number.NaN,
  };
}

/** Carver's demeaned quantile tail ratios on non-zero days; 1 means a Gaussian tail. */
export function tailRatios(returns: ArrayLike<number>) {
  const values = finiteValues(returns).filter((v) => v !== 0);
  if (values.length < 2) return { lower: Number.NaN, upper: Number.NaN };
  const m = meanOf(values);
  const sorted = values.map((v) => v - m).sort((a, b) => a - b);
  const q = (p: number) => quantileSorted(sorted, p);
  const q30 = q(0.3),
    q70 = q(0.7);
  return {
    lower: q30 !== 0 ? q(0.01) / q30 / NORMAL_TAIL_RATIO : Number.NaN,
    upper: q70 !== 0 ? q(0.99) / q70 / NORMAL_TAIL_RATIO : Number.NaN,
  };
}

/** Pandas-G1 skew of returns summed by calendar month. */
export function monthlySkew(dates: string[], returns: ArrayLike<number>) {
  const months: number[] = [];
  let key = "";
  for (let i = 0; i < returns.length; i++) {
    const month = dates[i].slice(0, 7);
    if (month !== key) {
      months.push(0);
      key = month;
    }
    months[months.length - 1] += returns[i];
  }
  return sampleSkew(months);
}

/** Calendar-year compounded returns in percent. */
export function yearlyReturns(dates: string[], returns: ArrayLike<number>) {
  const years: { year: number; return: number | null }[] = [];
  let growth = 1;
  for (let i = 0; i < returns.length; i++) {
    const year = Number(dates[i].slice(0, 4));
    if (years.at(-1)?.year !== year) {
      if (years.length) years[years.length - 1].return = (growth - 1) * 100;
      years.push({ year, return: null });
      growth = 1;
    }
    growth *= 1 + returns[i];
  }
  if (years.length) years[years.length - 1].return = (growth - 1) * 100;
  return years;
}

export function performanceStats(input: StatsInput): PerformanceStats {
  const { dates } = input;
  const returns = Array.from(input.returns);
  const n = returns.length;
  const mean = meanOf(returns);
  const sd = stdOf(returns);
  const annualReturn = mean * DAYS * 100;
  const annualVol = sd * ROOT_DAYS * 100;
  const srDaily = sd > 0 ? mean / sd : Number.NaN;
  const losses = returns.filter((r) => r < 0);
  const downside = stdOf(losses) * ROOT_DAYS * 100;
  const dd = drawdowns(returns);
  const years =
    n && dates.length
      ? (Date.parse(`${dates[n - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) /
        (365.25 * 864e5)
      : 0;
  const cagr = years > 0 && dd.level > 0 ? ((dd.level / 100) ** (1 / years) - 1) * 100 : Number.NaN;
  const tails = tailRatios(returns);
  const gains = returns.filter((r) => r > 0).length;
  const averageGross = input.gross ? meanOf(input.gross) : Number.NaN;
  const annualCost = input.cost ? meanOf(input.cost) * DAYS * 100 : Number.NaN;
  const regress = (benchmark: ArrayLike<number> | undefined) =>
    benchmark ? regression(returns, benchmark) : null;
  const vsRiskParity = regress(input.riskParity);
  const vsSpy = regress(input.spy);
  let binding = Number.NaN;
  if (input.multiplier?.length) {
    let count = 0;
    for (let i = 0; i < input.multiplier.length; i++)
      if (input.multiplier[i] < 1 - 1e-12) count++;
    binding = (count / input.multiplier.length) * 100;
  }
  return {
    start: dates[0] ?? "",
    end: dates[n - 1] ?? dates.at(-1) ?? "",
    sessions: n,
    totalReturn: nullable(n ? dd.level - 100 : Number.NaN),
    cagr: nullable(cagr),
    annualReturn: nullable(annualReturn),
    annualVol: nullable(annualVol),
    sharpe: nullable(srDaily * ROOT_DAYS),
    sharpeError: nullable(Math.sqrt((1 + srDaily ** 2 / 2) / n) * ROOT_DAYS),
    sortino: nullable(downside > 0 ? annualReturn / downside : Number.NaN),
    maxDrawdown: nullable(dd.max),
    averageDrawdown: nullable(dd.average),
    calmar: nullable(dd.max > 0 ? cagr / dd.max : Number.NaN),
    monthlySkew: nullable(monthlySkew(dates, returns)),
    lowerTail: nullable(tails.lower),
    upperTail: nullable(tails.upper),
    hitRate: nullable(
      gains + losses.length ? (gains / (gains + losses.length)) * 100 : Number.NaN,
    ),
    turnover: nullable(
      input.traded && averageGross > 0 ? (meanOf(input.traded) * DAYS) / averageGross : Number.NaN,
    ),
    annualCost: nullable(annualCost),
    costSharpe: nullable(annualVol > 0 ? annualCost / annualVol : Number.NaN),
    averageGross: nullable(averageGross * 100),
    overlayBinding: nullable(binding),
    alpha: nullable(vsRiskParity ? vsRiskParity.alpha * DAYS * 100 : Number.NaN),
    beta: nullable(vsRiskParity?.beta ?? Number.NaN),
    correlation: nullable(vsRiskParity?.correlation ?? Number.NaN),
    alphaSpy: nullable(vsSpy ? vsSpy.alpha * DAYS * 100 : Number.NaN),
    betaSpy: nullable(vsSpy?.beta ?? Number.NaN),
  };
}

/** The LCG used by the site's other block bootstraps (server/research/ema200.ts). */
export function seededRandom(seed = 0x2002026) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Paired block bootstrap of the annual Sharpe difference a − b:
 * both series are resampled with the same 42-session blocks, so their daily
 * dependence survives. Returns the 95% interval, or null when fewer than 95%
 * of the resamples produce a defined difference.
 */
export function pairedSharpeInterval(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  { block = 42, samples = 1000, seed = 0x2002026 } = {},
): [number, number] | null {
  const n = Math.min(a.length, b.length);
  const length = Math.min(block, n);
  if (n < 2 || !length) return null;
  const random = seededRandom(seed);
  const effects: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    let sa = 0,
      saa = 0,
      sb = 0,
      sbb = 0,
      used = 0;
    while (used < n) {
      const start = Math.floor(random() * (n - length + 1));
      for (let j = 0; j < length && used < n; j++, used++) {
        const x = a[start + j],
          y = b[start + j];
        sa += x;
        saa += x * x;
        sb += y;
        sbb += y * y;
      }
    }
    const va = (saa - (sa * sa) / n) / (n - 1);
    const vb = (sbb - (sb * sb) / n) / (n - 1);
    if (va > 0 && vb > 0)
      effects.push((sa / n / Math.sqrt(va) - sb / n / Math.sqrt(vb)) * ROOT_DAYS);
  }
  if (effects.length < samples * 0.95) return null;
  effects.sort((x, y) => x - y);
  return [quantileSorted(effects, 0.025), quantileSorted(effects, 0.975)];
}

/**
 * Annual Sharpe difference a − b with its paired bootstrap interval and the
 * Jobson–Korkie test with Memmel's correction on daily Sharpe ratios.
 */
export function sharpeDifference(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = Math.min(a.length, b.length);
  const x = Array.from({ length: n }, (_, i) => a[i]);
  const y = Array.from({ length: n }, (_, i) => b[i]);
  const sa = dailySharpe(x),
    sb = dailySharpe(y);
  const rho = correlation(x, y);
  const variance =
    2 * (1 - rho) + 0.5 * (sa * sa + sb * sb - 2 * sa * sb * rho * rho);
  const z = variance > 1e-12 ? (sa - sb) / Math.sqrt(variance / n) : Number.NaN;
  return {
    difference: nullable((sa - sb) * ROOT_DAYS),
    interval: pairedSharpeInterval(x, y),
    z: nullable(z),
    p: nullable(Number.isFinite(z) ? 2 * normCdf(-Math.abs(z)) : Number.NaN),
  };
}

/**
 * Expected maximum Sharpe ratio of N independent trials under the null
 * (Bailey & López de Prado 2014): √V·((1−γ)Φ⁻¹(1−1/N) + γΦ⁻¹(1−1/(Ne))).
 */
export function expectedMaxSharpe(variance: number, trials: number) {
  if (!(trials > 1) || !(variance >= 0)) return Number.NaN;
  return (
    Math.sqrt(variance) *
    ((1 - EULER_GAMMA) * normInv(1 - 1 / trials) +
      EULER_GAMMA * normInv(1 - 1 / (trials * Math.E)))
  );
}

/** Φ((SR − SR0)·√(T−1) ÷ √(1 − γ3·SR + (γ4−1)/4·SR²)) with per-period SRs and raw kurtosis. */
export function deflatedSharpeProbability(
  sharpe: number,
  benchmark: number,
  observations: number,
  skew: number,
  kurtosis: number,
) {
  const denominator = 1 - skew * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe;
  if (!(denominator > 0) || observations < 2) return Number.NaN;
  return normCdf(((sharpe - benchmark) * Math.sqrt(observations - 1)) / Math.sqrt(denominator));
}

/**
 * Deflated Sharpe ratio of `returns` given the variants tried in this run
 * (for ρ̄ and V[SR]) and the total number of logged trials N. The benchmark
 * Sharpe is reported annualised; it is floored at 0 because the extreme-value
 * approximation turns negative when N̂ is close to 1.
 */
export function deflatedSharpe(input: {
  returns: ArrayLike<number>;
  variants: ArrayLike<number>[];
  trials: number;
}): BacktestTests["deflatedSharpe"] {
  const sharpes = input.variants.map(dailySharpe).filter(Number.isFinite);
  const correlations: number[] = [];
  for (let i = 0; i < input.variants.length; i++)
    for (let j = i + 1; j < input.variants.length; j++) {
      const c = correlation(input.variants[i], input.variants[j]);
      if (Number.isFinite(c)) correlations.push(c);
    }
  const rho = correlations.length ? meanOf(correlations) : Number.NaN;
  const effective = Number.isFinite(rho) ? rho + (1 - rho) * input.trials : Number.NaN;
  const variance = sharpes.length > 1 ? stdOf(sharpes) ** 2 : Number.NaN;
  const raw = expectedMaxSharpe(variance, effective);
  const benchmark = Number.isFinite(raw)
    ? Math.max(0, raw)
    : Number.isFinite(variance) && effective <= 1
      ? 0
      : Number.NaN;
  const returns = Array.from(input.returns);
  const { skew, kurtosis } = moments(returns);
  return {
    probability: nullable(
      deflatedSharpeProbability(dailySharpe(returns), benchmark, returns.length, skew, kurtosis),
    ),
    trials: input.trials,
    effectiveTrials: nullable(effective),
    benchmarkSharpe: nullable(benchmark * ROOT_DAYS),
  };
}

function* combinations(n: number, k: number): Generator<number[]> {
  const pick = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield [...pick];
    let i = k - 1;
    while (i >= 0 && pick[i] === n - k + i) i--;
    if (i < 0) return;
    pick[i]++;
    for (let j = i + 1; j < k; j++) pick[j] = pick[j - 1] + 1;
  }
}

/**
 * Probability of backtest overfitting by combinatorially symmetric cross
 * validation (Bailey, Borwein, López de Prado & Zhu): S contiguous blocks,
 * every half as in-sample; ω = OOS rank of the IS-best variant ÷ (N+1)
 * (average ranks for ties); PBO = share of splits with logit ω ≤ 0.
 */
export function probabilityOfOverfitting(
  columns: ArrayLike<number>[],
  blocks = 10,
): BacktestTests["overfitting"] {
  const variants = columns.length;
  const length = Math.min(...columns.map((c) => c.length));
  if (variants < 2 || blocks < 2 || blocks % 2 || length < blocks * 2)
    return { probability: null, splits: 0, variants };
  // Per block and variant: count, Σx, Σx².
  const sums = Array.from({ length: blocks }, (_, k) => {
    const from = Math.floor((k * length) / blocks);
    const to = Math.floor(((k + 1) * length) / blocks);
    return columns.map((column) => {
      let s = 0,
        ss = 0;
      for (let t = from; t < to; t++) {
        s += column[t];
        ss += column[t] * column[t];
      }
      return { n: to - from, s, ss };
    });
  });
  const sharpeOf = (chosen: boolean[], variant: number) => {
    let n = 0,
      s = 0,
      ss = 0;
    for (let k = 0; k < blocks; k++)
      if (chosen[k]) {
        n += sums[k][variant].n;
        s += sums[k][variant].s;
        ss += sums[k][variant].ss;
      }
    const variance = (ss - (s * s) / n) / (n - 1);
    return variance > 0 ? s / n / Math.sqrt(variance) : 0;
  };
  let splits = 0,
    overfit = 0;
  for (const inSample of combinations(blocks, blocks / 2)) {
    const isChosen = Array.from({ length: blocks }, (_, k) => inSample.includes(k));
    const oosChosen = isChosen.map((v) => !v);
    let best = 0,
      bestSharpe = -Infinity;
    for (let v = 0; v < variants; v++) {
      const sr = sharpeOf(isChosen, v);
      if (sr > bestSharpe) {
        bestSharpe = sr;
        best = v;
      }
    }
    const oos = Array.from({ length: variants }, (_, v) => sharpeOf(oosChosen, v));
    const below = oos.filter((sr) => sr < oos[best]).length;
    const tied = oos.filter((sr) => sr === oos[best]).length;
    const omega = (below + (tied + 1) / 2) / (variants + 1);
    if (Math.log(omega / (1 - omega)) <= 0) overfit++;
    splits++;
  }
  return { probability: overfit / splits, splits, variants };
}
