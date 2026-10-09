import { useRef, useState, type Ref } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  ruleFamilies,
  type BookSnapshot,
  type SymbolChart,
  type SymbolRow,
} from "../../../shared/strategy";
import { familyLabels, ruleCatalog } from "../../../shared/strategyRules";
import { useStrategyFormat } from "./format";
import {
  FamilyBars,
  FamilyLegend,
  LatestGate,
  Pending,
  classNamer,
  type RunControls,
} from "./parts";
import { useResource } from "./strategyApi";
import { overlayLabels, reasonLabels } from "./strategyText";
import { SymbolStrategyChart } from "./SymbolStrategyChart";

type SortKey = "symbol" | "class" | "forecast" | "target" | "held";
type Status = "all" | "eligible" | "ineligible" | "held";
type Value = (r: SymbolRow) => number | string | null;
const sortValue: Record<Exclude<SortKey, "class">, Value> = {
  symbol: (r) => r.symbol,
  forecast: (r) => r.forecast,
  target: (r) => r.targetWeight,
  held: (r) => r.heldWeight,
};
function sortRows(
  rows: SymbolRow[],
  key: SortKey,
  desc: boolean,
  classLabel: (id: string) => string,
) {
  // Classes sort by the name shown, not the id.
  const value: Value =
    key === "class" ? (r) => classLabel(r.class) : sortValue[key];
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    // Missing values stay last in either direction.
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order =
      typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
    return (desc ? -order : order) || a.symbol.localeCompare(b.symbol);
  });
}

export function PositionsTab({
  book,
  controls,
}: {
  book: string;
  controls: RunControls;
}) {
  return (
    <LatestGate book={book} controls={controls}>
      {(snapshot) => <Positions key={book} snapshot={snapshot} />}
    </LatestGate>
  );
}

