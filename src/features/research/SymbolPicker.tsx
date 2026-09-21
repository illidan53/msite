import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale } from "../../shared/locale";
import type { ResearchReport } from "../../../shared/research";

type RecentReport = Pick<ResearchReport, "symbol" | "createdAt" | "status">;
export function SymbolPicker({
  value,
  onChange,
  disabled,
  reports,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  reports: RecentReport[];
}) {
  const { t } = useLocale(),
    id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState(false),
    [active, setActive] = useState(-1);
  const recent = [
    ...new Set(
      [...reports]
        .filter((r) => r.status === "complete" || r.status === "partial")
        .sort(
          (a, b) =>
            (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
        )
        .map((r) => r.symbol.trim().toUpperCase())
        .filter((s) => /^(?=.*[A-Z0-9])[A-Z0-9.-]{1,20}$/.test(s)),
    ),
  ].slice(0, 10);
  const options = filter
    ? recent.filter((s) => s.includes(value.trim().toUpperCase()))
    : recent;
  const expanded = open && !disabled;
  const select = (symbol: string) => {
    onChange(symbol);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  };
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  return (
    <div
      className="research-symbol-field"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <label htmlFor={id}>{t("Symbol", "标的代码")}</label>
      <div className="research-symbol-control">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-label={t("Symbol", "标的代码")}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            expanded && active >= 0 && options[active]
              ? `${id}-option-${active}`
              : undefined
          }
          value={value}
          onChange={(e) => {
            onChange(e.target.value.toUpperCase());
            setFilter(true);
            setOpen(true);
            setActive(-1);
          }}
          onClick={() => {
            setFilter(false);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!expanded) {
                setFilter(false);
                setOpen(true);
                setActive(e.key === "ArrowDown" ? 0 : recent.length - 1);
              } else
                setActive((n) =>
                  options.length
                    ? n < 0
                      ? e.key === "ArrowDown"
                        ? 0
                        : options.length - 1
                      : (n +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          options.length) %
                        options.length
                    : -1,
                );
            } else if (
              e.key === "Enter" &&
              expanded &&
              active >= 0 &&
              options[active]
            ) {
              e.preventDefault();
              select(options[active]);
            } else if (e.key === "Escape" && expanded) {
              e.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }}
          pattern="[A-Za-z0-9.\-]+"
          maxLength={20}
          required
          disabled={disabled}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="research-symbol-toggle"
          disabled={disabled}
          aria-label={t(
            "Choose a recently analyzed symbol",
            "选择最近分析的标的",
          )}
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          onClick={() => {
            setFilter(false);
            setOpen(!expanded);
            setActive(-1);
            input.current?.focus();
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {expanded && (
          <div className="research-symbol-dropdown">
            <p>
              {t(
                "Recently analyzed · or type any symbol",
                "最近分析 · 也可输入其他代码",
              )}
            </p>
            <ul
              id={`${id}-list`}
              role="listbox"
              aria-label={t("Recently analyzed symbols", "最近分析的标的")}
            >
              {options.map((symbol, index) => (
                <li
                  id={`${id}-option-${index}`}
                  key={symbol}
                  role="option"
                  aria-selected={active === index}
                  className={active === index ? "is-active" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(symbol)}
                >
                  {symbol}
                </li>
              ))}
            </ul>
            {!options.length && (
              <p role="status">
                {t(
                  "No recent match. Type a symbol and run analysis.",
                  "暂无匹配记录，可自行输入代码后运行分析。",
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
