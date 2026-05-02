import { strict as assert } from "node:assert";
import { createApp } from "./index.js";
import type { RefinementResult, TranscriptionJob } from "@sonolect/types";

const app = await createApp({ logger: false, env: {} });

try {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(
    health.json<{ service: string }>().service,
    "sonolect-audio-service",
  );
  assert.equal(health.json<{ sttProvider: string }>().sttProvider, "mock");

  const created = await app.inject({
    method: "POST",
    url: "/transcriptions",
    payload: {
      audio: {
        uri: "gs://sonolect-dev-audio-temp/example.webm",
        mimeType: "audio/webm",
      },
      language: "en-US",
      metadata: { source: "smoke" },
    },
  });
  assert.equal(created.statusCode, 202, created.body);
  const job = created.json<TranscriptionJob>();
  assert.equal(job.status, "completed");
  assert.equal(job.provider, "mock");
  assert.ok(job.transcriptText?.includes("mock transcript"));

  const googleNotConfigured = await app.inject({
    method: "POST",
    url: "/transcriptions",
    payload: {
      audio: {
        uri: "gs://sonolect-dev-audio-temp/example.webm",
        mimeType: "audio/webm",
      },
      language: "en-US",
      provider: "google",
      metadata: { source: "google-not-configured-regression" },
    },
  });
  assert.equal(googleNotConfigured.statusCode, 202, googleNotConfigured.body);
  const googleJob = googleNotConfigured.json<TranscriptionJob>();
  assert.equal(googleJob.status, "failed");
  assert.equal(googleJob.provider, "google");
  assert.ok(googleJob.error?.includes("provider_not_configured"));
  assert.ok(googleJob.error?.includes("GOOGLE_CLOUD_PROJECT"));

  const fetched = await app.inject({
    method: "GET",
    url: `/transcriptions/${job.id}`,
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json<TranscriptionJob>().id, job.id);

  const refined = await app.inject({
    method: "POST",
    url: "/refinements",
    payload: {
      action: "translate",
      text: "Hello world.",
      language: "en",
      targetLanguage: "fr",
    },
  });
  assert.equal(refined.statusCode, 200, refined.body);
  assert.equal(refined.json<RefinementResult>().action, "translate");
  assert.ok(refined.json<RefinementResult>().outputText.includes("fr"));
} finally {
  await app.close();
}

console.log("Audio service smoke test passed");
