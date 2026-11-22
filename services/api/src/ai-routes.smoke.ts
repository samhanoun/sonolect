import assert from "node:assert/strict";
import { ClientError, GoogleApiError } from "@google-cloud/vertexai";
import { createApp } from "./index.js";
import { MAX_POLISH_CHARS } from "./ai.js";
import { createAuthenticatedTestApp } from "./test-app.js";

// Runs without GCP credentials: the routes should register and validate input,
// returning graceful errors (not crashing) when the cloud loop is unconfigured.
const app = await createApp({ logger: false });

const transcribe = await app.inject({
  method: "POST",
  url: "/v1/transcribe",
  headers: { "content-type": "audio/webm" },
  payload: Buffer.from([1, 2, 3]),
});
assert.equal(transcribe.statusCode, 503);
assert.equal(transcribe.json().error.code, "not_configured");

const polishNoBody = await app.inject({
  method: "POST",
  url: "/v1/polish",
  payload: {},
});
assert.equal(polishNoBody.statusCode, 400);
assert.equal(polishNoBody.json().error.code, "invalid_request");

const polishUnconfigured = await app.inject({
  method: "POST",
  url: "/v1/polish",
  payload: { transcript: "um so the meeting moved to tuesday" },
});
assert.equal(polishUnconfigured.statusCode, 503);
assert.equal(polishUnconfigured.json().error.code, "not_configured");

const tooLarge = await app.inject({
  method: "POST",
  url: "/v1/polish",
  payload: { transcript: "a".repeat(MAX_POLISH_CHARS + 1) },
});
assert.equal(tooLarge.statusCode, 413);
assert.equal(tooLarge.json().error.code, "too_large");

await app.close();

// Paid routes have a per-account budget; one account cannot use up another's.
const limited = await createAuthenticatedTestApp({
  logger: false,
  aiRouteLimits: { maxRequests: 2, windowMs: 60_000 },
});
const polishAs = (user: string) =>
  limited.inject({
    method: "POST",
    url: "/v1/polish",
    headers: { authorization: `Bearer ${user}` },
    payload: { transcript: "hello" },
  });
assert.equal((await polishAs("user-a")).statusCode, 503);
assert.equal((await polishAs("user-a")).statusCode, 503);
const blocked = await polishAs("user-a");
assert.equal(blocked.statusCode, 429);
assert.equal(blocked.json().error.code, "rate_limited");
assert.ok(blocked.headers["retry-after"]);
assert.equal((await polishAs("user-b")).statusCode, 503);
// Unauthenticated calls are rejected before they reach the budget.
const anonymous = await limited.inject({
  method: "POST",
  url: "/v1/polish",
  payload: { transcript: "hello" },
});
assert.equal(anonymous.statusCode, 401);
await limited.close();

// Fake providers, so the routes run past the "not configured" check.
const transcribeCalls: { bytes: number; language: string }[] = [];
let transcribeFailure: unknown;
let polishFailure: unknown;
const configuredProviders = {
  configured: () => true,
  transcribe: async (audio: Buffer, language = "en-US") => {
    if (transcribeFailure) throw transcribeFailure;
    transcribeCalls.push({ bytes: audio.length, language });
    return { transcript: "hello", language };
  },
  polish: async (opts: { transcript: string }) => {
    if (polishFailure) throw polishFailure;
    return { polished: opts.transcript, model: "test" };
  },
};
const configured = await createApp({
  logger: false,
  aiProviders: configuredProviders,
});
const transcribeWith = (contentType: string, payload: Buffer) =>
  configured.inject({
    method: "POST",
    url: "/v1/transcribe?language=fr-FR",
    headers: { "content-type": contentType },
    payload,
  });

// Chromium records audio/webm;codecs=opus, and the apps send the recorder's
// type as it is. Media type parameters must not turn the upload into a 415.
for (const contentType of [
  "audio/webm",
  "audio/webm;codecs=opus",
  'audio/ogg; codecs="opus"',
  "AUDIO/MP4; codecs=mp4a.40.2",
]) {
  const response = await transcribeWith(contentType, Buffer.from([1, 2, 3]));
  assert.equal(response.statusCode, 200, `${contentType}: ${response.body}`);
  assert.equal(response.json().transcript, "hello");
}
assert.equal(transcribeCalls.length, 4);
assert.equal(transcribeCalls[0]?.language, "fr-FR");
const notAudio = await transcribeWith("text/plain", Buffer.from("hi"));
assert.equal(notAudio.statusCode, 400, notAudio.body);

