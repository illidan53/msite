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
    const risks = [
      grossRisk,
      Math.sqrt(quadraticForm(H, held, x, sig)),
      shock,
      Math.sqrt(quadraticForm(H, held, x, jump)),
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
