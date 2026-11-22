import { expect, test, type Page } from "@playwright/test";
import {
  type KeyValueStorage,
  createKeyValueStateStore,
  deriveVaultKeys,
  generateRootKey,
  openSyncEngine,
  pairingCode,
  pairingLink,
  syncNote,
} from "@sonolect/sync-core";
import {
  createMemoryNoteStore,
  createMemoryVaultServer,
  type MemoryVaultServer,
} from "@sonolect/sync-core/testing";

import {
  SYNC_REQUEST_HOOK,
  installMockTauri,
  nativeCalls,
  nativeSyncState,
  type MockCapture,
  type MockSyncRequest,
} from "./support/mockTauri";

const randomBytes = (length: number) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

function nav(page: Page, name: string) {
  return page.getByRole("navigation").getByRole("button", { name }).first();
}

function syncCard(page: Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Sync between devices" }),
  });
}

const recording: MockCapture = {
  id: "1700000000000-1",
  createdAtMs: Date.now() - 60_000,
  durationMs: 3_000,
  transcript: "Recorded on this desktop.",
  error: null,
  language: "en",
};

/** A sync server in the test, answering the page's requests. */
async function serve(page: Page): Promise<MemoryVaultServer> {
  const server = createMemoryVaultServer();
  await page.exposeFunction(SYNC_REQUEST_HOOK, (request: MockSyncRequest) =>
    server.request(request),
  );
  return server;
}

/** The phone: sync-core's engine over a memory note store, with its own key. */
async function phone(
  server: MemoryVaultServer,
  root = generateRootKey(randomBytes),
) {
  const keys = deriveVaultKeys(root);
  const notes = createMemoryNoteStore();
  const values = new Map<string, string>();
  const kv: KeyValueStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => void values.set(key, value),
    removeItem: async (key) => void values.delete(key),
  };
  const engine = await openSyncEngine({
    keys,
    transport: server.transport(keys),
    notes,
    state: createKeyValueStateStore(kv),
    randomBytes,
    now: Date.now,
    isExpired: () => false,
  });
  return { root, keys, notes, engine };
}

