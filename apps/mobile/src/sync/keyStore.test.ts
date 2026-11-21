import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { base64urlEncode, deriveVaultKeys } from "@sonolect/sync-core";

import { SYNC_KEY_ITEM, SYNC_KEY_MARKER, createSyncKeyStore } from "./keyStore";
import { MemoryKv, MemorySecrets } from "./testSupport";

const root = (seed: number) =>
  Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + seed) % 256);

function setup() {
  const secrets = new MemorySecrets();
  const kv = new MemoryKv();
  return { secrets, kv, keys: createSyncKeyStore(secrets, kv) };
}

describe("sync key store", () => {
  it("is empty until a key is saved", async () => {
    const { keys } = setup();
    assert.equal(await keys.load(), null);
  });

  it("saves the key in the secret store and its vault in the marker", async () => {
    const { secrets, kv, keys } = setup();
    await keys.save(root(1));
    assert.equal(secrets.data.get(SYNC_KEY_ITEM), base64urlEncode(root(1)));
    assert.equal(
      kv.data.get(SYNC_KEY_MARKER),
      deriveVaultKeys(root(1)).vaultId,
    );
    assert.deepEqual(await keys.load(), root(1));
  });

  it("replaces a saved key", async () => {
    const { keys } = setup();
    await keys.save(root(1));
    await keys.save(root(2));
    assert.deepEqual(await keys.load(), root(2));
  });

  it("deletes a key that survived a reinstall (no marker)", async () => {
    const { secrets, kv, keys } = setup();
    await keys.save(root(1));
    kv.data.clear(); // the app's storage went with the app; the keychain did not
    assert.equal(await keys.load(), null);
    assert.equal(secrets.data.has(SYNC_KEY_ITEM), false);
  });

  it("deletes a key whose marker names another vault", async () => {
    const { secrets, kv, keys } = setup();
    await keys.save(root(1));
    kv.data.set(SYNC_KEY_MARKER, deriveVaultKeys(root(2)).vaultId);
    assert.equal(await keys.load(), null);
    assert.equal(secrets.data.has(SYNC_KEY_ITEM), false);
    assert.equal(kv.data.has(SYNC_KEY_MARKER), false);
  });

  it("deletes a value that is not a key", async () => {
    const { secrets, kv, keys } = setup();
    secrets.data.set(SYNC_KEY_ITEM, "not a key");
    kv.data.set(SYNC_KEY_MARKER, "x");
    assert.equal(await keys.load(), null);
    assert.equal(secrets.data.size, 0);
  });

  it("drops a marker left without a key", async () => {
    const { kv, keys } = setup();
    kv.data.set(SYNC_KEY_MARKER, deriveVaultKeys(root(1)).vaultId);
    assert.equal(await keys.load(), null);
    assert.equal(kv.data.has(SYNC_KEY_MARKER), false);
  });

  it("deletes nothing when the keychain cannot be read", async () => {
    const { secrets, keys } = setup();
    await keys.save(root(1));
    secrets.fail = (op) => op === "get";
    await assert.rejects(keys.load(), /locked/);
    secrets.fail = () => false;
    assert.deepEqual(await keys.load(), root(1));
  });

  it("leaves no marker when the key cannot be saved", async () => {
    const { secrets, kv, keys } = setup();
    secrets.fail = (op) => op === "set";
    await assert.rejects(keys.save(root(1)));
    assert.equal(kv.data.has(SYNC_KEY_MARKER), false);
  });

  it("removes the marker first: a key left behind is deleted at the next load", async () => {
    const { secrets, keys } = setup();
    await keys.save(root(1));
    secrets.fail = (op) => op === "delete";
    await assert.rejects(keys.remove());
    secrets.fail = () => false;
    assert.equal(secrets.data.has(SYNC_KEY_ITEM), true);
    assert.equal(await keys.load(), null);
    assert.equal(secrets.data.has(SYNC_KEY_ITEM), false);
  });
});
