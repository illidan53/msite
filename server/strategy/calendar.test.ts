import { describe, expect, it } from "vitest";
import type { PriceBar } from "../../shared/types";
import {
  buildPanel,
  gather,
  isoWeek,
  monthStarts,
  ownSessions,
  scatter,
  weekEnds,
} from "./calendar";
import { expectSeries } from "./engineTestUtils";

const _ = NaN;
const bar = (timestamp: string, close: number): PriceBar => ({
  timestamp,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 1000,
});

describe("buildPanel", () => {
  const spy = [
    bar("2026-10-01T04:00:00.000Z", 10),
    bar("2026-10-02T04:00:00.000Z", 11),
    bar("2026-10-05T04:00:00.000Z", 12),
  ];
  it("uses the benchmark's New York sessions and NaN for missing dates", () => {
    const panel = buildPanel(
      {
        AAA: [
          bar("2026-10-02T19:59:00.000Z", 5),
          bar("2026-10-03T15:00:00.000Z", 6), // Saturday: not a benchmark session
          bar("2026-10-05T04:00:00.000Z", 7),
        ],
        SPY: spy,
        NONE: [bar("2026-09-30T04:00:00.000Z", 1)],
      },
      "SPY",
    );
    expect(panel.dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
    expect(panel.symbols).toEqual(["SPY", "AAA"]);
    expect(panel.index).toEqual({ SPY: 0, AAA: 1 });
    expect(panel.benchmark).toBe("SPY");
    expectSeries(panel.close[1], [_, 5, 7]);
    expectSeries(panel.open[1], [_, 4, 6]);
    expectSeries(panel.high[0], [11, 12, 13]);
    expectSeries(panel.low[0], [8, 9, 10]);
    expectSeries(panel.volume[1], [_, 1000, 1000]);
  });
  it("throws when the benchmark has no bars", () => {
    expect(() => buildPanel({ AAA: spy }, "SPY")).toThrow("SPY");
    expect(() => buildPanel({ SPY: [] }, "SPY")).toThrow("SPY");
  });
});

describe("session helpers", () => {
  it("maps own sessions to master positions and back", () => {
    const close = Float64Array.from([_, 2, _, 4, 5]);
    const own = ownSessions(close);
    expect([...own]).toEqual([1, 3, 4]);
    expect([...gather(close, own)]).toEqual([2, 4, 5]);
    expectSeries(scatter([20, 40, 50], own, 5), [_, 20, _, 40, 50]);
  });
  it("identifies ISO weeks by their Monday and finds week ends", () => {
    expect(isoWeek("2026-10-05")).toBe("2026-10-05");
    expect(isoWeek("2026-10-04")).toBe("2026-09-28");
    expect(isoWeek("2027-01-01")).toBe("2026-12-28");
    const dates = ["2026-09-30", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-12"];
    expect(weekEnds(dates)).toEqual([1, 3, 4]);
  });
  it("flags the first session of each month after the first date", () => {
    expect([...monthStarts(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"])]).toEqual([
      0, 0, 1, 0,
    ]);
  });
});