function Positions({ snapshot }: { snapshot: BookSnapshot }) {
  const { t, tr, number, signed, pct, shares } = useStrategyFormat();
  const [cls, setCls] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "target",
    desc: true,
  });
  const [picked, setPicked] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const classLabel = classNamer(snapshot.classes);
  const classes = [...new Set(snapshot.rows.map((r) => r.class))].sort(
    (a, b) => classLabel(a).localeCompare(classLabel(b)),
  );
  const visible = sortRows(
    snapshot.rows.filter(
      (r) =>
        (cls === "all" || r.class === cls) &&
        (status === "all" ||
          (status === "eligible" && r.eligible) ||
          (status === "ineligible" && !r.eligible) ||
          (status === "held" && r.heldShares > 0)),
    ),
    sort.key,
    sort.desc,
    classLabel,
  );
  const selected = snapshot.rows.find((r) => r.symbol === picked) ?? null;
  const eligible = snapshot.rows.filter((r) => r.eligible).length;
  function show(symbol: string) {
    setPicked(symbol);
    // Wait for the detail panel to render before scrolling to it.
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      }),
    );
  }
  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
    return (
      <th
        scope="col"
        aria-sort={
          active ? (sort.desc ? "descending" : "ascending") : undefined
        }
      >
        <button
          type="button"
          className="models-sort"
          onClick={() =>
            setSort((s) => ({
              key,
              desc:
                s.key === key ? !s.desc : key !== "symbol" && key !== "class",
            }))
          }
        >
          {label}
          <Icon size={13} aria-hidden="true" />
        </button>
      </th>
    );
  };
  return (
    <>
      <section
        className="research-panel"
        aria-labelledby="strategy-positions-heading"
      >
        <div className="models-section-heading">
          <div>
            <p className="eyebrow">
              {t(
                `Targets after the ${snapshot.asOf} close`,
                `${snapshot.asOf} 收盘后的目标仓位`,
              )}
            </p>
            <h3 id="strategy-positions-heading">
              {t("Positions & forecasts", "持仓与预测")}
            </h3>
          </div>
          <span className="research-meta" role="status">
            {t(
              `${visible.length} of ${snapshot.rows.length} shown · ${eligible} eligible`,
              `显示 ${visible.length} / ${snapshot.rows.length} 只 · ${eligible} 只合格`,
            )}
          </span>
        </div>
        <dl className="strategy-facts strategy-book-facts">
          <div>
            <dt>{t("IDM", "标的分散乘数 IDM")}</dt>
            <dd>{number(snapshot.idm, 2)}</dd>
          </div>
          <div>
            <dt>{t("FDM (book median)", "预测分散乘数 FDM（中位数）")}</dt>
            <dd>{number(snapshot.fdm, 2)}</dd>
          </div>
          <div>
            <dt>{t("Gross target", "目标总敞口")}</dt>
            <dd>{pct(snapshot.gross)}</dd>
          </div>
          <div>
            <dt>{t("Risk overlay", "风险叠加层")}</dt>
            <dd>
              × {number(snapshot.overlay.multiplier, 2)}
              <small>
                {snapshot.overlay.limit
                  ? t(
                      `Binding: ${overlayLabels[snapshot.overlay.limit].en}`,
                      `触发：${overlayLabels[snapshot.overlay.limit].zh}`,
                    )
                  : t("Not binding", "未触发")}
              </small>
            </dd>
          </div>
        </dl>
        <div className="models-filters">
          <label>
            {t("Class", "类别")}
            <select value={cls} onChange={(e) => setCls(e.target.value)}>
              <option value="all">{t("All classes", "全部类别")}</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {classLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Status", "状态")}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              <option value="all">{t("All symbols", "全部标的")}</option>
              <option value="eligible">{t("Eligible", "合格")}</option>
              <option value="ineligible">{t("Ineligible", "不合格")}</option>
              <option value="held">{t("Held in paper", "模拟持有")}</option>
            </select>
          </label>
        </div>
        <FamilyLegend />
        <div
          className="ema-table-wrap models-table-wrap strategy-table-wrap"
          tabIndex={0}
        >
          <table aria-label={t("Positions", "持仓")}>
            <thead>
              <tr>
                {header("symbol", t("Symbol", "代码"))}
                {header("class", t("Class", "类别"))}
                {header("forecast", t("Forecast", "预测值"))}
                <th scope="col">{t("Families", "规则族")}</th>
                {header("target", t("Target", "目标权重"))}
                {header("held", t("Held", "持有权重"))}
                <th scope="col">{t("Status", "状态")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.symbol}
                  className={`strategy-row${r.symbol === picked ? " is-selected" : ""}`}
                  onClick={() => show(r.symbol)}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="models-symbol"
                      aria-pressed={r.symbol === picked}
                      aria-label={t(
                        `Show ${r.symbol} chart`,
                        `查看 ${r.symbol} 图表`,
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        show(r.symbol);
                      }}
                    >
                      {r.symbol}
                    </button>
                  </th>
                  <td>{classLabel(r.class)}</td>
                  <td
                    className={
                      r.forecast !== null && r.forecast < 0
                        ? "strategy-negative"
                        : undefined
                    }
                  >
                    {signed(r.forecast, 1)}
                  </td>
                  <td>
                    <FamilyBars families={r.families} />
                  </td>
                  <td>{pct(r.targetWeight, 2)}</td>
                  <td>
                    {pct(r.heldWeight, 2)}
                    {r.heldShares > 0 && <small>{shares(r.heldShares)}</small>}
                  </td>
                  <td>
                    {r.eligible ? (
                      <span className="research-status complete">
                        {t("Eligible", "合格")}
                      </span>
                    ) : (
                      <span className="research-status">
                        {r.reason
                          ? tr(reasonLabels[r.reason])
                          : t("Ineligible", "不合格")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <p className="models-none">
              {t("No symbols match these filters.", "没有符合筛选条件的标的。")}
            </p>
          )}
        </div>
        <p className="research-meta">
          {t(
            "Forecasts are combined signed and capped at ±20; the long-only book holds max(0, forecast). Target weight = average weight × forecast ÷ 10 after the risk overlay. Select a row for its chart and rule breakdown.",
            "预测值带符号组合并截断在 ±20；只做多组合持有 max(0, 预测值)。目标权重 = 平均权重 × 预测值 ÷ 10（已计入风险叠加层）。点击任一行查看图表与规则拆解。",
          )}
        </p>
      </section>
      {selected && (
        <SymbolDetail
          ref={detailRef}
          book={snapshot.book}
          row={selected}
          classLabel={classLabel(selected.class)}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}

function SymbolDetail({
  ref,
  book,
  row,
  classLabel,
  onClose,
}: {
  ref: Ref<HTMLElement>;
  book: string;
  row: SymbolRow;
  classLabel: string;
  onClose: () => void;
}) {
  const { t, tr, number, signed, pct, shares } = useStrategyFormat();
  const path = `/strategy/charts/${encodeURIComponent(book)}/${encodeURIComponent(row.symbol)}`;
  const chart = useResource<SymbolChart>(path);
  return (
    <section
      ref={ref}
      className="research-panel strategy-detail"
      aria-labelledby="strategy-detail-heading"
    >
      <div className="models-section-heading">
        <div>
          <p className="eyebrow">{classLabel}</p>
          <h3 id="strategy-detail-heading">{row.symbol}</h3>
        </div>
        <button type="button" onClick={onClose}>
          {t("Close", "关闭")}
        </button>
      </div>
      <div className="ema-stat-grid strategy-kpis">
        <div>
          <span>{t("Combined forecast", "组合预测值")}</span>
          <strong>{signed(row.forecast, 1)}</strong>
          <small>FDM {number(row.fdm, 2)}</small>
        </div>
        <div>
          <span>{t("Target weight", "目标权重")}</span>
          <strong>{pct(row.targetWeight, 2)}</strong>
          <small>
            {t("At forecast 10:", "预测值为 10 时：")}{" "}
            {pct(row.averageWeight, 2)}
          </small>
        </div>
        <div>
          <span>{t("Held", "持有")}</span>
          <strong>{pct(row.heldWeight, 2)}</strong>
          <small>
            {shares(row.heldShares)} {t("shares", "股")}
          </small>
        </div>
        <div>
          <span>{t("Volatility σ", "波动率 σ")}</span>
          <strong>{pct(row.sigma)}</strong>
          <small>
            {t("Instrument weight", "标的权重")} {pct(row.instrumentWeight, 2)}
          </small>
        </div>
      </div>
      {chart?.status === "ready" ? (
        <SymbolStrategyChart chart={chart.value} />
      ) : (
        <Pending path={path} resource={chart} label={t("chart", "图表")} />
      )}
      <details className="models-method" open>
        <summary>{t("Rule forecasts", "各规则预测值")}</summary>
        <div
          className="ema-table-wrap strategy-table-wrap strategy-wrap"
          tabIndex={0}
        >
          <table
            aria-label={t(
              `${row.symbol} rule forecasts`,
              `${row.symbol} 各规则预测值`,
            )}
          >
            <thead>
              <tr>
                <th scope="col">{t("Rule", "规则")}</th>
                <th scope="col">{t("Forecast", "预测值")}</th>
                <th scope="col">{t("Weight", "权重")}</th>
              </tr>
            </thead>
            <tbody>
              {ruleFamilies.flatMap((family) =>
                ruleCatalog
                  .filter((rule) => rule.family === family)
                  .map((rule) => {
                    const filtered = row.costFiltered.includes(rule.id);
                    return (
                      <tr key={rule.id}>
                        <th scope="row">
                          {tr(rule.label)}
                          <small>{tr(familyLabels[family])}</small>
                        </th>
                        <td>
                          {signed(row.rules[rule.id] ?? null, 1)}
                          {filtered && (
                            <small>
                              {t(
                                "Too costly · not voting",
                                "成本过高 · 不参与",
                              )}
                            </small>
                          )}
                        </td>
                        <td>{number(rule.weight, 1, "%")}</td>
                      </tr>
                    );
                  }),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
