import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "../../shared/strategy";
import { opsConfig } from "./opsTestFrames";
import {
  newYorkClock,
  newYorkInstant,
  StrategyScheduler,
  type SchedulerOptions,
} from "./scheduler";

const schedule = opsConfig.schedule;
let dir: string;
let file: string;
let clock: number;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "msite-scheduler-"));
  file = join(dir, "strategy", "scheduler.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const set = (iso: string) => {
  clock = Date.parse(iso);
};
const now = () => new Date(clock);
const record = (status: RunRecord["status"], message?: string): RunRecord => ({
  at: now().toISOString(),
  trigger: "schedule",
  status,
  ...(message ? { message } : {}),
});

function make(overrides: Partial<SchedulerOptions> = {}) {
  const options = {
    schedule,
    file,
    now,
    runDaily: vi.fn(async () => record("complete")),
    runBacktest: vi.fn(async () => record("complete")),
    onDailyGiveUp: vi.fn(async () => {}),
    ...overrides,
  };
  return {
    scheduler: new StrategyScheduler(options),
    runDaily: vi.mocked(options.runDaily),
    runBacktest: vi.mocked(options.runBacktest),
    onDailyGiveUp: vi.mocked(options.onDailyGiveUp),
  };
}

/** Ticks once a minute from the current clock up to `until`. */
async function tickUntil(scheduler: StrategyScheduler, until: string) {
  const end = Date.parse(until);
  while (clock <= end) {
    await scheduler.tick();
    clock += 60_000;
  }
  clock = end;
}

/** Marks a backtest completed now so weekly runs are not due in daily tests. */
async function backtestDone(scheduler: StrategyScheduler) {
  await scheduler.record("backtest", { ...record("complete"), trigger: "manual" });
}

