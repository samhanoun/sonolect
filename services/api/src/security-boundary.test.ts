import { it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./index.js";

it("production refuses to start without a verifier even when authentication is disabled", async () => {
  await assert.rejects(
    createApp({
      nodeEnv: "production",
      authRequired: false,
      logger: false,
      firebaseProjectId: "",
    }),
    /auth|verif/i,
  );
});
it("untrusted user headers cannot select an anonymous identity", async () => {
  const app = await createApp({
    nodeEnv: "test",
    authRequired: false,
    logger: false,
    localUserId: "local-user",
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { "x-user-id": "victim" },
    });
    assert.equal(response.json().id, "local-user");
  } finally {
    await app.close();
  }
});
it("production rejects anonymous access and isolates verified accounts", async () => {
  const options = {
    nodeEnv: "production",
    authRequired: false,
    logger: false,
    verifyToken: async (token: string) => ({
      uid: token === "alice-token" ? "alice" : "bob",
    }),
  };
  const app = await createApp(options);
  try {
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/users/profile",
          headers: { "x-user-id": "alice" },
        })
      ).statusCode,
      401,
    );
    const created = await app.inject({
      method: "POST",
      url: "/transcripts",
      headers: { authorization: "Bearer alice-token" },
      payload: {
        language: "en",
        mode: "dictate",
        privacyMode: false,
        status: "draft",
        tags: [],
        rawText: "Private",
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/transcripts/${created.json().id}`,
          headers: { authorization: "Bearer bob-token", "x-user-id": "alice" },
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
it("preflight allows only the configured exact origin without requiring a bearer token", async () => {
  const options = {
    nodeEnv: "production",
    logger: false,
    verifyToken: async () => ({ uid: "alice" }),
    allowedOrigins: ["http://localhost:5173"],
  };
  const app = await createApp(options);
  try {
    const preflight = (origin: string) =>
      app.inject({
        method: "OPTIONS",
        url: "/v1/transcribe",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,authorization",
        },
      });
    const allowed = await preflight("http://localhost:5173");
    assert.equal(allowed.statusCode, 204);
    assert.equal(
      allowed.headers["access-control-allow-origin"],
      "http://localhost:5173",
    );
    const denied = await preflight("http://localhost:5173.evil.example");
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
  } finally {
    await app.close();
  }
});
