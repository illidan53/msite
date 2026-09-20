import { Languages } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { chineseMessages } from "./messages";

export type Locale = "en" | "zh";
export type Translate = (english: string, chinese?: string) => string;
const LocaleContext = createContext<{
  locale: Locale;
  setLocale(locale: Locale): void;
  t: Translate;
}>({ locale: "en", setLocale: () => {}, t: (en) => en });
const storageKey = "msite-language";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "en" || saved === "zh") return saved;
    } catch {
      /* Storage can be disabled; switching still works in memory. */
    }
    return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
  });
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = locale === "zh" ? "股票观察台" : "Stock Workbench";
    try {
      window.localStorage.setItem(storageKey, locale);
    } catch {
      /* Optional persistence. */
    }
  }, [locale]);
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: ((en, zh) =>
        locale === "en" ? en : (zh ?? chineseMessages[en] ?? en)) as Translate,
    }),
    [locale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
export function useLocale() {
  return useContext(LocaleContext);
}
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <label className="language-switcher">
      <Languages size={17} aria-hidden="true" />
      <span>{t("Language")}</span>
      <select
        aria-label={t("Language")}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="zh" lang="zh-CN">
          简体中文
        </option>
      </select>
    </label>
  );
}
