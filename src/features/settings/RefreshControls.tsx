import clsx from "clsx";

const INTERVALS = [
  { label: "1h", seconds: 3_600 },
  { label: "3h", seconds: 10_800 },
  { label: "6h", seconds: 21_600 },
  { label: "1d", seconds: 86_400 },
  { label: "5d", seconds: 432_000 },
  { label: "30d", seconds: 2_592_000 },
  { label: "2month", seconds: 5_184_000 },
  { label: "3month", seconds: 7_776_000 },
  { label: "6month", seconds: 15_552_000 },
  { label: "1y", seconds: 31_536_000 },
  { label: "5y", seconds: 157_680_000 },
];

export interface RefreshControlsProps {
  intervalSeconds: number;
  disabledIntervals: number[];
  status: "ok" | "warning" | "blocked";
  message: string;
  onChange(intervalSeconds: number): void;
}

export function RefreshControls({
  disabledIntervals,
  intervalSeconds,
  message,
  onChange,
  status,
}: RefreshControlsProps) {
  return (
    <section className="refresh-controls" aria-label="Refresh frequency">
      <div className="segmented-control">
        {INTERVALS.map((interval) => (
          <button
            key={interval.seconds}
            type="button"
            aria-pressed={intervalSeconds === interval.seconds}
            className={clsx("segment", intervalSeconds === interval.seconds && "selected")}
            disabled={disabledIntervals.includes(interval.seconds)}
            onClick={() => onChange(interval.seconds)}
          >
            {interval.label}
          </button>
        ))}
      </div>
      <p role="status" className={clsx("rate-status", status)}>
        {message}
      </p>
    </section>
  );
}
