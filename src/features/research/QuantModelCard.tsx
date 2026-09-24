import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale } from "../../shared/locale";
import { useStatusLabel, type EvidenceStatus } from "./ModelTables";
import type { QuantModelId } from "./quantModelText";

export interface ModelSection {
  key: string;
  title: string;
  content: ReactNode;
}
const pad = (n: number) => String(n).padStart(2, "0");
/** Collapsible model shell; the header is one large toggle and the body carries its own contents list. */
export function QuantModelCard({
  id,
  index,
  eyebrow,
  title,
  status,
  summary,
  signal,
  intro,
  notice,
  sections,
  open,
  onToggle,
}: {
  id: QuantModelId;
  index: number;
  eyebrow: string;
  title: string;
  status: EvidenceStatus | undefined;
  summary?: ReactNode;
  signal?: string;
  intro: string;
  notice?: ReactNode;
  sections: ModelSection[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const statusLabel = useStatusLabel();
  return (
    <article
      id={`model-${id}`}
      className={`quant-model${open ? " is-open" : ""}`}
      aria-labelledby={`${id}-heading`}
    >
      <header className="quant-model-heading">
        <span className="quant-model-number" aria-hidden="true">
          {pad(index)}
        </span>
        <div className="quant-model-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h4 id={`${id}-heading`}>
            <button
              type="button"
              className="quant-model-toggle"
              aria-expanded={open}
              aria-controls={`${id}-body`}
              onClick={onToggle}
            >
              {title}
            </button>
          </h4>
          {summary && <p className="quant-model-summary">{summary}</p>}
        </div>
        <div className="quant-model-badges">
          {signal && <span className="quant-signal">{signal}</span>}
          <span className={`quant-evidence ${status ?? "insufficient"}`}>
            {statusLabel(status)}
          </span>
          <ChevronDown
            className="quant-model-chevron"
            size={20}
            aria-hidden="true"
          />
        </div>
      </header>
      <div id={`${id}-body`} className="quant-model-body" hidden={!open}>
        {open && (
          <>
            <p className="quant-model-intro">{intro}</p>
            {notice}
            <nav
              className="quant-model-toc"
              aria-label={t(
                `Model ${pad(index)} contents`,
                `模型 ${pad(index)} 目录`,
              )}
            >
              <span>{t("In this model", "本模型目录")}</span>
              <ol>
                {sections.map((s, i) => (
                  <li key={s.key}>
                    <a href={`#${id}-${s.key}`}>
                      <small aria-hidden="true">{pad(i + 1)}</small>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            {sections.map((s, i) => (
              <section
                key={s.key}
                id={`${id}-${s.key}`}
                className="quant-model-item"
                aria-labelledby={`${id}-${s.key}-heading`}
              >
                <h5 id={`${id}-${s.key}-heading`}>
                  <span aria-hidden="true">{pad(i + 1)}</span> {s.title}
                </h5>
                {s.content}
              </section>
            ))}
          </>
        )}
      </div>
    </article>
  );
}
