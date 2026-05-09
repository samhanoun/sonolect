import { create } from "zustand";
import { en, type LocaleKeys } from "./locales/en";
import { fr } from "./locales/fr";
import { ar } from "./locales/ar";
import { es } from "./locales/es";
import { de } from "./locales/de";

export type SupportedLocale = "en" | "fr" | "ar" | "es" | "de";

const locales: Record<SupportedLocale, Record<LocaleKeys, string>> = {
  en,
  fr,
  ar,
  es,
  de,
};

export type I18nState = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
};

export const useI18nStore = create<I18nState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => set({ locale }),
}));

/** Detect locale from navigator.language, fall back to 'en'. */
export function detectLocale(): SupportedLocale {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language?.toLowerCase() ?? "";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("ar")) return "ar";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("de")) return "de";
  return "en";
}

/** Manually override the active locale. */
export function setLocale(locale: SupportedLocale) {
  useI18nStore.getState().setLocale(locale);
}

/** Get the current locale value (non-reactive, for use outside React). */
export function getLocale(): SupportedLocale {
  return useI18nStore.getState().locale;
}

/**
 * Translation function factory. Returns the string for the given key
 * in the current locale. Supports simple {placeholder} interpolation.
 */
function createT(locale: SupportedLocale) {
  const strings = locales[locale];
  return function t(
    key: LocaleKeys,
    params?: Record<string, string | number>,
  ): string {
    let value: string = strings[key] ?? en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return value;
  };
}

/** React hook that returns a t() function reactive to locale changes. */
export function useT() {
  const locale = useI18nStore((state) => state.locale);
  return createT(locale);
}

export type { LocaleKeys };
