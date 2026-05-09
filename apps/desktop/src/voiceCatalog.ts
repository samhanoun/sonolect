export type VoiceGender = "male" | "female" | "neutral";

export type VoiceProvider = "browser" | "edge" | "openai";

export type VoiceEntry = {
  id: string;
  name: string;
  displayName: string;
  language: string;
  languageCode: string;
  gender: VoiceGender;
  provider: VoiceProvider;
  previewText?: string;
  premium: boolean;
};

export const EDGE_VOICES: VoiceEntry[] = [
  {
    id: "edge-en-US-AriaNeural",
    name: "en-US-AriaNeural",
    displayName: "Aria",
    language: "English (US)",
    languageCode: "en-US",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-US-GuyNeural",
    name: "en-US-GuyNeural",
    displayName: "Guy",
    language: "English (US)",
    languageCode: "en-US",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-US-JennyNeural",
    name: "en-US-JennyNeural",
    displayName: "Jenny",
    language: "English (US)",
    languageCode: "en-US",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-US-ChristopherNeural",
    name: "en-US-ChristopherNeural",
    displayName: "Christopher",
    language: "English (US)",
    languageCode: "en-US",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-US-EricNeural",
    name: "en-US-EricNeural",
    displayName: "Eric",
    language: "English (US)",
    languageCode: "en-US",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-US-MichelleNeural",
    name: "en-US-MichelleNeural",
    displayName: "Michelle",
    language: "English (US)",
    languageCode: "en-US",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-US-RogerNeural",
    name: "en-US-RogerNeural",
    displayName: "Roger",
    language: "English (US)",
    languageCode: "en-US",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-GB-SoniaNeural",
    name: "en-GB-SoniaNeural",
    displayName: "Sonia",
    language: "English (UK)",
    languageCode: "en-GB",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-GB-RyanNeural",
    name: "en-GB-RyanNeural",
    displayName: "Ryan",
    language: "English (UK)",
    languageCode: "en-GB",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-GB-LibbyNeural",
    name: "en-GB-LibbyNeural",
    displayName: "Libby",
    language: "English (UK)",
    languageCode: "en-GB",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-AU-NatashaNeural",
    name: "en-AU-NatashaNeural",
    displayName: "Natasha",
    language: "English (AU)",
    languageCode: "en-AU",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-AU-WilliamNeural",
    name: "en-AU-WilliamNeural",
    displayName: "William",
    language: "English (AU)",
    languageCode: "en-AU",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-en-IN-NeerjaNeural",
    name: "en-IN-NeerjaNeural",
    displayName: "Neerja",
    language: "English (IN)",
    languageCode: "en-IN",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-fr-FR-DeniseNeural",
    name: "fr-FR-DeniseNeural",
    displayName: "Denise",
    language: "French (FR)",
    languageCode: "fr-FR",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-fr-FR-HenriNeural",
    name: "fr-FR-HenriNeural",
    displayName: "Henri",
    language: "French (FR)",
    languageCode: "fr-FR",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-fr-CA-SylvieNeural",
    name: "fr-CA-SylvieNeural",
    displayName: "Sylvie",
    language: "French (CA)",
    languageCode: "fr-CA",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-fr-CA-AntoineNeural",
    name: "fr-CA-AntoineNeural",
    displayName: "Antoine",
    language: "French (CA)",
    languageCode: "fr-CA",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-ar-SA-ZariyahNeural",
    name: "ar-SA-ZariyahNeural",
    displayName: "Zariyah",
    language: "Arabic (SA)",
    languageCode: "ar-SA",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-ar-SA-HamedNeural",
    name: "ar-SA-HamedNeural",
    displayName: "Hamed",
    language: "Arabic (SA)",
    languageCode: "ar-SA",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-ar-MA-MounaNeural",
    name: "ar-MA-MounaNeural",
    displayName: "Mouna",
    language: "Arabic (MA)",
    languageCode: "ar-MA",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-es-ES-ElviraNeural",
    name: "es-ES-ElviraNeural",
    displayName: "Elvira",
    language: "Spanish (ES)",
    languageCode: "es-ES",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-es-ES-AlvaroNeural",
    name: "es-ES-AlvaroNeural",
    displayName: "Alvaro",
    language: "Spanish (ES)",
    languageCode: "es-ES",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-es-MX-DaliaNeural",
    name: "es-MX-DaliaNeural",
    displayName: "Dalia",
    language: "Spanish (MX)",
    languageCode: "es-MX",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-de-DE-KatjaNeural",
    name: "de-DE-KatjaNeural",
    displayName: "Katja",
    language: "German (DE)",
    languageCode: "de-DE",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-de-DE-ConradNeural",
    name: "de-DE-ConradNeural",
    displayName: "Conrad",
    language: "German (DE)",
    languageCode: "de-DE",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-ja-JP-NanamiNeural",
    name: "ja-JP-NanamiNeural",
    displayName: "Nanami",
    language: "Japanese",
    languageCode: "ja-JP",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-ja-JP-KeitaNeural",
    name: "ja-JP-KeitaNeural",
    displayName: "Keita",
    language: "Japanese",
    languageCode: "ja-JP",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-zh-CN-XiaoxiaoNeural",
    name: "zh-CN-XiaoxiaoNeural",
    displayName: "Xiaoxiao",
    language: "Chinese (CN)",
    languageCode: "zh-CN",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-zh-CN-YunxiNeural",
    name: "zh-CN-YunxiNeural",
    displayName: "Yunxi",
    language: "Chinese (CN)",
    languageCode: "zh-CN",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-pt-BR-FranciscaNeural",
    name: "pt-BR-FranciscaNeural",
    displayName: "Francisca",
    language: "Portuguese (BR)",
    languageCode: "pt-BR",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-it-IT-ElsaNeural",
    name: "it-IT-ElsaNeural",
    displayName: "Elsa",
    language: "Italian",
    languageCode: "it-IT",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-it-IT-DiegoNeural",
    name: "it-IT-DiegoNeural",
    displayName: "Diego",
    language: "Italian",
    languageCode: "it-IT",
    gender: "male",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-ko-KR-SunHiNeural",
    name: "ko-KR-SunHiNeural",
    displayName: "Sun-Hi",
    language: "Korean",
    languageCode: "ko-KR",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-hi-IN-SwaraNeural",
    name: "hi-IN-SwaraNeural",
    displayName: "Swara",
    language: "Hindi",
    languageCode: "hi-IN",
    gender: "female",
    provider: "edge",
    premium: false,
  },
  {
    id: "edge-hi-IN-MadhurNeural",
    name: "hi-IN-MadhurNeural",
    displayName: "Madhur",
    language: "Hindi",
    languageCode: "hi-IN",
    gender: "male",
    provider: "edge",
    premium: false,
  },
];

