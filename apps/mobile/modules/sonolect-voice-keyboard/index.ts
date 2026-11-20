import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/**
 * Sonolect voice keyboard (Android only): an input method with one big mic
 * that types what you say into any app. iOS keyboards cannot use the
 * microphone, so there the app offers quick dictation + paste instead.
 */

export type VoiceKeyboardStatus = {
  /** The module is compiled into this build (Android dev/release builds). */
  supported: boolean;
  /** Turned on in Settings › System › Keyboard. */
  enabled: boolean;
  /** Currently the active keyboard. */
  selected: boolean;
  onDeviceRecognition: boolean;
  recognitionAvailable: boolean;
};

type NativeModule = {
  getStatus(): Omit<VoiceKeyboardStatus, "supported">;
  openKeyboardSettings(): void;
  showKeyboardPicker(): Promise<void>;
  setPreferences(allowSystemService: boolean, language: string): void;
};

let cached: NativeModule | null | undefined;

function native(): NativeModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== "android") return cached;
  try {
    cached = requireOptionalNativeModule<NativeModule>("SonolectVoiceKeyboard");
  } catch {
    cached = null;
  }
  return cached;
}

const UNSUPPORTED: VoiceKeyboardStatus = {
  supported: false,
  enabled: false,
  selected: false,
  onDeviceRecognition: false,
  recognitionAvailable: false,
};

export function getVoiceKeyboardStatus(): VoiceKeyboardStatus {
  const mod = native();
  if (!mod) return UNSUPPORTED;
  try {
    return { supported: true, ...mod.getStatus() };
  } catch {
    return UNSUPPORTED;
  }
}

export function openVoiceKeyboardSettings(): boolean {
  const mod = native();
  if (!mod) return false;
  try {
    mod.openKeyboardSettings();
    return true;
  } catch {
    return false;
  }
}

export async function showVoiceKeyboardPicker(): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  try {
    await mod.showKeyboardPicker();
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirror the app's privacy and language settings into the keyboard. The
 * keyboard falls back to the system speech service only when
 * `allowSystemService` is true (see systemServiceAllowedWithoutAsking);
 * otherwise it stays on the on-device recognizer.
 */
export function syncVoiceKeyboardPreferences(settings: {
  allowSystemService: boolean;
  language: string;
}): void {
  const mod = native();
  if (!mod) return;
  try {
    mod.setPreferences(settings.allowSystemService, settings.language);
  } catch {
    // Older build without the module: nothing to sync.
  }
}
