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

// With a token configured, one user cannot read another user's job.
const serviceToken = "s".repeat(40);
const guarded = await createApp({
  logger: false,
  env: { SONOLECT_SERVICE_TOKENS: serviceToken },
});
try {
  const headers = {
    authorization: `Bearer ${serviceToken}`,
    "x-user-id": "user-1",
  };
  const created = await guarded.inject({
    method: "POST",
    url: "/transcriptions",
    headers,
    payload: {
      audio: {
        uri: "gs://sonolect-dev-audio/example.webm",
        mimeType: "audio/webm",
      },
    },
  });
  assert.equal(created.statusCode, 202, created.body);
  const job = created.json<TranscriptionJob>();

  const otherUser = await guarded.inject({
    method: "GET",
    url: `/transcriptions/${job.id}`,
    headers: { ...headers, "x-user-id": "user-2" },
  });
  assert.equal(otherUser.statusCode, 404);

  const owner = await guarded.inject({
    method: "GET",
    url: `/transcriptions/${job.id}`,
    headers,
  });
  assert.equal(owner.statusCode, 200, owner.body);
} finally {
  await guarded.close();
}

// Production: service token required, and no fabricated output of any kind.
const production = await createApp({
  logger: false,
  env: { NODE_ENV: "production", SONOLECT_SERVICE_TOKENS: serviceToken },
});
try {
  const headers = {
    authorization: `Bearer ${serviceToken}`,
    "x-user-id": "user-1",
  };
  const audio = {
    uri: "gs://sonolect-prod-audio/example.webm",
    mimeType: "audio/webm",
  };

  const anonymous = await production.inject({
    method: "POST",
    url: "/transcriptions",
    headers: { "x-user-id": "user-1" },
    payload: { audio },
  });
  assert.equal(anonymous.statusCode, 401, anonymous.body);

  // No provider can transcribe here in production, so the job endpoints
  // answer 501 and store nothing.
  for (const request of [
    { method: "POST", url: "/transcriptions", payload: { audio } },
    {
      method: "POST",
      url: "/transcriptions",
      payload: { audio, provider: "google" },
    },
    { method: "GET", url: "/transcriptions/any-id" },
    { method: "POST", url: "/transcriptions/any-id/cancel" },
  ] as const) {
    const response = await production.inject({ ...request, headers });
    assert.equal(response.statusCode, 501, response.body);
    assert.equal(response.json<{ error: string }>().error, "not_implemented");
    assert.ok(!response.body.includes("mock transcript"));
  }

  const translate = await production.inject({
    method: "POST",
    url: "/refinements",
    headers,
    payload: { action: "translate", text: "Hello.", targetLanguage: "fr" },
  });
  assert.equal(translate.statusCode, 501, translate.body);

  const clean = await production.inject({
    method: "POST",
    url: "/refinements",
    headers,
    payload: { action: "clean", text: "um hello  there ." },
  });
  assert.equal(clean.statusCode, 200, clean.body);
  assert.equal(clean.json<RefinementResult>().outputText, "hello there.");
} finally {
  await production.close();
}

console.log("Audio service smoke test passed");
