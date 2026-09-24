import { ChevronDown, ExternalLink } from "lucide-react";
import { useLocale } from "../../shared/locale";
import type { ModelNotes } from "./quantModelText";

/** Inline model rules: a scannable rule card, then the detailed notes as an accordion. */
export function ModelConsideration({ notes }: { notes: ModelNotes }) {
  const { t, locale } = useLocale();
  const i = locale === "zh" ? 1 : 0;
  return (
    <div
      className="model-consideration"
      lang={locale === "zh" ? "zh-CN" : "en"}
    >
      <dl className="model-spec">
        {notes.spec.map((row) => (
          <div key={row.term[0]}>
            <dt>{row.term[i]}</dt>
            <dd>{row.value[i]}</dd>
          </div>
        ))}
      </dl>
      <div className="model-notes">
        {notes.notes.map((note, n) => (
          <details key={note.title[0]}>
            <summary>
              <span aria-hidden="true">{String(n + 1).padStart(2, "0")}</span>
              <strong>{note.title[i]}</strong>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <p>{note.body[i]}</p>
          </details>
        ))}
      </div>
      <p className="model-sources">
        <span>{t("References", "参考资料")}</span>
        {notes.sources.map((source) => (
          <a
            key={source.href}
            href={source.href}
            target="_blank"
            rel="noreferrer"
          >
            {source.label[i]}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ))}
      </p>
    </div>
  );
}
