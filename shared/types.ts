export type PolygonPlan = "free" | "paid" | "custom";

export interface SettingsConfig {
  polygon: {
    plan: PolygonPlan;
    paidPlanName?: string;
    customCallsPerMinute?: number;
    warningThreshold: number;
    hardThreshold: number;
  };
}

export interface WatchlistRow {
  id: string;
  name: string;
  expandedByDefault: boolean;
  symbols: string[];
}

/**
 * A display-only filter over a watchlist's symbols (popular themes such as
 * optical modules). Unlike rows, subsectors may overlap and never affect the
 * Quant System books.
 */
export interface WatchlistSubsector {
  id: string;
  name: string;
  description?: string;
  symbols: string[];
}

export interface Watchlist {
  navigationGroup?: "primary" | "other";
  selectionNote?: string;
  selectionReviewedAt?: string;
  selectionSources?: Array<{
    label: string;
    url: string;
    kind: "company" | "discussion";
    publishedAt?: string;
  }>;
  id: string;
  name: string;
  description?: string;
  theme?: string;
  pinnedSymbols: string[];
  symbolDescriptions?: Record<string, string>;
  rows: WatchlistRow[];
  subsectors?: WatchlistSubsector[];
  /**
   * Set on the Owner Focus list, which is saved on the server rather than
   * in the YAML: every visitor sees it, and only the site owner (the
   * research IP allowlist) may edit it. `canEdit` is for this visitor.
   */
  ownerManaged?: { canEdit: boolean };
  /** Shared sub-sector management is restricted to the authenticated owner. */
  subsectorManaged?: { canEdit: boolean };
}

export interface WatchlistsConfig {
  watchlists: Watchlist[];
}

/** Response of adding or removing a watchlist symbol: the updated lists. */
export interface WatchlistEditResult {
  symbol: string;
  name?: string;
  watchlists: WatchlistsConfig;
}

export interface MarketSnapshot {
  symbol: string;
  name?: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  sessionChange: number | null;
  sessionChangePercent: number | null;
  sessionDate?: string | null;
  spanChange?: number | null;
  spanChangePercent?: number | null;
  volume: number | null;
  updatedAt: string | null;
  timeframe: "DELAYED" | "PREVIOUS_CLOSE" | "REAL-TIME" | "UNKNOWN";
}

export interface PriceBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceSeries {
  symbol: string;
  range: "1h" | "1d" | "5d" | "30d" | "3month" | "1y" | "5y";
  bars: PriceBar[];
}

export interface RatePlanEvaluation {
  status: "ok" | "warning" | "blocked";
  plan: PolygonPlan;
  intervalSeconds: number;
  estimatedCallsPerMinute: number;
  message: string;
  disabledIntervals: number[];
}

export interface SubsectorEditorState {
  symbols: string[];
  subsectors: WatchlistSubsector[];
  revision: string;
}
