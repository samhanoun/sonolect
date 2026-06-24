import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitCapturedAudioCloud } from "./voiceApi";

describe("cloud dictation loop", () => {
  it("transcribes then polishes via the /v1 endpoints", async () => {
    const seen: string[] = [];
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await submitCapturedAudioCloud(
      audio,
      { durationMs: 1000, mimeType: "audio/webm", sizeBytes: 3 },
      {
        apiUrl: "http://localhost:4321",
        desktopTranscriber: async () => undefined,
        fetchImpl: (async (url: URL | RequestInfo) => {
          const target = String(url);
          seen.push(target);
          if (target.includes("/v1/transcribe")) {
            return new Response(
              JSON.stringify({ transcript: "um the meeting moved to tuesday" }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({ polished: "The meeting moved to Tuesday." }),
            { status: 200 },
          );
        }) as typeof fetch,
      },
    );

    assert.equal(result.status, "completed");
    assert.equal(result.transcript, "The meeting moved to Tuesday.");
    assert.equal(seen.length, 2);
    assert.ok(seen[0]?.includes("/v1/transcribe"));
    assert.ok(seen[1]?.includes("/v1/polish"));
  });

  it("prefers desktop Whisper before the cloud loop", async () => {
    let fetchCalled = false;
    const result = await submitCapturedAudioCloud(
      new Blob([new Uint8Array([1])], { type: "audio/webm" }),
      { durationMs: 500, mimeType: "audio/webm", sizeBytes: 1 },
      {
        apiUrl: "http://localhost:4321",
        fetchImpl: async () => {
          fetchCalled = true;
          throw new Error("backend should not be called");
        },
        desktopTranscriber: async () => ({
          text: "Local text",
          language: "en",
          segments: [],
        }),
      },
    );

    assert.equal(fetchCalled, false);
    assert.equal(result.status, "completed");
    assert.equal(result.transcript, "Local text");
  });

  it("falls back to offline retention when cloud and Whisper are unavailable", async () => {
    const result = await submitCapturedAudioCloud(
      new Blob([new Uint8Array([1])], { type: "audio/webm" }),
      { durationMs: 500, mimeType: "audio/webm", sizeBytes: 1 },
      {
        apiUrl: "http://localhost:4321",
        desktopTranscriber: async () => undefined,
        fetchImpl: async () => {
          throw new Error("connection refused");
        },
      },
    );

    assert.equal(result.status, "offline");
  });
});
