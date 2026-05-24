import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RecommendationCandidate, Watchlist } from "../../../shared/types";
import type { RecommendWatchlistInput } from "../../shared/apiClient";

export interface WatchlistEditorProps {
  open: boolean;
  onClose(): void;
  onSave(watchlist: Watchlist): void | Promise<void>;
  recommend(input: RecommendWatchlistInput): Promise<RecommendationCandidate[]>;
}

export function WatchlistEditor({ open, onClose, onSave, recommend }: WatchlistEditorProps) {
  const [name, setName] = useState("");
  const [theme, setTheme] = useState("");
  const [pinnedSymbolText, setPinnedSymbolText] = useState("");
  const [candidates, setCandidates] = useState<RecommendationCandidate[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const recommendationRequestIdRef = useRef(0);
  const saveRequestIdRef = useRef(0);

  const pinnedSymbols = useMemo(() => normalizeSymbols(pinnedSymbolText), [pinnedSymbolText]);
  const selectedCandidateSymbols = useMemo(
    () =>
      uniqueUppercaseSymbols(
        candidates.flatMap((candidate) => (selectedSymbols.includes(candidate.symbol) ? [candidate.symbol] : [])),
      ),
    [candidates, selectedSymbols],
  );
  const canRecommend = theme.trim().length > 0 && !isRecommending;
  const canSave =
    name.trim().length > 0 && (selectedCandidateSymbols.length > 0 || pinnedSymbols.length > 0) && !isSaving;

  useEffect(() => {
    if (!open) {
      cancelPendingRequests();
      resetEditorState();
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }

    const activeElement = document.activeElement;
    previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    nameInputRef.current?.focus();
  }, [open]);

  useEffect(
    () => () => {
      cancelPendingRequests();
    },
    [],
  );

  if (!open) {
    return null;
  }

  async function handleRecommend() {
    if (!canRecommend) {
      return;
    }

    const requestId = recommendationRequestIdRef.current + 1;
    recommendationRequestIdRef.current = requestId;
    setIsRecommending(true);
    setErrorMessage(null);

    try {
      const nextCandidates = await recommend({
        theme: theme.trim(),
        pinnedSymbols,
        excludedSymbols: [],
        limit: 8,
      });

      if (requestId !== recommendationRequestIdRef.current) {
        return;
      }

      setCandidates(nextCandidates);
      setSelectedSymbols(nextCandidates.flatMap((candidate) => (candidate.source === "pinned" ? [candidate.symbol] : [])));
    } catch (error: unknown) {
      if (requestId !== recommendationRequestIdRef.current) {
        return;
      }

      setCandidates([]);
      setSelectedSymbols([]);
      setErrorMessage(formatErrorMessage(error, "Unable to load recommendations."));
    } finally {
      if (requestId === recommendationRequestIdRef.current) {
        setIsRecommending(false);
      }
    }
  }

  function handleCandidateSelection(symbol: string, checked: boolean) {
    setSelectedSymbols((current) => {
      if (checked) {
        return current.includes(symbol) ? current : [...current, symbol];
      }

      return current.filter((selectedSymbol) => selectedSymbol !== symbol);
    });
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    const normalizedName = name.trim();
    const symbols = selectedCandidateSymbols.length > 0 ? selectedCandidateSymbols : pinnedSymbols;
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await onSave({
        id: slugify(normalizedName),
        name: normalizedName,
        theme: theme.trim(),
        pinnedSymbols,
        rows: [
          {
            id: "recommended",
            name: "Recommended",
            expandedByDefault: true,
            symbols,
          },
        ],
      });
    } catch (error: unknown) {
      if (requestId !== saveRequestIdRef.current) {
        return;
      }

      setErrorMessage(formatErrorMessage(error, "Unable to save watchlist."));
    } finally {
      if (requestId === saveRequestIdRef.current) {
        setIsSaving(false);
      }
    }
  }

  function handleClose() {
    cancelPendingRequests();
    onClose();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      handleClose();
    }
  }

  function cancelPendingRequests() {
    recommendationRequestIdRef.current += 1;
    saveRequestIdRef.current += 1;
  }

  function resetEditorState() {
    setName("");
    setTheme("");
    setPinnedSymbolText("");
    setCandidates([]);
    setSelectedSymbols([]);
    setErrorMessage(null);
    setIsRecommending(false);
    setIsSaving(false);
  }

  return (
    <div role="dialog" aria-label="Watchlist editor" className="watchlist-editor" onKeyDown={handleDialogKeyDown}>
      <div className="watchlist-editor-header">
        <h2>Watchlist editor</h2>
        <button type="button" onClick={handleClose}>
          Close
        </button>
      </div>

      {errorMessage ? (
        <p role="alert" className="watchlist-editor-error">
          {errorMessage}
        </p>
      ) : null}

      <div className="watchlist-editor-fields">
        <label htmlFor="watchlist-editor-name">Name</label>
        <input
          id="watchlist-editor-name"
          ref={nameInputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <label htmlFor="watchlist-editor-theme">Theme</label>
        <input id="watchlist-editor-theme" value={theme} onChange={(event) => setTheme(event.target.value)} />

        <label htmlFor="watchlist-editor-pinned-symbols">Pinned symbols</label>
        <input
          id="watchlist-editor-pinned-symbols"
          value={pinnedSymbolText}
          onChange={(event) => setPinnedSymbolText(event.target.value)}
        />
      </div>

      <div className="watchlist-editor-actions">
        <button type="button" onClick={handleRecommend} disabled={!canRecommend}>
          Recommend
        </button>
        <button type="button" onClick={handleSave} disabled={!canSave}>
          Save
        </button>
      </div>

      {candidates.length > 0 ? (
        <fieldset className="watchlist-editor-candidates">
          <legend>Recommendations</legend>
          {candidates.map((candidate) => (
            <label key={candidate.symbol}>
              <input
                type="checkbox"
                checked={selectedSymbols.includes(candidate.symbol)}
                onChange={(event) => handleCandidateSelection(candidate.symbol, event.target.checked)}
              />
              <span>{candidate.symbol}</span>
              {candidate.name ? <span>{candidate.name}</span> : null}
              <span>{candidate.source}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

function normalizeSymbols(symbolText: string): string[] {
  return uniqueUppercaseSymbols(symbolText.split(","));
}

function uniqueUppercaseSymbols(symbols: string[]): string[] {
  return [
    ...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => symbol.length > 0)),
  ];
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length === 0 ? "untitled-watchlist" : slug;
}

function formatErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
