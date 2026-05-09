import type { VoiceEntry } from "./voiceCatalog";

export type TtsStatus =
  | "idle"
  | "loading"
  | "speaking"
  | "paused"
  | "stopped"
  | "error";

export type TtsPlaybackState = {
  status: TtsStatus;
  currentSentenceIndex: number;
  totalSentences: number;
  progress: number;
  speed: number;
  voiceId: string;
  error?: string;
};

export function createInitialPlaybackState(): TtsPlaybackState {
  return {
    status: "idle",
    currentSentenceIndex: 0,
    totalSentences: 0,
    progress: 0,
    speed: 1,
    voiceId: "",
  };
}

export type TtsProvider = "browser" | "edge" | "openai";

const ABBREVIATIONS =
  /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|dept|est|govt|Inc|Ltd|Corp|Co|Gen|Sgt|Cpl|Pvt|Rev|Vol|No)\./gi;

export function splitTextForTts(text: string): string[] {
  if (!text.trim()) return [];

  const placeholder = "​";
  let processed = text.replace(ABBREVIATIONS, (match) =>
    match.replace(".", placeholder),
  );

  processed = processed.replace(/(\d)\.(\d)/g, `$1${placeholder}$2`);

  const raw = processed.split(/(?<=[.!?])\s+|(?<=\n)\s*/);

  const sentences: string[] = [];
  for (const segment of raw) {
    const restored = segment.replace(new RegExp(placeholder, "g"), ".").trim();
    if (!restored) continue;

    if (restored.length > 300) {
      const parts = restored.split(/,\s+|;\s+|\s+[-–—]\s+/);
      let buffer = "";
      for (const part of parts) {
        if (buffer && (buffer + ", " + part).length > 250) {
          sentences.push(buffer.trim());
          buffer = part;
        } else {
          buffer = buffer ? buffer + ", " + part : part;
        }
      }
      if (buffer.trim()) sentences.push(buffer.trim());
    } else if (restored.length < 10 && sentences.length > 0) {
      sentences[sentences.length - 1] =
        sentences[sentences.length - 1]! + " " + restored;
    } else {
      sentences.push(restored);
    }
  }

  return sentences;
}

type SpeechSynthesisWindow = typeof globalThis & {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

export function speakWithBrowserTts(
  text: string,
  voiceName: string,
  rate: number,
  onEnd: () => void,
): SpeechSynthesisUtterance | null {
  const win = globalThis as SpeechSynthesisWindow;
  if (!win.speechSynthesis || !win.SpeechSynthesisUtterance) return null;

  const utterance = new win.SpeechSynthesisUtterance(text);
  utterance.rate = rate;

  const voices = win.speechSynthesis.getVoices();
  const match = voices.find((v) => v.name === voiceName);
  if (match) utterance.voice = match;

  utterance.onend = onEnd;
  utterance.onerror = onEnd;

  win.speechSynthesis.speak(utterance);
  return utterance;
}

export function getBrowserVoices(): VoiceEntry[] {
  const win = globalThis as SpeechSynthesisWindow;
  if (!win.speechSynthesis) return [];

  return win.speechSynthesis.getVoices().map((v) => ({
    id: `browser-${v.name.replace(/\s+/g, "-").toLowerCase()}`,
    name: v.name,
    displayName: v.name,
    language: v.lang,
    languageCode: v.lang,
    gender: "neutral" as const,
    provider: "browser" as const,
    premium: false,
  }));
}

export function pauseTts(): void {
  const win = globalThis as SpeechSynthesisWindow;
  win.speechSynthesis?.pause();
}

export function resumeTts(): void {
  const win = globalThis as SpeechSynthesisWindow;
  win.speechSynthesis?.resume();
}

export function stopTts(): void {
  const win = globalThis as SpeechSynthesisWindow;
  win.speechSynthesis?.cancel();
}

export function formatProgress(current: number, total: number): string {
  return `${current} / ${total} sentences`;
}

export function calculateEta(
  remainingSentences: number,
  avgSecondsPerSentence: number,
): string {
  const totalSeconds = Math.ceil(remainingSentences * avgSecondsPerSentence);
  if (totalSeconds < 60) return `~${totalSeconds} sec remaining`;
  const minutes = Math.round(totalSeconds / 60);
  return `~${minutes} min remaining`;
}

type TauriWindow = typeof globalThis & {
  __TAURI_INTERNALS__?: unknown;
};

async function invokeTauri<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  const win = globalThis as TauriWindow;
  if (!win.__TAURI_INTERNALS__) return null;

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function speakWithEdgeTts(
  text: string,
  voiceName: string,
  rate: number,
): Promise<ArrayBuffer | null> {
  return invokeTauri<ArrayBuffer>("edge_tts_synthesize", {
    text,
    voice: voiceName,
    rate,
  });
}

export async function speakWithOpenAiTts(
  text: string,
  voice: string,
  apiKey: string,
): Promise<ArrayBuffer | null> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice,
      input: text,
    }),
  });

  if (!response.ok) return null;
  return response.arrayBuffer();
}
