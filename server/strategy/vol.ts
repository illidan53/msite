import {
  ewmMean,
  ewmStd,
  ffill,
  nanSeries,
  rollingMean,
  rollingQuantile,
  spanAlpha,
} from "./math";

/**
 * AFTS Strategy 3 volatility (spec §3.1), on one symbol's own sessions:
 * σ = 16·EWstd_32(r), blended with its long-run mean so a calm spell does not
 * lever up a stock right before vol returns.
 */
export function blendedVol(close: ArrayLike<number>) {
  const n = close.length;
  const returns = nanSeries(n);
  for (let k = 1; k < n; k++) returns[k] = close[k] / close[k - 1] - 1;
  const sigma = ewmStd(returns, spanAlpha(32), 10).map((s) => 16 * s);
  // σ is NaN only before its tenth return, so a 2560-position window holds the last ≤ 2560 valid values.
  const longRun = rollingMean(sigma, 2560, 1);
  const blended = sigma.map((s, k) =>
    s === s ? Math.max(0.3 * longRun[k] + 0.7 * s, 0.05) : NaN,
  );
  const valid = new Int32Array(n);
  for (let k = 0, count = 0; k < n; k++) valid[k] = sigma[k] === sigma[k] ? ++count : count;
  return { returns, sigma, blended, valid };
}

/**
 * Normalised returns for Strategies 17–19: r_t over the previous session's
 * daily vol, so the day's own move never shrinks its own z; capped at ±6
 * (Carver 2017) so one earnings gap cannot dominate a class index.
 */
export function normalisedReturns(
  returns: ArrayLike<number>,
  blended: ArrayLike<number>,
) {
  const z = nanSeries(returns.length);
  for (let k = 1; k < returns.length; k++) {
    const value = returns[k] / (blended[k - 1] / 16);
    if (value === value) z[k] = Math.max(-6, Math.min(6, value));
  }
  return z;
}

/**
 * pysystemtrade robust_vol_calc on a series of changes: EW std (span 35, min
 * 10), floored at its trailing 500-session 5% quantile (min 100 values, 0
 * before), then forward-filled.
 */
export function robustVol(changes: ArrayLike<number>) {
  const vol = ewmStd(changes, spanAlpha(35), 10).map((v) =>
    v === v && v < 1e-10 ? 1e-10 : v,
  );
  const floor = rollingQuantile(vol, 500, 0.05, 100);
  if (floor.length && floor[0] !== floor[0]) floor[0] = 0;
  const filledFloor = ffill(floor);
  return ffill(vol.map((v, k) => (v === v ? Math.max(v, filledFloor[k]) : NaN)));
}

/**
 * AFTS Strategy 13 regime multiplier on the symbol's own sessions: high vol
 * relative to its own history scales trend-like raw forecasts down (to 0.5),
 * low vol scales them up (to 2). 1 until 256 normalised-vol values exist.
 */
export function volAttenuation(blended: ArrayLike<number>) {
  const n = blended.length;
  const longRun = rollingMean(blended, 2500, 1);
  const multiplier = new Float64Array(n);
  // Earlier valid V values, kept sorted for the empirical quantile.
  const sorted = new Float64Array(n);
  let size = 0;
  for (let k = 0; k < n; k++) {
    const v = blended[k] / longRun[k];
    multiplier[k] = 1;
    if (v !== v) continue;
    let lo = 0,
      hi = size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    // Share of earlier values strictly below V_t, over the valid values up to t (AFTS chapter13).
    if (size + 1 >= 256) multiplier[k] = 2 - (1.5 * lo) / (size + 1);
    sorted.copyWithin(lo + 1, lo, size);
    sorted[lo] = v;
    size++;
  }
  return ewmMean(multiplier, spanAlpha(10));
}
