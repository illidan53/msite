import type { SymbolChart } from "../../../shared/strategy";
import { familyLabels } from "../../../shared/strategyRules";
import { ruleFamilies } from "../../../shared/strategy";
import { ChartInspection } from "../../shared/ChartInspection";
import { ChartValues, axisDigits, useNarrow } from "./EquityChart";
import { useStrategyFormat } from "./format";

const right = 710;
/** Panel bands in viewBox units; phones get taller bands for the larger labels. */
const layouts = {
  wide: {
    left: 60,
    close: { top: 45, bottom: 150 },
    forecast: { top: 205, bottom: 295 },
    weight: { top: 345, bottom: 395 },
    labelY: 430,
    nudge: 4,
  },
  narrow: {
    left: 100,
    close: { top: 60, bottom: 300 },
    forecast: { top: 380, bottom: 580 },
    weight: { top: 660, bottom: 780 },
    labelY: 830,
    nudge: 10,
  },
};
const finite = (v: number | null): v is number =>
  v !== null && Number.isFinite(v);

/** Close, combined forecast (±20) and target weight stacked on one session axis. */
export function SymbolStrategyChart({ chart }: { chart: SymbolChart }) {
  const { t, tr, number, signed } = useStrategyFormat();
  const { left, close, forecast, weight, labelY, nudge } =
    layouts[useNarrow() ? "narrow" : "wide"];
  const { dates } = chart;
  if (dates.length < 2) return null;
  const x = (i: number) => left + (i / (dates.length - 1)) * (right - left);
  const closes = chart.close.filter(finite);
  if (!closes.length) return null;
  const lo = Math.min(...closes),
    hi = Math.max(...closes),
    pad = (hi - lo) * 0.08 || 1;
  const py = (v: number) =>
    close.bottom -
    ((v - lo + pad) / (hi - lo + 2 * pad)) * (close.bottom - close.top);
  const fy = (v: number) =>
    forecast.bottom - ((v + 20) / 40) * (forecast.bottom - forecast.top);
  const maxWeight = Math.max(1, ...chart.targetWeight.filter(finite));
  const wy = (v: number) =>
    weight.bottom - (v / maxWeight) * (weight.bottom - weight.top);
  const path = (series: (number | null)[], scale: (v: number) => number) => {
    let pen = false;
    return series
      .map((v, i) => {
        if (!finite(v)) {
          pen = false;
          return "";
        }
        const d = `${pen ? "L" : "M"}${x(i).toFixed(1)},${scale(v).toFixed(1)}`;
        pen = true;
        return d;
      })
      .join(" ");
  };
  // A target holds from one session to the next, so it is drawn as steps.
  const firstWeight = chart.targetWeight.findIndex(finite);
  const weightArea =
    firstWeight >= 0
      ? `M${x(firstWeight).toFixed(1)},${weight.bottom} ` +
        chart.targetWeight
          .slice(firstWeight)
          .map((v, k) => {
            const level = wy(finite(v) ? v : 0).toFixed(1);
            return k === 0
              ? `V${level}`
              : `H${x(firstWeight + k).toFixed(1)} V${level}`;
          })
          .join(" ") +
        ` H${x(dates.length - 1).toFixed(1)} V${weight.bottom} Z`
      : "";
  const digits = axisDigits(lo, hi);
  const title = `${chart.symbol} · ${t("Quant System", "量化系统")}`;
  return (
    <figure className="ema-chart strategy-chart strategy-symbol-chart">
      <svg
        viewBox={`0 0 780 ${labelY + 10}`}
        role="img"
        aria-label={t(
          `${title}: close, combined forecast and target weight`,
          `${title}：收盘价、组合预测与目标权重`,
        )}
      >
        <text x={left} y={close.top - 2 * nudge - 6}>
          {t("Close (USD)", "收盘价（美元）")}
        </text>
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={py(v)}
              y2={py(v)}
              className="history-grid"
            />
            <text x={left - 8} y={py(v) + nudge} textAnchor="end">
              {v.toFixed(digits)}
            </text>
          </g>
        ))}
        <path
          d={path(chart.close, py)}
          fill="none"
          stroke="var(--text)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        <text x={left} y={forecast.top - 2 * nudge - 6}>
          {t("Combined forecast", "组合预测值")}
        </text>
        <rect
          x={left}
          width={right - left}
          y={fy(20)}
          height={fy(0) - fy(20)}
          fill="var(--accent)"
          opacity="0.06"
          aria-hidden="true"
        />
        {[-20, 0, 10, 20].map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={right}
              y1={fy(v)}
              y2={fy(v)}
              className={
                v === 0 || v === 10 ? "history-reference" : "history-grid"
              }
            />
            <text x={left - 8} y={fy(v) + nudge} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <path
          d={path(chart.forecast, fy)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />

        <text x={left} y={weight.top - 2 * nudge - 6}>
          {t("Target weight", "目标权重")}
        </text>
        <line
          x1={left}
          x2={right}
          y1={weight.bottom}
          y2={weight.bottom}
          className="history-grid"
        />
        <text x={left - 8} y={wy(maxWeight) + nudge} textAnchor="end">
          {maxWeight.toFixed(1)}%
        </text>
        {weightArea && (
          <path
            d={weightArea}
            fill="var(--accent)"
            opacity="0.22"
            stroke="var(--accent)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <ChartInspection
          dates={dates}
          x={x}
          top={close.top}
          bottom={weight.bottom}
          labelY={labelY}
          describe={(i) => [
            `${t("Close", "收盘价")}: ${number(chart.close[i], 2)} USD`,
            `${t("Forecast", "预测值")}: ${signed(chart.forecast[i], 1)}`,
            ...ruleFamilies.map(
              (f) =>
                `${tr(familyLabels[f])}: ${signed(chart.families[f][i], 1)}`,
            ),
            `${t("Target weight", "目标权重")}: ${number(chart.targetWeight[i], 2, "%")}`,
          ]}
        />
      </svg>
      <figcaption>
        {t(
          "Shaded band: long forecasts (0 to +20); dashed lines mark 0 and the average forecast of 10. The long-only system holds nothing while the forecast is below 0.",
          "阴影带为看多预测（0 至 +20）；虚线标出 0 与平均预测值 10。预测值低于 0 时，只做多系统不持仓。",
        )}
      </figcaption>
      <ChartValues
        dates={dates}
        columns={[
          { label: t("Close", "收盘价"), values: chart.close },
          { label: t("Forecast", "预测值"), values: chart.forecast, digits: 1 },
          ...ruleFamilies.map((f) => ({
            label: tr(familyLabels[f]),
            values: chart.families[f],
            digits: 1,
          })),
          {
            label: t("Target weight %", "目标权重 %"),
            values: chart.targetWeight,
          },
        ]}
      />
    </figure>
  );
}
