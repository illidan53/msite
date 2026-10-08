import type { Bilingual, RuleFamily, RuleId } from "./strategy";

/**
 * Pre-registered rule catalog. Scalars are the book's published values
 * (AFTS book code and pysystemtrade rob_system config); `null` means a
 * pooled, expanding estimate (no published scalar for this transform).
 * Weights are percent of the combined forecast before redistribution.
 */
export interface RuleSpec {
  id: RuleId;
  family: RuleFamily;
  label: Bilingual;
  /** Where the rule comes from in Advanced Futures Trading Strategies. */
  source: string;
  scalar: number | null;
  weight: number;
  /** Sessions of the symbol's own history before the rule may vote. */
  warmup: number;
  params: Record<string, number>;
}

const third = 100 / 12;

export const ruleCatalog: RuleSpec[] = [
  ...(
    [
      [8, 5.95],
      [16, 4.1],
      [32, 2.79],
      [64, 1.91],
    ] as const
  ).map(
    ([fast, scalar]): RuleSpec => ({
      id: `ewmac${fast}` as RuleId,
      family: "trend",
      label: {
        en: `EWMAC ${fast}/${fast * 4}`,
        zh: `EWMAC ${fast}/${fast * 4} 均线交叉`,
      },
      source: "AFTS Strategies 7–9",
      scalar,
      weight: 5,
      warmup: fast * 4,
      params: { fast, slow: fast * 4 },
    }),
  ),
  ...(
    [
      [40, 0.7],
      [80, 0.73],
      [160, 0.74],
      [320, 0.74],
    ] as const
  ).map(
    ([horizon, scalar]): RuleSpec => ({
      id: `breakout${horizon}` as RuleId,
      family: "trend",
      label: { en: `Breakout ${horizon}`, zh: `突破 ${horizon} 日` },
      source: "AFTS Strategy 21",
      scalar,
      weight: 5,
      warmup: horizon,
      params: { horizon, smooth: horizon / 4 },
    }),
  ),
  ...(
    [
      [32, 1.98],
      [64, 2.05],
    ] as const
  ).map(
    ([fast, scalar]): RuleSpec => ({
      id: `accel${fast}` as RuleId,
      family: "trend",
      label: { en: `Acceleration ${fast}`, zh: `趋势加速 ${fast}` },
      source: "AFTS Strategy 23",
      scalar,
      weight: 2.5,
      warmup: fast * 5,
      params: { fast, slow: fast * 4 },
    }),
  ),
  ...(
    [
      [16, 3.55],
      [32, 2.34],
      [64, 1.55],
    ] as const
  ).map(
    ([fast, scalar]): RuleSpec => ({
      id: `assettrend${fast}` as RuleId,
      family: "sector_trend",
      label: {
        en: `Sector trend ${fast}/${fast * 4}`,
        zh: `板块趋势 ${fast}/${fast * 4}`,
      },
      source: "AFTS Strategy 18",
      scalar,
      weight: third,
      warmup: fast * 4,
      params: { fast, slow: fast * 4 },
    }),
  ),
  ...(
    [
      [40, 117.78],
      [80, 159.88],
    ] as const
  ).map(
    ([horizon, scalar]): RuleSpec => ({
      id: `relmom${horizon}` as RuleId,
      family: "relative_momentum",
      label: {
        en: `Relative momentum ${horizon}`,
        zh: `板块内相对动量 ${horizon} 日`,
      },
      source: "AFTS Strategy 19",
      scalar,
      weight: 10,
      warmup: horizon + 2 * (horizon / 4),
      params: { horizon, smooth: horizon / 4 },
    }),
  ),
  {
    id: "mr5",
    family: "mean_reversion",
    label: { en: "Trend-gated reversion (com 5)", zh: "顺势均值回归（com 5）" },
    source: "AFTS Strategies 26–27",
    scalar: 9.3,
    weight: 5,
    warmup: 64,
    params: { com: 5, gate: 16 },
  },
  {
    id: "mr20",
    family: "mean_reversion",
    label: { en: "Trend-gated reversion (SMA20)", zh: "顺势均值回归（SMA20）" },
    source: "AFTS Strategy 27 (Bollinger successor)",
    scalar: null,
    weight: 5,
    warmup: 64,
    params: { window: 20, gate: 16 },
  },
];

export const ruleIds = ruleCatalog.map((rule) => rule.id);
export const ruleById = Object.fromEntries(
  ruleCatalog.map((rule) => [rule.id, rule]),
) as Record<RuleId, RuleSpec>;
export const familyLabels: Record<RuleFamily, Bilingual> = {
  trend: { en: "Absolute trend", zh: "绝对趋势" },
  sector_trend: { en: "Sector trend", zh: "板块趋势" },
  relative_momentum: { en: "Relative momentum", zh: "相对动量" },
  mean_reversion: { en: "Trend-gated mean reversion", zh: "顺势均值回归" },
};
