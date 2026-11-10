import { Platform } from "react-native";

import type { CapturedAudioPayload } from "./audioCapture";
import type { DictationLanguage } from "./domain";
import type {
  DownloadAttempt,
  DownloadOutcome,
  PermissionOutcome,
  RecognitionEnvironment,
  RecognitionPlan,
  RecognitionPlatform,
} from "./speechPolicy";
import {
  ANDROID_ON_DEVICE_MIN_API,
  DOWNLOAD_TIMEOUT_MS,
  LOCALES_TIMEOUT_MS,
  TranscriptAccumulator,
  levelFromVolume,
  mapDownloadOutcome,
  shouldRetryWithSystemService,
} from "./speechPolicy";

/**
 * Thin wrapper around expo-speech-recognition 58.0.1 (iOS SFSpeechRecognizer,
 * Android SpeechRecognizer, Web Speech API in browsers). The native module is
 * loaded lazily so the app still opens in environments without it (Expo Go)
 * and reports "unavailable" instead of crashing. speechPolicy.ts decides what
 * a dictation may use; this module reads the device and runs the sessions.
 */

type Subscription = { remove(): void };

interface PermissionResponse {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
  /** iOS: Speech Recognition is restricted (Screen Time or a profile). */
  restricted?: boolean;
}

type SpeechModule = {
  start(options: Record<string, unknown>): void;
  stop(): void;
  abort(): void;
  requestPermissionsAsync(): Promise<PermissionResponse>;
  getMicrophonePermissionsAsync(): Promise<PermissionResponse>;
  requestMicrophonePermissionsAsync(): Promise<PermissionResponse>;
  getSpeechRecognizerPermissionsAsync(): Promise<PermissionResponse>;
  requestSpeechRecognizerPermissionsAsync(): Promise<PermissionResponse>;
  getSupportedLocales(options: {
    androidRecognitionServicePackage?: string;
  }): Promise<{ locales: string[]; installedLocales: string[] }>;
  androidTriggerOfflineModelDownload(options: {
    locale: string;
  }): Promise<{ status: string; message: string }>;
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  /**
   * iOS: whether the recognizer of this locale can run on the device. Added
   * by patches/expo-speech-recognition@58.0.1.patch, so it may be missing.
   */
  supportsOnDeviceRecognitionForLocale?: (lang: string) => boolean;
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

function currentPlatform(): RecognitionPlatform {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  return "web";
}

/** Android API level, iOS major version, or 0 elsewhere. */
function currentOsVersion(): number {
  const version: unknown = Platform.Version;
  if (typeof version === "number") {
    return Platform.OS === "android" ? version : 0;
  }
  if (Platform.OS !== "ios" || typeof version !== "string") return 0;
  const major = Number.parseInt(version, 10);
  return Number.isFinite(major) ? major : 0;
}

function warn(message: string, detail?: unknown): void {
  // Native messages are English and may name locales or services: they are
  // for developers only and never reach the UI.
  if (__DEV__) console.warn(`[speech] ${message}`, detail ?? "");
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** Runs an async native call, turning a synchronous throw into a rejection. */
function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return run();
  } catch (error) {
    return Promise.reject(error);
  }
}

/** The promise's value, or the fallback if it rejects or takes over ms. */
function withTimeout<T, F>(
  promise: Promise<T>,
  ms: number,
  fallback: F,
): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Installed on-device language packs, read once per app session. */
let installedLocalesRead: Promise<readonly string[] | null> | null = null;
const environmentListeners = new Set<() => void>();

/**
 * Forgets what was read about the device, so the next plan reads it again.
 * The store calls it when the app comes back to the foreground (a language
 * pack may have been installed in the system settings) and after a download.
 */
export function invalidateRecognitionEnvironment(): void {
  installedLocalesRead = null;
  for (const listener of environmentListeners) listener();
}

/** Called after every invalidateRecognitionEnvironment(). */
export function subscribeRecognitionEnvironment(
  listener: () => void,
): () => void {
  environmentListeners.add(listener);
  return () => {
    environmentListeners.delete(listener);
  };
}

/**
 * getSupportedLocales has no timeout on Android and some recognizers never
 * answer, so the list is unknown (null) after LOCALES_TIMEOUT_MS or an error.
 */
