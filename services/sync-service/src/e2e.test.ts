/**
 * Two devices sync through the real service over HTTP (fetch), on a SQLite
 * file: pairing by code, both-way sync, a concurrent edit, a delete, and the
 * vault's deletion reaching the other device. The server's file must hold
 * no word of a note.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  type HttpRequester,
  type SyncNote,
  SyncError,
  createHttpTransport,
  createMemoryStateStore,
  deriveVaultKeys,
  generateRootKey,
  openSyncEngine,
  pairingCode,
  parsePairing,
  syncNote,
} from "@sonolect/sync-core";
import { createMemoryNoteStore } from "@sonolect/sync-core/testing";
import type { FastifyInstance } from "fastify";

import { createApp } from "./index.js";
import { SqliteStore } from "./sqlite-store.js";
import { randomBytes } from "./test-support.js";

const note = (rawText: string, origin: string): SyncNote =>
  syncNote({
    createdAt: "2026-11-20T09:00:00.000Z",
    rawText,
    durationMs: 4200,
    origin,
  });

describe("two devices through the service", () => {
  let directory: string;
  let store: SqliteStore;
  let app: FastifyInstance;
  let request: HttpRequester;
  const statuses: number[] = [];

  before(async () => {
    directory = mkdtempSync(join(tmpdir(), "sonolect-sync-e2e-"));
    store = await SqliteStore.open(join(directory, "sync.db"));
    app = await createApp({ store, env: { NODE_ENV: "test" }, logger: false });
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    request = async ({ method, path, headers, body }) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
      });
      statuses.push(response.status);
      return {
        status: response.status,
        body: await response.text(),
        retryAfter: response.headers.get("retry-after"),
      };
    };
  });

  after(async () => {
    await app.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("syncs, merges, resolves a conflict, deletes and ends", async () => {
    const root = generateRootKey(randomBytes);
    const device = async (rootKey: Uint8Array) => {
      const keys = deriveVaultKeys(rootKey);
      const notes = createMemoryNoteStore();
      const engine = await openSyncEngine({
        keys,
        transport: createHttpTransport({ request, vault: keys }),
        notes,
        state: createMemoryStateStore(),
        randomBytes,
      });
      const edit = (id: string, text: string, origin: string) => {
        const previous = notes.get(id);
        notes.put(
          id,
          { ...(previous?.note ?? note(text, origin)), rawText: text },
          engine.stamp(previous?.hlc),
        );
      };
      return { keys, notes, engine, edit };
    };

    // The desktop starts syncing with a note it already had.
    const desktop = await device(root);
    desktop.edit(
      "note-e2e-desk-0001",
      "Quarterly planning call with the design team",
      "desktop",
    );
    const first = await desktop.engine.sync();
    assert.equal(first.vaultCreated, true);
    assert.equal(first.pushed, 1);

    // The phone joins with the code the desktop shows, bringing its own note.
    const joined = parsePairing(pairingCode(root));
    const phone = await device(joined);
    assert.equal(phone.keys.vaultId, desktop.keys.vaultId);
    phone.edit(
      "note-e2e-phone-0001",
      "Grocery list: lentils, saffron, oat milk",
      "mobile",
    );
    const merged = await phone.engine.sync();
    assert.equal(merged.vaultCreated, false);
    assert.equal(merged.pulled, 1);
    assert.equal(merged.pushed, 1);
    await desktop.engine.sync();
    const ids = (side: { notes: { notes: Map<string, unknown> } }) =>
      [...side.notes.notes.keys()].sort();
    assert.deepEqual(ids(desktop), [
      "note-e2e-desk-0001",
      "note-e2e-phone-0001",
    ]);
    assert.deepEqual(ids(phone), ids(desktop));
    assert.equal(
      phone.notes.get("note-e2e-desk-0001")?.note.rawText,
      "Quarterly planning call with the design team",
    );

    // Both edit the same note before syncing: one version wins everywhere,
    // the other survives as a conflict copy.
    desktop.edit(
      "note-e2e-desk-0001",
      "Planning call moved to Thursday",
      "desktop",
    );
    phone.edit(
      "note-e2e-desk-0001",
      "Planning call: bring the mockups",
      "mobile",
    );
    await desktop.engine.sync();
    const conflicted = await phone.engine.sync();
    await desktop.engine.sync();
    assert.equal(conflicted.conflictCopies.length, 1);
    assert.deepEqual(ids(desktop), ids(phone));
    assert.equal(ids(desktop).length, 3);
    const texts = (side: typeof desktop) =>
      ids(side).map((id) => side.notes.get(id)?.note.rawText);
    assert.deepEqual(texts(desktop), texts(phone));
    assert.deepEqual([...texts(desktop)].sort(), [
      "Grocery list: lentils, saffron, oat milk",
      "Planning call moved to Thursday",
      "Planning call: bring the mockups",
    ]);
    const copyId = conflicted.conflictCopies[0]!;
    assert.ok(copyId.startsWith("note-e2e-desk-0001"));
    assert.equal(
      desktop.notes.get(copyId)?.note.conflictOf,
      "note-e2e-desk-0001",
    );

    // A delete on the phone reaches the desktop.
    const hlc = phone.notes.get("note-e2e-phone-0001")?.hlc;
    phone.notes.remove("note-e2e-phone-0001");
    await phone.engine.recordDeletes([{ id: "note-e2e-phone-0001", hlc }]);
    await phone.engine.sync();
    await desktop.engine.sync();
    assert.ok(!ids(desktop).includes("note-e2e-phone-0001"));

    // The server's files hold ciphertext only: no text and no note id.
    const files = readdirSync(directory).map((name) =>
      readFileSync(join(directory, name)).toString("latin1"),
    );
    const everything = files.join("");
    assert.ok(everything.length > 0);
    for (const word of [
      "Quarterly",
      "lentils",
      "mockups",
      "Thursday",
      "note-e2e",
      "desktop",
      "mobile",
    ])
      assert.ok(!everything.includes(word), `the server stored "${word}"`);
    assert.ok(!everything.includes(desktop.keys.authToken));

    // The desktop deletes the server copy; the phone learns and keeps its notes.
    await desktop.engine.deleteVault();
    const ended = await phone.engine.sync().catch((error: unknown) => error);
    assert.ok(ended instanceof SyncError, String(ended));
    assert.equal(ended.kind, "gone");
    assert.equal(ended.code, "vault_deleted");
    assert.equal(ended.vaultGone, true);
    await phone.engine.forget();
    assert.equal(ids(phone).length, 2);
    // Nothing was refused for being too fast or too large along the way.
    assert.ok(statuses.every((status) => status !== 429 && status !== 413));
  });
});
