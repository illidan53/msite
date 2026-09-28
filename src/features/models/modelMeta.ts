import type { QuantModelId } from "../../../shared/research";
import type { ChartLine } from "../research/ModelChart";
import { pullbackConfigs } from "../research/PullbackModel";
import {
  ema200Notes,
  pullbackNotes,
  type ModelNotes,
  type Pair,
} from "../research/quantModelText";

export interface ModelMeta {
  index: number;
  title: Pair;
  intro: Pair;
  event: Pair;
  legend: Pair;
  lines: Record<string, ChartLine>;
  /** The current reading shown in the fit list. */
  reading: { label: Pair; unit: string; signed: boolean };
  notes: ModelNotes;
}

const fromPullback = (
  id: Exclude<QuantModelId, "ema200">,
  reading: ModelMeta["reading"],
): ModelMeta => {
  const { index, title, intro, event, legend, lines } = pullbackConfigs[id];
  return {
    index,
    title,
    intro,
    event,
    legend,
    lines,
    reading,
    notes: pullbackNotes[id],
  };
};

/** Display metadata shared by the model picker, sample chart and fit list. */
export const modelMeta: Record<QuantModelId, ModelMeta> = {
  ema200: {
    index: 1,
    title: ["EMA200 pullback & rebound", "EMA200 回踩与反弹"],
    intro: [
      "When price approaches EMA200 from above, does touching the ±3% zone precede stronger 20-session returns than comparable background days?",
      "价格从上方回踩 EMA200 ±3% 区域后，20 日收益是否强于可比的背景交易日？",
    ],
    event: ["Touch", "触碰"],
    legend: [
      "Latest 252 sessions · solid: close · dashed: EMA200 · shaded: ±3% zone · dots: touch-day close",
      "最近最多 252 日 · 实线：收盘价 · 虚线：EMA200 · 阴影：±3% 区域 · 圆点：触碰日收盘",
    ],
    lines: { ema200: { label: "EMA200", dash: "6 4" } },
    reading: { label: ["vs EMA200", "距 EMA200"], unit: "%", signed: true },
    notes: ema200Notes,
  },
  sma50: fromPullback("sma50", {
    label: ["vs SMA50", "距 SMA50"],
    unit: "%",
    signed: true,
  }),
  rsi2: fromPullback("rsi2", {
    label: ["RSI(2)", "RSI(2)"],
    unit: "",
    signed: false,
  }),
  bollinger: fromPullback("bollinger", {
    label: ["%B", "%B"],
    unit: "",
    signed: false,
  }),
};
