import type { PriceBar } from "../../../shared/types";

export interface ActivityMetrics {
  asOf: string | null;
  return5: number | null;
  return20: number | null;
  return60: number | null;
  relative20: number | null;
  rvol: number | null;
  cmf: number | null;
}
export function completedBars(bars: PriceBar[], now = new Date()): PriceBar[] {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const byDate = new Map<string, PriceBar>();
  for (const bar of bars) {
    const day = bar.timestamp.slice(0, 10);
    if (Number.isFinite(Date.parse(bar.timestamp)) && day < today)
      byDate.set(day, bar);
  }
  return [...byDate.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
}
export function calculateMetrics(
  input: PriceBar[],
  benchmarkInput: PriceBar[],
  now = new Date(),
): ActivityMetrics {
  const bars = completedBars(input, now);
  const benchmark = completedBars(benchmarkInput, now);
  const asOf = bars.at(-1)?.timestamp.slice(0, 10) ?? null;
  const reference = benchmark.filter(
    (bar) => bar.timestamp.slice(0, 10) <= (asOf ?? ""),
  );
  const window = (n: number) => {
    const slice = bars.slice(-n);
    if (slice.length < n) return [];
    if (
      reference.length >= n &&
      slice.some(
        (bar, i) =>
          bar.timestamp.slice(0, 10) !==
          reference.slice(-n)[i].timestamp.slice(0, 10),
      )
    )
      return [];
    return slice;
  };
  const priceReturn = (n: number) => {
    const slice = window(n + 1);
    if (
      !slice.length ||
      slice.some((bar) => !Number.isFinite(bar.close) || bar.close <= 0)
    )
      return null;
    return (slice.at(-1)!.close / slice[0].close - 1) * 100;
  };
  const return20 = priceReturn(20);
  const aligned = window(21);
  const benchmark20 = reference.slice(-21);
  const sameDates =
    aligned.length === 21 &&
    benchmark20.length === 21 &&
    aligned.every(
      (bar, i) =>
        bar.timestamp.slice(0, 10) === benchmark20[i].timestamp.slice(0, 10),
    );
  const validBenchmark =
    sameDates &&
    benchmark20.every((bar) => Number.isFinite(bar.close) && bar.close > 0);
  const relative20 =
    return20 !== null && validBenchmark
      ? return20 - (benchmark20.at(-1)!.close / benchmark20[0].close - 1) * 100
      : null;
  const volumeBars = window(25);
  const validVolumes =
    volumeBars.length === 25 &&
    volumeBars.every((bar) => Number.isFinite(bar.volume) && bar.volume >= 0);
  const priorVolume = validVolumes
    ? volumeBars.slice(0, 20).reduce((s, bar) => s + bar.volume, 0) / 20
    : 0;
  const recentVolume = validVolumes
    ? volumeBars.slice(-5).reduce((s, bar) => s + bar.volume, 0) / 5
    : 0;
  const cmfBars = window(20);
  const validCmf =
    cmfBars.length === 20 &&
    cmfBars.every(
      (bar) =>
        [bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) &&
        bar.volume >= 0 &&
        bar.low > 0 &&
        bar.high >= bar.low &&
        bar.close >= bar.low &&
        bar.close <= bar.high,
    );
  const volume = validCmf ? cmfBars.reduce((s, bar) => s + bar.volume, 0) : 0;
  const cmf =
    volume > 0
      ? cmfBars.reduce(
          (s, bar) =>
            s +
            (bar.high === bar.low
              ? 0
              : (2 * bar.close - bar.high - bar.low) / (bar.high - bar.low)) *
              bar.volume,
          0,
        ) / volume
      : null;
  return {
    asOf,
    return5: priceReturn(5),
    return20,
    return60: priceReturn(60),
    relative20,
    rvol: priorVolume > 0 ? recentVolume / priorVolume : null,
    cmf,
  };
}