export const OPENAI_VOICES: VoiceEntry[] = [
  {
    id: "openai-alloy",
    name: "alloy",
    displayName: "Alloy",
    language: "Multilingual",
    languageCode: "mul",
    gender: "neutral",
    provider: "openai",
    premium: true,
  },
  {
    id: "openai-echo",
    name: "echo",
    displayName: "Echo",
    language: "Multilingual",
    languageCode: "mul",
    gender: "male",
    provider: "openai",
    premium: true,
  },
  {
    id: "openai-fable",
    name: "fable",
    displayName: "Fable",
    language: "Multilingual",
    languageCode: "mul",
    gender: "neutral",
    provider: "openai",
    premium: true,
  },
  {
    id: "openai-onyx",
    name: "onyx",
    displayName: "Onyx",
    language: "Multilingual",
    languageCode: "mul",
    gender: "male",
    provider: "openai",
    premium: true,
  },
  {
    id: "openai-nova",
    name: "nova",
    displayName: "Nova",
    language: "Multilingual",
    languageCode: "mul",
    gender: "female",
    provider: "openai",
    premium: true,
  },
  {
    id: "openai-shimmer",
    name: "shimmer",
    displayName: "Shimmer",
    language: "Multilingual",
    languageCode: "mul",
    gender: "female",
    provider: "openai",
    premium: true,
  },
];

