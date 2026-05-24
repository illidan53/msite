const INTERVALS = [
  { label: "10s", seconds: 10 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "30m", seconds: 1_800 },
  { label: "1h", seconds: 3_600 },
  { label: "1d", seconds: 86_400 },
];

export interface RefreshControlsProps {
  intervalSeconds: number;
  disabledIntervals: number[];
  onChange(intervalSeconds: number): void;
}

export function RefreshControls({
  disabledIntervals,
  intervalSeconds,
  onChange,
}: RefreshControlsProps) {
  return (
    <>
      <label htmlFor="refresh-interval">Refresh interval</label>
      <select
        id="refresh-interval"
        value={intervalSeconds}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {INTERVALS.map((interval) => (
          <option
            key={interval.seconds}
            value={interval.seconds}
            disabled={disabledIntervals.includes(interval.seconds)}
          >
            {interval.label}
          </option>
        ))}
      </select>
    </>
  );
}
