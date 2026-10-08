import type { StrategyConfig } from "./config";
import type {
  PortfolioFrame,
  PortfolioOptions,
  Series,
  SystemFrame,
} from "./types";

/**
 * AFTS Strategies 4 and 7 plus the Part Six risk overlay: handcrafted
 * instrument weights over eligible symbols, the instrument diversification
 * multiplier from correlations of vol-normalised returns, volatility-targeted
 * position weights, and a proportional overlay that keeps gross exposure and
 * portfolio risk inside the configured limits. Every value at t uses data up
 * to t's close only.
 */

const IDM_SPAN_WEEKS = 25;
const IDM_MIN_WEEKS = 20;
const IDM_SMOOTHING = 125;
/** Correlation assumed for pairs without enough overlapping weeks (conservative). */
const MISSING_CORRELATION = 0.99;
const Z_CLIP = 6;
const JUMP_QUANTILE = 0.99;

/** Online pandas ewm(span).mean() with adjust=True, ignore_na=False: NaN inputs carry the mean. */
export function ewmaStep(span: number) {
  const decay = 1 - 2 / (span + 1);
  let num = 0,
    den = 0;
  return (value: number) => {
    num *= decay;
    den *= decay;
    if (Number.isFinite(value)) {
      num += value;
      den += 1;
    }
    return den > 0 ? num / den : Number.NaN;
  };
}

export function ewmaSeries(values: ArrayLike<number>, span: number): Series {
  const step = ewmaStep(span);
  return Float64Array.from(values, (value) => step(value));
}

/** Monday-based week number: sessions share it exactly when they share an ISO week. */
export function weekNumber(date: string) {
  return Math.floor((Date.parse(`${date}T00:00:00Z`) / 864e5 + 3) / 7);
}

/** The first session of each calendar month (monthly refits and rebalances). */
export function isMonthStart(dates: string[], t: number) {
  return t === 0 || dates[t].slice(0, 7) !== dates[t - 1].slice(0, 7);
}

/** Contiguous session blocks of each ISO week, as [start, end] indices. */
export function weekBlocks(dates: string[]) {
  const blocks: { start: number; end: number }[] = [];
  let week = Number.NaN;
  dates.forEach((date, t) => {
    const w = weekNumber(date);
    if (w === week) blocks[blocks.length - 1].end = t;
    else blocks.push({ start: t, end: t });
    week = w;
  });
  return blocks;
}

/**
 * Top-down handcrafted weights (AFTS Strategy 4): equal across classes with
 * an eligible symbol, then across that class's rows with an eligible symbol,
 * then across the row's eligible symbols. Zero when ineligible (or, defensively,
 * without a positive σ to size with).
 */
export function instrumentWeights(system: SystemFrame): Series[] {
  const T = system.dates.length;
  const position = new Map(system.symbols.map((s, i) => [s, i]));
  const classes = system.book.classes.map((c) =>
    c.rows.map((r) =>
      r.symbols.flatMap((s) => (position.has(s) ? [position.get(s)!] : [])),
    ),
  );
  const out = system.symbols.map(() => new Float64Array(T));
  for (let t = 0; t < T; t++) {
    const live = classes
      .map((rows) =>
        rows
          .map((row) =>
            row.filter((i) => system.eligible[i][t] === 1 && system.sigma[i][t] > 0),
          )
          .filter((row) => row.length),
      )
      .filter((rows) => rows.length);
    for (const rows of live)
      for (const row of rows)
        for (const i of row) out[i][t] = 1 / live.length / rows.length / row.length;
  }
  return out;
}

/**
 * Vol-normalised returns z_t = r_t ÷ (σ_{t−1}/16), clipped to ±6, on each
 * symbol's own sessions (σ lagged one own session, as in pysystemtrade).
 */
export function normalisedReturns(system: SystemFrame): Series[] {
  const T = system.dates.length;
  return system.panelIndex.map((row, i) => {
    const close = system.panel.close[row];
    const sigma = system.sigma[i];
    const z = new Float64Array(T).fill(Number.NaN);
    let prev = -1;
    for (let t = 0; t < T; t++) {
      if (!(close[t] > 0)) continue;
      if (prev >= 0 && sigma[prev] > 0) {
        const r = close[t] / close[prev] - 1;
        z[t] = Math.max(-Z_CLIP, Math.min(Z_CLIP, r / (sigma[prev] / 16)));
      }
      prev = t;
    }
    return z;
  });
}

