import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConfigError,
  parseAllowedOrigins,
  parseStoreSpec,
  parseTrustProxy,
  readConfig,
} from "./config.js";
import { createApp } from "./index.js";
import { MemoryStore } from "./memory-store.js";
import { SqliteStore } from "./sqlite-store.js";

const PRODUCTION = {
  NODE_ENV: "production",
  SONOLECT_SERVICE_TOKENS: "a-production-service-token-of-32-chars-or-more",
};

describe("configuration", () => {
  it("reads SONOLECT_SYNC_STORE", () => {
    assert.deepEqual(parseStoreSpec({}), { kind: "memory" });
    assert.deepEqual(parseStoreSpec({ SONOLECT_SYNC_STORE: "memory" }), {
      kind: "memory",
    });
    assert.deepEqual(
      parseStoreSpec({ SONOLECT_SYNC_STORE: "sqlite:/data/sync.db" }),
      { kind: "sqlite", path: "/data/sync.db" },
    );
    assert.deepEqual(parseStoreSpec({ SONOLECT_SYNC_STORE: " firestore " }), {
      kind: "firestore",
      projectId: undefined,
      databaseId: undefined,
    });
    assert.deepEqual(
      parseStoreSpec({
        SONOLECT_SYNC_STORE: "firestore",
        GCLOUD_PROJECT: "demo-sonolect",
        SONOLECT_SYNC_FIRESTORE_DATABASE: "sync",
      }),
      { kind: "firestore", projectId: "demo-sonolect", databaseId: "sync" },
    );
    for (const value of ["sqlite:", "postgres", "firestore:x", "Memory"])
      assert.throws(
        () => parseStoreSpec({ SONOLECT_SYNC_STORE: value }),
        ConfigError,
        value,
      );
  });

  it("refuses a store that forgets its vaults in production", () => {
    assert.throws(
      () => parseStoreSpec({ NODE_ENV: "production" }),
      /must be set in production/,
    );
    assert.throws(
      () =>
        parseStoreSpec({
          NODE_ENV: "production",
          SONOLECT_SYNC_STORE: "memory",
        }),
      /refused in production/,
    );
    assert.throws(
      () =>
        parseStoreSpec({
          NODE_ENV: "production",
          SONOLECT_SYNC_STORE: "sqlite::memory:",
        }),
      /refused in production/,
    );
    assert.deepEqual(
      parseStoreSpec({
        NODE_ENV: "production",
        SONOLECT_SYNC_STORE: "sqlite:/data/sync.db",
      }),
      { kind: "sqlite", path: "/data/sync.db" },
    );
  });

  it("trusts proxy hops only when told or on Cloud Run", () => {
    assert.equal(parseTrustProxy({}), false);
    assert.equal(parseTrustProxy({ K_SERVICE: "sonolect-sync" }), 1);
    assert.equal(
      parseTrustProxy({
        K_SERVICE: "sonolect-sync",
        SONOLECT_SYNC_TRUST_PROXY: "2",
      }),
      2,
    );
    assert.equal(
      parseTrustProxy({
        K_SERVICE: "sonolect-sync",
        SONOLECT_SYNC_TRUST_PROXY: "0",
      }),
      false,
    );
    for (const value of ["true", "-1", "1.5", "loopback", "100"])
      assert.throws(
        () => parseTrustProxy({ SONOLECT_SYNC_TRUST_PROXY: value }),
        ConfigError,
        value,
      );
  });

  it("keeps CORS off unless origins are listed", () => {
    assert.equal(parseAllowedOrigins({}), undefined);
    assert.equal(
      parseAllowedOrigins({ SONOLECT_SYNC_ALLOWED_ORIGINS: " , " }),
      undefined,
    );
    assert.deepEqual(
      parseAllowedOrigins({
        SONOLECT_SYNC_ALLOWED_ORIGINS:
          "https://app.example.com, tauri://localhost,http://localhost:1420",
      }),
      ["https://app.example.com", "tauri://localhost", "http://localhost:1420"],
    );
    for (const value of [
      "*",
      "https://app.example.com/",
      "app.example.com",
      "https://a.example.com/path",
    ])
      assert.throws(
        () => parseAllowedOrigins({ SONOLECT_SYNC_ALLOWED_ORIGINS: value }),
        ConfigError,
        value,
      );
  });

  it("reads the whole configuration", () => {
    assert.deepEqual(
      readConfig({ SONOLECT_SYNC_STORE: "sqlite:./sync.db", K_SERVICE: "x" }),
      {
        production: false,
        store: { kind: "sqlite", path: "./sync.db" },
        trustProxy: 1,
        allowedOrigins: undefined,
      },
    );
  });

  it("refuses to start in production on the memory store or without service tokens", async () => {
    await assert.rejects(
      createApp({ env: PRODUCTION, logger: false }),
      /must be set in production/,
    );
    await assert.rejects(
      createApp({
        env: { ...PRODUCTION, SONOLECT_SYNC_STORE: "memory" },
        logger: false,
      }),
      /refused in production/,
    );
    await assert.rejects(
      createApp({
        env: { ...PRODUCTION, SONOLECT_SYNC_STORE: "sqlite::memory:" },
        store: new MemoryStore(),
        logger: false,
      }),
      /refused in production/,
    );
    await assert.rejects(
      createApp({
        env: { NODE_ENV: "production", SONOLECT_SYNC_STORE: "sqlite::memory:" },
        logger: false,
      }),
      /refused in production/,
    );
    await assert.rejects(
      createApp({
        env: {
          NODE_ENV: "production",
          SONOLECT_SYNC_STORE: "sqlite:/tmp/x.db",
        },
        store: new MemoryStore(),
        logger: false,
      }),
      /memory store is refused/,
    );
  });

  it("starts in production on SQLite, and only with service tokens", async () => {
    const store = await SqliteStore.open(":memory:");
    const env = {
      NODE_ENV: "production",
      SONOLECT_SYNC_STORE: "sqlite:/unused/sync.db",
    };
    await assert.rejects(
      createApp({ env, store, logger: false }),
      /SONOLECT_SERVICE_TOKENS must be set in production/,
    );
    const app = await createApp({
      env: { ...env, ...PRODUCTION },
      store,
      logger: false,
    });
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    await app.close();
    await store.close();
  });
});
