import { useEffect, useState } from "react";
import { Plus, Settings2, Trash2, Save } from "lucide-react";
import type {
  SubsectorEditorState,
  Watchlist,
  WatchlistsConfig,
} from "../../../shared/types";
import { ApiRequestError, requestJson } from "../../shared/apiClient";
import { useLocale } from "../../shared/locale";

export function SubsectorManager({
  watchlist,
  onSaved,
}: {
  watchlist: Watchlist;
  onSaved(lists: WatchlistsConfig): void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SubsectorEditorState | null>(null);
  const [saved, setSaved] = useState<SubsectorEditorState | null>(null);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reload, setReload] = useState(0);
  const endpoint = `/api/watchlists/${encodeURIComponent(watchlist.id)}/subsectors`;
  const dirty = JSON.stringify(state) !== JSON.stringify(saved);
  const current = state?.subsectors.find((s) => s.id === selected);
  const filtered = (state?.symbols ?? []).filter((symbol) =>
    symbol.toLowerCase().includes(query.trim().toLowerCase()),
  );
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    setError(null);
    setSuccess(false);
    requestJson<SubsectorEditorState>(endpoint)
      .then((data) => {
        if (!active) return;
        setState(data);
        setSaved(data);
        setSelected(data.subsectors[0]?.id ?? "");
        setConflict(false);
        setQuery("");
        setConfirmDelete(false);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "Unable to load sub-sectors. Please retry.",
              "无法加载子板块，请重试。",
            ),
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [open, endpoint, reload]);
  function update(patch: Partial<NonNullable<typeof current>>) {
    setState(
      (prev) =>
        prev && {
          ...prev,
          subsectors: prev.subsectors.map((s) =>
            s.id === selected ? { ...s, ...patch } : s,
          ),
        },
    );
    setSuccess(false);
    if (!conflict) setError(null);
  }
  async function save() {
    if (!state || busy) return;
    const subsectors = state.subsectors.map((s) => ({
      ...s,
      name: s.name.trim(),
      description: s.description?.trim(),
    }));
    if (
      subsectors.some((s) => !s.name) ||
      new Set(subsectors.map((s) => s.name.toLowerCase())).size !==
        subsectors.length
    ) {
      setError(
        t(
          "Give every sub-sector a unique, non-empty name.",
          "每个子板块都需要填写名称，且名称不能重复。",
        ),
      );
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await requestJson<{
        editor: SubsectorEditorState;
        watchlists: WatchlistsConfig;
      }>(endpoint, {
        method: "PUT",
        body: JSON.stringify({ revision: state.revision, subsectors }),
      });
      setState(result.editor);
      setSaved(result.editor);
      setSuccess(true);
      setConflict(false);
      onSaved(result.watchlists);
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.code : "";
      setConflict(code === "SUBSECTORS_CONFLICT");
      setError(
        code === "SUBSECTORS_CONFLICT"
          ? t(
              "Another edit changed this list. Reload the latest version before saving; your draft has not been published.",
              "列表已被其他操作更新。请重新加载最新版本后编辑；当前草稿尚未发布。",
            )
          : code === "RESEARCH_IP_FORBIDDEN"
            ? t(
                "Sign in as the site owner to save changes.",
                "请以站长账号登录后保存。",
              )
            : t(
                "Could not save sub-sectors. Your draft is still here; please retry.",
                "子板块保存失败，草稿已保留，请重试。",
              ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="subsector-management">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="subsector-manager"
        disabled={busy}
        onClick={() => {
          if (open) {
            setState(null);
            setSaved(null);
          }
          setOpen(!open);
        }}
      >
        <Settings2 size={15} aria-hidden="true" />
        {open
          ? dirty
            ? t("Discard and close", "放弃修改并关闭")
            : t("Close sub-sector manager", "关闭子板块管理")
          : t("Manage sub-sectors", "管理子板块")}
      </button>
      {open && (
        <div
          className="subsector-manager"
          id="subsector-manager"
          aria-busy={busy}
        >
          <h3>
            {t("Manage sub-sectors", "管理子板块")} · {t(watchlist.name)}
          </h3>
          <p>
            {t(
              "Saved changes are shared with every visitor and survive updates. Choose members from this shared list; stocks can belong to multiple sub-sectors. Empty sub-sectors are hidden from the filter bar. Quant System and Models are unchanged.",
              "保存后对所有访客生效，更新后仍保留。成员来自当前公共列表，可同时属于多个子板块；空子板块不显示在筛选栏中。量化系统和模型不受影响。",
            )}
          </p>
          {busy && <p role="status">{t("Working…", "正在处理…")}</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              {(conflict || !state) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReload((n) => n + 1)}
                >
                  {conflict
                    ? t("Discard draft and reload", "放弃草稿并加载最新版本")
                    : t("Retry", "重试")}
                </button>
              )}
            </div>
          )}
          {state && (
            <fieldset disabled={busy} className="subsector-manager-fields">
              <legend className="sr-only">
                {t("Sub-sector settings", "子板块设置")}
              </legend>
              <div className="subsector-manager-actions">
                <label>
                  {t("Sub-sector", "子板块")}
                  <select
                    aria-label={t("Choose sub-sector", "选择子板块")}
                    value={selected}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setQuery("");
                      setConfirmDelete(false);
                    }}
                  >
                    {!state.subsectors.length && (
                      <option value="">
                        {t("No sub-sectors yet", "还没有子板块")}
                      </option>
                    )}
                    {state.subsectors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {t(s.name) || t("Unnamed", "未命名")} (
                        {s.symbols.length})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={state.subsectors.length >= 30}
                  onClick={() => {
                    const id = `custom-${crypto.randomUUID()}`;
                    setState({
                      ...state,
                      subsectors: [
                        ...state.subsectors,
                        { id, name: "", symbols: [] },
                      ],
                    });
                    setSelected(id);
                    setQuery("");
                    setConfirmDelete(false);
                    setSuccess(false);
                  }}
                >
                  <Plus size={15} aria-hidden="true" />
                  {t("Add sub-sector", "新增子板块")}
                </button>
              </div>
              {current && (
                <>
                  <div className="subsector-manager-actions">
                    <label>
                      {t("Sub-sector name", "子板块名称")}
                      <input
                        value={current.name}
                        maxLength={80}
                        onChange={(event) =>
                          update({ name: event.target.value })
                        }
                      />
                    </label>
                    <label className="subsector-description">
                      {t("Description (optional)", "说明（可选）")}
                      <input
                        value={current.description ?? ""}
                        maxLength={240}
                        onChange={(event) =>
                          update({ description: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="subsector-manager-actions">
                    <label>
                      {t("Find members", "搜索成员")}
                      <input
                        value={query}
                        placeholder="NVDA"
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          symbols: [
                            ...new Set([...current.symbols, ...filtered]),
                          ],
                        })
                      }
                    >
                      {t("Select shown", "选中筛选结果")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          symbols: current.symbols.filter(
                            (symbol) => !filtered.includes(symbol),
                          ),
                        })
                      }
                    >
                      {t("Clear shown", "取消筛选结果")}
                    </button>
                    <span>
                      {t(
                        `${current.symbols.length} selected`,
                        `已选 ${current.symbols.length} 只`,
                      )}
                    </span>
                  </div>
                  <fieldset className="subsector-member-grid">
                    <legend>{t("Members", "成员")}</legend>
                    {filtered.map((symbol) => (
                      <label key={symbol}>
                        <input
                          type="checkbox"
                          checked={current.symbols.includes(symbol)}
                          onChange={(event) =>
                            update({
                              symbols: event.target.checked
                                ? [...current.symbols, symbol]
                                : current.symbols.filter((s) => s !== symbol),
                            })
                          }
                        />
                        {symbol}
                      </label>
                    ))}
                    {!filtered.length && (
                      <p>
                        {t(
                          "No matching symbols in this shared list.",
                          "当前公共列表中没有匹配的股票。",
                        )}
                      </p>
                    )}
                  </fieldset>
                  <button
                    type="button"
                    className="subsector-delete"
                    onClick={() => {
                      if (!confirmDelete) {
                        setConfirmDelete(true);
                        return;
                      }
                      const subsectors = state.subsectors.filter(
                        (s) => s.id !== selected,
                      );
                      setState({ ...state, subsectors });
                      setSelected(subsectors[0]?.id ?? "");
                      setConfirmDelete(false);
                      setSuccess(false);
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {confirmDelete
                      ? t(
                          "Confirm removing this sub-sector",
                          "确认移除此子板块",
                        )
                      : t("Remove sub-sector", "移除子板块")}
                  </button>
                  <small>
                    {t(
                      "Removing a sub-sector does not remove its stocks from the watchlist. Changes take effect only after saving.",
                      "移除子板块不会删除列表中的股票；所有修改在保存后才生效。",
                    )}
                  </small>
                </>
              )}
              <div className="subsector-manager-actions">
                <button
                  type="button"
                  disabled={!dirty || conflict}
                  onClick={() => void save()}
                >
                  <Save size={15} aria-hidden="true" />
                  {t("Save shared sub-sectors", "保存公共子板块")}
                </button>
                <span role="status">
                  {success
                    ? t("Saved for all visitors.", "已保存，所有访客均可见。")
                    : dirty
                      ? t("Unsaved changes", "有未保存的修改")
                      : ""}
                </span>
              </div>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
