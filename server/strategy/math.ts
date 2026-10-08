/**
 * Pandas-exact series primitives (NaN = missing). The published AFTS scalars
 * were fitted with pandas, so EWMAs replicate `ewm(adjust=True,
 * ignore_na=False)`: weights decay by position through NaN inputs, a NaN adds
 * no observation, and the output at a NaN carries the previous value. Rolling
 * windows count positions; `minPeriods` counts valid values, as in pandas.
 */
export type Values = ArrayLike<number>;

export const spanAlpha = (span: number) => 2 / (span + 1);
export const comAlpha = (com: number) => 1 / (1 + com);
export const clip = (value: number, cap: number) =>
  value > cap ? cap : value < -cap ? -cap : value;
export const nanSeries = (length: number) => new Float64Array(length).fill(NaN);

/** pandas `ewm(alpha=…, min_periods=…).mean()` (port of aggregations.pyx `ewm`). */
export function ewmMean(values: Values, alpha: number, minPeriods = 0) {
  const n = values.length;
  const out = nanSeries(n);
  if (!n) return out;
  const minp = Math.max(minPeriods, 1);
  const decay = 1 - alpha;
  let weighted = values[0];
  let nobs = weighted === weighted ? 1 : 0;
  let oldWt = 1;
  if (nobs >= minp) out[0] = weighted;
  for (let i = 1; i < n; i++) {
    const cur = values[i];
    const obs = cur === cur;
    if (obs) nobs++;
    if (weighted === weighted) {
      oldWt *= decay;
      if (obs) {
        // pandas skips the update on an unchanged value to stay exact on constant series.
        if (weighted !== cur) weighted = (oldWt * weighted + cur) / (oldWt + 1);
        oldWt += 1;
      }
    } else if (obs) weighted = cur;
    if (nobs >= minp) out[i] = weighted;
  }
  return out;
}

/** pandas `ewm(...).std()` with bias=False (port of aggregations.pyx `ewmcov`, then zsqrt). */
export function ewmStd(values: Values, alpha: number, minPeriods = 0) {
  const n = values.length;
  const out = nanSeries(n);
  if (!n) return out;
  const minp = Math.max(minPeriods, 1);
  const decay = 1 - alpha;
  let mean = values[0];
  let nobs = mean === mean ? 1 : 0;
  let cov = 0,
    sumWt = 1,
    sumWt2 = 1,
    oldWt = 1;
  for (let i = 1; i < n; i++) {
    const cur = values[i];
    const obs = cur === cur;
    if (obs) nobs++;
    if (mean === mean) {
      sumWt *= decay;
      sumWt2 *= decay * decay;
      oldWt *= decay;
      if (obs) {
        const old = mean;
        if (mean !== cur) mean = (oldWt * old + cur) / (oldWt + 1);
        cov =
          (oldWt * (cov + (old - mean) * (old - mean)) +
            (cur - mean) * (cur - mean)) /
          (oldWt + 1);
        sumWt += 1;
        sumWt2 += 1;
        oldWt += 1;
      }
    } else if (obs) mean = cur;
    if (nobs >= minp) {
      const numerator = sumWt * sumWt;
      const denominator = numerator - sumWt2;
      if (denominator > 0) {
        const variance = (numerator / denominator) * cov;
        out[i] = variance < 0 ? 0 : Math.sqrt(variance);
      }
    }
  }
  return out;
}

function rollingExtreme(
  values: Values,
  window: number,
  minPeriods: number,
  max: boolean,
) {
  const n = values.length;
  const out = nanSeries(n);
  const deque = new Int32Array(n);
  let head = 0,
    tail = 0,
    count = 0;
  for (let i = 0; i < n; i++) {
    const cur = values[i];
    if (cur === cur) {
      count++;
      while (
        tail > head &&
        (max ? values[deque[tail - 1]] <= cur : values[deque[tail - 1]] >= cur)
      )
        tail--;
      deque[tail++] = i;
    }
    const drop = i - window;
    if (drop >= 0 && values[drop] === values[drop]) count--;
    while (tail > head && deque[head] <= drop) head++;
    if (count >= Math.max(minPeriods, 1) && tail > head) out[i] = values[deque[head]];
  }
  return out;
}

/** pandas `rolling(window, min_periods).max()`; O(n) with a monotonic deque. */
export const rollingMax = (values: Values, window: number, minPeriods = window) =>
  rollingExtreme(values, window, minPeriods, true);
export const rollingMin = (values: Values, window: number, minPeriods = window) =>
  rollingExtreme(values, window, minPeriods, false);

const signbit = (value: number) => value < 0 || Object.is(value, -0);

