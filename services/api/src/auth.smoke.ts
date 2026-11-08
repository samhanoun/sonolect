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
    assert.equal(profile.statusCode, 401, profile.body);
    assert.equal(profile.json<{ error: string }>().error, "invalid_token");
  } finally {
    await app.close();
  }
}

{
  const previousLocalDevAuth = process.env.SONOLECT_LOCAL_DEV_AUTH;
  const previousLocalUserId = process.env.SONOLECT_LOCAL_USER_ID;
  process.env.SONOLECT_LOCAL_DEV_AUTH = "true";
  process.env.SONOLECT_LOCAL_USER_ID = "dev-alice";
  const app = await createApp({ logger: false, authRequired: true });
  try {
    const unauthorized = await app.inject({
      method: "GET",
      url: "/users/profile",
    });
    assert.equal(unauthorized.statusCode, 401, unauthorized.body);

    const profile = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { authorization: "Bearer dev:dev-alice" },
    });
    assert.equal(profile.statusCode, 200, profile.body);
    const user = profile.json<User>();
    assert.equal(user.id, "dev-alice");
    assert.equal(user.email, "dev-alice@local.sonolect.dev");

    const create = await app.inject({
      method: "POST",
      url: "/transcripts",
      headers: {
        authorization: "Bearer dev:dev-alice",
        "content-type": "application/json",
      },
      payload: {
        language: "en",
        mode: "dictate",
        privacyMode: false,
        status: "draft",
        tags: [],
        rawText: "owned by alice",
      },
    });
    assert.equal(create.statusCode, 201, create.body);
    assert.equal(create.json<{ userId: string }>().userId, "dev-alice");

    const hiddenFromBob = await app.inject({
      method: "GET",
      url: `/transcripts/${create.json<{ id: string }>().id}`,
      headers: { authorization: "Bearer dev:dev-bob" },
    });
    assert.equal(hiddenFromBob.statusCode, 404, hiddenFromBob.body);
  } finally {
    if (previousLocalDevAuth === undefined)
      delete process.env.SONOLECT_LOCAL_DEV_AUTH;
    else process.env.SONOLECT_LOCAL_DEV_AUTH = previousLocalDevAuth;
    if (previousLocalUserId === undefined)
      delete process.env.SONOLECT_LOCAL_USER_ID;
    else process.env.SONOLECT_LOCAL_USER_ID = previousLocalUserId;
    await app.close();
  }
}

{
  const app = await createApp({
    logger: false,
    authRequired: true,
    allowDevTokens: true,
    nodeEnv: "production",
    verifyToken: async () => {
      throw new Error("Invalid token");
    },
  });
  try {
    const profile = await app.inject({
      method: "GET",
      url: "/users/profile",
      headers: { authorization: "Bearer dev:prod-user" },
    });
    assert.equal(profile.statusCode, 401, profile.body);
    assert.equal(profile.json<{ error: string }>().error, "invalid_token");
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
    assert.equal(profile.statusCode, 401, profile.body);
    assert.equal(profile.json<{ error: string }>().error, "invalid_token");
  } finally {
    await app.close();
  }
}

console.log("API auth smoke test passed");
