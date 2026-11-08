import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitCapturedAudio } from "./voiceApi";

function createDeterministicWavBytes() {
  const data = new Uint8Array([0, 64, 255, 127, 0, 128, 255, 191]);
  const bytes = new Uint8Array(44 + data.length);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return bytes;
}

describe("desktop voice API client", () => {
  it("uploads deterministic WAV fixture bytes through the real backend audio boundary", async () => {
    const wavBytes = createDeterministicWavBytes();
    const audio = new Blob([wavBytes], { type: "audio/wav" });
    let uploaded: Blob | undefined;

    const result = await submitCapturedAudio(
      audio,
      {
        durationMs: 250,
        mimeType: "audio/wav",
        sizeBytes: wavBytes.byteLength,
      },
      {
        processingMode: "cloud",
        apiUrl: "http://localhost:4321",
        desktopTranscriber: async () => undefined,
        fetchImpl: (async (_url: URL | RequestInfo, init?: RequestInit) => {
          if (init?.body instanceof Blob) {
            uploaded = init.body;
            return new Response("{}", { status: 200 });
          }
          return new Response(
            JSON.stringify({ id: "wav-job", status: "queued" }),
            { status: 201 },
          );
        }) as typeof fetch,
      },
    );

    assert.equal(result.status, "submitted");
    assert.equal(result.jobId, "wav-job");
    assert.ok(uploaded);
    assert.equal(uploaded.type, "audio/wav");
    assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), wavBytes);
    assert.equal(new TextDecoder().decode(wavBytes.slice(0, 4)), "RIFF");
    assert.equal(new TextDecoder().decode(wavBytes.slice(8, 12)), "WAVE");
  });

  it("uses in-app desktop Whisper before backend submission when available", async () => {
    let fetchCalled = false;
    const result = await submitCapturedAudio(
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
      { durationMs: 1200, mimeType: "audio/webm", sizeBytes: 3 },
      {
        processingMode: "cloud",
        apiUrl: "https://api.example.test",
        fetchImpl: async () => {
          fetchCalled = true;
          throw new Error("backend should not be called");
        },
        language: "fr",
        desktopTranscriber: async (_audio, metadata, language) => {
          assert.equal(metadata.mimeType, "audio/webm");
          assert.equal(language, "fr");
          return {
            text: " Bonjour Sonolect ",
            language: "fr",
            segments: [
              {
                id: "whisper-1",
                text: "Bonjour Sonolect",
                startMs: 0,
                endMs: 1200,
                speaker: "Speaker 1",
              },
            ],
          };
        },
      },
    );

    assert.equal(fetchCalled, false);
    assert.deepEqual(result, {
      status: "completed",
      transcript: "Bonjour Sonolect",
      message: "Transcribed on this device with local Whisper.",
      segments: [
        {
          id: "whisper-1",
          text: "Bonjour Sonolect",
          startMs: 0,
          endMs: 1200,
          speaker: "Speaker 1",
        },
      ],
    });
  });

  it("falls back to the local API when desktop Whisper is unavailable", async () => {
    const seen: string[] = [];
    const result = await submitCapturedAudio(
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
      { durationMs: 1200, mimeType: "audio/webm", sizeBytes: 3 },
      {
        processingMode: "cloud",
        apiUrl: "http://localhost:4321",
        desktopTranscriber: async () => {
          throw new Error("Whisper command args are not configured");
        },
        fetchImpl: async (url: URL | RequestInfo) => {
          seen.push(String(url));
          if (seen.length === 1) {
            return new Response(
              JSON.stringify({ id: "job-2", status: "queued" }),
              {
                status: 201,
              },
            );
          }
          return new Response(JSON.stringify({ id: "job-2" }), { status: 200 });
        },
      },
    );

    assert.equal(result.status, "submitted");
    assert.equal(result.jobId, "job-2");
    assert.deepEqual(seen, [
      "http://localhost:4321/audio/jobs",
      "http://localhost:4321/audio/jobs/job-2/audio",
    ]);
  });

  it("creates an audio job then uploads the captured binary", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      if (seen.length === 1) {
        return new Response(
          JSON.stringify({
            id: "job-1",
            transcriptId: "transcript-1",
            status: "queued",
          }),
          { status: 201 },
        );
      }
      return new Response(JSON.stringify({ id: "job-1", status: "queued" }), {
        status: 200,
      });
    };

    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await submitCapturedAudio(
      audio,
      { durationMs: 2500, mimeType: "audio/webm", sizeBytes: audio.size },
      {
        processingMode: "cloud",
        apiUrl: "http://localhost:4321",
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    assert.equal(result.status, "submitted");
    assert.equal(result.jobId, "job-1");
    assert.equal(result.transcript, "transcript-1");
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.url, "http://localhost:4321/audio/jobs");
    assert.equal(seen[0]?.init.method, "POST");
    assert.equal(seen[1]?.url, "http://localhost:4321/audio/jobs/job-1/audio");
    assert.equal(seen[1]?.init.method, "POST");
    assert.equal(
      (seen[1]?.init.headers as Record<string, string>)["content-type"],
      "audio/webm",
    );
    assert.equal(seen[1]?.init.body, audio);
  });

  it("falls back to offline retention when the configured local API is unavailable", async () => {
    const audio = new Blob([new Uint8Array([1])], { type: "audio/webm" });
    const result = await submitCapturedAudio(
      audio,
      { durationMs: 1000, mimeType: "audio/webm", sizeBytes: audio.size },
      {
        processingMode: "cloud",
        apiUrl: "http://localhost:4321",
        fetchImpl: async () => {
          throw new Error("connection refused");
        },
      },
    );

    assert.equal(result.status, "offline");
    assert.match(result.message ?? "", /connection refused/);
  });
});
