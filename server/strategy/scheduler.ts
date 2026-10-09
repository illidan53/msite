import type { RunRecord } from "../../shared/strategy";
import type { StrategyConfig } from "./config";
import { readJson, writeJsonAtomic } from "./store";

/**
 * In-process scheduler for the daily signal run and the weekly backtest
 * (spec §8). It is started only from server/index.ts behind
 * STRATEGY_SCHEDULER=on. All schedule times are New York wall-clock times
 * compared as "HH:MM" strings, so DST changes need no special cases; real
 * instants are only derived for retry spacing and the "next run" display.
 * State lives in one atomically written file so a restart (every deploy)
 * neither skips nor repeats a run.
 */

type Schedule = StrategyConfig["schedule"];
export type JobKind = "daily" | "backtest";

export const SCHEDULER_TICK_MS = 60_000;
/** Scheduled backtest attempts per weekly slot before waiting for the next one. */
export const BACKTEST_ATTEMPTS = 3;

interface SchedulerFile {
  version: 1;
  lastDaily: RunRecord | null;
  lastBacktest: RunRecord | null;
  /** Scheduled daily attempts for one New York date. */
  daily: {
    date: string;
    attempts: number;
    lastAttemptAt: string;
    /** Succeeded (complete or skipped), or gave up after the last retry. */
    done: boolean;
    gaveUp: boolean;
  } | null;
  backtest: {
    completedAt: string | null;
    /** Weekly slot (ISO instant) the attempts below belong to. */
    slot: string | null;
    attempts: number;
    lastAttemptAt: string | null;
  };
}

const emptyState = (): SchedulerFile => ({
  version: 1,
  lastDaily: null,
  lastBacktest: null,
  daily: null,
  backtest: { completedAt: null, slot: null, attempts: 0, lastAttemptAt: null },
});
const isSchedulerFile = (v: unknown): v is SchedulerFile =>
  !!v &&
  typeof v === "object" &&
  (v as SchedulerFile).version === 1 &&
  !!(v as SchedulerFile).backtest &&
  typeof (v as SchedulerFile).backtest === "object";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const nyFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

/** New York wall clock: date "YYYY-MM-DD", time "HH:MM", weekday 0 = Sunday. */
export function newYorkClock(at: Date) {
  const p = Object.fromEntries(nyFormat.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: weekdays.indexOf(p.weekday),
  };
}

export function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The instant at which New York shows `date` `time`. Iterates on the offset
 * so either side of a DST change resolves; a wall time skipped by the spring
 * change resolves to the equivalent instant one hour later.
 */
