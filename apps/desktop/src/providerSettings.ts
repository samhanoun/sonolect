import { create } from "zustand";
import { isTauriRuntime } from "./desktopNative";
import { getT } from "./i18n";
import { localizeNativeMessage } from "./nativeMessages";
import { prepareLocalAudio } from "./localAudio";
import type { VoiceCaptureMetadata } from "./voiceApi";
import {
  createDesktopWhisperRequest,
  type DesktopWhisperResult,
} from "./desktopWhisper";

export type ProviderId = "openrouter" | "opencode";
export type ModelTask = "stt" | "tts" | "text";
export type ModelChoice = { provider: ProviderId | "local"; model: string };
export type ProviderModel = {
  id: string;
  name: string;
  capabilities: string[];
  voices: string[];
};
export type ProviderPreferences = {
  stt: ModelChoice;
  tts: ModelChoice;
  text: ModelChoice;
  voice: string;
};
const PREF_KEY = "sonolect.providers.v1";
export const PROVIDER_NAMES = {
  openrouter: "OpenRouter",
  opencode: "OpenCode Zen",
  local: "Local Whisper",
};

export function parseProviderPreferences(
  raw: string | null,
): ProviderPreferences {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw ?? "{}") ?? {};
  } catch {
    /* default to local */
  }
  const choice = (task: ModelTask, fallback: ModelChoice): ModelChoice => {
    const value = parsed[task] as Partial<ModelChoice> | undefined;
    const allowed =
      task === "stt"
        ? ["local", "openrouter"]
        : task === "tts"
          ? ["openrouter"]
          : ["openrouter", "opencode"];
    if (
      !value ||
      !allowed.includes(value.provider ?? "") ||
      typeof value.model !== "string" ||
      value.model.length > 200
    )
      return fallback;
    return { provider: value.provider!, model: value.model };
  };
  return {
    stt: choice("stt", { provider: "local", model: "" }),
    tts: choice("tts", { provider: "openrouter", model: "" }),
    text: choice("text", { provider: "opencode", model: "" }),
    voice: typeof parsed.voice === "string" ? parsed.voice.slice(0, 200) : "",
  };
}
export function serializeProviderPreferences(preferences: ProviderPreferences) {
  return JSON.stringify({
    stt: preferences.stt,
    tts: preferences.tts,
    text: preferences.text,
    voice: preferences.voice,
  });
}
export function modelsForTask(models: ProviderModel[], task: ModelTask) {
  return models.filter((model) => model.capabilities.includes(task));
}
function initialPreferences() {
  try {
    return parseProviderPreferences(localStorage.getItem(PREF_KEY));
  } catch {
    return parseProviderPreferences(null);
  }
}