function readInstalledLocales(
  mod: SpeechModule,
): Promise<readonly string[] | null> {
  installedLocalesRead ??= withTimeout(
    call(() => mod.getSupportedLocales({})).then((result) =>
      Array.isArray(result?.installedLocales) ? result.installedLocales : null,
    ),
    LOCALES_TIMEOUT_MS,
    null,
  );
  return installedLocalesRead;
}

function readLocaleOnDevice(
  mod: SpeechModule,
  language: DictationLanguage,
): boolean | null {
  if (typeof mod.supportsOnDeviceRecognitionForLocale !== "function") {
    return null;
  }
  return safely<boolean | null>(
    () => mod.supportsOnDeviceRecognitionForLocale?.(language) === true,
    null,
  );
}

/** What the device can do for a dictation in this language. */
export async function getRecognitionEnvironment(
  language: DictationLanguage,
): Promise<RecognitionEnvironment> {
  const platform = currentPlatform();
  const osVersion = currentOsVersion();
  const mod = loadModule();
  if (!mod) {
    return {
      platform,
      osVersion,
      recognitionAvailable: false,
      onDeviceService: false,
      installedLocales: null,
      localeOnDevice: null,
    };
  }
  const recognitionAvailable = safely(
    () => mod.isRecognitionAvailable() === true,
    false,
  );
  const onDeviceService = safely(
    () => mod.supportsOnDeviceRecognition() === true,
    false,
  );
  const installedLocales =
    platform === "android" &&
    osVersion >= ANDROID_ON_DEVICE_MIN_API &&
    onDeviceService
      ? await readInstalledLocales(mod)
      : null;
  const localeOnDevice =
    platform === "ios" ? readLocaleOnDevice(mod, language) : null;
  return {
    platform,
    osVersion,
    recognitionAvailable,
    onDeviceService,
    installedLocales,
    localeOnDevice,
  };
}

function deniedOutcome(
  which: "microphone" | "speech",
  response: PermissionResponse,
): PermissionOutcome {
  return {
    status: "denied",
    which,
    canAskAgain: response.canAskAgain !== false,
    ...(response.restricted === true ? { restricted: true } : {}),
  };
}

/**
 * Asks for what a dictation needs. On iOS the microphone comes first, and
 * Speech Recognition only for the speech service: expo-speech-recognition
 * does not check it for on-device recognition.
 */
export async function requestDictationPermission(options: {
  needsSpeechRecognizer: boolean;
}): Promise<PermissionOutcome> {
  const mod = loadModule();
  if (!mod) return { status: "unsupported" };
  try {
    if (Platform.OS === "ios") {
      const microphone = await mod.requestMicrophonePermissionsAsync();
      if (!microphone.granted) return deniedOutcome("microphone", microphone);
      if (!options.needsSpeechRecognizer) return { status: "granted" };
      const speech = await mod.requestSpeechRecognizerPermissionsAsync();
      return speech.granted
        ? { status: "granted" }
        : deniedOutcome("speech", speech);
    }
    const result = await mod.requestPermissionsAsync();
    return result.granted
      ? { status: "granted" }
      : deniedOutcome("microphone", result);
  } catch (error) {
    warn("permission request failed", error);
    return { status: "denied", which: "microphone", canAskAgain: true };
  }
}

/**
 * Reads the permissions again without asking, after the recognizer reported
 * 'not-allowed'. Null when they can't be read.
 */
export async function readDictationPermission(options: {
  needsSpeechRecognizer: boolean;
}): Promise<PermissionOutcome | null> {
  const mod = loadModule();
  if (!mod) return null;
  try {
    const microphone = await mod.getMicrophonePermissionsAsync();
    if (!microphone.granted) return deniedOutcome("microphone", microphone);
    if (Platform.OS === "ios" && options.needsSpeechRecognizer) {
      const speech = await mod.getSpeechRecognizerPermissionsAsync();
      if (!speech.granted) return deniedOutcome("speech", speech);
    }
    return { status: "granted" };
  } catch (error) {
    warn("permission read failed", error);
    return null;
  }
}

let download: Promise<DownloadOutcome> | null = null;

/**
 * Asks Android 13+ to download the on-device language pack. Repeated taps
 * share one request. It never starts a dictation.
 */
