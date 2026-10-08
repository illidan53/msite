import { useEffect, useState } from "react";
import { ChartInspection } from "../../shared/ChartInspection";
import { useStrategyFormat } from "./format";

export interface EquitySeries {
  id: string;
  label: string;
  values: (number | null)[];
  color: string;
  dash?: string;
  width?: number;
}
/** Validated categorical order; the first slot is the site accent for the live system. */
export const seriesColors = [
  "#5652b5",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
];
export const seriesDashes = ["", "7 4", "", "2 3", "10 3 2 3"];

const narrowQuery = "(max-width: 600px)";
/** Phones get taller charts so labels stay legible once the SVG is scaled down. */
export function useNarrow() {
  const matches = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia(narrowQuery).matches;
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(narrowQuery);
    const update = () => setNarrow(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return narrow;
}
/** Axis labels need more decimals when the range is narrow. */
export const axisDigits = (lo: number, hi: number) =>
  hi - lo >= 10 ? 0 : hi - lo >= 1 ? 1 : 2;

const right = 710,
  top = 35;
/** Indexed equity curves (100 = start) on one session axis, one shared scale. */
export function EquityChart({
  dates,
  series,
  title,
  caption,
}: {
  dates: string[];
  series: EquitySeries[];
  title: string;
  caption?: string;
}) {
  const { t, number } = useStrategyFormat();
  const narrow = useNarrow();
  const left = narrow ? 90 : 60,
    bottom = narrow ? 470 : 220,
    labelY = bottom + 30;
  if (dates.length < 2 || !series.length) return null;
  const values = series
    .flatMap((s) => s.values)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (!values.length) return null;
  const lo = Math.min(100, ...values),
    hi = Math.max(100, ...values),
    pad = (hi - lo) * 0.08 || 1;
  const x = (i: number) => left + (i / (dates.length - 1)) * (right - left),
    y = (v: number) =>
      bottom - ((v - lo + pad) / (hi - lo + 2 * pad)) * (bottom - top);
  const path = (line: (number | null)[]) => {
    let pen = false;
    return line
      .map((v, i) => {
        if (v === null || !Number.isFinite(v)) {
          pen = false;
          return "";
        }
        const d = `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
        return d;
      })
      .join(" ");
  };
  const ticks = [lo, (lo + hi) / 2, hi];
  const digits = axisDigits(lo, hi);
  return (
    <figure className="ema-chart strategy-chart">
      <ul className="strategy-legend" aria-label={t("Legend", "图例")}>
        {series.map((s) => (
          <li key={s.id}>
            <svg width="28" height="10" aria-hidden="true">
              <line
                x1="1"
                x2="27"
                y1="5"
                y2="5"
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeDasharray={s.dash || undefined}
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 780 ${labelY + 10}`}
        role="img"
        aria-label={t(
          `${title}: equity indexed to 100 at the start`,
          `${title}：以起点为 100 的净值`,
        )}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={y(v)}
              y2={y(v)}
              className="history-grid"
            />
            <text x={left - 8} y={y(v) + (narrow ? 10 : 4)} textAnchor="end">
              {v.toFixed(digits)}
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={right}
          y1={y(100)}
          y2={y(100)}
          className="history-reference"
        />
        {[...series].reverse().map((s) => (
          <path
            key={s.id}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 2}
            strokeDasharray={s.dash || undefined}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <ChartInspection
          dates={dates}
          x={x}
          top={top}
          bottom={bottom}
          labelY={labelY}
          describe={(i) =>
            series.map((s) => `${s.label}: ${number(s.values[i], 1)}`)
          }
        />
      </svg>
      {caption && <figcaption>{caption}</figcaption>}
      <ChartValues
        dates={dates}
        columns={series.map((s) => ({ label: s.label, values: s.values }))}
      />
    </figure>
  );
}

/** Table view of a chart, rendered only once opened to keep long series cheap. */
export function ChartValues({
  dates,
  columns,
}: {
  dates: string[];
  columns: { label: string; values: (number | null)[]; digits?: number }[];
}) {
  const { t, number } = useStrategyFormat();
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("View chart values", "查看图表数值")}</summary>
      {open && (
        <div className="ema-table-wrap strategy-values" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t("Date", "日期")}</th>
                {columns.map((c) => (
                  <th key={c.label} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates
                .map((date, i) => (
                  <tr key={date}>
                    <th scope="row">{date}</th>
                    {columns.map((c) => (
                      <td key={c.label}>
                        {number(c.values[i], c.digits ?? 2)}
                      </td>
                    ))}
                  </tr>
                ))
                .reverse()}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