test.describe("note sync", () => {
  test("a build without a sync server shows no sync and makes no request", async ({
    page,
  }) => {
    const server = await serve(page);
    await installMockTauri(page, [recording]);
    await page.goto("/");
    await nav(page, "Settings").click();
    await expect(
      page.getByRole("heading", { name: "Privacy & retention" }),
    ).toBeVisible();
    await expect(syncCard(page)).toHaveCount(0);
    await expect(
      page.getByText("Sync is turned off on this device too."),
    ).toHaveCount(0);
    expect(await nativeCalls(page, "sync_key_load")).toEqual([]);
    expect(await nativeCalls(page, "sync_request")).toEqual([]);
    expect(server.log).toEqual([]);
  });

  test("a recording made here whose audio is gone is not shown as synced", async ({
    page,
  }) => {
    await installMockTauri(page, [
      { ...recording, hasAudio: false },
      {
        ...recording,
        id: "1700000000000-2",
        transcript: "From the phone.",
        origin: "mobile",
        hasAudio: false,
      },
    ]);
    await page.goto("/");
    await nav(page, "Library").click();
    const local = page.locator("article", {
      hasText: "Recorded on this desktop.",
    });
    await expect(
      local.getByText("Saved on device", { exact: true }),
    ).toBeVisible();
    await expect(
      local.getByText(
        "The audio of this recording is no longer on this device.",
      ),
    ).toBeVisible();
    await expect(local.getByText("Synced", { exact: true })).toHaveCount(0);
    // Nothing to play or to transcribe again.
    await expect(local.getByRole("button", { name: "Listen" })).toHaveCount(0);
    await expect(
      local.getByRole("button", { name: "Retry locally" }),
    ).toHaveCount(0);
    const synced = page.locator("article", { hasText: "From the phone." });
    await expect(synced.getByText("Synced", { exact: true })).toBeVisible();
    await expect(
      synced.getByText("The recording stays on the device that made it."),
    ).toBeVisible();
  });

  test("turning sync on shows the code for the other devices, with its warning", async ({
    page,
  }) => {
    const server = await serve(page);
    await installMockTauri(page, [recording], { sync: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = syncCard(page);
    await expect(card.getByText("Sync is off.")).toBeVisible();
    await expect(
      card.getByText("Sync server: sync.example.test"),
    ).toBeVisible();
    await expect(
      card.getByText(
        "Recordings stay on the device that made them. Only the notes sync.",
      ),
    ).toBeVisible();

    await card.getByRole("button", { name: "Turn on sync" }).click();
    await expect(card.getByText("Sync is on.")).toBeVisible();
    await expect(
      card.getByRole("img", { name: "QR code to join this sync" }),
    ).toBeVisible();
    const code = await card
      .locator(".studio-sync-code-text code")
      .textContent();
    expect(code?.replaceAll("-", "")).toHaveLength(56);
    await expect(
      card.getByText("Joining shares every note with whoever holds this code."),
    ).toBeVisible();
    await expect(card.getByText(/^Last synced: /)).toBeVisible();

    // The phone joins with that code and finds the desktop's recording, as text.
    const [key] = await nativeCalls(page, "sync_key_create");
    const root = Buffer.from((key!.args as { key: string }).key, "base64url");
    expect(pairingCode(root)).toBe(code);
    const other = await phone(server, root);
    await other.engine.sync();
    expect(
      [...other.notes.notes.values()].map(({ note }) => note.rawText),
    ).toEqual(["Recorded on this desktop."]);

    // Hidden and shown again on demand.
    await card.getByRole("button", { name: "Hide code" }).click();
    await expect(
      card.getByRole("img", { name: "QR code to join this sync" }),
    ).toHaveCount(0);
    await card.getByRole("button", { name: "Show code" }).click();
    await expect(card.locator(".studio-sync-code-text code")).toHaveText(code!);
  });

  test("deleting a note while sync is on says it goes from every device", async ({
    page,
  }) => {
    await serve(page);
    await installMockTauri(page, [recording], { sync: true });
    await page.goto("/");
    const asked: string[] = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    const askToDelete = async () => {
      await nav(page, "Library").click();
      await page
        .locator("article", { hasText: "Recorded on this desktop." })
        .getByRole("button", { name: "Delete", exact: true })
        .click();
    };

    // Sync is off: the note goes from this device only.
    await askToDelete();
    await expect
      .poll(() => asked)
      .toEqual(["Delete this recording and its transcript from this device?"]);

    await nav(page, "Settings").click();
    await syncCard(page).getByRole("button", { name: "Turn on sync" }).click();
    await expect(syncCard(page).getByText("Sync is on.")).toBeVisible();
    await askToDelete();
    await expect
      .poll(() => asked.at(-1))
      .toBe(
        "Delete this note from all your synced devices? Its recording is deleted from this device.",
      );
    // Declined both times: nothing was deleted.
    expect(await nativeCalls(page, "delete_local_capture")).toEqual([]);
    await expect(page.getByText("Recorded on this desktop.")).toBeVisible();
  });

  test("joining with a code brings the other device's notes, without their audio", async ({
    page,
  }) => {
    const server = await serve(page);
    const other = await phone(server);
    other.notes.put(
      "turn_1700000000000_phone1",
      syncNote({
        createdAt: new Date(Date.now() - 30_000).toISOString(),
        rawText: "buy milk and eggs",
        title: "Groceries",
        origin: "mobile",
        durationMs: 2_500,
        segments: [
          {
            startMs: 0,
            endMs: 2_500,
            text: "buy milk and eggs",
            speaker: "Me",
          },
        ],
      }),
      other.engine.stamp(),
    );
    await other.engine.sync();

    await installMockTauri(page, [recording], { sync: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = syncCard(page);
    await card.getByRole("button", { name: "Join with a code" }).click();
    await expect(
      card.getByText("Joining shares every note with whoever holds this code."),
    ).toBeVisible();
    const field = card.getByLabel("Sync code or link from your other device");

    // One character wrong.
    const code = pairingCode(other.root);
    const typed = code.replaceAll("-", "");
    await field.fill(
      typed.slice(0, 20) + (typed[20] === "7" ? "8" : "7") + typed.slice(21),
    );
    await card.getByRole("button", { name: "Join", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveText("A character is wrong.");
    await field.fill(typed.slice(0, 50));
    await card.getByRole("button", { name: "Join", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveText(
      "Check the code: it has 56 characters.",
    );
    await field.fill("sonolect://open/note-1");
    await card.getByRole("button", { name: "Join", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveText(
      "This is not a Sonolect sync code.",
    );

    // The link from the QR code, as a phone would read it.
    await field.fill(pairingLink(other.root));
    await card.getByRole("button", { name: "Join", exact: true }).click();
    await expect(card.getByText("Sync is on.")).toBeVisible();
    await expect(card.getByText(/^Last synced: /)).toBeVisible();

    await nav(page, "Library").click();
    const note = page.locator("article", { hasText: "buy milk and eggs" });
    await expect(
      note.getByRole("heading", { name: "Groceries" }),
    ).toBeVisible();
    await expect(note.getByText("Synced", { exact: true })).toBeVisible();
    await expect(
      note.getByText("The recording stays on the device that made it."),
    ).toBeVisible();
    await expect(note.getByRole("button", { name: "Listen" })).toHaveCount(0);
    const local = page.locator("article", {
      hasText: "Recorded on this desktop.",
    });
    await expect(local.getByRole("button", { name: "Listen" })).toBeVisible();

    // Opened in the editor: its text and speaker, and no play buttons.
    await note.getByRole("button", { name: "Open editor →" }).click();
    await expect(page.getByRole("button", { name: /^Play from/ })).toHaveCount(
      0,
    );

    // And the desktop's own recording reached the phone.
    await other.engine.sync();
    expect(
      [...other.notes.notes.values()].map(({ note }) => note.rawText).sort(),
    ).toEqual(["Recorded on this desktop.", "buy milk and eggs"]);
  });

  test("turning off can delete the server copy; the other devices then stop and keep their notes", async ({
    page,
  }) => {
    const server = await serve(page);
    const other = await phone(server);
    await other.engine.sync();
    await installMockTauri(page, [recording], { sync: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = syncCard(page);
    await card.getByRole("button", { name: "Join with a code" }).click();
    await card
      .getByLabel("Sync code or link from your other device")
      .fill(pairingCode(other.root));
    await card.getByRole("button", { name: "Join", exact: true }).click();
    await expect(card.getByText(/^Last synced: /)).toBeVisible();

    await card.getByRole("button", { name: "Turn off sync" }).click();
    const question = card.getByRole("group", {
      name: "Turn off sync on this device?",
    });
    await expect(
      question.getByText(
        "Your other devices keep syncing. This one can join again with the code.",
      ),
    ).toBeVisible();
    await question
      .getByRole("button", { name: "Delete the server copy" })
      .click();
    await expect(card.getByText("Sync is off.")).toBeVisible();
    await expect(
      card.getByText("Your notes stay on this device."),
    ).toBeVisible();
    expect(await nativeCalls(page, "sync_key_forget")).toHaveLength(1);

    // The phone hears that the sync was deleted.
    await expect(other.engine.sync()).rejects.toMatchObject({
      kind: "gone",
      code: "vault_deleted",
    });
    await nav(page, "Library").click();
    await expect(page.getByText("Recorded on this desktop.")).toBeVisible();
  });

  test("a sync deleted on another device turns sync off here and keeps the notes", async ({
    page,
  }) => {
    const server = await serve(page);
    const other = await phone(server);
    await other.engine.sync();
    await installMockTauri(page, [recording], { sync: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = syncCard(page);
    await card.getByRole("button", { name: "Join with a code" }).click();
    await card
      .getByLabel("Sync code or link from your other device")
      .fill(pairingCode(other.root));
    await card.getByRole("button", { name: "Join", exact: true }).click();
    await expect(card.getByText(/^Last synced: /)).toBeVisible();

    await other.engine.deleteVault();
    await card.getByRole("button", { name: "Sync now" }).click();
    await expect(card.getByText("Sync is off.")).toBeVisible();
    await expect(
      card.getByText("This sync was deleted. Your notes stay on this device."),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Turn on sync" }),
    ).toBeEnabled();
  });

  test("“Delete all my data” offers to delete the server copy, then forgets sync", async ({
    page,
  }) => {
    const server = await serve(page);
    const other = await phone(server);
    await other.engine.sync();
    await installMockTauri(page, [recording], { sync: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = syncCard(page);
    await card.getByRole("button", { name: "Join with a code" }).click();
    await card
      .getByLabel("Sync code or link from your other device")
      .fill(pairingCode(other.root));
    await card.getByRole("button", { name: "Join", exact: true }).click();
    await expect(card.getByText(/^Last synced: /)).toBeVisible();
    await expect(
      page.getByText(/Sync is turned off on this device too\./),
    ).toBeVisible();

    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.accept();
    });
    expect(await nativeSyncState(page)).toMatchObject({
      key: expect.any(String),
    });
    // The app starts again (a reload) once everything here is deleted.
    const reloaded = page.waitForEvent("load");
    await page.getByRole("button", { name: "Delete all my data" }).click();
    await reloaded;
    // The server copy went first, then everything here.
    expect(
      server.log.some(
        ({ method, status }) => method === "DELETE" && status === 204,
      ),
    ).toBe(true);
    expect(dialogs).toHaveLength(2);
    expect(dialogs[1]).toContain("Delete the server copy of your notes too?");
    await expect(other.engine.sync()).rejects.toMatchObject({
      code: "vault_deleted",
    });
    // The native side forgot the key and the sync state, so the app that
    // started again has sync off.
    expect(await nativeSyncState(page)).toEqual({ key: null, stateKeys: 0 });
    await nav(page, "Settings").click();
    await expect(
      page.getByRole("heading", { name: "Sync between devices" }),
    ).toBeVisible();
    await expect(syncCard(page).getByText("Sync is off.")).toBeVisible();
    await expect(
      syncCard(page).getByRole("button", { name: "Turn on sync" }),
    ).toBeEnabled();
    expect(await nativeCalls(page, "sync_request")).toEqual([]);
  });
});
