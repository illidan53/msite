import type {
  ModelFit,
  ModelFitTier,
  ModelScan,
  QuantModelId,
} from "../../../shared/research";

export const tierOrder: ModelFitTier[] = [
  "high",
  "moderate",
  "low",
  "contrary",
  "insufficient",
];
export type SortKey =
  | "fit"
  | "symbol"
  | "score"
  | "lift"
  | "events"
  | "meanReturn"
  | "positiveRate"
  | "hitRate"
  | "reading"
  | "lastEvent";
export interface FitRow {
  symbol: string;
  lists: string[];
  asOf: string;
  fit: ModelFit;
  /** 1 = best fit for the selected model across the whole scan. */
  rank: number;
}

/** Tier first, then standardized advantage, then sample size. */
function compareFit(a: Omit<FitRow, "rank">, b: Omit<FitRow, "rank">) {
  return (
    tierOrder.indexOf(a.fit.tier) - tierOrder.indexOf(b.fit.tier) ||
    (b.fit.score ?? -Infinity) - (a.fit.score ?? -Infinity) ||
    b.fit.events - a.fit.events ||
    a.symbol.localeCompare(b.symbol)
  );
}
export function rankRows(scan: ModelScan, model: QuantModelId): FitRow[] {
  return scan.rows
    .map(({ symbol, lists, asOf, fits }) => ({
      symbol,
      lists,
      asOf,
      fit: fits[model],
    }))
    .sort(compareFit)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
const value = (row: FitRow, key: Exclude<SortKey, "fit">) =>
  key === "symbol" ? row.symbol : row.fit[key];
/** Missing values always sort last, whichever direction is chosen. */
export function sortRows(rows: FitRow[], key: SortKey, desc: boolean) {
  if (key === "fit")
    return [...rows].sort((a, b) => (desc ? a.rank - b.rank : b.rank - a.rank));
  return [...rows].sort((a, b) => {
    const x = value(a, key),
      y = value(b, key);
    if (x === null || y === null)
      return x === y ? a.rank - b.rank : x === null ? 1 : -1;
    const order =
      typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
    return (desc ? -order : order) || a.rank - b.rank;
  });
}
/**
 * One-sided false positives expected at the 95% interval's upper tail if no
 * symbol truly had an effect; symbols are not independent, so this is a guide.
 */
export const expectedByChance = (testable: number) => testable * 0.025;
