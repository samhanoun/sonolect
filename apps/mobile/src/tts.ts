import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import * as Speech from "expo-speech";

import type { TtsController, TtsState } from "./ttsCore";
import {
  createTtsController,
  engineLanguage,
  retryWhileThrowing,
} from "./ttsCore";

/**
 * Read-aloud for the whole app: one controller (ttsCore.ts) wired to
 * expo-speech 58.0.3. Reader and Library play through it, a Stop anywhere
 * stops it, and a dictation stops it before the microphone opens
 * (speech-4).
 *
 * iOS audio session (speech-6, ios-5): expo-speech 58 never sets one, so
 * speech would follow the app's default session, which the Ring/Silent
 * switch mutes, or the record session a dictation leaves behind. The
 * session calls of expo-speech-recognition 58.0.1 set it for spoken audio
 * and give it back afterwards, so other apps' audio comes back. The module
 * is loaded lazily, as speech.ts does, and both calls are synchronous and
 * may throw.
 */

type AudioSessionModule = {
  setCategoryIOS?: (options: {
    category: "playback";
    categoryOptions: "duckOthers"[];
    mode: "spokenAudio";
  }) => void;
  setAudioSessionActiveIOS?: (
    value: boolean,
    options?: { notifyOthersOnDeactivation: boolean },
  ) => void;
};

let cachedSessionModule: AudioSessionModule | null | undefined;

function loadSessionModule(): AudioSessionModule | null {
  if (cachedSessionModule !== undefined) return cachedSessionModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech-recognition") as {
      ExpoSpeechRecognitionModule?: AudioSessionModule;
    };
    cachedSessionModule = mod.ExpoSpeechRecognitionModule ?? null;
  } catch {
    cachedSessionModule = null;
  }
  return cachedSessionModule;
}

function warn(message: string, detail: unknown): void {
  if (__DEV__) console.warn("[tts] %s", message, detail);
}

/** Read-aloud has the session, between beforeSpeak and afterSpeak. */
let speechHoldsSession = false;

/** Changes each time read-aloud or a dictation takes the session. */
let sessionGeneration = 0;

/** A dictation is about to set its record session (speech.ts). */
export function noteRecordSessionTaken(): void {
  sessionGeneration += 1;
}

function deactivateSession(): void {
  if (Platform.OS !== "ios") return;
  const mod = loadSessionModule();
  if (!mod?.setAudioSessionActiveIOS) return;
  const generation = sessionGeneration;
  // Busy while audio still runs, and other apps stay ducked until it is
  // released: tried again shortly, unless the session was taken since.
  retryWhileThrowing(
    () =>
      mod.setAudioSessionActiveIOS?.(false, {
        notifyOthersOnDeactivation: true,
      }),
    () => generation === sessionGeneration && !speechHoldsSession,
    (run, ms) => {
      setTimeout(run, ms);
    },
    (error) => warn("audio session not released", error),
  );
}

/** Playback that the Silent switch does not mute, ducking other audio. */
function takePlaybackSession(): void {
  speechHoldsSession = true;
  sessionGeneration += 1;
  if (Platform.OS !== "ios") return;
  const mod = loadSessionModule();
  if (!mod) return;
  try {
    mod.setCategoryIOS?.({
      category: "playback",
      categoryOptions: ["duckOthers"],
      mode: "spokenAudio",
    });
  } catch (error) {
    warn("audio session category not set", error);
  }
  try {
    mod.setAudioSessionActiveIOS?.(true);
  } catch (error) {
    warn("audio session not activated", error);
  }
}

function givePlaybackSessionBack(): void {
  speechHoldsSession = false;
  deactivateSession();
}

/**
 * Gives the iOS audio session back after a dictation, so other apps' audio
 * resumes: expo-speech-recognition sets playAndRecord at every start and
 * never deactivates it. Does nothing while read-aloud holds the session.
 */
export function releaseAudioSessionAfterRecognition(): void {
  if (speechHoldsSession) return;
  deactivateSession();
}

let playbackAllowed: () => boolean = () => true;

/**
 * The store's rule for when read-aloud may start: never while a dictation
 * starts, listens or is processed.
 */
export function setTtsPlaybackGuard(guard: () => boolean): void {
  playbackAllowed = guard;
}

/** Past this, read-aloud speaks without waiting for the engine. */
const ENGINE_START_TIMEOUT_MS = 5000;

let engineReady = Platform.OS !== "android";
let engineStarting: Promise<void> | null = null;

/**
 * Android binds its TextToSpeech engine on first use. expo-speech keeps the
 * utterances spoken before that in its own queue, which Speech.stop()
 * cannot empty, so a Stop meanwhile would not stop them. The voice list
 * resolves once the engine is bound (empty if it failed to start), so
 * read-aloud waits for it before speaking.
 */
function engineReadiness(): Promise<void> | null {
  if (engineReady) return null;
  engineStarting ??= new Promise<void>((resolve) => {
    const started = () => {
      engineReady = true;
      resolve();
    };
    setTimeout(started, ENGINE_START_TIMEOUT_MS);
    Speech.getAvailableVoicesAsync().then(started, started);
  });
  return engineStarting;
}

export const ttsController: TtsController = createTtsController({
  speak: (text, options, callbacks) => {
    Speech.speak(text, {
      ...(options.language
        ? { language: engineLanguage(options.language, Platform.OS) }
        : {}),
      ...(options.rate !== undefined ? { rate: options.rate } : {}),
      ...(options.voice ? { voice: options.voice } : {}),
      onStopped: callbacks.onStopped,
      onError: () => callbacks.onError(),
      ...(callbacks.onDone ? { onDone: callbacks.onDone } : {}),
    });
  },
  stop: () => Speech.stop(),
  // Android has no pause: the promise rejects and the state stays.
  pause: () => Speech.pause(),
  resume: () => Speech.resume(),
  maxInputLength: Speech.maxSpeechInputLength,
  beforeSpeak: takePlaybackSession,
  afterSpeak: givePlaybackSessionBack,
  canPlay: () => playbackAllowed(),
  ready: engineReadiness,
});

/** The read-aloud state, for screens. */
export function useTts(): TtsState {
  return useSyncExternalStore(
    ttsController.subscribe,
    ttsController.getState,
    ttsController.getState,
  );
}
