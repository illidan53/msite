import type { RecommendationCandidate } from "../../shared/types";

export interface TickerDetails {
  symbol: string;
  name?: string;
  marketCap?: number;
}

export interface RecommendationDataSource {
  getTickerDetails(symbol: string): Promise<TickerDetails>;
  getRelatedTickers(seed: string): Promise<string[]>;
  searchTickers(query: string): Promise<string[]>;
}

export interface RecommendInput {
  theme: string;
  pinnedSymbols: string[];
  excludedSymbols: string[];
  limit: number;
}

interface CandidateContext {
  fromRelated: boolean;
  fromSearch: boolean;
  isPinned: boolean;
  symbol: string;
}

interface ScoredCandidate extends RecommendationCandidate {
  sort: {
    isPinned: number;
    marketCap: number;
    themeRelevance: number;
  };
}

export class RecommendationService {
  constructor(private readonly source: RecommendationDataSource) {}

  async recommend(input: RecommendInput): Promise<RecommendationCandidate[]> {
    const theme = input.theme.trim();
    const pinned = uniqueSymbols(input.pinnedSymbols);
    const excluded = new Set(uniqueSymbols(input.excludedSymbols));

    const [related, searched] = await Promise.all([
      pinned[0] === undefined ? Promise.resolve<string[]>([]) : this.source.getRelatedTickers(pinned[0]),
      this.source.searchTickers(theme),
    ]);

    const contexts = mergeCandidates({
      excluded,
      pinned,
      related: uniqueSymbols(related),
      searched: uniqueSymbols(searched),
    });

    const candidates = await Promise.all(
      contexts.map(async (context): Promise<ScoredCandidate> => {
        const details = await this.source.getTickerDetails(context.symbol);
        const detailsSymbol = normalizeSymbol(details.symbol) ?? context.symbol;
        const marketCap = numericMarketCap(details.marketCap);
        const themeRelevance = scoreThemeRelevance(theme, details, context.fromSearch);
        const source = context.isPinned ? "pinned" : context.fromRelated ? "related" : "reference";
        const reasons = buildReasons({ context, marketCap, source, theme, themeRelevance });

        return {
          name: details.name,
          reasons,
          score: scoreCandidate({ isPinned: context.isPinned, marketCap, themeRelevance }),
          sort: {
            isPinned: context.isPinned ? 1 : 0,
            marketCap,
            themeRelevance,
          },
          source,
          symbol: detailsSymbol,
        };
      }),
    );

    return candidates
      .sort(compareCandidates)
      .slice(0, Math.max(0, Math.trunc(input.limit)))
      .map(({ sort: _sort, ...candidate }) => candidate);
  }
}

function mergeCandidates(input: {
  excluded: Set<string>;
  pinned: string[];
  related: string[];
  searched: string[];
}): CandidateContext[] {
  const bySymbol = new Map<string, CandidateContext>();

  for (const symbol of input.pinned) {
    if (!input.excluded.has(symbol)) {
      bySymbol.set(symbol, { fromRelated: false, fromSearch: false, isPinned: true, symbol });
    }
  }

  for (const symbol of input.related) {
    if (input.excluded.has(symbol)) {
      continue;
    }

    const existing = bySymbol.get(symbol);
    if (existing === undefined) {
      bySymbol.set(symbol, { fromRelated: true, fromSearch: false, isPinned: false, symbol });
    } else {
      existing.fromRelated = true;
    }
  }

  for (const symbol of input.searched) {
    if (input.excluded.has(symbol)) {
      continue;
    }

    const existing = bySymbol.get(symbol);
    if (existing === undefined) {
      bySymbol.set(symbol, { fromRelated: false, fromSearch: true, isPinned: false, symbol });
    } else {
      existing.fromSearch = true;
    }
  }

  return [...bySymbol.values()];
}

function uniqueSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.flatMap((symbol) => normalizeSymbol(symbol) ?? []))];
}

function normalizeSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  return normalized.length === 0 ? null : normalized;
}

function numericMarketCap(marketCap: number | undefined): number {
  return marketCap === undefined || !Number.isFinite(marketCap) || marketCap < 0 ? 0 : marketCap;
}

function scoreCandidate(input: { isPinned: boolean; marketCap: number; themeRelevance: number }): number {
  const pinnedScore = input.isPinned ? 1_000_000 : 0;
  const marketCapScore = Math.min(input.marketCap / 1_000_000_000, 10_000);
  return pinnedScore + marketCapScore + input.themeRelevance;
}

function scoreThemeRelevance(theme: string, details: TickerDetails, fromSearch: boolean): number {
  const normalizedTheme = theme.toLowerCase();
  const searchable = `${details.symbol} ${details.name ?? ""}`.toLowerCase();
  const themeTerms = themeTokens(normalizedTheme);
  const textMatches = themeTerms.filter((term) => searchable.includes(term)).length;

  return (fromSearch ? 5 : 0) + textMatches;
}

function themeTokens(theme: string): string[] {
  return [
    ...new Set(
      theme
        .split(/[^a-z0-9]+/)
        .flatMap((term) => {
          if (term.length < 3) {
            return [];
          }

          return term.endsWith("s") ? [term, term.slice(0, -1)] : [term];
        }),
    ),
  ];
}

function buildReasons(input: {
  context: CandidateContext;
  marketCap: number;
  source: RecommendationCandidate["source"];
  theme: string;
  themeRelevance: number;
}): string[] {
  const reasons: string[] = [];

  if (input.source === "pinned") {
    reasons.push("user pinned");
  }

  if (input.marketCap >= 100_000_000_000) {
    reasons.push("large market capitalization");
  }

  if (input.context.fromSearch || input.themeRelevance > 0) {
    reasons.push(`matches ${input.theme}`);
  }

  if (input.source === "related") {
    reasons.push("related candidate");
  }

  return reasons.length === 0 ? ["reference candidate"] : reasons;
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return (
    right.sort.isPinned - left.sort.isPinned ||
    right.sort.marketCap - left.sort.marketCap ||
    right.sort.themeRelevance - left.sort.themeRelevance ||
    left.symbol.localeCompare(right.symbol)
  );
}