export function newYorkInstant(date: string, time: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let k = 0; k < 3; k++) {
    const c = newYorkClock(new Date(guess));
    const [cy, cm, cd] = c.date.split("-").map(Number);
    const [ch, cmin] = c.time.split(":").map(Number);
    const diff = wall - Date.UTC(cy, cm - 1, cd, ch, cmin);
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Most recent weekly slot at or before `now`. */
function weeklySlot(now: Date, schedule: Schedule) {
  const clock = newYorkClock(now);
  let back = (clock.weekday - schedule.weeklyDay + 7) % 7;
  if (back === 0 && clock.time < schedule.weeklyAt) back = 7;
  const date = addDays(clock.date, -back);
  return { date, at: newYorkInstant(date, schedule.weeklyAt) };
}

const failure = (at: Date, e: unknown): RunRecord => ({
  at: at.toISOString(),
  trigger: "schedule",
  status: "failed",
  message: e instanceof Error ? e.message : String(e),
});

export interface SchedulerOptions {
  schedule: Schedule;
  /** `RESEARCH_DATA_DIR/strategy/scheduler.json` */
  file: string;
  now?: () => Date;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  runDaily: (trigger: "schedule") => Promise<RunRecord>;
  runBacktest: (trigger: "schedule") => Promise<RunRecord>;
  /** Called once per New York date when the daily run exhausts its retries. */
  onDailyGiveUp?: (record: RunRecord) => Promise<void>;
  /** Called once per weekly slot when the scheduled backtest exhausts its attempts. */
  onBacktestGiveUp?: (record: RunRecord) => Promise<void>;
}

export class StrategyScheduler {
  private now: () => Date;
  private loaded: Promise<SchedulerFile> | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }
  private get schedule() {
    return this.options.schedule;
  }
  private get retryMs() {
    return this.schedule.dailyRetryMinutes * 60_000;
  }
  private load() {
    this.loaded ??= readJson(this.options.file, isSchedulerFile).then(
      (s) => s ?? emptyState(),
      () => emptyState(),
    );
    return this.loaded;
  }
  private save(state: SchedulerFile) {
    return writeJsonAtomic(this.options.file, state);
  }

  start() {
    if (this.timer) return;
    const set = this.options.setInterval ?? setInterval;
    this.timer = set(() => void this.tick().catch(() => {}), SCHEDULER_TICK_MS);
    // Catch up right away after a restart instead of waiting a full tick.
    void this.tick().catch(() => {});
  }
  stop() {
    if (!this.timer) return;
    (this.options.clearInterval ?? clearInterval)(this.timer);
    this.timer = null;
  }

  /** Runs at most one due job; overlapping calls share the tick in flight. */
  tick(): Promise<void> {
    this.running ??= this.step().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async step() {
    const state = await this.load();
    const now = this.now();
    const clock = newYorkClock(now);
    const s = this.schedule;
    const today = state.daily?.date === clock.date ? state.daily : null;
    if (clock.time >= s.dailyAt && !today?.done) {
      if (!today) return this.attemptDaily(state, clock.date, now);
      if (clock.time >= s.dailyGiveUpAt) return this.giveUp(state, today, now);
      if (now.getTime() - Date.parse(today.lastAttemptAt) >= this.retryMs)
        return this.attemptDaily(state, clock.date, now);
    }
    const slot = weeklySlot(now, s).at;
    const bt = state.backtest;
    if (bt.completedAt && Date.parse(bt.completedAt) >= slot.getTime()) return;
    const attempts = bt.slot === slot.toISOString() ? bt.attempts : 0;
    if (attempts >= BACKTEST_ATTEMPTS) return;
    if (attempts > 0 && now.getTime() - Date.parse(bt.lastAttemptAt ?? "") < this.retryMs)
      return;
    return this.attemptBacktest(state, slot.toISOString(), attempts, now);
  }

  private async attemptDaily(state: SchedulerFile, date: string, now: Date) {
    const prior = state.daily?.date === date ? state.daily.attempts : 0;
    const daily = {
      date,
      attempts: prior + 1,
      lastAttemptAt: now.toISOString(),
      done: false,
      gaveUp: false,
    };
    state.daily = daily;
    // Persist the attempt first: a crash mid-run then waits for the retry
    // interval instead of re-running at once on the next boot.
    await this.save(state);
    let record: RunRecord;
    try {
      record = await this.options.runDaily("schedule");
    } catch (e) {
      record = failure(this.now(), e);
    }
    state.lastDaily = record;
    if (record.status !== "failed") daily.done = true;
    await this.save(state);
  }

  private async giveUp(
    state: SchedulerFile,
    daily: NonNullable<SchedulerFile["daily"]>,
    now: Date,
  ) {
    daily.done = true;
    daily.gaveUp = true;
    const record: RunRecord =
      state.lastDaily?.status === "failed" &&
      newYorkClock(new Date(state.lastDaily.at)).date === daily.date
        ? state.lastDaily
        : failure(now, new Error("Daily run did not complete"));
    state.lastDaily = record;
    await this.save(state);
    await this.alert(this.options.onDailyGiveUp, record);
  }

  private async attemptBacktest(
    state: SchedulerFile,
    slot: string,
    attempts: number,
    now: Date,
  ) {
    state.backtest = {
      ...state.backtest,
      slot,
      attempts: attempts + 1,
      lastAttemptAt: now.toISOString(),
    };
    await this.save(state);
    let record: RunRecord;
    try {
      record = await this.options.runBacktest("schedule");
    } catch (e) {
      record = failure(this.now(), e);
    }
    state.lastBacktest = record;
    if (record.status !== "failed")
      state.backtest = { ...state.backtest, completedAt: this.now().toISOString(), attempts: 0 };
    await this.save(state);
    if (record.status === "failed" && attempts + 1 >= BACKTEST_ATTEMPTS)
      await this.alert(this.options.onBacktestGiveUp, record);
  }

  private async alert(hook: SchedulerOptions["onDailyGiveUp"], record: RunRecord) {
    try {
      await hook?.(record);
    } catch {
      // The alert is best effort; the failure is already recorded.
    }
  }

  /**
   * Records a manual run in the same state file. A successful manual daily
   * run after `dailyAt` counts as today's run (no retries or give-up alert);
   * a completed manual backtest satisfies the current weekly slot.
   */
  async record(kind: JobKind, record: RunRecord) {
    const state = await this.load();
    const now = this.now();
    if (kind === "daily") {
      state.lastDaily = record;
      const clock = newYorkClock(now);
      if (record.status !== "failed" && clock.time >= this.schedule.dailyAt) {
        const today = state.daily?.date === clock.date ? state.daily : null;
        state.daily = {
          date: clock.date,
          attempts: today?.attempts ?? 0,
          lastAttemptAt: today?.lastAttemptAt ?? now.toISOString(),
          done: true,
          gaveUp: today?.gaveUp ?? false,
        };
      }
    } else {
      state.lastBacktest = record;
      if (record.status !== "failed")
        state.backtest = { ...state.backtest, completedAt: now.toISOString(), attempts: 0 };
    }
    await this.save(state);
  }

  /** Last runs from the state file; next runs only while the scheduler is started. */
  async state(): Promise<{
    lastDaily: RunRecord | null;
    lastBacktest: RunRecord | null;
    nextDaily: string | null;
    nextBacktest: string | null;
  }> {
    const state = await this.load();
    const now = this.now();
    return {
      lastDaily: state.lastDaily,
      lastBacktest: state.lastBacktest,
      nextDaily: this.timer ? this.nextDaily(state, now) : null,
      nextBacktest: this.timer ? this.nextBacktest(state, now) : null,
    };
  }

  private nextDaily(state: SchedulerFile, now: Date) {
    const s = this.schedule;
    const clock = newYorkClock(now);
    const tomorrow = newYorkInstant(addDays(clock.date, 1), s.dailyAt).toISOString();
    if (clock.time < s.dailyAt) return newYorkInstant(clock.date, s.dailyAt).toISOString();
    const today = state.daily?.date === clock.date ? state.daily : null;
    if (!today) return now.toISOString();
    if (today.done || clock.time >= s.dailyGiveUpAt) return tomorrow;
    const retry = Date.parse(today.lastAttemptAt) + this.retryMs;
    return retry < newYorkInstant(clock.date, s.dailyGiveUpAt).getTime()
      ? new Date(Math.max(retry, now.getTime())).toISOString()
      : tomorrow;
  }

  private nextBacktest(state: SchedulerFile, now: Date) {
    const slot = weeklySlot(now, this.schedule);
    const next = newYorkInstant(addDays(slot.date, 7), this.schedule.weeklyAt).toISOString();
    const bt = state.backtest;
    if (bt.completedAt && Date.parse(bt.completedAt) >= slot.at.getTime()) return next;
    const attempts = bt.slot === slot.at.toISOString() ? bt.attempts : 0;
    if (attempts >= BACKTEST_ATTEMPTS) return next;
    if (attempts === 0) return now.toISOString();
    return new Date(
      Math.max(Date.parse(bt.lastAttemptAt ?? "") + this.retryMs, now.getTime()),
    ).toISOString();
  }
}