describe("New York clock", () => {
  it("reads wall-clock date, time and weekday across DST", () => {
    expect(newYorkClock(new Date("2026-10-08T11:00:00Z"))).toEqual({
      date: "2026-10-08",
      time: "07:00",
      weekday: 4,
    });
    expect(newYorkClock(new Date("2026-12-01T04:30:00Z"))).toEqual({
      date: "2026-11-30",
      time: "23:30",
      weekday: 1,
    });
    expect(newYorkClock(new Date("2026-10-09T04:00:00Z")).time).toBe("00:00");
  });
  it("converts wall-clock times back to instants on both sides of a change", () => {
    expect(newYorkInstant("2026-03-07", "07:00").toISOString()).toBe("2026-03-07T12:00:00.000Z");
    expect(newYorkInstant("2026-03-08", "07:00").toISOString()).toBe("2026-03-08T11:00:00.000Z");
    expect(newYorkInstant("2026-11-01", "07:00").toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(newYorkInstant("2026-10-31", "07:00").toISOString()).toBe("2026-10-31T11:00:00.000Z");
    // 02:30 does not exist on the spring-forward day; it resolves into the next hour.
    expect(newYorkInstant("2026-03-08", "02:30").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
});

describe("daily schedule", () => {
  it("runs once at 07:00 New York time and not again that day", async () => {
    set("2026-10-08T10:00:00Z"); // 06:00 EDT
    const { scheduler, runDaily, runBacktest } = make();
    await backtestDone(scheduler);
    await tickUntil(scheduler, "2026-10-08T10:59:00Z");
    expect(runDaily).not.toHaveBeenCalled();
    set("2026-10-08T11:00:00Z");
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(1);
    expect(runDaily).toHaveBeenCalledWith("schedule");
    await tickUntil(scheduler, "2026-10-09T03:59:00Z"); // 23:59 EDT
    expect(runDaily).toHaveBeenCalledTimes(1);
    expect(runBacktest).not.toHaveBeenCalled();
    set("2026-10-09T11:00:00Z");
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(2);
  });

  it("does not rerun after a restart on the same New York date", async () => {
    set("2026-10-08T11:00:00Z");
    const first = make();
    await backtestDone(first.scheduler);
    await first.scheduler.tick();
    expect(first.runDaily).toHaveBeenCalledTimes(1);
    set("2026-10-08T15:00:00Z");
    const second = make();
    await second.scheduler.tick();
    expect(second.runDaily).not.toHaveBeenCalled();
    expect((await second.scheduler.state()).lastDaily).toMatchObject({
      status: "complete",
      at: "2026-10-08T11:00:00.000Z",
    });
    // A skipped run (no new session) also counts as done.
    set("2026-10-09T11:05:00Z");
    second.runDaily.mockResolvedValueOnce(record("skipped"));
    await second.scheduler.tick();
    set("2026-10-09T12:00:00Z");
    await make().scheduler.tick();
    expect(second.runDaily).toHaveBeenCalledTimes(1);
  });

  it("catches up after downtime through the morning, even past the give-up time", async () => {
    set("2026-10-08T17:30:00Z"); // 13:30 EDT, booted after a long outage
    const { scheduler, runDaily, onDailyGiveUp } = make();
    await backtestDone(scheduler);
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(1);
    expect(onDailyGiveUp).not.toHaveBeenCalled();
  });

  it("retries every 30 minutes until 12:00, then gives up and alerts once", async () => {
    set("2026-10-08T10:30:00Z");
    const { scheduler, runDaily, onDailyGiveUp } = make();
    await backtestDone(scheduler);
    let calls = 0;
    runDaily.mockImplementation(async () => {
      calls += 1;
      if (calls % 2) throw new Error("Polygon 503");
      return record("failed", "fetch failed");
    });
    await tickUntil(scheduler, "2026-10-08T15:59:00Z"); // 07:00 → 11:59 EDT
    const attempts = runDaily.mock.results.length;
    expect(attempts).toBe(10); // 07:00, 07:30, … 11:30
    expect(onDailyGiveUp).not.toHaveBeenCalled();
    set("2026-10-08T16:00:00Z");
    await scheduler.tick();
    expect(onDailyGiveUp).toHaveBeenCalledTimes(1);
    expect(onDailyGiveUp).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", trigger: "schedule", message: "fetch failed" }),
    );
    await tickUntil(scheduler, "2026-10-08T23:00:00Z");
    expect(runDaily).toHaveBeenCalledTimes(10);
    expect(onDailyGiveUp).toHaveBeenCalledTimes(1);
    // A restart the same afternoon neither retries nor alerts again.
    const restarted = make();
    await restarted.scheduler.tick();
    expect(restarted.runDaily).not.toHaveBeenCalled();
    expect(restarted.onDailyGiveUp).not.toHaveBeenCalled();
    expect((await restarted.scheduler.state()).lastDaily).toMatchObject({ status: "failed" });
  });

  it("stops retrying once a retry succeeds", async () => {
    set("2026-10-08T11:00:00Z");
    const { scheduler, runDaily, onDailyGiveUp } = make();
    await backtestDone(scheduler);
    runDaily.mockResolvedValueOnce(record("failed", "x"));
    await tickUntil(scheduler, "2026-10-08T16:30:00Z");
    expect(runDaily).toHaveBeenCalledTimes(2);
    expect(onDailyGiveUp).not.toHaveBeenCalled();
    expect((await scheduler.state()).lastDaily?.status).toBe("complete");
  });

  it("records the give-up even when the alert itself fails", async () => {
    set("2026-10-08T15:45:00Z"); // 11:45 EDT
    const { scheduler, runDaily, onDailyGiveUp } = make({
      runDaily: vi.fn(async () => record("failed", "x")),
      onDailyGiveUp: vi.fn(async () => {
        throw new Error("mail down");
      }),
    });
    await backtestDone(scheduler);
    await tickUntil(scheduler, "2026-10-08T17:00:00Z");
    expect(runDaily).toHaveBeenCalledTimes(1);
    expect(onDailyGiveUp).toHaveBeenCalledTimes(1);
    const restarted = make();
    await restarted.scheduler.tick();
    expect(restarted.onDailyGiveUp).not.toHaveBeenCalled();
  });

  it("counts a successful manual run after 07:00 as today's run", async () => {
    set("2026-10-08T11:30:00Z");
    const { scheduler, runDaily } = make({ runDaily: vi.fn(async () => record("failed", "busy")) });
    await backtestDone(scheduler);
    await scheduler.tick();
    expect(runDaily).toHaveBeenCalledTimes(1);
    set("2026-10-08T11:40:00Z");
    await scheduler.record("daily", { ...record("complete"), trigger: "manual" });
    await tickUntil(scheduler, "2026-10-08T17:00:00Z");
    expect(runDaily).toHaveBeenCalledTimes(1);
    expect((await scheduler.state()).lastDaily?.trigger).toBe("manual");
  });

  it("follows 07:00 local time on DST change days", async () => {
    // Spring forward: 07:00 EDT is 11:00 UTC; the day before it is 12:00 UTC.
    set("2026-03-07T11:59:00Z");
    const spring = make();
    await backtestDone(spring.scheduler);
    await spring.scheduler.tick();
    expect(spring.runDaily).not.toHaveBeenCalled();
    set("2026-03-07T12:00:00Z");
    await spring.scheduler.tick();
    expect(spring.runDaily).toHaveBeenCalledTimes(1);
    await tickUntil(spring.scheduler, "2026-03-08T10:59:00Z");
    expect(spring.runDaily).toHaveBeenCalledTimes(1);
    set("2026-03-08T11:00:00Z");
    await spring.scheduler.tick();
    expect(spring.runDaily).toHaveBeenCalledTimes(2);

    // Fall back: 07:00 EST is 12:00 UTC; 11:00 UTC is only 06:00.
    await rm(file);
    set("2026-10-31T10:59:00Z");
    const fall = make();
    await backtestDone(fall.scheduler);
    await fall.scheduler.tick();
    expect(fall.runDaily).not.toHaveBeenCalled();
    set("2026-10-31T11:00:00Z");
    await fall.scheduler.tick();
    expect(fall.runDaily).toHaveBeenCalledTimes(1);
    await tickUntil(fall.scheduler, "2026-11-01T11:59:00Z");
    expect(fall.runDaily).toHaveBeenCalledTimes(1);
    set("2026-11-01T12:00:00Z");
    await fall.scheduler.tick();
    expect(fall.runDaily).toHaveBeenCalledTimes(2);
  });
});

describe("weekly schedule", () => {
  it("runs the backtest at Saturday 09:00 New York time", async () => {
    set("2026-10-07T15:00:00Z"); // Wednesday
    const { scheduler, runBacktest } = make();
    await backtestDone(scheduler);
    await tickUntil(scheduler, "2026-10-10T12:59:00Z"); // Saturday 08:59 EDT
    expect(runBacktest).not.toHaveBeenCalled();
    set("2026-10-10T13:00:00Z");
    await scheduler.tick();
    expect(runBacktest).toHaveBeenCalledTimes(1);
    expect(runBacktest).toHaveBeenCalledWith("schedule");
    await tickUntil(scheduler, "2026-10-12T12:00:00Z");
    expect(runBacktest).toHaveBeenCalledTimes(1);
    expect((await scheduler.state()).lastBacktest).toMatchObject({ status: "complete", trigger: "schedule" });
  });

  it("catches up on Sunday after Saturday downtime, once", async () => {
    set("2026-10-03T13:30:00Z"); // previous Saturday, after the slot
    const before = make();
    await backtestDone(before.scheduler);
    set("2026-10-11T14:00:00Z"); // Sunday 10:00 EDT, first boot since Friday
    const after = make();
    await after.scheduler.tick(); // the daily run goes first
    expect(after.runDaily).toHaveBeenCalledTimes(1);
    expect(after.runBacktest).not.toHaveBeenCalled();
    await after.scheduler.tick();
    expect(after.runBacktest).toHaveBeenCalledTimes(1);
    await tickUntil(after.scheduler, "2026-10-11T20:00:00Z");
    expect(after.runBacktest).toHaveBeenCalledTimes(1);
  });

  it("retries a failed backtest a few times per slot, then alerts once", async () => {
    set("2026-10-10T13:00:00Z");
    const onBacktestGiveUp = vi.fn(async () => {});
    const { scheduler, runBacktest } = make({
      runBacktest: vi.fn(async () => record("failed", "x")),
      onBacktestGiveUp,
    });
    await scheduler.record("daily", { ...record("complete"), trigger: "manual" });
    await tickUntil(scheduler, "2026-10-10T23:00:00Z");
    expect(runBacktest).toHaveBeenCalledTimes(3);
    expect(onBacktestGiveUp).toHaveBeenCalledTimes(1);
    expect(onBacktestGiveUp).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", message: "x" }));
    set("2026-10-17T13:00:00Z");
    await scheduler.record("daily", { ...record("complete"), trigger: "manual" });
    await scheduler.tick();
    expect(runBacktest).toHaveBeenCalledTimes(4);
  });
});

describe("scheduler lifecycle", () => {
  it("never runs two jobs at once", async () => {
    set("2026-10-10T13:00:00Z"); // daily and weekly both due
    let release!: () => void;
    const runDaily = vi.fn(
      () =>
        new Promise<RunRecord>((resolve) => {
          release = () => resolve(record("complete"));
        }),
    );
    const { scheduler, runBacktest } = make({ runDaily });
    const a = scheduler.tick();
    const b = scheduler.tick();
    await vi.waitFor(() => expect(runDaily).toHaveBeenCalledTimes(1));
    expect(runBacktest).not.toHaveBeenCalled();
    release();
    await Promise.all([a, b]);
    expect(runBacktest).not.toHaveBeenCalled();
    await scheduler.tick();
    expect(runBacktest).toHaveBeenCalledTimes(1);
    expect(runDaily).toHaveBeenCalledTimes(1);
  });

  it("ticks every minute once started, reports next runs and stops", async () => {
    set("2026-10-08T12:00:00Z"); // Thursday 08:00 EDT
    const setInterval = vi.fn(() => 42 as unknown as ReturnType<typeof globalThis.setInterval>);
    const clearInterval = vi.fn();
    const { scheduler, runDaily } = make({
      setInterval: setInterval as unknown as typeof globalThis.setInterval,
      clearInterval: clearInterval as unknown as typeof globalThis.clearInterval,
    });
    await backtestDone(scheduler);
    expect(await scheduler.state()).toMatchObject({ nextDaily: null, nextBacktest: null });
    scheduler.start();
    scheduler.start();
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    await scheduler.tick(); // the boot tick catches up at once
    expect(runDaily).toHaveBeenCalledTimes(1);
    expect(await scheduler.state()).toMatchObject({
      lastDaily: { status: "complete" },
      nextDaily: "2026-10-09T11:00:00.000Z",
      nextBacktest: "2026-10-10T13:00:00.000Z",
    });
    scheduler.stop();
    expect(clearInterval).toHaveBeenCalledWith(42);
    expect((await scheduler.state()).nextDaily).toBeNull();
  });

  it("reports pending retries and the next day across DST", async () => {
    set("2026-03-07T12:00:00Z");
    const setInterval = vi.fn(() => 1 as unknown as ReturnType<typeof globalThis.setInterval>);
    const { scheduler } = make({
      setInterval: setInterval as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      runDaily: vi.fn(async () => record("failed", "x")),
    });
    await backtestDone(scheduler);
    scheduler.start();
    await scheduler.tick();
    expect((await scheduler.state()).nextDaily).toBe("2026-03-07T12:30:00.000Z");
    set("2026-03-07T17:00:00Z");
    await scheduler.tick(); // gives up
    expect((await scheduler.state()).nextDaily).toBe("2026-03-08T11:00:00.000Z");
    scheduler.stop();
  });

  it("starts empty from a missing or corrupt state file and writes it atomically", async () => {
    set("2026-10-08T11:00:00Z");
    await make().scheduler.state().then((s) => expect(s.lastDaily).toBeNull());
    const { scheduler } = make();
    await scheduler.tick();
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toMatchObject({ version: 1, daily: { date: "2026-10-08", attempts: 1, done: true } });
    await writeFile(file, "{oops");
    const fresh = make();
    expect((await fresh.scheduler.state()).lastDaily).toBeNull();
  });
});
