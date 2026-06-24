import assert from "node:assert/strict";
import { createApp } from "./index.js";

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

await app.close();
console.log("ai-routes smoke ok");
