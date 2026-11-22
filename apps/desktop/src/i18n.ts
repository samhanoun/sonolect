import { create } from "zustand";
import { en, type LocaleKeys } from "./locales/en";
import { fr } from "./locales/fr";
import { ar } from "./locales/ar";
import { es } from "./locales/es";
import { de } from "./locales/de";

export type SupportedLocale = "en" | "fr" | "ar" | "es" | "de";

/**
 * Locales the app launches with. Only these are complete, so only these are
 * auto-detected and offered in Settings. The others are partial groundwork
 * and fall back to English key by key.
 */
export const LAUNCH_LOCALES = ["en", "fr"] as const;
export type LaunchLocale = (typeof LAUNCH_LOCALES)[number];

/** Each launch locale's own name, as shown in the language picker. */
export const LOCALE_NAMES: Record<LaunchLocale, string> = {
  en: "English",
  fr: "Français",
};

const locales: Record<SupportedLocale, Partial<Record<LocaleKeys, string>>> = {
  en,
  fr,
  ar,
  es,
  de,
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && Object.hasOwn(locales, value);
}

export type I18nState = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
};

function applyDocumentLanguage(locale: SupportedLocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    applyDocumentLanguage(locale);
    set({ locale });
  },
}));
applyDocumentLanguage(useI18nStore.getState().locale);

/** Detect a launch locale from navigator.language, fall back to 'en'. */
export function detectLocale(
  language: string | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.language,
): LaunchLocale {
  const lang = language?.toLowerCase() ?? "";
  return (
    LAUNCH_LOCALES.find(
      (locale) => lang === locale || lang.startsWith(`${locale}-`),
    ) ?? "en"
  );
}

/** Manually override the active locale. */
export function setLocale(locale: SupportedLocale) {
  useI18nStore.getState().setLocale(locale);
}

/** Get the current locale value (non-reactive, for use outside React). */
export function getLocale(): SupportedLocale {
  return useI18nStore.getState().locale;
}

type Params = Record<string, string | number>;

/** Keys that come as a `.one` / `.other` pair, named by their shared stem. */
export type PluralKey = {
  [K in LocaleKeys]: K extends `${infer Stem}.other`
    ? `${Stem}.one` extends LocaleKeys
      ? Stem
      : never
    : never;
}[LocaleKeys];

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

const pluralRules = new Map<SupportedLocale, Intl.PluralRules>();
function pluralCategory(locale: SupportedLocale, count: number) {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count) === "one" ? "one" : "other";
}

export type Translator = {
  (key: LocaleKeys, params?: Params): string;
  /** The locale this translator renders, for dates and numbers. */
  locale: SupportedLocale;
  /**
   * Pick the singular or plural form for `count` in the active language and
   * fill `{count}` with the locale-formatted number.
   */
  count: (stem: PluralKey, count: number, params?: Params) => string;
  /**
   * Translate a status or error string that may be a locale key (the store
   * reports some errors by key). Anything else is returned unchanged.
   */
  message: (value: string) => string;
};

/**
 * Translation function factory. Returns the string for the given key
 * in the given locale. Supports simple {placeholder} interpolation.
 */
function createT(locale: SupportedLocale): Translator {
  const strings = locales[locale];
  const t = ((key, params) =>
    interpolate(strings[key] ?? en[key] ?? key, params)) as Translator;
  t.locale = locale;
  t.count = (stem, count, params) =>
    t(`${stem}.${pluralCategory(locale, count)}` as LocaleKeys, {
      count: count.toLocaleString(locale),
      ...params,
    });
  t.message = (value) =>
    Object.hasOwn(en, value) ? t(value as LocaleKeys) : value;
  return t;
}

const translators = new Map<SupportedLocale, Translator>();
function translatorFor(locale: SupportedLocale): Translator {
  let t = translators.get(locale);
  if (!t) {
    t = createT(locale);
    translators.set(locale, t);
  }
  return t;
}

/** React hook that returns a t() function reactive to locale changes. */
export function useT(): Translator {
  const locale = useI18nStore((state) => state.locale);
  return translatorFor(locale);
}

/**
 * The translator for the active locale, for code outside React (stores,
 * thrown errors). The text is fixed when it is produced, which is what a
 * status message wants.
 */
export function getT(): Translator {
  return translatorFor(getLocale());
}

/**
 * A string in every language the app has, the active one first. Text the app
 * wrote in one language, such as a detected speaker's label, can then still
 * be recognised after the language changes.
 */
export function inEveryLocale(key: LocaleKeys, params?: Params): string[] {
  const active = getLocale();
  const order = [
    active,
    ...(Object.keys(locales) as SupportedLocale[]).filter(
      (locale) => locale !== active,
    ),
  ];
  return [
    ...new Set(order.map((locale) => translatorFor(locale)(key, params))),
  ];
}

/** The language's own name in the given locale, e.g. "allemand" for de/fr. */
export function languageName(
  code: string,
  locale: SupportedLocale,
  fallback: string,
): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    return name && name !== code ? name : fallback;
  } catch {
    return fallback;
  }
}

export type { LocaleKeys };