/** Expanding type-7 quantile of each finite value so far (NaN before the first). */
export function expandingQuantile(values: ArrayLike<number>, q: number): Series {
  const sorted = new Float64Array(values.length);
  const out = new Float64Array(values.length).fill(Number.NaN);
  let n = 0;
  for (let t = 0; t < values.length; t++) {
    const v = values[t];
    if (Number.isFinite(v)) {
      let lo = 0,
        hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] <= v) lo = mid + 1;
        else hi = mid;
      }
      sorted.copyWithin(lo + 1, lo, n);
      sorted[lo] = v;
      n++;
    }
    if (n) {
      const index = (n - 1) * q;
      const a = Math.floor(index);
      const b = Math.ceil(index);
      out[t] = sorted[a] + (sorted[b] - sorted[a]) * (index - a);
    }
  }
  return out;
}

/**
 * Expanding exponentially weighted correlations of weekly z sums over
 * pairwise-complete weeks (pandas ewm(span=25).corr semantics: weights
 * (1−α)^age by week age, missing weeks still age the older ones). Weights
 * grow as (1−α)^−week instead of decaying, which gives the same ratios
 * without touching every pair each week.
 */
class WeeklyCorrelation {
  private readonly ratio = 1 / (1 - 2 / (IDM_SPAN_WEEKS + 1));
  private readonly sw: Float64Array;
  private readonly sx: Float64Array;
  private readonly sy: Float64Array;
  private readonly sxx: Float64Array;
  private readonly syy: Float64Array;
  private readonly sxy: Float64Array;
  private readonly count: Uint32Array;
  constructor(private readonly n: number) {
    const pairs = (n * (n - 1)) / 2;
    this.sw = new Float64Array(pairs);
    this.sx = new Float64Array(pairs);
    this.sy = new Float64Array(pairs);
    this.sxx = new Float64Array(pairs);
    this.syy = new Float64Array(pairs);
    this.sxy = new Float64Array(pairs);
    this.count = new Uint32Array(pairs);
  }
  add(week: number, values: ArrayLike<number>) {
    const g = this.ratio ** week;
    const live: number[] = [];
    for (let i = 0; i < this.n; i++) if (Number.isFinite(values[i])) live.push(i);
    for (let a = 0; a < live.length; a++) {
      const i = live[a];
      const x = values[i];
      const base = i * this.n - (i * (i + 1)) / 2 - i - 1;
      for (let b = a + 1; b < live.length; b++) {
        const j = live[b];
        const y = values[j];
        const k = base + j;
        this.sw[k] += g;
        this.sx[k] += g * x;
        this.sy[k] += g * y;
        this.sxx[k] += g * x * x;
        this.syy[k] += g * y * y;
        this.sxy[k] += g * x * y;
        this.count[k]++;
      }
    }
  }
  /** Writes floored correlations (0.99 where undefined) into H; true when any pair is fitted. */
  fill(H: Float64Array) {
    const n = this.n;
    let fitted = false;
    for (let i = 0, k = 0; i < n; i++) {
      H[i * n + i] = 1;
      for (let j = i + 1; j < n; j++, k++) {
        let c = MISSING_CORRELATION;
        if (this.count[k] >= IDM_MIN_WEEKS) {
          const w = this.sw[k];
          const mx = this.sx[k] / w,
            my = this.sy[k] / w;
          const vx = this.sxx[k] / w - mx * mx;
          const vy = this.syy[k] / w - my * my;
          const value = (this.sxy[k] / w - mx * my) / Math.sqrt(vx * vy);
          if (vx > 0 && vy > 0 && Number.isFinite(value)) {
            c = Math.max(0, Math.min(1, value));
            fitted = true;
          }
        }
        H[i * n + j] = c;
        H[j * n + i] = c;
      }
    }
    return fitted;
  }
}

/** yᵀHy with y_i = x_i·scale_i over the listed symbols; H is row-major n×n. */
export function quadraticForm(
  H: ArrayLike<number>,
  live: number[],
  x: ArrayLike<number>,
  scale?: ArrayLike<number>,
) {
  const n = x.length;
  let sum = 0;
  for (let a = 0; a < live.length; a++) {
    const i = live[a];
    const yi = x[i] * (scale ? scale[i] : 1);
    sum += yi * yi;
    for (let b = a + 1; b < live.length; b++) {
      const j = live[b];
      sum += 2 * yi * x[j] * (scale ? scale[j] : 1) * H[i * n + j];
    }
  }
  return sum;
}

/**
 * Eigenvalues and eigenvectors of a symmetric n×n row-major matrix:
 * Householder tridiagonalisation then implicit QL (EISPACK tred2/tql2 as in
 * JAMA). Eigenvalues are unsorted; eigenvector k is row k of `vectors`.
 */
