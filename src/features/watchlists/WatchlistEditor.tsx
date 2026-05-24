import { useMemo, useState } from "react";
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

  const pinnedSymbols = useMemo(() => normalizeSymbols(pinnedSymbolText), [pinnedSymbolText]);
  const selectedCandidateSymbols = useMemo(
    () =>
      uniqueUppercaseSymbols(
        candidates.flatMap((candidate) => (selectedSymbols.includes(candidate.symbol) ? [candidate.symbol] : [])),
      ),
    [candidates, selectedSymbols],
  );
  const canSave = name.trim().length > 0 && (selectedCandidateSymbols.length > 0 || pinnedSymbols.length > 0);

  if (!open) {
    return null;
  }

  async function handleRecommend() {
    setIsRecommending(true);
    setErrorMessage(null);

    try {
      const nextCandidates = await recommend({
        theme: theme.trim(),
        pinnedSymbols,
        excludedSymbols: [],
        limit: 8,
      });

      setCandidates(nextCandidates);
      setSelectedSymbols(nextCandidates.flatMap((candidate) => (candidate.source === "pinned" ? [candidate.symbol] : [])));
    } catch (error: unknown) {
      setCandidates([]);
      setSelectedSymbols([]);
      setErrorMessage(formatErrorMessage(error, "Unable to load recommendations."));
    } finally {
      setIsRecommending(false);
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
  }

  return (
    <div role="dialog" aria-label="Watchlist editor" aria-modal="true" className="watchlist-editor">
      <div className="watchlist-editor-header">
        <h2>Watchlist editor</h2>
        <button type="button" onClick={onClose}>
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
        <input id="watchlist-editor-name" value={name} onChange={(event) => setName(event.target.value)} />

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
        <button type="button" onClick={handleRecommend} disabled={isRecommending}>
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
