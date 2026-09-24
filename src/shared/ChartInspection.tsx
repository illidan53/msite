import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale";

/** Shared daily axis and inspection layer. Indices follow trading sessions, not calendar gaps. */
export function ChartInspection({
  dates,
  x,
  top,
  bottom,
  labelY,
  describe,
  onSelect,
}: {
  dates: string[];
  x: (index: number) => number;
  top: number;
  bottom: number;
  labelY: number;
  describe: (index: number) => string[];
  onSelect?: (index: number) => void;
}) {
  const { t } = useLocale();
  const ref = useRef<SVGGElement>(null);
  const [scale, setScale] = useState(1);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    if (!svg) return;
    const observer = new ResizeObserver(() => {
      const width = svg.getBoundingClientRect().width;
      if (width > 0) setScale(svg.viewBox.baseVal.width / width);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  if (!dates.length) return null;
  const last = dates.length - 1;
  const left = x(0),
    right = x(last);
  const count = Math.min(
    dates.length,
    Math.max(2, Math.floor((right - left) / (78 * scale)) + 1),
  );
  const ticks = [
    ...new Set(
      Array.from({ length: count }, (_, i) =>
        Math.round((i * last) / Math.max(1, count - 1)),
      ),
    ),
  ];
  const index = Math.min(last, active ?? last);
  const choose = (i: number) => {
    const next = Math.max(0, Math.min(last, i));
    setActive(next);
    onSelect?.(next);
  };
  const pointer = (event: React.PointerEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement!;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (matrix)
      choose(
        Math.round(
          ((point.matrixTransform(matrix.inverse()).x - left) /
            (right - left || 1)) *
            last,
        ),
      );
  };
  const lines = [dates[index], ...describe(index)];
  const font = 12 * scale,
    row = 18 * scale;
  const boxWidth = Math.min(
    right - left || 220,
    Math.max(180, ...lines.map((s) => s.length * 7)) * scale,
  );
  const boxX = Math.max(
    left,
    Math.min(right - boxWidth, x(index) + 10 * scale),
  );
  return (
    <g ref={ref} className="chart-inspection">
      {ticks.map((i) => (
        <g key={i} aria-hidden="true" pointerEvents="none">
          <line
            x1={x(i)}
            x2={x(i)}
            y1={top}
            y2={bottom + 4}
            stroke="var(--border, #dce1eb)"
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
            opacity="0.65"
          />
          <text
            x={x(i)}
            y={labelY}
            textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
            style={{ fontSize: font }}
            fill="var(--muted)"
          >
            {Date.parse(dates[last]) - Date.parse(dates[0]) > 366 * 86400000
              ? dates[i].slice(0, 7)
              : dates[i].slice(5)}
          </text>
        </g>
      ))}
      {active !== null && (
        <g pointerEvents="none" aria-hidden="true">
          <line
            x1={x(index)}
            x2={x(index)}
            y1={top}
            y2={bottom}
            stroke="var(--accent)"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x={boxX}
            y={top}
            width={boxWidth}
            height={row * lines.length + 12 * scale}
            rx={5 * scale}
            fill="var(--surface, white)"
            stroke="var(--border, #dce1eb)"
          />
          {lines.map((line, i) => (
            <text
              key={i}
              x={boxX + 7 * scale}
              y={top + row * (i + 1)}
              style={{ fontSize: font, fontWeight: i === 0 ? 600 : 400 }}
              fill="var(--text, #202939)"
            >
              {line}
            </text>
          ))}
        </g>
      )}
      <rect
        x={left}
        y={top}
        width={Math.max(1, right - left)}
        height={labelY - top + 8 * scale}
        fill="transparent"
        tabIndex={0}
        role="slider"
        aria-label={t(
          "Inspect chart date · use arrow keys",
          "查看图表日期 · 使用方向键",
        )}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={lines.join(" · ")}
        onPointerMove={pointer}
        onPointerDown={pointer}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setActive(null);
        }}
        onFocus={() => choose(index)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? last
                : e.key === "ArrowLeft"
                  ? index - 1
                  : e.key === "ArrowRight"
                    ? index + 1
                    : null;
          if (next !== null) {
            e.preventDefault();
            choose(next);
          }
        }}
        style={{ cursor: "crosshair", touchAction: "pan-y" }}
      />
    </g>
  );
}
