import clsx from "clsx";

const INTERVALS = [5, 10, 15, 30, 60, 120, 300];

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
            key={interval}
            type="button"
            aria-pressed={intervalSeconds === interval}
            className={clsx("segment", intervalSeconds === interval && "selected")}
            disabled={disabledIntervals.includes(interval)}
            onClick={() => onChange(interval)}
          >
            {formatInterval(interval)}
          </button>
        ))}
      </div>
      <p role="status" className={clsx("rate-status", status)}>
        {message}
      </p>
    </section>
  );
}

function formatInterval(intervalSeconds: number): string {
  return intervalSeconds < 60 ? `${intervalSeconds}s` : `${intervalSeconds / 60}m`;
}
