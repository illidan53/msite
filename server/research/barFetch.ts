import type { PriceBar } from "../../shared/types";
import { ApiError } from "../http/apiError";
import type { MarketDataProvider } from "../market/marketDataProvider";
import { closedBars } from "./quant";

export type HistorySource = Pick<MarketDataProvider, "getHistory">;

/**
 * Five years of completed daily bars (one-year fallback when the plan denies
 * the range), with one polite retry when the provider throttles.
 */
export async function fetchClosedBars(
  market: HistorySource,
  symbol: string,
  options: { retryDelayMs?: number; now?: Date } = {},
): Promise<PriceBar[]> {
  const get = async (range: "5y" | "1y") => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await market.getHistory({ symbol, range });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 429 || attempt >= 1)
          throw e;
        await new Promise((r) => setTimeout(r, options.retryDelayMs ?? 2000));
      }
    }
  };
  let series;
  try {
    series = await get("5y");
  } catch (e) {
    if (!(e instanceof ApiError) || ![400, 403].includes(e.status)) throw e;
    series = await get("1y");
  }
  const bars = closedBars(series.bars, options.now);
  if (bars.length < 2)
    throw new ApiError(422, "NO_HISTORY", "Insufficient completed bars");
  return bars;
}

/** Short failure codes shared by background jobs. */
export const fetchFailureCode = (e: unknown) =>
  e instanceof ApiError
    ? e.code === "NO_HISTORY"
      ? "NO_HISTORY"
      : `PROVIDER_${e.status}`
    : "FETCH_FAILED";
