import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPTURE_FORMATS,
  CAPTURE_FORMAT_KEY,
  applyCaptureFormat,
  captureQuality,
  compressCaptures,
  formatSize,
  loadCaptureFormat,
  saveCaptureFormat,
  savedCaptureMetadata,
} from "./captureStorage";
import type { NativeCall } from "./privacyControls";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

function recordingCall(result: unknown) {
  const calls: string[] = [];
  const call = (async (command: string) => {
    calls.push(command);
    return result;
  }) as NativeCall;
  return { call, calls };
}

test("recordings stay WAV until compressed storage is chosen", () => {
  assert.equal(loadCaptureFormat(memoryStorage()), "wav");
  assert.equal(
    loadCaptureFormat(memoryStorage({ [CAPTURE_FORMAT_KEY]: "flac" })),
    "wav",
  );
  assert.equal(loadCaptureFormat(undefined), "wav");
  const storage = memoryStorage();
  saveCaptureFormat("opus", storage);
  assert.equal(loadCaptureFormat(storage), "opus");
  saveCaptureFormat("wav", storage);
  assert.equal(loadCaptureFormat(storage), "wav");
});

test("high quality is a third choice, kept under the same key", () => {
  assert.deepEqual([...CAPTURE_FORMATS], ["wav", "opus", "hq"]);
  const storage = memoryStorage();
  saveCaptureFormat("hq", storage);
  assert.equal(loadCaptureFormat(storage), "hq");
  assert.equal(
    loadCaptureFormat(memoryStorage({ [CAPTURE_FORMAT_KEY]: "hq" })),
    "hq",
  );
  // Only that choice records in high quality.
  assert.equal(captureQuality("hq"), "high");
  assert.equal(captureQuality("opus"), "speech");
  assert.equal(captureQuality("wav"), "speech");
});

test("a storage that throws falls back to WAV", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
  };
  assert.equal(loadCaptureFormat(broken), "wav");
  assert.doesNotThrow(() => saveCaptureFormat("opus", broken));
});

test("only compressed storage compresses after a recording", async () => {
  const result = { recordings: 2, bytesFreed: 1_800_000, failed: 0 };
  const wav = recordingCall(result);
  assert.equal(await applyCaptureFormat(wav.call, "wav"), undefined);
  assert.deepEqual(wav.calls, []);

  const opus = recordingCall(result);
  assert.deepEqual(await applyCaptureFormat(opus.call, "opus"), result);
  assert.deepEqual(opus.calls, ["compress_local_captures"]);

  // High quality keeps imports and interrupted recordings as Opus too.
  const hq = recordingCall(result);
  assert.deepEqual(await applyCaptureFormat(hq.call, "hq"), result);
  assert.deepEqual(hq.calls, ["compress_local_captures"]);

  const manual = recordingCall(result);
  assert.deepEqual(await compressCaptures(manual.call), result);
  assert.deepEqual(manual.calls, ["compress_local_captures"]);
});

test("a finished recording is described as the file it is saved as", () => {
  assert.deepEqual(savedCaptureMetadata(1000, "wav"), {
    durationMs: 1000,
    mimeType: "audio/wav",
    sizeBytes: 32_044,
  });
  assert.deepEqual(savedCaptureMetadata(1000, "opus"), {
    durationMs: 1000,
    mimeType: "audio/ogg",
    sizeBytes: 3000,
  });
  assert.deepEqual(savedCaptureMetadata(1000.4, "hq"), {
    durationMs: 1000,
    mimeType: "audio/ogg",
    sizeBytes: 12_000,
  });
  assert.equal(savedCaptureMetadata(-5, "wav").sizeBytes, 44);
});

test("sizes read the way each language writes them", () => {
  assert.equal(formatSize(0, "en"), "0 kB");
  assert.equal(formatSize(512_000, "en"), "512 kB");
  assert.equal(formatSize(12_400_000, "en"), "12.4 MB");
  assert.equal(formatSize(460_000_000, "en"), "460 MB");
  assert.equal(formatSize(1_250_000_000, "en"), "1.3 GB");
  // French uses a comma, a no-break space and "Mo".
  assert.match(formatSize(12_400_000, "fr"), /^12,4\sMo$/);
  assert.equal(formatSize(-5, "en"), "0 kB");
});
