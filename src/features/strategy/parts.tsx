import type { ReactNode } from "react";
import { CalendarClock, Play, RefreshCw } from "lucide-react";
import {
  ruleFamilies,
  type BookSnapshot,
  type LatestSnapshot,
  type RuleFamily,
  type SignalAction,
} from "../../../shared/strategy";
import { familyLabels } from "../../../shared/strategyRules";
import { useStrategyFormat } from "./format";
import { actionLabels } from "./strategyText";
import { useResource, useRetry, type Resource } from "./strategyApi";

export type JobKind = "daily" | "backtest";
export type TabId = "overview" | "signals" | "positions" | "backtest" | "rules";
export const reportPath = (id: string) =>
  `/strategy/reports/${encodeURIComponent(id)}`;
export interface RunControls {
  canRun: boolean;
  busy: boolean;
  running: JobKind | null;
  run(job: JobKind): void;
}

export function RunButton({
  job,
  controls,
}: {
  job: JobKind;
  controls: RunControls;
}) {
  const { t } = useStrategyFormat();
  if (!controls.canRun) return null;
  return (
    <button
      type="button"
      className="research-run"
      disabled={controls.busy}
      onClick={() => controls.run(job)}
    >
      {job === "daily" ? (
        <Play size={16} aria-hidden="true" />
      ) : (
        <CalendarClock size={16} aria-hidden="true" />
      )}
      {controls.running === job
        ? t("Running…", "运行中…")
        : job === "daily"
          ? t("Run daily", "运行每日信号")
          : t("Run backtest", "运行回测")}
    </button>
  );
}

/** Loading and failure states for one lazily fetched resource. */
export function Pending<T>({
  path,
  resource,
  label,
}: {
  path: string;
  resource: Resource<T> | null;
  label: string;
}) {
  const { t } = useStrategyFormat();
  const retry = useRetry();
  if (!resource || resource.status === "ready") return null;
  if (resource.status === "loading")
    return (
      <p className="quant-model-empty" role="status">
        {t(`Loading ${label}…`, `正在加载${label}…`)}
      </p>
    );
  return (
    <div className="quant-model-error">
      <p role="alert">
        {t(`The ${label} could not be loaded.`, `${label}加载失败。`)}
      </p>
      <button type="button" onClick={() => retry(path)}>
        <RefreshCw size={15} aria-hidden="true" />
        {t("Retry", "重试")}
      </button>
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="research-empty strategy-empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export const latestPath = "/strategy/latest";
/** The latest daily snapshot for one book; 404 STRATEGY_NOT_RUN means no daily run yet. */
export function useLatestBook(book: string) {
  const resource = useResource<LatestSnapshot>(latestPath);
  const notRun = resource?.status === "error" && resource.error.status === 404;
  const snapshot: BookSnapshot | null =
    resource?.status === "ready"
      ? (resource.value.books.find((b) => b.book === book) ?? null)
      : null;
  return { resource, notRun, snapshot };
}

/** Gate for tabs built on the latest snapshot: loading, not-run and missing-book states. */
export function LatestGate({
  book,
  controls,
  children,
}: {
  book: string;
  controls: RunControls;
  children: (snapshot: BookSnapshot) => ReactNode;
}) {
  const { t } = useStrategyFormat();
  const { resource, notRun, snapshot } = useLatestBook(book);
  if (notRun)
    return (
      <Empty
        title={t("No daily run yet", "尚未运行每日信号")}
        action={<RunButton job="daily" controls={controls} />}
      >
        {t(
          "Signals, positions and the paper record appear after the first daily run. It runs automatically each weekday morning at 07:00 New York time, after the previous session is final.",
          "首次每日运行后，这里会显示信号、持仓和模拟交易记录。系统在每个交易日纽约时间早上 07:00（上一交易日数据定稿后）自动运行。",
        )}
      </Empty>
    );
  if (resource?.status !== "ready")
    return (
      <Pending
        path={latestPath}
        resource={resource}
        label={t("latest signals", "最新信号")}
      />
    );
  if (!snapshot)
    return (
      <Empty
        title={t(
          "This book is not in the latest run",
          "最新一次运行不包含该组合",
        )}
      >
        {t(
          "The book may have been added or re-enabled since the last daily run.",
          "该组合可能是在上次每日运行之后新增或重新启用的。",
        )}
      </Empty>
    );
  return <>{children(snapshot)}</>;
}

export function ActionBadge({ action }: { action: SignalAction }) {
  const { tr } = useStrategyFormat();
  return (
    <span className={`strategy-action ${action}`}>
      {tr(actionLabels[action])}
    </span>
  );
}

export const familyColors: Record<RuleFamily, string> = {
  trend: "#2a78d6",
  sector_trend: "#eb6834",
  relative_momentum: "#1baf7a",
  mean_reversion: "#eda100",
};
export function FamilyLegend() {
  const { tr, t } = useStrategyFormat();
  return (
    <ul
      className="strategy-legend"
      aria-label={t("Rule family colours", "规则族颜色")}
    >
      {ruleFamilies.map((f) => (
        <li key={f}>
          <span
            className="strategy-swatch"
            style={{ background: familyColors[f] }}
            aria-hidden="true"
          />
          {tr(familyLabels[f])}
        </li>
      ))}
    </ul>
  );
}
/** Four tiny bars, one per family, growing up for long and down for short forecasts. */
export function FamilyBars({
  families,
}: {
  families: Record<RuleFamily, number | null>;
}) {
  const { tr, signed } = useStrategyFormat();
  const label = ruleFamilies
    .map((f) => `${tr(familyLabels[f])} ${signed(families[f], 1)}`)
    .join(" · ");
  return (
    <svg
      className="strategy-family-bars"
      width="76"
      height="32"
      viewBox="0 0 64 28"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <line x1="0" x2="64" y1="14" y2="14" stroke="var(--border)" />
      {ruleFamilies.map((f, i) => {
        const v = families[f];
        if (v === null || !Number.isFinite(v)) return null;
        const h = (Math.min(20, Math.abs(v)) / 20) * 13;
        return (
          <rect
            key={f}
            x={2 + i * 16}
            width="12"
            y={v >= 0 ? 14 - h : 14}
            height={Math.max(1, h)}
            rx="2"
            fill={familyColors[f]}
          />
        );
      })}
    </svg>
  );
}
