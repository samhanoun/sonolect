import * as assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ONLINE_PROVIDERS } from "./onlineRefine";
import type { SecureItemStore } from "./providerKeys";
import { PROVIDER_KEY_ITEMS, createProviderKeyStore } from "./providerKeys";

const KEY = "test-key-not-real-0000";
const OPTIONS = { keychainAccessible: "WHEN_UNLOCKED_THIS_DEVICE_ONLY" };

type Op = [string, string, (object | undefined)?];

/** An in-memory SecureStore that records every call. */
function fakeSecureStore(failDeletesOf: string[] = []) {
  const items = new Map<string, { value: string; options?: object }>();
  const ops: Op[] = [];
  const store: SecureItemStore = {
    async getItemAsync(key) {
      ops.push(["get", key]);
      return items.get(key)?.value ?? null;
    },
    async setItemAsync(key, value, options) {
      ops.push(["set", key, options]);
      items.set(key, { value, ...(options ? { options } : {}) });
    },
    async deleteItemAsync(key) {
      ops.push(["delete", key]);
      if (failDeletesOf.includes(key)) throw new Error("keychain busy");
      items.delete(key);
    },
  };
  return { store, items, ops };
}

describe("provider keys", () => {
  // Nothing here may reach the network.
  const realFetch = globalThis.fetch;
  let fetches = 0;
  beforeEach(() => {
    fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("no network in this test");
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    assert.equal(fetches, 0);
  });

  it("uses one SecureStore item per provider, with a valid name", () => {
    for (const provider of ONLINE_PROVIDERS) {
      assert.match(PROVIDER_KEY_ITEMS[provider], /^[\w.-]+$/);
      assert.ok(PROVIDER_KEY_ITEMS[provider].startsWith("sonolect.mobile."));
    }
    assert.notEqual(PROVIDER_KEY_ITEMS.openrouter, PROVIDER_KEY_ITEMS.opencode);
  });

  it("deletes, then saves the trimmed key on this device only", async () => {
    const { store, items, ops } = fakeSecureStore();
    const keys = createProviderKeyStore(store, () => OPTIONS);
    assert.equal(await keys.save("opencode", `  ${KEY}\n`), true);
    const item = PROVIDER_KEY_ITEMS.opencode;
    assert.deepEqual(ops, [
      ["delete", item],
      ["set", item, OPTIONS],
    ]);
    assert.equal(items.get(item)?.value, KEY);
    assert.equal(await keys.load("opencode"), KEY);
    assert.equal(await keys.load("openrouter"), undefined);
  });

  it("saves nothing for a key the desktop would refuse", async () => {
    const { store, ops } = fakeSecureStore();
    const keys = createProviderKeyStore(store, () => OPTIONS);
    for (const bad of ["", "short", "has a space", "x".repeat(1025)]) {
      assert.equal(await keys.save("openrouter", bad), false);
    }
    assert.deepEqual(ops, []);
  });

  it("reports only booleans", async () => {
    const { store } = fakeSecureStore();
    const keys = createProviderKeyStore(store, () => OPTIONS);
    assert.deepEqual(await keys.status(), {
      openrouter: false,
      opencode: false,
    });
    await keys.save("openrouter", KEY);
    const status = await keys.status();
    assert.deepEqual(status, { openrouter: true, opencode: false });
    assert.ok(!JSON.stringify(status).includes(KEY));
  });

  it("removes one key, or every key even when one delete fails", async () => {
    const { store, items } = fakeSecureStore();
    const keys = createProviderKeyStore(store, () => OPTIONS);
    await keys.save("openrouter", KEY);
    await keys.save("opencode", KEY);
    await keys.remove("openrouter");
    assert.deepEqual(await keys.status(), {
      openrouter: false,
      opencode: true,
    });
    await keys.removeAll();
    assert.equal(items.size, 0);

    const failing = fakeSecureStore([PROVIDER_KEY_ITEMS.openrouter]);
    const flaky = createProviderKeyStore(failing.store, () => OPTIONS);
    await flaky.save("opencode", KEY);
    failing.items.set(PROVIDER_KEY_ITEMS.openrouter, { value: KEY });
    await assert.rejects(flaky.removeAll(), /keychain busy/);
    // The other provider's key was still deleted.
    assert.equal(failing.items.has(PROVIDER_KEY_ITEMS.opencode), false);
  });

  it("treats an unreadable or invalid stored value as no key", async () => {
    const broken: SecureItemStore = {
      getItemAsync: async () => {
        throw new Error("locked");
      },
      setItemAsync: async () => undefined,
      deleteItemAsync: async () => undefined,
    };
    assert.equal(
      await createProviderKeyStore(broken, () => OPTIONS).load("opencode"),
      undefined,
    );
    const { store, items } = fakeSecureStore();
    items.set(PROVIDER_KEY_ITEMS.opencode, { value: "bad key\nvalue" });
    assert.equal(
      await createProviderKeyStore(store, () => OPTIONS).load("opencode"),
      undefined,
    );
  });

  it("stores nothing in the web preview", async () => {
    const keys = createProviderKeyStore(null, () => OPTIONS);
    assert.equal(await keys.save("openrouter", KEY), false);
    assert.equal(await keys.load("openrouter"), undefined);
    assert.deepEqual(await keys.status(), {
      openrouter: false,
      opencode: false,
    });
    await keys.remove("openrouter");
    await keys.removeAll();
  });
});
