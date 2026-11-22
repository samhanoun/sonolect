import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  previewCanTranscribe,
  requestSignal,
  submitCapturedAudio,
} from "./voiceApi";

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
    // The id of a transcript still to be written is not its text: nothing
    // would otherwise stop it being pasted into the app in front.
    assert.equal(result.transcriptId, "transcript-1");
    assert.equal(result.transcript, undefined);
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

describe("what the browser preview can transcribe", () => {
  const privacyLevels = ["local", "cloud"] as const;
  const sttProviders = ["local", "openrouter"] as const;
  const apiConfigured = [false, true] as const;

  for (const privacyLevel of privacyLevels) {
    for (const sttProvider of sttProviders) {
      for (const api of apiConfigured) {
        // Only Cloud enabled, local speech and a Sonolect API work today.
        const expected =
          privacyLevel === "cloud" && sttProvider === "local" && api;
        it(`${privacyLevel} privacy, ${sttProvider} speech, ${api ? "with" : "without"} an API: ${expected ? "transcribes" : "refuses"}`, () => {
          assert.equal(
            previewCanTranscribe({ privacyLevel, sttProvider }, api),
            expected,
          );
        });
      }
    }
  }

  it("covers every combination, and exactly one transcribes", () => {
    const results = privacyLevels.flatMap((privacyLevel) =>
      sttProviders.flatMap((sttProvider) =>
        apiConfigured.map((api) =>
          previewCanTranscribe({ privacyLevel, sttProvider }, api),
        ),
      ),
    );
    assert.equal(results.length, 8);
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("reads the build's API URL, which unit tests run without", () => {
    assert.equal(
      previewCanTranscribe({ privacyLevel: "cloud", sttProvider: "local" }),
      false,
    );
  });
});

describe("the signal a request is sent with", () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 30));

  it("uses AbortSignal.timeout and AbortSignal.any where they exist", () => {
    const made: string[] = [];
    const caller = new AbortController();
    const statics = {
      timeout: (ms: number) => {
        made.push(`timeout ${ms}`);
        return AbortSignal.timeout(ms);
      },
      any: (signals: AbortSignal[]) => {
        made.push(`any ${signals.length}`);
        return AbortSignal.any(signals);
      },
    };
    requestSignal(caller.signal, 60_000, statics).settle();
    assert.deepEqual(made, ["timeout 60000", "any 2"]);
  });

  it("aborts when the caller does, in a webview without them", () => {
    const caller = new AbortController();
    const { signal, settle } = requestSignal(caller.signal, 60_000, {});
    assert.equal(signal.aborted, false);
    caller.abort(new Error("cancelled"));
    assert.equal(signal.aborted, true);
    assert.equal((signal.reason as Error).message, "cancelled");
    settle();
    const before = new AbortController();
    before.abort();
    const already = requestSignal(before.signal, 60_000, {});
    assert.equal(already.signal.aborted, true);
    already.settle();
  });

  it("times out in a webview without them, unless the request is done", async () => {
    const late = requestSignal(undefined, 5, {});
    await settled();
    assert.equal(late.signal.aborted, true);
    assert.equal((late.signal.reason as DOMException).name, "TimeoutError");

    const done = requestSignal(undefined, 5, {});
    done.settle();
    await settled();
    assert.equal(done.signal.aborted, false);
  });

  it("lets go of the caller's signal once settled, timed out or aborted", async () => {
    // A caller's signal that counts who listens to it.
    const listening = new Set<unknown>();
    const caller = () =>
      ({
        aborted: false,
        reason: undefined,
        addEventListener: (_type: string, listener: unknown) =>
          listening.add(listener),
        removeEventListener: (_type: string, listener: unknown) =>
          listening.delete(listener),
      }) as unknown as AbortSignal;

    requestSignal(caller(), 60_000, {}).settle();
    assert.equal(listening.size, 0);

    const late = requestSignal(caller(), 5, {});
    assert.equal(listening.size, 1);
    await settled();
    assert.equal(late.signal.aborted, true);
    assert.equal(listening.size, 0);

    const real = new AbortController();
    const done = requestSignal(real.signal, 60_000, {});
    done.settle();
    real.abort();
    assert.equal(done.signal.aborted, false);
  });

  it("keeps a timeout with a caller's signal where only timeout exists", async () => {
    // macOS 11: AbortSignal.timeout, but no AbortSignal.any.
    const caller = new AbortController();
    const { signal, settle } = requestSignal(caller.signal, 60_000, {
      timeout: AbortSignal.timeout,
    });
    caller.abort();
    assert.equal(signal.aborted, true);
    settle();
  });
});
