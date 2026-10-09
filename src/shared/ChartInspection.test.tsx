import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChartInspection } from "./ChartInspection";

/** Weekday dates from `start`, `count` of them; holidays do not matter here. */
function sessions(start: string, count: number) {
  const out: string[] = [];
  const day = new Date(`${start}T12:00:00Z`);
  while (out.length < count) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6)
      out.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}
/** Tick labels of a 900-unit-wide axis (12 ticks at the MM-DD spacing). */
function ticks(dates: string[]) {
  return axis(dates).map((t) => t.label);
}
function axis(dates: string[]) {
  const last = Math.max(1, dates.length - 1);
  const { container } = render(
    <svg viewBox="0 0 1000 300">
      <ChartInspection
        dates={dates}
        x={(i) => 40 + (i / last) * 900}
        top={10}
        bottom={260}
        labelY={285}
        describe={() => []}
      />
    </svg>,
  );
  return [...container.querySelectorAll(".chart-inspection text")].map(
    (t) => ({ label: t.textContent, x: Number(t.getAttribute("x")) }),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 2025-10-07 to 2026-10-07 is exactly 365 days: MM-DD read "10-07" twice.
const year = sessions("2025-10-07", 300).filter((d) => d <= "2026-10-07");

it("labels a one-year window by month so its two ends differ", () => {
  expect(year.at(-1)).toBe("2026-10-07");
  const labels = ticks(year);
  expect(labels[0]).toBe("2025-10");
  expect(labels.at(-1)).toBe("2026-10");
  expect(labels.every((l) => /^\d{4}-\d{2}$/.test(l ?? ""))).toBe(true);
  // Two ticks in one month would print the same label twice.
  expect(new Set(labels).size).toBe(labels.length);
  // The wider YYYY-MM labels get more room, even beside the edge labels.
  const xs = axis(year).map((t) => t.x);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(110);
});

it("labels a sparse series spanning 365 days by month", () => {
  const sparse = year.filter((_, i) => i % 2 === 0 || i === year.length - 1);
  expect(sparse.length).toBeLessThan(250);
  const labels = ticks(sparse);
  expect(labels[0]).toBe("2025-10");
  expect(labels.at(-1)).toBe("2026-10");
});

it("labels 250+ sessions by month even when they span under 365 days", () => {
  const dates = sessions("2025-10-21", 252);
  const days = (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / 86400000;
  expect(days).toBeLessThan(365);
  const labels = ticks(dates);
  expect(labels[0]).toBe("2025-10");
  expect(labels.at(-1)).toBe(dates.at(-1)!.slice(0, 7));
  expect(new Set(labels).size).toBe(labels.length);
});

it("keeps month-day labels for shorter windows", () => {
  const dates = sessions("2026-05-01", 120);
  const labels = ticks(dates);
  expect(labels[0]).toBe("05-01");
  expect(labels.at(-1)).toBe(dates.at(-1)!.slice(5));
  expect(labels).toHaveLength(12);
});

it("labels multi-year windows by month and ends at the newest month", () => {
  const dates = sessions("2021-10-07", 1250);
  const labels = ticks(dates);
  expect(labels[0]).toBe("2021-10");
  expect(labels.at(-1)).toBe(dates.at(-1)!.slice(0, 7));
  expect(new Set(labels).size).toBe(labels.length);
});
