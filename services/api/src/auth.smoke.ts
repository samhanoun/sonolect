import { strict as assert } from "node:assert";
import { createApp, type VerifyToken } from "./index.js";
import type { User } from "@sonolect/types";

{
  const previousAuthRequired = process.env.SONOLECT_AUTH_REQUIRED;
  process.env.SONOLECT_AUTH_REQUIRED = "true";
  const app = await createApp({ logger: false });
  try {
    const profile = await app.inject({ method: "GET", url: "/users/profile" });
    assert.equal(profile.statusCode, 401, profile.body);
    assert.equal(profile.json<{ error: string }>().error, "unauthorized");

    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200, health.body);
  } finally {
    if (previousAuthRequired === undefined) {
      delete process.env.SONOLECT_AUTH_REQUIRED;
    } else {
      process.env.SONOLECT_AUTH_REQUIRED = previousAuthRequired;
    }
    await app.close();
  }
}

{
  const app = await createApp({
    logger: false,
    authRequired: true,
    firebaseProjectId: "sonolect-test",
    allowDevTokens: true,
  });
  try {
    const profile = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { authorization: "Bearer dev:alice" },
    });
    assert.equal(profile.statusCode, 200, profile.body);
    assert.equal(profile.json<User>().id, "alice");

    const testProfile = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { authorization: "Bearer test:bob" },
    });
    assert.equal(testProfile.statusCode, 200, testProfile.body);
    assert.equal(testProfile.json<User>().id, "bob");
  } finally {
    await app.close();
  }
}

{
  const app = await createApp({
    logger: false,
    authRequired: true,
    firebaseProjectId: "sonolect-test",
  });
  try {
    const profile = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { authorization: "Bearer dev:mallory" },
    });
    assert.equal(profile.statusCode, 501, profile.body);
    assert.equal(
      profile.json<{ error: string }>().error,
      "firebase_auth_not_configured",
    );
  } finally {
    await app.close();
  }
}

{
  const verifyToken: VerifyToken = async (token) => {
    assert.equal(token, "firebase-token");
    return { uid: "firebase-user", email: "firebase-user@example.com" };
  };
  const app = await createApp({
    logger: false,
    authRequired: true,
    firebaseProjectId: "sonolect-test",
    verifyToken,
  });
  try {
    const profile = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { authorization: "Bearer firebase-token" },
    });
    assert.equal(profile.statusCode, 200, profile.body);
    const user = profile.json<User>();
    assert.equal(user.id, "firebase-user");
    assert.equal(user.email, "firebase-user@example.com");
  } finally {
    await app.close();
  }
}

{
  const app = await createApp({
    logger: false,
    authRequired: true,
    firebaseProjectId: "sonolect-test",
  });
  try {
    const profile = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { authorization: "Bearer firebase-token" },
    });
    assert.equal(profile.statusCode, 501, profile.body);
    assert.equal(
      profile.json<{ error: string }>().error,
      "firebase_auth_not_configured",
    );
  } finally {
    await app.close();
  }
}

console.log("API auth smoke test passed");
