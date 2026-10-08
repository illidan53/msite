import type { Bilingual } from "../../../shared/strategy";
import { useLocale } from "../../shared/locale";

type Value = number | null | undefined;
const finite = (v: Value): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

/** Locale-aware formatting for the Quant System; every missing value reads "—". */
export function useStrategyFormat() {
  const { t, locale } = useLocale();
  const tr = (text: Bilingual) => (locale === "zh" ? text.zh : text.en);
  const number = (v: Value, digits = 2, unit = "") =>
    finite(v)
      ? new Intl.NumberFormat(locale, {
          maximumFractionDigits: digits,
          minimumFractionDigits: digits,
        }).format(v) + unit
      : "—";
  /** Returns and differences read better with an explicit direction. */
  const signed = (v: Value, digits = 2, unit = "") =>
    finite(v)
      ? new Intl.NumberFormat(locale, {
          maximumFractionDigits: digits,
          minimumFractionDigits: digits,
          signDisplay: "exceptZero",
        }).format(v) + unit
      : "—";
  const pct = (v: Value, digits = 1) => number(v, digits, "%");
  const signedPct = (v: Value, digits = 1) => signed(v, digits, "%");
  /** Probabilities arrive as fractions (0–1). */
  const probability = (v: Value) => (finite(v) ? pct(v * 100, 1) : "—");
  const money = (v: Value, digits = 0) =>
    finite(v)
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: digits,
          minimumFractionDigits: digits,
        }).format(v)
      : "—";
  const shares = (v: Value) =>
    finite(v)
      ? new Intl.NumberFormat(locale, {
          maximumFractionDigits: 4,
          signDisplay: "exceptZero",
        }).format(v)
      : "—";
  const interval = (v: [number, number] | null, digits = 2) =>
    v ? `${signed(v[0], digits)} ~ ${signed(v[1], digits)}` : "—";
  /** Timestamps are shown on the scheduler's clock so everyone sees the same time. */
  const dateTime = (iso: string | null | undefined, timeZone?: string) => {
    if (!iso) return "—";
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
          // dateStyle cannot be combined with timeZoneName, so spell the fields out.
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone,
          timeZoneName: timeZone ? "short" : undefined,
        });
  };
  return {
    t,
    tr,
    locale,
    number,
    signed,
    pct,
    signedPct,
    probability,
    money,
    shares,
    interval,
    dateTime,
  };
}
export type StrategyFormat = ReturnType<typeof useStrategyFormat>;
