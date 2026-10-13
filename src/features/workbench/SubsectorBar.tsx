import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocale } from "../../shared/locale";

export interface SubsectorOption {
  /** null is the whole watchlist. */
  id: string | null;
  label: string;
  changePercent: number | null;
}

/**
 * One-row segmented bar: the highlight slides to the chosen subsector, and
 * the arrows (or ←/→ on a focused option) step to the neighbouring one. The
 * track scrolls sideways when the options do not fit.
 */
export function SubsectorBar({
  options,
  selectedId,
  onSelect,
}: {
  options: SubsectorOption[];
  selectedId: string | null;
  onSelect(id: string | null): void;
}) {
  const { t, locale } = useLocale();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ x: number; width: number }>();
  const index = Math.max(
    0,
    options.findIndex((option) => option.id === selectedId),
  );
  const selectedKey = String(options[index]?.id);
  // Option widths change with labels, the locale and the daily change values.
  const layoutKey = `${locale}|${options
    .map((option) => `${option.id}:${option.label}:${option.changePercent}`)
    .join("|")}`;

  useLayoutEffect(() => {
    const track = trackRef.current;
    const place = () => {
      const button = buttonRefs.current.get(selectedKey);
      if (!button) return;
      const next = { x: button.offsetLeft, width: button.offsetWidth };
      setIndicator((current) =>
        current?.x === next.x && current.width === next.width ? current : next,
      );
    };
    place();
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(track);
    return () => observer.disconnect();
  }, [selectedKey, layoutKey]);

  useLayoutEffect(() => {
    // Scroll only the track, never the page, to keep the choice visible.
    const track = trackRef.current;
    const button = buttonRefs.current.get(selectedKey);
    if (!track || !button) return;
    const left = button.offsetLeft - 8;
    const right = button.offsetLeft + button.offsetWidth + 8 - track.clientWidth;
    if (left < track.scrollLeft) track.scrollLeft = left;
    else if (right > track.scrollLeft) track.scrollLeft = right;
  }, [selectedKey]);

  function step(offset: number) {
    const next = options[index + offset];
    if (!next) return;
    onSelect(next.id);
    buttonRefs.current.get(String(next.id))?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  }

  return (
    <div
      className="subsector-bar"
      role="group"
      aria-label={t("Sub-sectors", "子板块")}
    >
      <button
        type="button"
        className="subsector-step"
        aria-label={t("Previous sub-sector", "上一个子板块")}
        disabled={index <= 0}
        onClick={() => step(-1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <div className="subsector-track" ref={trackRef}>
        {indicator && (
          <span
            className="subsector-indicator"
            aria-hidden="true"
            style={{
              width: indicator.width,
              transform: `translateX(${indicator.x}px)`,
            }}
          />
        )}
        {options.map((option) => (
          <button
            key={String(option.id)}
            ref={(node) => {
              if (node) buttonRefs.current.set(String(option.id), node);
              else buttonRefs.current.delete(String(option.id));
            }}
            type="button"
            className="subsector-option"
            aria-pressed={option.id === options[index]?.id}
            onClick={() => onSelect(option.id)}
            onKeyDown={handleKeyDown}
          >
            <span>{option.label}</span>
            {option.changePercent != null && (
              <small
                className={
                  option.changePercent > 0
                    ? "positive-change"
                    : option.changePercent < 0
                      ? "negative-change"
                      : undefined
                }
              >
                {option.changePercent > 0 ? "+" : ""}
                {option.changePercent.toFixed(2)}%
              </small>
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="subsector-step"
        aria-label={t("Next sub-sector", "下一个子板块")}
        disabled={index >= options.length - 1}
        onClick={() => step(1)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
