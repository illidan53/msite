import type { MarketSnapshot, Watchlist } from "../../../shared/types";
import { newYorkDate } from "../../../shared/marketDate";

export interface WatchlistPerformance {
  changePercent: number | null;
  sessionDate: string | null;
  covered: number;
  total: number;
}

function snapshotDate(snapshot: MarketSnapshot): string | null {
  if (snapshot.sessionDate) return snapshot.sessionDate;
  return snapshot.timeframe !== "PREVIOUS_CLOSE" && snapshot.updatedAt
    ? newYorkDate(snapshot.updatedAt)
    : null;
}

export function watchlistPerformances(
  watchlists: Watchlist[],
  snapshots: Record<string, MarketSnapshot>,
): Record<string, WatchlistPerformance> {
  // A shared latest session keeps menu values comparable across watchlists.
  const sessionDate =
    Object.values(snapshots)
      .map(snapshotDate)
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1) ?? null;
  return Object.fromEntries(
    watchlists.map((watchlist) => {
      const symbols = [
        ...new Set(
          watchlist.rows
            .flatMap((row) => row.symbols)
            .map((symbol) => symbol.trim().toUpperCase())
            .filter(Boolean),
        ),
      ];
      const changes = symbols.flatMap((symbol) => {
        const snapshot = snapshots[symbol];
        const change =
          snapshot?.sessionChangePercent ?? snapshot?.changePercent;
        return snapshot &&
          sessionDate &&
          snapshotDate(snapshot) === sessionDate &&
          change != null &&
          Number.isFinite(change)
          ? [change]
          : [];
      });
      const average = changes.length
        ? changes.reduce((sum, change) => sum + change, 0) / changes.length
        : null;
      return [
        watchlist.id,
        {
          changePercent:
            average === null || !Number.isFinite(average)
              ? null
              : Math.round(average * 100) / 100,
          sessionDate,
          covered: changes.length,
          total: symbols.length,
        },
      ];
    }),
  );
}
