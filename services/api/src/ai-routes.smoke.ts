import assert from "node:assert/strict";
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

console.log("ai-routes smoke ok");
