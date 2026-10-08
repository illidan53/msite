import {
  comAlpha,
  ewmMean,
  nanSeries,
  rollingMax,
  rollingMean,
  rollingMin,
  spanAlpha,
} from "./math";

/**
 * Raw (unscaled) rule forecasts, spec §3.2. Price rules run on one symbol's
 * own sessions; class rules run on master dates. Every value at t uses data
 * up to t only.
 */

/** AFTS Strategies 7–9: (EWMA_L(C) − EWMA_4L(C)) / σ_p. */
export function ewmacRaw(
  close: ArrayLike<number>,
  sigmaPrice: ArrayLike<number>,
  fast: number,
) {
  const quick = ewmMean(close, spanAlpha(fast));
  const slow = ewmMean(close, spanAlpha(fast * 4));
  return quick.map((q, k) => (q - slow[k]) / sigmaPrice[k]);
}

/**
 * AFTS Strategy 21: position of the close in its N-session range, ±20 at the
 * extremes, smoothed with span N/4 (the scalar applies after smoothing).
 */
export function breakoutRaw(close: ArrayLike<number>, horizon: number) {
  const high = rollingMax(close, horizon, 1);
  const low = rollingMin(close, horizon, 1);
  const raw = high.map((h, k) =>
    h === low[k] ? NaN : (40 * (close[k] - (h + low[k]) / 2)) / (h - low[k]),
  );
  return ewmMean(raw, spanAlpha(Math.ceil(horizon / 4)));
}

/** AFTS Strategy 23: change of the scaled, uncapped EWMAC over its own fast span. */
export function accelRaw(scaledEwmac: ArrayLike<number>, lag: number) {
  const out = nanSeries(scaledEwmac.length);
  for (let k = lag; k < scaledEwmac.length; k++)
    out[k] = scaledEwmac[k] - scaledEwmac[k - lag];
  return out;
}

/** mr5's equilibrium: the book's `ewm(5)` is a centre of mass (α = 1/6), not a span. */
export const ewmEquilibrium = (close: ArrayLike<number>, com: number) =>
  ewmMean(close, comAlpha(com));
/** mr20's equilibrium, the Bollinger midline. */
export const smaEquilibrium = (close: ArrayLike<number>, window: number) =>
  rollingMean(close, window);

/**
 * AFTS Strategies 26–27: distance below the equilibrium in daily price vol,
 * kept only when it agrees with the EWMAC16 trend (buy dips in uptrends,
 * sell rallies in downtrends); NaN until the trend gate exists.
 */
export function mrRaw(
  close: ArrayLike<number>,
  equilibrium: ArrayLike<number>,
  sigmaPrice: ArrayLike<number>,
  trend: ArrayLike<number>,
) {
  const out = nanSeries(close.length);
  for (let k = 0; k < close.length; k++) {
    const raw = (equilibrium[k] - close[k]) / sigmaPrice[k];
    const gate = trend[k];
    if (raw !== raw || gate !== gate) continue;
    out[k] = Math.sign(raw) === Math.sign(gate) ? raw : 0;
  }
  return out;
}

const middle = (values: number[]) => {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
};

/**
 * AFTS Strategy 18 class index on master dates: Z = median member z (needs 5
 * finite members, or ≥ 1 while the class has fewer than 5 members), A =
 * cumsum(Z) with gaps as 0 once started. Class size counts members that have
 * produced a z so far, so later listings cannot change past index values.
 */
export function classIndex(memberZ: ArrayLike<number>[], length: number, minMembers = 5) {
  const median = nanSeries(length);
  const index = nanSeries(length);
  const seen = new Uint8Array(memberZ.length);
  let members = 0,
    level = NaN;
  const values: number[] = [];
  for (let t = 0; t < length; t++) {
    values.length = 0;
    memberZ.forEach((z, m) => {
      if (z[t] === z[t]) {
        values.push(z[t]);
        if (!seen[m]) {
          seen[m] = 1;
          members++;
        }
      }
    });
    if (values.length && values.length >= (members < minMembers ? 1 : minMembers))
      median[t] = middle(values);
    if (median[t] === median[t]) level = (level === level ? level : 0) + median[t];
    index[t] = level;
  }
  return { median, index };
}

/** EWMAC of an index already in vol units, over the robust vol of its changes (Strategy 18). */
export function indexTrendRaw(
  index: ArrayLike<number>,
  vol: ArrayLike<number>,
  fast: number,
) {
  const quick = ewmMean(index, spanAlpha(fast));
  const slow = ewmMean(index, spanAlpha(fast * 4));
  return quick.map((q, t) => (q - slow[t]) / vol[t]);
}

/**
 * AFTS Strategy 19 (pysystemtrade form) on master dates: outperformance
 * O = N − A of the symbol over its class (exact zeros dropped), its average
 * daily change over H sessions, smoothed with span H/4.
 */
export function relmomRaw(
  normalisedPrice: ArrayLike<number>,
  index: ArrayLike<number>,
  horizon: number,
) {
  const n = index.length;
  const outperformance = nanSeries(n);
  for (let t = 0; t < n; t++) {
    const o = normalisedPrice[t] - index[t];
    if (o === o && o !== 0) outperformance[t] = o;
  }
  const momentum = nanSeries(n);
  for (let t = horizon; t < n; t++)
    momentum[t] = (outperformance[t] - outperformance[t - horizon]) / horizon;
  return ewmMean(momentum, spanAlpha(horizon / 4));
}

/**
 * Pooled expanding forecast scalar without backfill: 10 over the running
 * mean of the daily cross-sectional median |raw| (finite, non-zero values),
 * NaN until `minDates` dates have contributed a median.
 */
export function pooledScalar(raws: ArrayLike<number>[], length: number, minDates = 256) {
  const out = nanSeries(length);
  const values: number[] = [];
  let sum = 0,
    count = 0;
  for (let t = 0; t < length; t++) {
    values.length = 0;
    for (const raw of raws) {
      const v = Math.abs(raw[t]);
      if (v > 0 && v < Infinity) values.push(v);
    }
    if (values.length) {
      sum += middle(values);
      count++;
    }
    if (count >= minDates) out[t] = (10 * count) / sum;
  }
  return out;
}