// Google's synchronous recognize takes at most 10 MB of inline audio, so a
// bigger body is refused before it is read, and the client is told not to
// send it again.
const googleSyncLimit = 10 * 1024 * 1024;
transcribeCalls.length = 0;
const atLimit = await transcribeWith(
  "audio/webm;codecs=opus",
  Buffer.alloc(googleSyncLimit),
);
assert.equal(atLimit.statusCode, 200, atLimit.body);
const overLimit = await transcribeWith(
  "audio/webm;codecs=opus",
  Buffer.alloc(googleSyncLimit + 1),
);
assert.equal(overLimit.statusCode, 413, overLimit.body);
assert.deepEqual(overLimit.json().error, {
  code: "audio_too_large",
  message: overLimit.json().error.message,
  retryable: false,
});
assert.match(overLimit.json().error.message, /10485760 bytes/);
assert.equal(transcribeCalls.length, 1);

// A provider error is logged, never returned. Errors that would fail again
// in the same way are marked not retryable, and a missing model has its own
// code so a retired model shows up in monitoring.
const grpcError = (code: number, message: string) =>
  Object.assign(new Error(`${code} ${message}`), { code });
const vertexError = (code: number, status: string) =>
  new ClientError(
    `got status: ${code}. {"error":{"code":${code},"status":"${status}"}}`,
    new GoogleApiError("Publisher model was not found", code, status),
  );
const expectError = async (
  response: Awaited<ReturnType<typeof transcribeWith>>,
  statusCode: number,
  code: string,
  retryable: boolean,
) => {
  assert.equal(response.statusCode, statusCode, response.body);
  assert.equal(response.json().error.code, code, response.body);
  assert.equal(response.json().error.retryable, retryable, response.body);
  assert.doesNotMatch(response.body, /Publisher|INVALID_ARGUMENT|NOT_FOUND/);
};
const audio = Buffer.from([1, 2, 3]);
transcribeFailure = grpcError(3, "INVALID_ARGUMENT: Audio is too long");
await expectError(
  await transcribeWith("audio/webm", audio),
  422,
  "audio_rejected",
  false,
);
transcribeFailure = grpcError(5, "NOT_FOUND: Recognizer not found");
await expectError(
  await transcribeWith("audio/webm", audio),
  502,
  "model_not_found",
  false,
);
transcribeFailure = grpcError(14, "UNAVAILABLE: try again");
await expectError(
  await transcribeWith("audio/webm", audio),
  503,
  "transcribe_failed",
  true,
);
transcribeFailure = undefined;

const polishWith = () =>
  configured.inject({
    method: "POST",
    url: "/v1/polish",
    payload: { transcript: "um hello" },
  });
polishFailure = vertexError(404, "NOT_FOUND");
await expectError(await polishWith(), 502, "model_not_found", false);
polishFailure = vertexError(400, "INVALID_ARGUMENT");
await expectError(await polishWith(), 422, "polish_rejected", false);
polishFailure = vertexError(429, "RESOURCE_EXHAUSTED");
await expectError(await polishWith(), 503, "polish_failed", true);
polishFailure = new Error("socket hang up");
await expectError(await polishWith(), 503, "polish_failed", true);
polishFailure = undefined;
assert.equal((await polishWith()).statusCode, 200);
await configured.close();

// The per-account budget is checked before the body is read, so an account
// over budget cannot make the API buffer more audio.
const budget = await createAuthenticatedTestApp({
  logger: false,
  aiRouteLimits: { maxRequests: 1, windowMs: 60_000 },
  aiProviders: configuredProviders,
});
const transcribeAs = (user: string, payload: Buffer) =>
  budget.inject({
    method: "POST",
    url: "/v1/transcribe",
    headers: {
      authorization: `Bearer ${user}`,
      "content-type": "audio/webm",
    },
    payload,
  });
assert.equal((await transcribeAs("user-a", audio)).statusCode, 200);
const overBudget = await transcribeAs(
  "user-a",
  Buffer.alloc(googleSyncLimit + 1),
);
assert.equal(overBudget.statusCode, 429, overBudget.body);
assert.equal(overBudget.json().error.code, "rate_limited");
assert.ok(overBudget.headers["retry-after"]);
assert.equal((await transcribeAs("user-b", audio)).statusCode, 200);
await budget.close();

console.log("ai-routes smoke ok");
