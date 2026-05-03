export type STTLanguage = {
  code: string;
  name: string;
  nativeName: string;
};

export const STT_LANGUAGES: STTLanguage[] = [
  { code: "auto", name: "Auto", nativeName: "Auto" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
];

export function getLanguageByCode(code: string): STTLanguage | undefined {
  return STT_LANGUAGES.find((lang) => lang.code === code);
}

export function getLanguageDisplayName(code: string): string {
  const lang = getLanguageByCode(code);
  if (!lang) return code;
  if (lang.code === "auto") return "Auto-détection";
  return lang.nativeName;
}
