/**
 * How saved recordings are kept on disk.
 *
 * A recording is always made as WAV, which survives a crash mid-recording.
 * With compressed storage, each finished recording is then turned into Ogg
 * Opus on the native side (`compress_local_captures`), about a tenth of the
 * size. Playback and transcribing again work the same with either format.
 */
import type { NativeCall } from "./privacyControls";

export const CAPTURE_FORMATS = ["wav", "opus"] as const;
export type CaptureFormat = (typeof CAPTURE_FORMATS)[number];

export const CAPTURE_FORMAT_KEY = "sonolect.captureFormat";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function isCaptureFormat(value: unknown): value is CaptureFormat {
  return (CAPTURE_FORMATS as readonly unknown[]).includes(value);
}

/** The saved choice; WAV until the user picks compressed storage. */
export function loadCaptureFormat(
  storage: StorageLike | undefined = browserStorage(),
): CaptureFormat {
  try {
    const value = storage?.getItem(CAPTURE_FORMAT_KEY);
    return isCaptureFormat(value) ? value : "wav";
  } catch {
    return "wav";
  }
}

export function saveCaptureFormat(
  format: CaptureFormat,
  storage: StorageLike | undefined = browserStorage(),
) {
  try {
    storage?.setItem(CAPTURE_FORMAT_KEY, format);
  } catch {
    // Storage can be unavailable or full; the default (WAV) still applies.
  }
}

export type CompressResult = {
  /** Recordings compressed by this call. */
  recordings: number;
  bytesFreed: number;
  /** Recordings that could not be compressed; they stay as WAV. */
  failed: number;
};

/** Compresses every finished recording that is still a WAV. */
export function compressCaptures(call: NativeCall): Promise<CompressResult> {
  return call<CompressResult>("compress_local_captures");
}

/**
 * Applies the storage choice after a recording or an import: compresses what
 * is still WAV when the user chose compressed storage, and does nothing
 * otherwise. Recordings are never expanded back.
 */
export async function applyCaptureFormat(
  call: NativeCall,
  format: CaptureFormat = loadCaptureFormat(),
): Promise<CompressResult | undefined> {
  if (format !== "opus") return undefined;
  return compressCaptures(call);
}

const SIZE_UNITS = ["kilobyte", "megabyte", "gigabyte"] as const;

/** "512 kB", "12.4 MB", "1.2 GB": a size the way the locale writes it. */
export function formatSize(bytes: number, locale: string): string {
  let value = Math.max(0, bytes) / 1000;
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: SIZE_UNITS[unit],
    unitDisplay: "short",
    maximumFractionDigits: value < 100 && unit > 0 ? 1 : 0,
  }).format(value);
}