export function downloadLanguageModel(
  language: DictationLanguage,
): Promise<DownloadOutcome> {
  if (download) return download;
  const mod = loadModule();
  if (
    !mod ||
    currentPlatform() !== "android" ||
    currentOsVersion() < ANDROID_ON_DEVICE_MIN_API
  ) {
    return Promise.resolve("not-supported");
  }
  const attempt: Promise<DownloadAttempt> = call(() =>
    mod.androidTriggerOfflineModelDownload({ locale: language }),
  ).then(
    (result) => ({ status: String(result?.status) }),
    (error: unknown) => {
      warn("language pack download failed", error);
      return { error };
    },
  );
  const pending = withTimeout(attempt, DOWNLOAD_TIMEOUT_MS, "timeout" as const)
    .then(mapDownloadOutcome)
    .finally(() => {
      download = null;
      invalidateRecognitionEnvironment();
    });
  download = pending;
  return pending;
}

export interface SpeechSessionHandlers {
  onTranscript(text: string, isFinal: boolean): void;
  /** Normalised input level, 0 (silence) to 1 (loud). */
  onLevel(level: number): void;
  /**
   * An expo-speech-recognition error code, or 'unsupported' and
   * 'start-failed'. Benign ends ('no-speech', 'speech-timeout', 'aborted')
   * are not reported.
   */
  onError(code: string): void;
  /** The session moved to the system speech service, with consent. */
  onRouteChange(route: "system-service"): void;
  onEnd(result: { text: string; audio?: CapturedAudioPayload }): void;
}

export interface SpeechSessionOptions {
  language: DictationLanguage;
  plan: RecognitionPlan;
  /**
   * The user allowed the system speech service for this dictation: when the
   * on-device recognizer has no model for the language, the session restarts
   * once with the service instead of failing.
   */
  fallbackToSystemService: boolean;
  /** Persist the audio so it can be uploaded to the Sonolect API. */
  persistAudio: boolean;
}

export interface SpeechSession {
  stop(): void;
  abort(): void;
}

const BENIGN_ERRORS = new Set(["no-speech", "speech-timeout", "aborted"]);

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
    handlers.onError("unsupported");
    return null;
  }

  // Below API 33 expo-speech-recognition has no strict on-device recognizer:
  // the flag would only ask the service to prefer offline.
  const requiresOnDevice =
    options.plan.requiresOnDevice &&
    !(
      currentPlatform() === "android" &&
      currentOsVersion() < ANDROID_ON_DEVICE_MIN_API
    );
  const startOptions = {
    lang: options.language,
    interimResults: true,
    continuous: true,
    addsPunctuation: true,
    requiresOnDeviceRecognition: requiresOnDevice,
    volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    ...(options.persistAudio ? { recordingOptions: { persist: true } } : {}),
  };

  const startedAt = Date.now();
  const accumulator = new TranscriptAccumulator();
  let audioUri: string | null = null;
  let finished = false;
  let onDevice = requiresOnDevice;
  let stopRequested = false;
  let retried = false;
  /** A missing-language error was held back for a retry on the next 'end'. */
  let retryPending = false;
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

  /** Starts again with the system speech service; false if it can't. */
  const retryWithSystemService = (): boolean => {
    retried = true;
    onDevice = false;
    audioUri = null;
    try {
      mod.start({ ...startOptions, requiresOnDeviceRecognition: false });
    } catch (error) {
      warn("restart with the speech service failed", error);
      handlers.onError("start-failed");
      return false;
    }
    handlers.onRouteChange("system-service");
    return true;
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
    mod.addListener("error", ((event: { error: string; message?: string }) => {
      if (finished) return;
      warn(event.error, event.message);
      if (BENIGN_ERRORS.has(event.error)) return;
      if (
        shouldRetryWithSystemService({
          code: event.error,
          requiresOnDevice: onDevice,
          consented: options.fallbackToSystemService,
          alreadyRetried: retried,
          stopRequested,
        })
      ) {
        retryPending = true;
        return;
      }
      handlers.onError(event.error);
    }) as (payload: never) => void),
    mod.addListener("end", (() => {
      if (finished) return;
      if (retryPending) {
        retryPending = false;
        // Done was pressed before the restart: report the held-back error.
        if (stopRequested) handlers.onError("language-not-supported");
        else if (retryWithSystemService()) return;
      }
      void finish();
    }) as (payload: never) => void),
  );

  try {
    mod.start(startOptions);
  } catch (error) {
    cleanup();
    warn("start failed", error);
    handlers.onError("start-failed");
    return null;
  }

  return {
    stop: () => {
      stopRequested = true;
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