export function symmetricEigen(matrix: ArrayLike<number>, n: number) {
  const V = Float64Array.from(matrix);
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  if (!n) return { values: d, vectors: V };
  for (let j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0,
      h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) {
        d[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
        V[j * n + i] = 0;
      }
    } else {
      for (let k = 0; k < i; k++) {
        d[k] /= scale;
        h += d[k] * d[k];
      }
      let f = d[i - 1];
      let g = f > 0 ? -Math.sqrt(h) : Math.sqrt(h);
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j];
        V[j * n + i] = f;
        g = e[j] + V[j * n + j] * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += V[k * n + j] * d[k];
          e[k] += V[k * n + j] * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] /= h;
        f += e[j] * d[j];
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j];
        g = e[j];
        for (let k = j; k <= i - 1; k++) V[k * n + j] -= f * e[k] + g * d[k];
        d[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = V[i * n + i];
    V[i * n + i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j];
        for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = V[(n - 1) * n + j];
    V[(n - 1) * n + j] = 0;
  }
  V[n * n - 1] = 1;
  e[0] = 0;

  // QL on the transpose so the rotations below touch contiguous rows.
  const Z = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) Z[k * n + i] = V[i * n + k];
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0,
    tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n && Math.abs(e[m]) > eps * tst1) m++;
    if (m > l) {
      do {
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r);
        d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1,
          c2 = 1,
          c3 = 1,
          s = 0,
          s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          const below = i * n,
            above = below + n;
          for (let k = 0; k < n; k++) {
            h = Z[above + k];
            Z[above + k] = s * Z[below + k] + c * h;
            Z[below + k] = c * Z[below + k] - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1;
        e[l] = s * p;
        d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f;
    e[l] = 0;
  }
  return { values: d, vectors: Z };
}

/** Cheap PSD test (n³/6): a Cholesky factorisation of H + 1e-10·I succeeds. */
function choleskyPasses(H: ArrayLike<number>, n: number) {
  const L = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let d = H[j * n + j] + 1e-10;
    for (let k = 0; k < j; k++) d -= L[j * n + k] ** 2;
    if (!(d > 0)) return false;
    const l = Math.sqrt(d);
    L[j * n + j] = l;
    for (let i = j + 1; i < n; i++) {
      let s = H[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = s / l;
    }
  }
  return true;
}

/**
 * A positive semi-definite stand-in for an indefinite correlation matrix
 * (Rebonato–Jäckel eigenvalue clipping): negative eigenvalues set to 0, then
 * rescaled to a unit diagonal. The 0 floor, the 0.99 fill for unfitted pairs
 * and pairwise-complete estimates can each leave H indefinite, and then
 * xᵀDHDx goes negative for signed weights. H is returned unchanged when it
 * is already PSD.
 */
export function clipCorrelation(H: ArrayLike<number>, n: number): Float64Array {
  if (choleskyPasses(H, n)) return Float64Array.from(H);
  const { values, vectors } = symmetricEigen(H, n);
  // H⁺ = H − Σ λ·vvᵀ over the (few) negative eigenvalues.
  const out = Float64Array.from(H);
  values.forEach((value, k) => {
    if (value >= 0) return;
    const v = vectors.subarray(k * n, k * n + n);
    for (let i = 0; i < n; i++) {
      const coef = value * v[i];
      for (let j = i; j < n; j++) out[i * n + j] -= coef * v[j];
    }
  });
  const scale = Float64Array.from({ length: n }, (_, i) => {
    const v = out[i * n + i];
    return v > 0 ? 1 / Math.sqrt(v) : 0;
  });
  for (let i = 0; i < n; i++) {
    out[i * n + i] = 1;
    for (let j = i + 1; j < n; j++)
      out[i * n + j] = out[j * n + i] = out[i * n + j] * scale[i] * scale[j];
  }
  return out;
}

/** AFTS diversification multiplier min(cap, 1/√(wᵀHw)); NaN without any weight. */
export function diversificationMultiplier(
  weights: ArrayLike<number>,
  H: ArrayLike<number>,
  cap: number,
) {
  const live: number[] = [];
  for (let i = 0; i < weights.length; i++) if (weights[i] !== 0) live.push(i);
  const risk = quadraticForm(H, live, weights);
  return risk > 1e-12 ? Math.min(cap, 1 / Math.sqrt(risk)) : Number.NaN;
}

