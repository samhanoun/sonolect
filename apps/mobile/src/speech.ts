import type { CapturedAudioPayload } from "./audioCapture";

/**
 * Thin wrapper around expo-speech-recognition (iOS SFSpeechRecognizer,
 * Android SpeechRecognizer, Web Speech API in browsers). The native module is
 * loaded lazily so the app still opens in environments without it (Expo Go,
 * tests) and reports "unavailable" instead of crashing.
 */

type Subscription = { remove(): void };
type SpeechModule = {
  start(options: Record<string, unknown>): void;
  stop(): void;
  abort(): void;
  requestPermissionsAsync(): Promise<{
    granted: boolean;
    canAskAgain?: boolean;
  }>;
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  addListener(event: string, listener: (payload: never) => void): Subscription;
};

let cachedModule: SpeechModule | null | undefined;

function loadModule(): SpeechModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech-recognition") as {
      ExpoSpeechRecognitionModule?: SpeechModule;
    };
    cachedModule = mod.ExpoSpeechRecognitionModule ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export type SpeechAvailability =
  | { available: true; onDevice: boolean }
  | { available: false; reason: "unsupported" | "service-unavailable" };

export function getSpeechAvailability(): SpeechAvailability {
  const mod = loadModule();
  if (!mod) return { available: false, reason: "unsupported" };
  try {
    if (!mod.isRecognitionAvailable()) {
      return { available: false, reason: "service-unavailable" };
    }
    return { available: true, onDevice: safeOnDevice(mod) };
  } catch {
    return { available: false, reason: "unsupported" };
  }
}

function safeOnDevice(mod: SpeechModule): boolean {
  try {
    return mod.supportsOnDeviceRecognition();
  } catch {
    return false;
  }
}

export async function requestMicrophonePermission(): Promise<
  "granted" | "denied" | "unsupported"
> {
  const mod = loadModule();
  if (!mod) return "unsupported";
  try {
    const result = await mod.requestPermissionsAsync();
    return result.granted ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export interface SpeechSessionHandlers {
  onTranscript(text: string, isFinal: boolean): void;
  /** Normalised input level, 0 (silence) to 1 (loud). */
  onLevel(level: number): void;
  onError(code: string, message: string): void;
  onEnd(result: { text: string; audio?: CapturedAudioPayload }): void;
}

export interface SpeechSessionOptions {
  language: string;
  /** Keep audio and recognition on the device. */
  requireOnDevice: boolean;
  /** Persist the audio so it can be uploaded to the Sonolect API. */
  persistAudio: boolean;
}

export interface SpeechSession {
  stop(): void;
  abort(): void;
}

/** Accumulates continuous-mode results: finalised segments plus the live one. */
export class TranscriptAccumulator {
  private committed: string[] = [];
  private interim = "";

  push(text: string, isFinal: boolean): string {
    const clean = text.trim();
    if (isFinal) {
      if (clean) this.committed.push(clean);
      this.interim = "";
    } else {
      this.interim = clean;
    }
    return this.text();
  }

  text(): string {
    return [...this.committed, this.interim].filter(Boolean).join(" ");
  }
}

export function levelFromVolume(value: number): number {
  // expo-speech-recognition reports roughly -2 (silent) to 10 (loud).
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 10));
}

function mimeForUri(uri: string): string {
  if (uri.endsWith(".wav")) return "audio/wav";
  if (uri.endsWith(".caf")) return "audio/x-caf";
  if (uri.endsWith(".m4a") || uri.endsWith(".mp4")) return "audio/mp4";
  return "application/octet-stream";
}

async function readAudio(
  uri: string,
  durationMs: number,
): Promise<CapturedAudioPayload | undefined> {
  try {
    const response = await fetch(uri);
    const bytes = await response.arrayBuffer();
    return {
      bytes,
      mimeType: mimeForUri(uri),
      durationMs,
      sizeBytes: bytes.byteLength,
      fileName: uri.split("/").pop() ?? "sonolect-capture",
    };
  } catch {
    return undefined;
  }
}

export function startSpeechSession(
  options: SpeechSessionOptions,
  handlers: SpeechSessionHandlers,
): SpeechSession | null {
  const mod = loadModule();
  if (!mod) {
    handlers.onError(
      "unsupported",
      "Speech recognition isn't available in this build.",
    );
    return null;
  }

  const startedAt = Date.now();
  const accumulator = new TranscriptAccumulator();
  let audioUri: string | null = null;
  let finished = false;
  const subscriptions: Subscription[] = [];

  const cleanup = () => {
    for (const subscription of subscriptions) subscription.remove();
    subscriptions.length = 0;
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    cleanup();
    const audio = audioUri
      ? await readAudio(audioUri, Date.now() - startedAt)
      : undefined;
    handlers.onEnd({ text: accumulator.text(), ...(audio ? { audio } : {}) });
  };

  subscriptions.push(
    mod.addListener("result", ((event: {
      isFinal: boolean;
      results: { transcript: string }[];
    }) => {
      const best = event.results[0]?.transcript ?? "";
      handlers.onTranscript(
        accumulator.push(best, event.isFinal),
        event.isFinal,
      );
    }) as (payload: never) => void),
    mod.addListener("volumechange", ((event: { value: number }) => {
      handlers.onLevel(levelFromVolume(event.value));
    }) as (payload: never) => void),
    mod.addListener("audioend", ((event: { uri: string | null }) => {
      if (event.uri) audioUri = event.uri;
    }) as (payload: never) => void),
    mod.addListener("error", ((event: { error: string; message: string }) => {
      // "no-speech" and "aborted" end the session; they are not failures.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        handlers.onError(event.error, event.message);
      }
    }) as (payload: never) => void),
    mod.addListener("end", (() => {
      void finish();
    }) as (payload: never) => void),
  );

  try {
    const onDevice = options.requireOnDevice && safeOnDevice(mod);
    mod.start({
      lang: options.language,
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      requiresOnDeviceRecognition: onDevice,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      ...(options.persistAudio ? { recordingOptions: { persist: true } } : {}),
    });
  } catch (error) {
    cleanup();
    handlers.onError(
      "start-failed",
      error instanceof Error ? error.message : "Could not start listening.",
    );
    return null;
  }

  return {
    stop: () => {
      try {
        mod.stop();
      } catch {
        void finish();
      }
    },
    abort: () => {
      finished = true;
      cleanup();
      try {
        mod.abort();
      } catch {
        // Already stopped.
      }
    },
  };
}
