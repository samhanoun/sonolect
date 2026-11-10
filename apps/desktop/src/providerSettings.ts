import { create } from "zustand";
import { isTauriRuntime } from "./desktopNative";
import { prepareLocalAudio } from "./localAudio";
import type { VoiceCaptureMetadata } from "./voiceApi";
import type { DesktopWhisperResult } from "./desktopWhisper";

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
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime())
    throw new Error(
      "Open the Windows app to use secure keys and native speech. This window is a browser preview.",
    );
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
export async function setProviderMode(enabled: boolean) {
  if (isTauriRuntime())
    await nativeProviderCall("set_online_enabled", { enabled });
}
async function withCloudConsent<T>(
  allowed: () => boolean,
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!allowed())
    throw new Error(
      "Choose cloud processing before sending audio or text online.",
    );
  await setProviderMode(true);
  if (!allowed()) {
    await setProviderMode(false);
    throw new Error("Cloud processing was cancelled.");
  }
  return nativeProviderCall<T>(command, args);
}
export async function transcribeUsingProvider(
  audio: Blob,
  metadata: VoiceCaptureMetadata,
  choice: ModelChoice,
  language: string,
  allowed: () => boolean,
): Promise<DesktopWhisperResult> {
  if (choice.provider !== "openrouter" || !choice.model)
    throw new Error(
      "Select an OpenRouter speech-to-text model in Models & voices.",
    );
  const bytes = await prepareLocalAudio(audio);
  return withCloudConsent(allowed, "provider_transcribe", {
    provider: choice.provider,
    model: choice.model,
    payload: {
      audioBytes: Array.from(bytes),
      mimeType: "audio/wav",
      durationMs: metadata.durationMs,
      language,
    },
  });
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
    throw new Error("Select an OpenRouter text-to-speech model first.");
  const result = await withCloudConsent<{ bytes: number[]; mimeType: string }>(
    allowed,
    "provider_speak",
    {
      provider: choice.provider,
      model: choice.model,
      text,
      voice,
      responseFormat,
      sampleRate,
    },
  );
  return new Blob([new Uint8Array(result.bytes)], { type: result.mimeType });
}
export async function rewriteUsingProvider(
  text: string,
  instruction: string,
  choice: ModelChoice,
  allowed: () => boolean,
) {
  if (choice.provider === "local" || !choice.model)
    throw new Error("Select a text editing model in Models & voices.");
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
        message: `${models.length} compatible models loaded from ${PROVIDER_NAMES[provider]}.`,
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
        message: `${PROVIDER_NAMES[provider]} key saved in Windows Credential Manager. It has not been billed or used for a test request.`,
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
        message: "Saved key removed.",
      });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
    }
  },
}));