export function getVoicesForLanguage(languageCode: string): VoiceEntry[] {
  const prefix = languageCode.toLowerCase().split("-")[0]!;
  return [...EDGE_VOICES, ...OPENAI_VOICES].filter(
    (v) =>
      v.languageCode.toLowerCase().startsWith(prefix) ||
      v.languageCode === "mul",
  );
}

export function getVoicesByProvider(provider: VoiceProvider): VoiceEntry[] {
  return [...EDGE_VOICES, ...OPENAI_VOICES].filter(
    (v) => v.provider === provider,
  );
}

export function getAllVoices(): VoiceEntry[] {
  return [...EDGE_VOICES, ...OPENAI_VOICES];
}

export function findVoiceById(id: string): VoiceEntry | null {
  return [...EDGE_VOICES, ...OPENAI_VOICES].find((v) => v.id === id) ?? null;
}

const ARABIC_RANGE = /[؀-ۿ]/;
const CHINESE_RANGE = /[一-鿿]/;
const JAPANESE_RANGE = /[぀-ゟ゠-ヿ]/;
const KOREAN_RANGE = /[가-힯ᄀ-ᇿ]/;
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

const FRENCH_WORDS =
  /\b(le|la|les|de|des|du|un|une|et|est|je|tu|nous|vous|ils|elles|ce|cette|pour|dans|avec|sur|que|qui|pas|mais|ou|sont|aux|par)\b/i;
const SPANISH_WORDS =
  /\b(el|la|los|las|de|del|un|una|es|en|que|por|con|para|se|su|no|al|lo|le|como|pero|sus|este|esta|son|hay|muy|fue|ser)\b/i;
const GERMAN_WORDS =
  /\b(der|die|das|und|ist|ein|eine|zu|den|auf|mit|dem|nicht|sich|von|auch|es|ich|des|für|wie|werden|bei|nach|haben|wird|sind|war)\b/i;
const PORTUGUESE_WORDS =
  /\b(o|a|os|as|de|do|da|dos|das|em|no|na|um|uma|que|é|para|com|se|por|como|mas|foi|ser|são|seu|sua|pelo|pela|nos|ao)\b/i;
const ITALIAN_WORDS =
  /\b(il|la|di|che|è|e|un|una|in|per|non|sono|con|si|lo|le|del|da|al|dei|gli|anche|come|ha|più|questo|questa|suo|sua|ma)\b/i;

export function detectLanguage(text: string): string {
  if (!text.trim()) return "en";

  if (ARABIC_RANGE.test(text)) return "ar";
  if (JAPANESE_RANGE.test(text)) return "ja";
  if (CHINESE_RANGE.test(text)) return "zh";
  if (KOREAN_RANGE.test(text)) return "ko";
  if (DEVANAGARI_RANGE.test(text)) return "hi";

  const words = text.split(/\s+/);
  const wordCount = words.length;
  if (wordCount < 2) return "en";

  const scores: Record<string, number> = { fr: 0, es: 0, de: 0, pt: 0, it: 0 };
  for (const word of words) {
    if (FRENCH_WORDS.test(word)) scores["fr"]!++;
    if (SPANISH_WORDS.test(word)) scores["es"]!++;
    if (GERMAN_WORDS.test(word)) scores["de"]!++;
    if (PORTUGUESE_WORDS.test(word)) scores["pt"]!++;
    if (ITALIAN_WORDS.test(word)) scores["it"]!++;
  }

  let bestLang = "en";
  let bestScore = 0;
  const threshold = wordCount * 0.15;

  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return bestLang;
}
