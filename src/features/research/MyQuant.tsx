import { useEffect, useRef, useState } from "react";
import { RefreshCw, FlaskConical, ChevronsUpDown } from "lucide-react";
import {
  QUANT_MODELS_VERSION,
  type ResearchReport,
} from "../../../shared/research";
import { useLocale } from "../../shared/locale";
import { Ema200Model } from "./Ema200Model";
import { PullbackModel } from "./PullbackModel";
import { quantModelIds, type QuantModelId } from "./quantModelText";

const modelsReady = (report: ResearchReport) =>
  report.ema200Study?.version === 2 &&
  report.quantModels?.version === QUANT_MODELS_VERSION;
// Share an in-flight request across remounts (including React Strict Mode).
const pendingModels = new Map<string, Promise<ResearchReport>>();
function loadModel(id: string) {
  const pending = pendingModels.get(id);
  if (pending) return pending;
  const task = fetch(`/api/research/${id}/models`, { method: "POST" })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as ResearchReport;
      if (!modelsReady(next)) throw new Error("unavailable");
      return next;
    })
    .finally(() => pendingModels.delete(id));
  pendingModels.set(id, task);
  return task;
}
const storageKey = "msite-quant-open-models";
function savedOpen(): Set<QuantModelId> {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    );
    if (Array.isArray(saved))
      return new Set(quantModelIds.filter((id) => saved.includes(id)));
  } catch {
    /* Storage can be unavailable; fall back to the default layout. */
  }
  return new Set<QuantModelId>(["ema200"]);
}
/** Map a location hash such as #model-rsi2 or #rsi2-consideration to its model. */
function modelForHash(hash: string) {
  return quantModelIds.find(
    (id) => hash === `model-${id}` || hash.startsWith(`${id}-`),
  );
}
export function MyQuant({
  report,
  canRun,
  onLoaded,
}: {
  report: ResearchReport;
  canRun: boolean;
  onLoaded: (report: ResearchReport) => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ready = modelsReady(report);
  const study =
    report.ema200Study?.version === 2 ? report.ema200Study : undefined;
  const set =
    report.quantModels?.version === QUANT_MODELS_VERSION
      ? report.quantModels
      : undefined;
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(savedOpen);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  }, [onLoaded]);
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...open]));
    } catch {
      /* Optional persistence. */
    }
  }, [open]);
  useEffect(() => {
    const reveal = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const id = modelForHash(hash);
      if (!id) return;
      setOpen((current) =>
        current.has(id) ? current : new Set(current).add(id),
      );
      // The target only exists after the model body renders.
      requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView?.(),
      );
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  const asOf = report.sections.quant.asOf;
  useEffect(() => {
    if (ready || !canRun || report.status === "running" || !asOf) {
      setBusy(false);
      return;
    }
    let current = true;
    setBusy(true);
    setError("");
    void loadModel(report.id)
      .then((next) => {
        if (current) loaded.current(next);
      })
      .catch((e) => {
        if (current) setError(e instanceof Error ? e.message : "unknown");
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [report.id, report.status, asOf, ready, canRun, retry]);
  const toggle = (id: QuantModelId) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allOpen = quantModelIds.every((id) => open.has(id));
  const waiting = (
    <p className="quant-model-empty" role="status">
      {error
        ? t(
            "Results are unavailable until the model calculation succeeds.",
            "模型计算成功后才会显示结果。",
          )
        : busy || (canRun && asOf && report.status !== "running")
          ? t("Preparing model results…", "正在准备模型结果…")
          : !asOf || report.status === "running"
            ? t(
                "Model results will appear when the quantitative analysis is ready.",
                "量化分析完成后，模型结果会自动显示。",
              )
            : t("Model results are not available yet.", "模型结果暂不可用。")}
    </p>
  );
  return (
    <section
      id="research-my-quant"
      className="research-panel research-my-quant"
      aria-labelledby="my-quant-heading"
    >
      <header className="my-quant-heading">
        <div>
          <p className="eyebrow">
            {t("Your model workspace", "我的模型工作区")}
          </p>
          <h3 id="my-quant-heading">
            <FlaskConical size={23} aria-hidden="true" />
            {t("My Quant", "我的量化")}
          </h3>
          <p>
            {t(
              "Four pullback-and-rebound hypotheses with explicit rules and observed historical outcomes. Select a model to expand it.",
              "四个“回踩与反弹”假设，规则明确、历史效果可核查。点击模型展开查看。",
            )}
          </p>
        </div>
        <div className="my-quant-actions">
          <span className="my-quant-count">{t("04 models", "04 个模型")}</span>
          <button
            type="button"
            className="my-quant-toggle-all"
            onClick={() =>
              setOpen(allOpen ? new Set() : new Set(quantModelIds))
            }
          >
            <ChevronsUpDown size={15} aria-hidden="true" />
            {allOpen
              ? t("Collapse all", "全部收起")
              : t("Expand all", "全部展开")}
          </button>
        </div>
      </header>
      {error && (
        <div className="quant-model-error">
          <p role="alert">
            {error === "403"
              ? t("This IP cannot run the model.", "当前 IP 无权运行模型。")
              : error === "429"
                ? t(
                    "Calculation capacity reached; retry later.",
                    "计算频率已达上限，请稍后重试。",
                  )
                : t(
                    "Model calculation failed. Historical data may be unavailable; please retry.",
                    "模型计算失败，可能缺少历史行情，请重试。",
                  )}
          </p>
          {canRun && (
            <button
              className="quant-model-run"
              disabled={busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {t("Retry loading", "重新加载")}
            </button>
          )}
        </div>
      )}
      <div className="quant-model-list">
        <Ema200Model
          study={study}
          open={open.has("ema200")}
          onToggle={() => toggle("ema200")}
          notice={!study && waiting}
        />
        {(["sma50", "rsi2", "bollinger"] as const).map((id) => (
          <PullbackModel
            key={id}
            id={id}
            set={set}
            open={open.has(id)}
            onToggle={() => toggle(id)}
            notice={!set && waiting}
          />
        ))}
      </div>
    </section>
  );
}