export async function nativeProviderCall<T>(
  command: string,
  args?: Record<string, unknown> | Uint8Array,
  headers?: Record<string, string>,
): Promise<T> {
  if (!isTauriRuntime()) throw new Error(getT()("provider.previewOnly"));
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await (headers
      ? invoke<T>(command, args, { headers })
      : invoke<T>(command, args));
  } catch (error) {
    // Native commands fail with an English sentence; show it in the
    // interface language.
    throw new Error(
      localizeNativeMessage(
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}
export async function setProviderMode(enabled: boolean) {
  if (isTauriRuntime())
    await nativeProviderCall("set_online_enabled", { enabled });
}
async function withCloudConsent<T>(
  allowed: () => boolean,
  command: string,
  args: Record<string, unknown> | Uint8Array,
  headers?: Record<string, string>,
): Promise<T> {
  if (!allowed()) throw new Error(getT()("provider.cloudRequired"));
  await setProviderMode(true);
  if (!allowed()) {
    await setProviderMode(false);
    throw new Error(getT()("provider.cloudCancelled"));
  }
  return nativeProviderCall<T>(command, args, headers);
}
export async function transcribeUsingProvider(
  audio: Blob,
  metadata: VoiceCaptureMetadata,
  choice: ModelChoice,
  language: string,
  allowed: () => boolean,
): Promise<DesktopWhisperResult> {
  if (choice.provider !== "openrouter" || !choice.model)
    throw new Error(getT()("provider.selectStt"));
  const request = createDesktopWhisperRequest(
    await prepareLocalAudio(audio),
    metadata,
    language,
  );
  return withCloudConsent(allowed, "provider_transcribe", request.body, {
    ...request.headers,
    "x-sonolect-provider": encodeURIComponent(choice.provider),
    "x-sonolect-model": encodeURIComponent(choice.model),
  });
}
/** PCM is wrapped as WAV natively; MP3 is passed through. */
export function speechMimeType(responseFormat: "mp3" | "pcm") {
  return responseFormat === "pcm" ? "audio/wav" : "audio/mpeg";
}
export async function speakUsingProvider(
  text: string,
  choice: ModelChoice,
  voice: string,
  allowed: () => boolean,
  responseFormat: "mp3" | "pcm" = "mp3",
  sampleRate = 24000,
): Promise<Blob> {
  if (choice.provider !== "openrouter" || !choice.model)
    throw new Error(getT()("provider.selectTts"));
  // The audio comes back as a raw binary response, not a JSON number array.
  const audio = await withCloudConsent<ArrayBuffer>(allowed, "provider_speak", {
    provider: choice.provider,
    model: choice.model,
    text,
    voice,
    responseFormat,
    sampleRate,
  });
  return new Blob([audio], { type: speechMimeType(responseFormat) });
}
export async function rewriteUsingProvider(
  text: string,
  instruction: string,
  choice: ModelChoice,
  allowed: () => boolean,
) {
  if (choice.provider === "local" || !choice.model)
    throw new Error(getT()("provider.selectText"));
  return withCloudConsent<string>(allowed, "provider_rewrite", {
    provider: choice.provider,
    model: choice.model,
    text,
    instruction,
  });
}

type ProviderState = {
  preferences: ProviderPreferences;
  models: Record<ProviderId, ProviderModel[]>;
  keys: Record<ProviderId, boolean>;
  busy: ProviderId | null;
  message: string;
  selectModel: (task: ModelTask, choice: ModelChoice) => void;
  setVoice: (voice: string) => void;
  refreshModels: (provider: ProviderId) => Promise<void>;
  refreshKeyStatus: () => Promise<void>;
  saveKey: (provider: ProviderId, key: string) => Promise<boolean>;
  removeKey: (provider: ProviderId) => Promise<void>;
};
export const useProviderStore = create<ProviderState>((set, get) => ({
  preferences: initialPreferences(),
  models: { openrouter: [], opencode: [] },
  keys: { openrouter: false, opencode: false },
  busy: null,
  message: "",
  selectModel: (task, choice) => {
    const preferences = parseProviderPreferences(
      JSON.stringify({ ...get().preferences, [task]: choice }),
    );
    try {
      localStorage.setItem(PREF_KEY, serializeProviderPreferences(preferences));
    } catch {
      /* usable in-session */
    }
    set({ preferences });
  },
  setVoice: (voice) => {
    const preferences = { ...get().preferences, voice };
    try {
      localStorage.setItem(PREF_KEY, serializeProviderPreferences(preferences));
    } catch {
      /* usable in-session */
    }
    set({ preferences });
  },
  refreshKeyStatus: async () => {
    if (!isTauriRuntime()) return;
    const statuses = await Promise.allSettled(
      (["openrouter", "opencode"] as const).map((provider) =>
        nativeProviderCall<boolean>("provider_key_status", { provider }),
      ),
    );
    const router = statuses[0],
      zen = statuses[1];
    set({
      keys: {
        openrouter: router?.status === "fulfilled" && router.value,
        opencode: zen?.status === "fulfilled" && zen.value,
      },
    });
  },
  refreshModels: async (provider) => {
    set({ busy: provider, message: "" });
    try {
      const models = await nativeProviderCall<ProviderModel[]>(
        "provider_models",
        { provider },
      );
      set({
        models: { ...get().models, [provider]: models },
        message: getT().count("provider.modelsLoaded", models.length, {
          provider: PROVIDER_NAMES[provider],
        }),
      });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: null });
    }
  },
  saveKey: async (provider, key) => {
    try {
      await nativeProviderCall("save_provider_key", { provider, key });
      set({
        keys: { ...get().keys, [provider]: true },
        message: getT()("provider.keySaved", {
          provider: PROVIDER_NAMES[provider],
        }),
      });
      return true;
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },
  removeKey: async (provider) => {
    try {
      await nativeProviderCall("delete_provider_key", { provider });
      set({
        keys: { ...get().keys, [provider]: false },
        message: getT()("provider.keyRemoved"),
      });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
    }
  },
}));
