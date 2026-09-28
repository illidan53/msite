import type { PullbackStudy } from "../../../shared/research";
import { ChartInspection } from "../../shared/ChartInspection";
import { useLocale } from "../../shared/locale";

export interface ChartLine {
  label: string;
  dash: string;
}
/** Close, reference lines, optional band/oscillator and signal dots on one session axis. */
export function ModelChart({
  dates,
  close,
  chart,
  lines,
  legend,
  title,
}: {
  dates: string[];
  close: number[];
  chart: PullbackStudy["chart"];
  lines: Record<string, ChartLine>;
  legend: string;
  title: string;
}) {
  const { t } = useLocale();
  if (dates.length < 2) return null;
  const osc = chart.oscillator;
  const lineEntries = Object.entries(chart.lines);
  const band = chart.band;
  const values = [
    ...close,
    ...lineEntries.flatMap(([, v]) => v),
    ...(band ? [...band.upper, ...band.lower] : []),
  ].filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = Math.min(...values),
    hi = Math.max(...values),
    pad = (hi - lo) * 0.08 || 1;
  const top = 35,
    bottom = 220,
    oscTop = 250,
    oscBottom = 340;
  const labelY = osc ? 370 : 250;
  const x = (i: number) => 60 + (i / (dates.length - 1)) * 650,
    y = (v: number) =>
      bottom - ((v - lo + pad) / (hi - lo + 2 * pad)) * (bottom - top),
    oy = (v: number) => oscBottom - (v / 100) * (oscBottom - oscTop);
  const path = (series: (number | null)[], scale = y) => {
    let pen = false;
    return series
      .map((v, i) => {
        if (v === null) {
          pen = false;
          return "";
        }
        const d = `${pen ? "L" : "M"}${x(i)},${scale(v)}`;
        pen = true;
        return d;
      })
      .join(" ");
  };
  const bandPoints = band
    ? band.upper.flatMap((u, i) =>
        u === null || band.lower[i] === null
          ? []
          : [{ i, u, l: band.lower[i]! }],
      )
    : [];
  const bandPath = bandPoints.length
    ? "M" +
      bandPoints.map((p) => `${x(p.i)},${y(p.u)}`).join(" L") +
      " L" +
      [...bandPoints]
        .reverse()
        .map((p) => `${x(p.i)},${y(p.l)}`)
        .join(" L") +
      " Z"
    : "";
  const events = new Set(chart.events);
  const failed = new Set(chart.failed);
  const fmt = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : v.toFixed(2);
  return (
    <figure className="ema-chart model-chart">
      <figcaption>{legend}</figcaption>
      <svg
        viewBox={`0 0 780 ${labelY + 10}`}
        role="img"
        aria-label={t(
          `${title}: closing price, reference lines and signals`,
          `${title}：收盘价、参考线与信号`,
        )}
      >
        {[lo, (hi + lo) / 2, hi].map((v, index) => (
          <g key={index}>
            <line
              x1="60"
              x2="710"
              y1={y(v)}
              y2={y(v)}
              className="history-grid"
            />
            <text x="52" y={y(v) + 4} textAnchor="end">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {bandPath && (
          <path
            d={bandPath}
            fill="var(--accent)"
            opacity="0.09"
            aria-hidden="true"
          />
        )}
        <path
          d={path(close)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {lineEntries.map(([key, series]) => (
          <path
            key={key}
            d={path(series)}
            fill="none"
            stroke="var(--muted)"
            strokeWidth="2"
            strokeDasharray={lines[key]?.dash}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {close.map(
          (c, i) =>
            events.has(i) && (
              <circle
                key={dates[i]}
                className={failed.has(i) ? "model-event-failed" : undefined}
                cx={x(i)}
                cy={y(c)}
                r={failed.has(i) ? 5 : 4}
                fill={failed.has(i) ? "var(--negative)" : "var(--surface)"}
                stroke={failed.has(i) ? "var(--negative)" : "var(--accent)"}
                strokeWidth="2"
              >
                <title>
                  {failed.has(i)
                    ? `${dates[i]} · ${t("breakdown, not reclaimed", "破位未收回")}`
                    : dates[i]}
                </title>
              </circle>
            ),
        )}
        {osc && (
          <g className="model-oscillator">
            <rect
              x="60"
              width="650"
              y={oy(osc.threshold)}
              height={oscBottom - oy(osc.threshold)}
              fill="var(--accent)"
              opacity="0.09"
              aria-hidden="true"
            />
            {[0, osc.threshold, 50, 100].map((v) => (
              <g key={v}>
                <line
                  x1="60"
                  x2="710"
                  y1={oy(v)}
                  y2={oy(v)}
                  className={
                    v === osc.threshold ? "history-reference" : "history-grid"
                  }
                />
                {/* 0 sits too close to the threshold label to be legible. */}
                {v > 0 && (
                  <text x="52" y={oy(v) + 4} textAnchor="end">
                    {v}
                  </text>
                )}
              </g>
            ))}
            <text x="60" y={oscTop - 8}>
              RSI(2)
            </text>
            <path
              d={path(osc.values, oy)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              opacity="0.8"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
        <ChartInspection
          dates={dates}
          x={x}
          top={top}
          bottom={osc ? oscBottom : bottom}
          labelY={labelY}
          describe={(i) => [
            `${t("Close", "收盘价")}: ${close[i].toFixed(2)} USD`,
            ...lineEntries.map(
              ([key, series]) =>
                `${lines[key]?.label ?? key}: ${fmt(series[i])}`,
            ),
            ...(osc ? [`RSI(2): ${fmt(osc.values[i])}`] : []),
            ...(failed.has(i)
              ? [
                  t(
                    "Signal event · breakdown, not reclaimed within 20 sessions",
                    "信号事件 · 破位且 20 日内未收回",
                  ),
                ]
              : events.has(i)
                ? [t("Signal event", "信号事件")]
                : []),
          ]}
        />
      </svg>
      <details>
        <summary>{t("View chart values", "查看图表数值")}</summary>
        <div className="ema-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Date", "日期")}</th>
                <th>{t("Close", "收盘")}</th>
                {lineEntries.map(([key]) => (
                  <th key={key}>{lines[key]?.label ?? key}</th>
                ))}
                {band && <th>{t("Lower band", "下轨")}</th>}
                {osc && <th>RSI(2)</th>}
              </tr>
            </thead>
            <tbody>
              {dates
                .map((date, i) => (
                  <tr key={date}>
                    <td>{date}</td>
                    <td>{close[i].toFixed(2)}</td>
                    {lineEntries.map(([key, series]) => (
                      <td key={key}>{fmt(series[i])}</td>
                    ))}
                    {band && <td>{fmt(band.lower[i])}</td>}
                    {osc && <td>{fmt(osc.values[i])}</td>}
                  </tr>
                ))
                .reverse()}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
