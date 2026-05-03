import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitCapturedAudio } from "./voiceApi";

describe("desktop voice API client", () => {
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
      { apiUrl: "http://localhost:4321", fetchImpl: fetchImpl as typeof fetch },
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
