import { etfs } from "../../../shared/etfs";
import type { Locale } from "../../shared/locale";
export { etfs, groups, type EtfGroup } from "../../../shared/etfs";
export function etfName(symbol: string, locale: Locale) {
  return etfs.find((etf) => etf.symbol === symbol)?.[locale] ?? symbol;
}
