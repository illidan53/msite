import { Plus, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { Watchlist } from "../../../shared/types";
import { ApiRequestError } from "../../shared/apiClient";
import { useLocale, type Translate } from "../../shared/locale";

export interface WatchlistAddition {
  symbol: string;
  rowId: string;
  description?: string;
  subsectors?: string[];
}

export interface WatchlistEditStatus {
  kind: "success" | "error";
  message: string;
  /** Re-adds a symbol that was just removed. */
  undo?: WatchlistAddition;
}

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,11}$/;

export function WatchlistEditor({
  watchlist,
  defaultSubsectorId,
  busy,
  status,
  onAdd,
  onUndo,
  onReset,
}: {
  watchlist: Watchlist;
  /** The subsector being viewed; a new stock is tagged with it by default. */
  defaultSubsectorId: string | null;
  busy: boolean;
  status: WatchlistEditStatus | null;
  onAdd(addition: WatchlistAddition): Promise<boolean>;
  onUndo(addition: WatchlistAddition): void;
  /** Drops this browser's edits to the list (not offered for Owner Focus). */
  onReset(): void;
}) {
  const { t } = useLocale();
  const [symbol, setSymbol] = useState("");
  const [rowId, setRowId] = useState(watchlist.rows[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const subsectors = watchlist.ownerManaged ? [] : watchlist.subsectors ?? [];

  useEffect(() => {
    if (!confirmingReset) return;
    const timer = window.setTimeout(() => setConfirmingReset(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmingReset]);

  useEffect(() => {
    setRowId(watchlist.rows[0]?.id ?? "");
    setSymbol("");
    setDescription("");
    setInputError(null);
    setConfirmingReset(false);
  }, [watchlist.id]);

  useEffect(() => {
    setTags(defaultSubsectorId ? [defaultSubsectorId] : []);
  }, [watchlist.id, defaultSubsectorId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = symbol.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(normalized)) {
      setInputError(
        t(
          "Enter a ticker such as PLTR or BRK.B.",
          "请输入股票代码，例如 PLTR 或 BRK.B。",
        ),
      );
      return;
    }
    setInputError(null);
    const added = await onAdd({
      symbol: normalized,
      rowId,
      description: description.trim() || undefined,
      ...(!watchlist.ownerManaged && tags.length ? { subsectors: tags } : {}),
    });
    if (added) {
      setSymbol("");
      setDescription("");
      setTags(defaultSubsectorId ? [defaultSubsectorId] : []);
    }
  }

  return (
    <section
      className="watchlist-editor"
      aria-label={t("Edit watchlist", "编辑列表")}
    >
      <form className="watchlist-editor-form" onSubmit={handleSubmit}>
        <div className="control-field">
          <label htmlFor="watchlist-add-symbol">{t("Symbol")}</label>
          <input
            id="watchlist-add-symbol"
            value={symbol}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            placeholder="PLTR"
            aria-invalid={inputError ? true : undefined}
            aria-describedby={inputError ? "watchlist-add-error" : undefined}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
          />
        </div>
        {watchlist.rows.length > 1 && (
          <div className="control-field">
            <label htmlFor="watchlist-add-row">{t("Segment", "分组")}</label>
            <select
              id="watchlist-add-row"
              value={rowId}
              onChange={(event) => setRowId(event.target.value)}
            >
              {watchlist.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {t(row.name)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="control-field watchlist-editor-note-field">
          <label htmlFor="watchlist-add-description">
            {t("Business (optional)", "业务（可选）")}
          </label>
          <input
            id="watchlist-add-description"
            value={description}
            maxLength={160}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {subsectors.length > 0 && (
          <fieldset className="watchlist-editor-tags">
            <legend>{t("Sub-sectors (optional)", "子板块（可多选）")}</legend>
            {subsectors.map((subsector) => (
              <label key={subsector.id}>
                <input
                  type="checkbox"
                  checked={tags.includes(subsector.id)}
                  onChange={(event) =>
                    setTags((current) =>
                      event.target.checked
                        ? [...current, subsector.id]
                        : current.filter((id) => id !== subsector.id),
                    )
                  }
                />
                {t(subsector.name)}
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit" disabled={busy || !symbol.trim()}>
          <Plus size={14} aria-hidden="true" />
          {t("Add stock", "添加股票")}
        </button>
      </form>
      {inputError && (
        <p id="watchlist-add-error" className="watchlist-editor-error">
          {inputError}
        </p>
      )}
      <p
        className={`watchlist-editor-status ${status?.kind ?? ""}`}
        role="status"
        aria-live="polite"
      >
        {status?.message}
        {status?.undo && (
          <button
            type="button"
            className="watchlist-editor-undo"
            disabled={busy}
            onClick={() => status.undo && onUndo(status.undo)}
          >
            <Undo2 size={13} aria-hidden="true" />
            {t("Undo", "撤销")}
          </button>
        )}
      </p>
      <div className="watchlist-editor-footer">
        <p className="watchlist-editor-hint">
          {watchlist.ownerManaged
            ? t(
                "Saved on the server: every visitor sees this list, and it survives restarts and updates. Only the site owner can change it. The Quant System and Models do not use it.",
                "保存在服务器上：所有访问者都能看到，服务器重启或更新后仍保留。只有站长可以修改；量化系统和模型页不使用该列表。",
              )
            : t(
                "Changes apply to this browser only and are kept in the server's memory, so a server restart or update clears them. Other visitors, the Quant System and Models keep using the default lists.",
                "修改只对当前浏览器生效，暂存在服务器内存中，服务器重启或更新后会清空；其他访问者、量化系统和模型页仍使用默认列表。",
              )}
        </p>
        {!watchlist.ownerManaged && (
          <button
            type="button"
            className={`watchlist-reset ${confirmingReset ? "confirming" : ""}`}
            disabled={busy}
            onClick={() => {
              if (!confirmingReset) {
                setConfirmingReset(true);
                return;
              }
              setConfirmingReset(false);
              onReset();
            }}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {confirmingReset
              ? t("Click again to reset", "再点一次确认恢复")
              : t("Reset to default list", "恢复默认列表")}
          </button>
        )}
      </div>
    </section>
  );
}

export function watchlistEditErrorMessage(
  error: unknown,
  symbol: string,
  t: Translate,
): string {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  switch (code) {
    case "UNKNOWN_SYMBOL":
      return t(
        `No listed security matches ${symbol}.`,
        `找不到代码为 ${symbol} 的上市证券。`,
      );
    case "WATCHLIST_SYMBOL_EXISTS":
      return t(
        `${symbol} is already in this watchlist.`,
        `${symbol} 已在该列表中。`,
      );
    case "WATCHLIST_SYMBOL_NOT_FOUND":
      return t(
        `${symbol} is no longer in this watchlist.`,
        `${symbol} 已不在该列表中。`,
      );
    case "WATCHLIST_LAST_SYMBOL":
      return t(
        "A watchlist must keep at least one symbol.",
        "列表至少需要保留一只股票。",
      );
    case "WATCHLIST_ADD_LIMIT":
      return t(
        "This watchlist has reached its limit of added symbols.",
        "该列表新增的股票已达上限。",
      );
    case "BROWSER_ADD_LIMIT":
      return t(
        "This browser has reached its limit of added symbols. Remove some first.",
        "当前浏览器新增的股票已达上限，请先移除一些。",
      );
    case "SYMBOL_LOOKUP_FAILED":
      return t(
        "The symbol could not be verified right now. Try again shortly.",
        "暂时无法核验该代码，请稍后重试。",
      );
    case "RESEARCH_IP_FORBIDDEN":
      return t(
        "Only the site owner can change this list.",
        "只有站长可以修改这个列表。",
      );
    case "EDIT_RATE_LIMIT":
      return t(
        "Too many changes in a short time. Try again in a few minutes.",
        "短时间内修改次数过多，请几分钟后再试。",
      );
    case "WATCHLIST_SUBSECTOR_NOT_FOUND":
      return t(
        "A selected sub-sector no longer exists. Reload the page.",
        "所选子板块已不存在，请刷新页面。",
      );
    case "INVALID_WATCHLIST_EDIT":
      return t(
        "Enter a ticker such as PLTR or BRK.B.",
        "请输入股票代码，例如 PLTR 或 BRK.B。",
      );
    default:
      return t(
        "The watchlist could not be updated. Try again.",
        "列表更新失败，请重试。",
      );
  }
}
