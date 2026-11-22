import { it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createFirebaseVerifier } from "./firebase-verifier.js";

const pair = await generateKeyPair("RS256");
const publicKey = await exportJWK(pair.publicKey);
const verify = createFirebaseVerifier(
  "sonolect-test",
  createLocalJWKSet({
    keys: [{ ...publicKey, kid: "test-key", alg: "RS256" }],
  }),
);
const now = Math.floor(Date.now() / 1000);
const sign = (overrides: Record<string, unknown> = {}) =>
  new SignJWT({
    sub: "alice",
    iss: "https://securetoken.google.com/sonolect-test",
    aud: "sonolect-test",
    iat: now,
    exp: now + 300,
    auth_time: now - 10,
    email: "alice@example.test",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(pair.privateKey);

it("verifies a real signature and returns only the signed identity", async () => {
  assert.deepEqual(await verify(await sign()), {
    uid: "alice",
    email: "alice@example.test",
  });
});
it("rejects expired, wrong-project, wrong-issuer and invalid identity tokens", async () => {
  for (const claims of [
    { exp: now - 1 },
    { aud: "another-project" },
    { iss: "https://attacker.example" },
    { sub: "" },
    { auth_time: now + 100 },
    { iat: now + 100 },
    { auth_time: "not-a-number" },
  ]) {
    await assert.rejects(verify(await sign(claims)));
  }
});
it("accepts a fresh token from a clock a little ahead of the server's", async () => {
  // Google stamps iat and auth_time with its own clock. A server clock a few
  // seconds behind must not reject a token that was just minted.
  assert.equal(
    (await verify(await sign({ iat: now + 5, auth_time: now + 5 }))).uid,
    "alice",
  );
  assert.equal(
    (await verify(await sign({ iat: now + 60, auth_time: now + 60 }))).uid,
    "alice",
  );
  await assert.rejects(verify(await sign({ iat: now + 120 })));
  await assert.rejects(verify(await sign({ auth_time: now + 120 })));
});
it("rejects a forged token and unsigned identity headers", async () => {
  const token = await sign();
  const parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ sub: "victim" })).toString(
    "base64url",
  );
  await assert.rejects(verify(parts.join(".")));
  await assert.rejects(verify("dev:alice"));
});
