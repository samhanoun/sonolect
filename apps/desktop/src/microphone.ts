/**
 * Choosing which microphone records: listing the inputs the system offers,
 * remembering the choice, and opening it (or the system default when the
 * chosen one is unplugged).
 */

import type { CaptureQuality } from "./captureStorage";
import type { RecordingState } from "./store/appStore";

/** The saved microphone; absent or empty means the system default. */
export const MIC_DEVICE_KEY = "sonolect.micDeviceId";

export type Microphone = {
  deviceId: string;
  /** The name the system gives it; empty until microphone access is allowed. */
  label: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadMicDeviceId(
  storage: StorageLike | undefined = browserStorage(),
): string {
  try {
    return storage?.getItem(MIC_DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveMicDeviceId(
  deviceId: string,
  storage: StorageLike | undefined = browserStorage(),
): void {
  try {
    if (deviceId) storage?.setItem(MIC_DEVICE_KEY, deviceId);
    else storage?.removeItem(MIC_DEVICE_KEY);
  } catch {
    // The choice then lasts for this session only.
  }
}

/**
 * The microphones the system offers. Chromium-based webviews also list
 * "default" and "communications" aliases of real devices; those are left
 * out, since the app has its own "System default" entry.
 */
export async function listMicrophones(
  devices: Pick<MediaDevices, "enumerateDevices"> | undefined = globalThis
    .navigator?.mediaDevices,
): Promise<Microphone[]> {
  if (!devices?.enumerateDevices) return [];
  const all = await devices.enumerateDevices();
  const seen = new Set<string>();
  const microphones: Microphone[] = [];
  for (const device of all) {
    if (device.kind !== "audioinput") continue;
    const id = device.deviceId;
    if (!id || id === "default" || id === "communications" || seen.has(id))
      continue;
    seen.add(id);
    microphones.push({ deviceId: id, label: device.label.trim() });
  }
  return microphones;
}

/**
 * What to ask the browser for: the chosen microphone, or any. A
 * high-quality recording also asks for 48 kHz and two channels where the
 * microphone has them. Echo cancellation, noise suppression and automatic
 * gain stay as the browser sets them (on), as for every recording.
 */
export function microphoneConstraints(
  deviceId: string,
  quality: CaptureQuality = "speech",
): MediaStreamConstraints {
  const device = deviceId ? { deviceId: { exact: deviceId } } : {};
  if (quality === "high")
    return {
      audio: {
        ...device,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48000 },
      },
    };
  return deviceId ? { audio: device } : { audio: true };
}

function deviceIsGone(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError";
}

export type OpenedMicrophone = {
  stream: MediaStream;
  /** The chosen microphone was not there, so the system default records. */
  fellBack: boolean;
};

/**
 * Opens the chosen microphone. When it has been unplugged the system default
 * is used instead, so a recording still starts; `fellBack` says so. Any
 * other failure (permission refused, no microphone at all) is thrown.
 */
export async function openMicrophone(
  deviceId: string,
  devices: Pick<MediaDevices, "getUserMedia"> = navigator.mediaDevices,
  quality: CaptureQuality = "speech",
): Promise<OpenedMicrophone> {
  if (!deviceId)
    return {
      stream: await devices.getUserMedia(microphoneConstraints("", quality)),
      fellBack: false,
    };
  try {
    return {
      stream: await devices.getUserMedia(
        microphoneConstraints(deviceId, quality),
      ),
      fellBack: false,
    };
  } catch (error) {
    if (!deviceIsGone(error)) throw error;
    return {
      stream: await devices.getUserMedia(microphoneConstraints("", quality)),
      fellBack: true,
    };
  }
}

/** The name shown for a microphone, numbered when the system gives none. */
export function microphoneName(
  microphone: Microphone,
  index: number,
  fallback: (position: number) => string,
): string {
  return microphone.label || fallback(index + 1);
}

/**
 * Where a loudness (0 to 1, as `pcmLevel` gives it) sits on a meter that runs
 * from -60 dB to 0 dB, as a fraction from 0 to 1. Quiet speech is around
 * 0.5; a meter of raw loudness would barely move.
 */
export function meterPosition(level: number): number {
  if (!(level > 0)) return 0;
  const decibels = 20 * Math.log10(Math.min(1, level));
  return Math.max(0, Math.min(1, (decibels + 60) / 60));
}

/**
 * Whether a dictation keeps the microphone test from starting. One that is
 * under way always does. In the app, one that failed also does until its
 * message is dismissed. The browser preview refuses before the microphone
 * opens, so its refusal leaves the test free.
 */
export function micTestBlocked(
  recordingState: RecordingState,
  native: boolean,
): boolean {
  if (recordingState === "idle" || recordingState === "completed") return false;
  return recordingState !== "error" || native;
}
