import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompanionSettings } from "./domain";
import { DEFAULT_SETTINGS, SAMPLE_TRANSCRIPTS } from "./domain";
import {
  buildTurnFromCapture,
  shouldUploadCapturedAudio,
  stopCaptureWithAudio,
} from "./audioCapture";
import { submitCapturedMobileAudio } from "./localApi";

function generatedWavBytes(): Uint8Array {
  const sampleRate = 8000;
  const samples = 80;
  const dataBytes = samples * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      bytes[offset + i] = value.charCodeAt(i);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(Math.sin((i / samples) * Math.PI * 2) * 32767);
    view.setInt16(44 + i * 2, sample, true);
  }
  return bytes;
}

const uploadSettings: CompanionSettings = {
  ...DEFAULT_SETTINGS,
  cloudSyncEnabled: true,
  localApiUrl: "http://localhost:8787",
  saveHistory: true,
  privacyLevel: "local_first",
};

describe("mobile audio capture/upload", () => {
  it("creates an audio job, uploads generated WAV bytes, and fetches the completed transcript", async () => {
    const wavBytes = generatedWavBytes();
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (requests.length === 1) {
        return Response.json(
          { id: "job-1", transcriptId: "transcript-1", status: "queued" },
          { status: 201 },
        );
      }
      if (requests.length === 2) {
        return Response.json({ id: "job-1", status: "processing" });
      }
      return Response.json({
        id: "transcript-1",
        rawText: "bonjour mobile",
        finalText: "Bonjour mobile.",
        language: "fr-FR",
        mode: "dictate",
        privacyMode: false,
        status: "completed",
        tags: ["mobile", "audio"],
        durationMs: 1000,
        createdAt: "2026-05-05T07:30:00.000Z",
        updatedAt: "2026-05-05T07:30:01.000Z",
      });
    };

    const result = await submitCapturedMobileAudio(
      {
        bytes: wavBytes,
        mimeType: "audio/wav",
        durationMs: 1000,
      },
      { apiUrl: "http://localhost:8787", fetchImpl },
      { language: "fr-FR" },
    );

    assert.equal(result.status, "completed");
    assert.equal(result.turn?.id, "transcript-1");
    assert.equal(result.turn?.rawText, "bonjour mobile");
    assert.equal(result.turn?.refinedText, "Bonjour mobile.");
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "http://localhost:8787/audio/jobs",
        "http://localhost:8787/audio/jobs/job-1/audio",
        "http://localhost:8787/transcripts/transcript-1",
      ],
    );
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal(requests[1]?.init?.method, "POST");
    assert.equal(
      (requests[1]?.init?.headers as Record<string, string>)["content-type"],
      "audio/wav",
    );
    assert.equal(requests[1]?.init?.body, wavBytes);
  });

  it("builds a synced transcript turn from a completed local API audio transcript", async () => {
    const turn = await stopCaptureWithAudio({
      captureStartedAt: new Date(Date.now() - 1500).toISOString(),
      settings: uploadSettings,
      historyLength: 0,
      captureAdapter: {
        start: async () => undefined,
        stop: async () => ({
          bytes: generatedWavBytes(),
          mimeType: "audio/wav",
          durationMs: 1000,
        }),
        cancel: async () => undefined,
      },
      uploadAudio: async () => ({
        status: "completed",
        turn: {
          id: "api-turn-1",
          rawText: "audio brut",
          refinedText: "Audio propre.",
          mode: "dictate",
          language: "fr-FR",
          privacyMode: false,
          createdAt: "2026-05-05T08:00:00.000Z",
          durationMs: 1000,
          source: "microphone",
          syncState: "synced",
        },
      }),
    });

    assert.equal(turn.rawText, "audio brut");
    assert.equal(turn.refinedText, "Audio propre.");
    assert.equal(turn.syncState, "synced");
  });

  it("keeps submitted audio jobs in history without replacing them with sample transcripts", async () => {
    const turn = await stopCaptureWithAudio({
      captureStartedAt: new Date(Date.now() - 1500).toISOString(),
      settings: uploadSettings,
      historyLength: 1,
      captureAdapter: {
        start: async () => undefined,
        stop: async () => ({
          bytes: generatedWavBytes(),
          mimeType: "audio/wav",
          durationMs: 1000,
        }),
        cancel: async () => undefined,
      },
      uploadAudio: async () => ({
        status: "submitted",
        jobId: "job-processing-1",
        transcriptId: "transcript-processing-1",
        message: "Capture audio envoyée à l'API locale.",
      }),
    });

    assert.equal(turn.rawText, "Capture audio envoyée à l'API locale.");
    assert.equal(turn.refinedText, "Transcription locale en cours…");
    assert.equal(turn.id, "transcript-processing-1");
    assert.equal(turn.syncState, "synced");
  });

  it("falls back to sample/local transcription when the local API upload is unavailable", async () => {
    const turn = await stopCaptureWithAudio({
      captureStartedAt: new Date(Date.now() - 1500).toISOString(),
      settings: uploadSettings,
      historyLength: 1,
      captureAdapter: {
        start: async () => undefined,
        stop: async () => ({
          bytes: generatedWavBytes(),
          mimeType: "audio/wav",
          durationMs: 1000,
        }),
        cancel: async () => undefined,
      },
      uploadAudio: async () => ({ status: "offline", message: "offline" }),
    });

    assert.equal(turn.rawText, SAMPLE_TRANSCRIPTS[1]);
    assert.equal(turn.syncState, "queued");
  });

  it("does not upload audio when privacy is ephemeral or history saving is disabled", async () => {
    for (const settings of [
      { ...uploadSettings, privacyLevel: "ephemeral" as const },
      { ...uploadSettings, saveHistory: false },
    ]) {
      let uploaded = false;
      const turn = await stopCaptureWithAudio({
        captureStartedAt: new Date(Date.now() - 1500).toISOString(),
        settings,
        historyLength: 0,
        captureAdapter: {
          start: async () => undefined,
          stop: async () => ({
            bytes: generatedWavBytes(),
            mimeType: "audio/wav",
            durationMs: 1000,
          }),
          cancel: async () => undefined,
        },
        uploadAudio: async () => {
          uploaded = true;
          return { status: "completed" };
        },
      });

      assert.equal(uploaded, false);
      assert.equal(shouldUploadCapturedAudio(settings), false);
      assert.equal(turn.syncState, "local");
    }
  });

  it("builds sample fallback turns when the adapter has no captured bytes yet", async () => {
    const turn = buildTurnFromCapture({
      settings: uploadSettings,
      historyLength: 2,
      startedAtMs: Date.now() - 1500,
    });

    assert.equal(turn.rawText, SAMPLE_TRANSCRIPTS[2]);
    assert.equal(turn.source, "microphone");
  });
});
