/**
 * How saved recordings are kept on disk.
 *
 * A recording is always made as a 16 kHz mono WAV, the speech engine's
 * format, which survives a crash mid-recording. With compressed storage,
 * each finished recording is then turned into Ogg Opus on the native side
 * (`compress_local_captures`), about a tenth of the size. In high quality, a
 * live recording also writes a 48 kHz Opus copy while it is made (stereo
 * when its source is), which takes the WAV's place when it ends. Playback
 * and transcribing again work the same with every format.
 */
import type { NativeCall } from "./privacyControls";

export const CAPTURE_FORMATS = ["wav", "opus", "hq"] as const;
export type CaptureFormat = (typeof CAPTURE_FORMATS)[number];

/** How a live recording is made: what `capture_begin` takes. */
export type CaptureQuality = "speech" | "high";

/** High quality for the "hq" choice; speech quality otherwise. */
export function captureQuality(
  format: CaptureFormat = loadCaptureFormat(),
): CaptureQuality {
  return format === "hq" ? "high" : "speech";
}

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

/** The saved choice; WAV until the user picks another one. */
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
 * is still WAV when the user chose compressed storage or high quality (whose
 * imports and interrupted recordings are kept as Opus too), and does nothing
 * otherwise. Recordings are never expanded back.
 */
export async function applyCaptureFormat(
  call: NativeCall,
  format: CaptureFormat = loadCaptureFormat(),
): Promise<CompressResult | undefined> {
  if (format === "wav") return undefined;
  return compressCaptures(call);
}

/** Opus at 24 kbit/s (speech) and at 96 kbit/s (high quality, stereo). */
const OPUS_BYTES_PER_MS = { opus: 3, hq: 12 } as const;

/**
 * What a finished live recording is saved as. A WAV's size is exact (a
 * 44-byte header, then 32 bytes a millisecond); an Opus file's is its
 * bitrate's, the most it takes.
 */
export function savedCaptureMetadata(
  durationMs: number,
  format: CaptureFormat = loadCaptureFormat(),
): { durationMs: number; mimeType: string; sizeBytes: number } {
  const ms = Math.max(0, Math.round(durationMs));
  return format === "wav"
    ? { durationMs: ms, mimeType: "audio/wav", sizeBytes: 44 + ms * 32 }
    : {
        durationMs: ms,
        mimeType: "audio/ogg",
        sizeBytes: ms * OPUS_BYTES_PER_MS[format],
      };
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
