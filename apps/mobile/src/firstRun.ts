import type {
  CompanionSettings,
  DictationLanguage,
  UiLanguage,
} from "./domain";
import { DICTATION_LANGUAGES } from "./domain";

/** What a first run reads from each preferred device locale (expo-localization). */
export interface DeviceLocale {
  languageTag: string;
  languageCode: string | null;
}

/** The dictation language for a language code, when the tag has no exact match. */
const DICTATION_BY_CODE: ReadonlyMap<string, DictationLanguage> = new Map([
  ["en", "en-US"],
  ["fr", "fr-FR"],
  ["es", "es-ES"],
  ["de", "de-DE"],
  ["ar", "ar-SA"],
]);

/** The locale's language code; the tag's first subtag when the code is missing. */
function codeOf(locale: DeviceLocale): string {
  const code = locale.languageCode ?? locale.languageTag.split(/[-_]/)[0];
  return (code ?? "").trim().toLowerCase();
}

/** The dictation language with this tag, case-insensitive and '_' read as '-'. */
function exactDictationLanguage(tag: string): DictationLanguage | undefined {
  const normalized = tag.trim().replace(/_/g, "-").toLowerCase();
  return DICTATION_LANGUAGES.find(
    (language) => language.toLowerCase() === normalized,
  );
}

/**
 * The app language and dictation language for a first run, from the
 * device's preferred locales in order (ux-5). Used only when no settings are
 * stored, and again after Erase all data.
 */
export function resolveInitialSettings(
  locales: readonly DeviceLocale[],
): Pick<CompanionSettings, "uiLanguage" | "language"> {
  let uiLanguage: UiLanguage = "en";
  for (const locale of locales) {
    const code = codeOf(locale);
    if (code === "en" || code === "fr") {
      uiLanguage = code;
      break;
    }
  }
  let language: DictationLanguage = "en-US";
  for (const locale of locales) {
    const match =
      exactDictationLanguage(locale.languageTag) ??
      DICTATION_BY_CODE.get(codeOf(locale));
    if (match) {
      language = match;
      break;
    }
  }
  return { uiLanguage, language };
}
