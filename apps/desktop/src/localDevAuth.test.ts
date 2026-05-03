import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthHeaders, resolveDesktopAuthConfig } from "./localDevAuth";

describe("desktop local dev auth config", () => {
  it("generates a dev token from explicit local dev profile settings", () => {
    const config = resolveDesktopAuthConfig({
      MODE: "development",
      VITE_SONOLECT_LOCAL_DEV_AUTH: "true",
      VITE_SONOLECT_LOCAL_USER_ID: "dev-alice",
    });

    assert.deepEqual(config, {
      token: "dev:dev-alice",
      localUserId: "dev-alice",
      localDevAuth: true,
      source: "generated-dev-token",
    });
    assert.deepEqual(createAuthHeaders(config), {
      authorization: "Bearer dev:dev-alice",
      "x-sonolect-local-user-id": "dev-alice",
    });
  });

  it("prefers explicit API tokens and preserves explicit dev tokens in non-production", () => {
    assert.equal(
      resolveDesktopAuthConfig({
        MODE: "development",
        VITE_SONOLECT_API_TOKEN: " firebase-token ",
        VITE_SONOLECT_DEV_AUTH_TOKEN: "dev:alice",
        VITE_SONOLECT_LOCAL_DEV_AUTH: "true",
      }).token,
      "firebase-token",
    );

    const dev = resolveDesktopAuthConfig({
      MODE: "development",
      VITE_SONOLECT_DEV_AUTH_TOKEN: "test:bob",
    });
    assert.equal(dev.token, "test:bob");
    assert.equal(dev.localUserId, "bob");
    assert.equal(dev.source, "dev-token");
  });

  it("does not enable dev auth or dev tokens in production", () => {
    const config = resolveDesktopAuthConfig({
      MODE: "production",
      VITE_SONOLECT_DEV_AUTH_TOKEN: "dev:prod-user",
      VITE_SONOLECT_LOCAL_DEV_AUTH: "true",
      VITE_SONOLECT_LOCAL_USER_ID: "prod-user",
    });

    assert.deepEqual(config, {
      localUserId: "prod-user",
      localDevAuth: false,
      source: "none",
    });
    assert.deepEqual(createAuthHeaders(config), {});
  });

  it("sanitizes unsafe local user ids before generating dev tokens", () => {
    const config = resolveDesktopAuthConfig({
      MODE: "development",
      VITE_SONOLECT_LOCAL_DEV_AUTH: "true",
      VITE_SONOLECT_LOCAL_USER_ID: "mallory:admin",
    });

    assert.equal(config.localUserId, "local-user");
    assert.equal(config.token, "dev:local-user");
  });

  it("persists and reuses local dev user id when browser storage is available", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    const first = resolveDesktopAuthConfig(
      {
        MODE: "development",
        VITE_SONOLECT_LOCAL_DEV_AUTH: "true",
        VITE_SONOLECT_LOCAL_USER_ID: "desktop-alice",
      },
      { storage },
    );
    const second = resolveDesktopAuthConfig(
      {
        MODE: "development",
        VITE_SONOLECT_LOCAL_DEV_AUTH: "true",
      },
      { storage },
    );

    assert.equal(first.localUserId, "desktop-alice");
    assert.equal(second.localUserId, "desktop-alice");
    assert.equal(second.token, "dev:desktop-alice");
  });
});
