import { useLocale } from "./locale";
import { Info, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MetricExplanation {
  title: string;
  meaning: string;
  formula: string;
  example: string;
  caveat: string;
  reading?: string;
}

export function MetricHelp({ metric }: { metric: MetricExplanation }) {
  const { locale, t } = useLocale();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="metric-info-button"
        aria-label={t(`About ${metric.title}`, `了解${metric.title}`)}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
      >
        <Info size={17} aria-hidden="true" />
      </button>
      {createPortal(
        <dialog
          ref={dialogRef}
          id={id}
          className="metric-help-dialog"
          aria-labelledby={`${id}-title`}
          lang={locale === "zh" ? "zh-CN" : "en"}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              dialogRef.current?.close();
          }}
        >
          <header className="metric-help-heading">
            <div>
              <p className="eyebrow">{t("Metric guide", "指标小课堂")}</p>
              <h2 id={`${id}-title`}>{metric.title}</h2>
            </div>
            <button
              type="button"
              className="metric-info-button"
              aria-label={t("Close metric guide", "关闭指标说明")}
              onClick={() => dialogRef.current?.close()}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <dl className="metric-help-content">
            {metric.reading && (
              <div>
                <dt>{t("How to read it", "数值怎么读")}</dt>
                <dd>{metric.reading}</dd>
              </div>
            )}
            <div>
              <dt>{t("What it means", "它告诉你什么")}</dt>
              <dd>{metric.meaning}</dd>
            </div>
            <div>
              <dt>{t("How it is calculated", "怎么算")}</dt>
              <dd className="metric-formula">{metric.formula}</dd>
            </div>
            <div>
              <dt>{t("Example · hypothetical data", "举个例子 · 假设数据")}</dt>
              <dd>{metric.example}</dd>
            </div>
            <div>
              <dt>{t("Keep in mind", "解读时留意")}</dt>
              <dd>{metric.caveat}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="metric-help-done"
            onClick={() => dialogRef.current?.close()}
          >
            {t("Got it", "明白了")}
          </button>
        </dialog>,
        document.body,
      )}
    </>
  );
}