export function buildPortfolio(
  system: SystemFrame,
  config: StrategyConfig,
  options: PortfolioOptions = {},
): PortfolioFrame {
  const { dates, sigma } = system;
  const T = dates.length;
  const n = system.symbols.length;
  const { riskTarget: tau, maxPositionWeight } = system.book;
  const { diversificationCap, overlay } = config.engine;
  const limits = [
    overlay.gross,
    overlay.normalRisk * tau,
    overlay.correlationShock * tau,
    overlay.jumpRisk * tau,
  ];

  const instrumentWeight = instrumentWeights(system);
  const z = normalisedReturns(system);
  const weeks = weekBlocks(dates);
  const weekly = weeks.map(({ start, end }) =>
    z.map((series) => {
      let sum = 0,
        any = false;
      for (let t = start; t <= end; t++)
        if (Number.isFinite(series[t])) {
          sum += series[t];
          any = true;
        }
      return any ? sum : Number.NaN;
    }),
  );
  const jumpSigma = sigma.map((s) => expandingQuantile(s, JUMP_QUANTILE));
  const correlations = new WeeklyCorrelation(n);
  const H = new Float64Array(n * n).fill(MISSING_CORRELATION);
  for (let i = 0; i < n; i++) H[i * n + i] = 1;
  // Long-only weights are safe with H itself (H ≥ 0 elementwise keeps xᵀDHDx ≥ 0).
  // Signed weights get the PSD repair at each refit: otherwise a negative
  // xᵀDHDx makes the risk NaN and silently switches those limits off.
  let riskH: Float64Array = H;

  const idm = new Float64Array(T).fill(Number.NaN);
  const forecast = system.symbols.map(() => new Float64Array(T).fill(Number.NaN));
  const averageWeight = system.symbols.map(() => new Float64Array(T));
  const targetWeight = system.symbols.map(() => new Float64Array(T));
  const multiplier = new Float64Array(T).fill(1);
  const limit = new Uint8Array(T);
  const gross = new Float64Array(T);

  const smoothIdm = ewmaStep(IDM_SMOOTHING);
  let nextWeek = 0,
    fitted = false;
  const [w, sig, jump, x, a] = [0, 0, 0, 0, 0].map(() => new Float64Array(n));
  for (let t = 0; t < T; t++) {
    if (isMonthStart(dates, t)) {
      // Refit from ISO weeks that ended before this session.
      while (nextWeek < weeks.length && weeks[nextWeek].end < t) {
        correlations.add(nextWeek, weekly[nextWeek]);
        nextWeek++;
      }
      fitted = correlations.fill(H) || fitted;
      if (options.longShort && fitted) riskH = clipCorrelation(H, n);
    }
    const live: number[] = [];
    for (let i = 0; i < n; i++) {
      w[i] = instrumentWeight[i][t];
      sig[i] = sigma[i][t];
      jump[i] = jumpSigma[i][t];
      if (w[i] > 0) live.push(i);
    }
    // 1 before the first fit; NaN (carry the smoothed value) with nothing eligible.
    const raw = fitted ? diversificationMultiplier(w, H, diversificationCap) : 1;
    idm[t] = smoothIdm(raw);

    x.fill(0);
    a.fill(0);
    for (const i of live) {
      const combined = system.combined[i][t];
      const f =
        options.constantForecast ??
        (options.trendFilter
          ? system.trendFilter[i][t]
          : options.longShort
            ? combined
            : Math.max(0, combined));
      forecast[i][t] = f;
      a[i] = (idm[t] * instrumentWeight[i][t] * tau) / sigma[i][t];
      if (Number.isFinite(f))
        x[i] = Math.max(-maxPositionWeight, Math.min(maxPositionWeight, (a[i] * f) / 10));
    }

    const held = live.filter((i) => x[i] !== 0);
    let grossRisk = 0,
      shock = 0;
    for (const i of held) {
      grossRisk += Math.abs(x[i]);
      shock += Math.abs(x[i]) * sigma[i][t];
    }
    // The clamp only absorbs rounding: the matrix used is PSD for signed weights.
    const risks = [
      grossRisk,
      Math.sqrt(Math.max(0, quadraticForm(riskH, held, x, sig))),
      shock,
      Math.sqrt(Math.max(0, quadraticForm(riskH, held, x, jump))),
    ];
    let m = 1,
      code = 0;
    risks.forEach((risk, k) => {
      const ratio = risk > limits[k] ? limits[k] / risk : 1;
      if (ratio < m) {
        m = ratio;
        code = k + 1;
      }
    });
    multiplier[t] = m;
    limit[t] = code;
    let total = 0;
    for (const i of live) {
      averageWeight[i][t] = a[i] * m;
      targetWeight[i][t] = x[i] * m;
      total += Math.abs(x[i] * m);
    }
    gross[t] = total;
  }

  return {
    system,
    idm,
    instrumentWeight,
    forecast,
    averageWeight,
    targetWeight,
    multiplier,
    limit,
    gross,
  };
}