/** pandas `rolling(window, min_periods).mean()` (port of `roll_mean`, Kahan-compensated). */
export function rollingMean(values: Values, window: number, minPeriods = window) {
  const n = values.length;
  const out = nanSeries(n);
  const minp = Math.max(minPeriods, 1);
  let sum = 0,
    addCompensation = 0,
    removeCompensation = 0,
    nobs = 0,
    negative = 0,
    same = 0,
    previous = values[0];
  for (let i = 0; i < n; i++) {
    const drop = i - window;
    if (drop >= 0) {
      const old = values[drop];
      if (old === old) {
        nobs--;
        const y = -old - removeCompensation;
        const t = sum + y;
        removeCompensation = t - sum - y;
        sum = t;
        if (signbit(old)) negative--;
      }
    }
    const cur = values[i];
    if (cur === cur) {
      nobs++;
      const y = cur - addCompensation;
      const t = sum + y;
      addCompensation = t - sum - y;
      sum = t;
      if (signbit(cur)) negative++;
      same = cur === previous ? same + 1 : 1;
      previous = cur;
    }
    if (nobs >= minp) {
      // pandas returns a repeated constant itself and never flips the sign of a one-signed window.
      let result = sum / nobs;
      if (same >= nobs) result = previous;
      else if (negative === 0 && result < 0) result = 0;
      else if (negative === nobs && result > 0) result = 0;
      out[i] = result;
    }
  }
  return out;
}

/** Sorted multiset of the valid values in a rolling window. */
class SortedWindow {
  private readonly data: Float64Array;
  size = 0;
  constructor(capacity: number) {
    this.data = new Float64Array(Math.max(capacity, 1));
  }
  private search(value: number) {
    let lo = 0,
      hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.data[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  insert(value: number) {
    const at = this.search(value);
    this.data.copyWithin(at + 1, at, this.size);
    this.data[at] = value;
    this.size++;
  }
  remove(value: number) {
    const at = this.search(value);
    this.data.copyWithin(at, at + 1, this.size);
    this.size--;
  }
  get(index: number) {
    return this.data[index];
  }
}

function rollingOrder(
  values: Values,
  window: number,
  minPeriods: number,
  pick: (w: SortedWindow) => number,
) {
  const n = values.length;
  const out = nanSeries(n);
  const sorted = new SortedWindow(Math.min(window, n));
  const minp = Math.max(minPeriods, 1);
  for (let i = 0; i < n; i++) {
    const cur = values[i];
    if (cur === cur) sorted.insert(cur);
    const drop = i - window;
    if (drop >= 0 && values[drop] === values[drop]) sorted.remove(values[drop]);
    if (sorted.size >= minp) out[i] = pick(sorted);
  }
  return out;
}

/** pandas `rolling(...).quantile(q)` with linear (type 7) interpolation. */
export function rollingQuantile(
  values: Values,
  window: number,
  q: number,
  minPeriods = window,
) {
  return rollingOrder(values, window, minPeriods, (w) => {
    const position = q * (w.size - 1);
    const lo = Math.floor(position);
    if (position === lo) return w.get(lo);
    const low = w.get(lo);
    return low + (w.get(lo + 1) - low) * (position - lo);
  });
}

/** pandas `rolling(...).median()`: the mean of the two middle values on an even count. */
export function rollingMedian(values: Values, window: number, minPeriods = window) {
  return rollingOrder(values, window, minPeriods, (w) => {
    const mid = w.size >> 1;
    return w.size % 2 ? w.get(mid) : (w.get(mid) + w.get(mid - 1)) / 2;
  });
}

const finiteSorted = (values: Values) => {
  const sorted: number[] = [];
  for (let i = 0; i < values.length; i++)
    if (Number.isFinite(values[i])) sorted.push(values[i]);
  return sorted.sort((a, b) => a - b);
};

/** Median of the finite values (NaN when none), numpy/pandas convention. */
export function median(values: Values) {
  const sorted = finiteSorted(values);
  if (!sorted.length) return NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Type-7 (numpy "linear") quantile of the finite values, with numpy's lerp. */
export function quantile(values: Values, q: number) {
  const sorted = finiteSorted(values);
  if (!sorted.length) return NaN;
  const position = q * (sorted.length - 1);
  const lo = Math.floor(position);
  const t = position - lo;
  const a = sorted[lo];
  const b = sorted[Math.min(lo + 1, sorted.length - 1)];
  const diff = b - a;
  return t >= 0.5 ? b - diff * (1 - t) : a + diff * t;
}

export function mean(values: Values) {
  let sum = 0,
    count = 0;
  for (let i = 0; i < values.length; i++)
    if (Number.isFinite(values[i])) {
      sum += values[i];
      count++;
    }
  return count ? sum / count : NaN;
}

/** pandas `cumsum()`: NaN inputs stay NaN and do not interrupt the running sum. */
export function cumsum(values: Values) {
  const out = nanSeries(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++)
    if (values[i] === values[i]) out[i] = sum += values[i];
  return out;
}

/** pandas `ffill()`. */
export function ffill(values: Values) {
  const out = Float64Array.from(values);
  for (let i = 1; i < out.length; i++) if (out[i] !== out[i]) out[i] = out[i - 1];
  return out;
}

/** `x_t − x_{t−lag}` (pandas `diff(lag)`). */
export function diff(values: Values, lag = 1) {
  const out = nanSeries(values.length);
  for (let i = lag; i < values.length; i++) out[i] = values[i] - values[i - lag];
  return out;
}
