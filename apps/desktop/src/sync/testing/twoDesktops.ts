/**
 * Two desktops against a real sync server: each runs the app's own sync
 * modules (the controller, the note store adapter, the transport and the
 * state store) over a fake native side (FakeNative, which follows the Rust
 * commands), with real timers and HTTP. Not part of the unit tests: it
 * needs a running sync service, such as the built one with the memory store.
 *
 *   SONOLECT_SYNC_STORE=memory PORT=8712 node services/sync-service/dist/index.js
 *   SONOLECT_SYNC_TEST_URL=http://127.0.0.1:8712 pnpm --filter @sonolect/desktop sync:two-desktops
 *
 * A note goes across, an edit comes back, a delete propagates, the server
 * sees no note text and no key, and deleting the server copy turns the other
 * desktop off with its notes kept. Exits non-zero on the first failure.
 */
import { pathToFileURL } from "node:url";

import { type HttpRequest, type HttpResponse } from "@sonolect/sync-core";

import { appPlatform } from "../platform";
import { LOCAL_CHANGE_DELAY_MS, SyncController } from "../syncController";
import { FakeNative } from "./fakeNative";

export async function checkTwoDesktops(
  baseUrl: string,
  print: (line: string) => void = () => undefined,
): Promise<void> {
  /** Everything sent to the server, to check what it can see. */
  const sent: string[] = [];
  const answered: string[] = [];

  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    sent.push(`${request.method} ${request.path} ${request.body ?? ""}`);
    const response = await fetch(baseUrl + request.path, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    answered.push(
      `${request.method} ${request.path.split("?")[0]} -> ${response.status}`,
    );
    return {
      status: response.status,
      body,
      retryAfter: response.headers.get("retry-after"),
    };
  };

  const desktop = (name: string) => {
    const native = new FakeNative({
      request: http,
      now: Date.now,
      server: new URL(baseUrl).host,
    });
    const controller = new SyncController({
      platform: { ...appPlatform(), invoke: native.invoke },
      retentionDays: () => 0,
    });
    native.onLocalChange = () => controller.localChange();
    return { name, native, controller };
  };
  type Desktop = ReturnType<typeof desktop>;

  const waitFor = async (
    what: string,
    check: () => boolean,
    timeoutMs = 20_000,
  ) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return Date.now() - start;
  };
  /** Waits until a sync of `desk` that started after `before` is over. */
  const synced = async (desk: Desktop, before: number, timeoutMs = 20_000) => {
    await waitFor(
      `${desk.name} syncs`,
      () => {
        const view = desk.controller.getView();
        return (
          (view.lastSyncAt ?? 0) > before ||
          view.problem !== undefined ||
          view.phase !== "on"
        );
      },
      timeoutMs,
    );
    await desk.controller.idle();
  };
  const syncNow = async (desk: Desktop) => {
    const before = desk.controller.getView().lastSyncAt ?? 0;
    desk.controller.syncNow();
    await synced(desk, before);
  };
  const step = (text: string) => print(`\n== ${text}`);
  const ok = (condition: unknown, text: string) => {
    if (!condition) throw new Error(`failed: ${text}`);
    print(`   ok: ${text}`);
  };

  const a = desktop("desktop A");
  const b = desktop("desktop B");
  try {
    step("Desktop A turns sync on");
    await a.controller.start();
    ok(a.controller.getView().available, "sync is available in this build");
    await a.controller.turnOn();
    await synced(a, 0);
    ok(a.controller.getView().problem === undefined, "A synced");
    ok(
      answered.includes("POST /v1/vaults -> 201"),
      "the vault was created on the server",
    );

    step("A records a note: it is uploaded about 5 s later");
    const uploads = () =>
      answered.filter((line) =>
        /^POST \/v1\/vaults\/.+\/records -> 200$/.test(line),
      ).length;
    const id = a.native.record("Note from desktop A: buy milk.", {
      segments: [
        {
          startMs: 0,
          endMs: 1_000,
          text: "Note from desktop A: buy milk.",
          speaker: "Ana",
        },
      ],
    });
    const after = await waitFor("A uploads the note", () => uploads() > 0);
    await a.controller.idle();
    ok(
      after >= LOCAL_CHANGE_DELAY_MS - 200 &&
        after < LOCAL_CHANGE_DELAY_MS + 3_000,
      `uploaded ${after} ms after the change`,
    );

    step("Desktop B joins with A's code: the note goes across");
    const pairing = await a.controller.pairing();
    ok(pairing, "A shows its code");
    await b.controller.start();
    await b.controller.join(pairing!.code);
    await synced(b, 0);
    const onB = b.native.note(id);
    ok(onB?.transcript === "Note from desktop A: buy milk.", "B has A's note");
    ok(onB?.segments[0]?.speaker === "Ana", "with its segments and speaker");
    ok(onB?.hasAudio === false, "without audio on B");

    step("B edits the note: the edit comes back to A");
    const edited = "Note from desktop A: buy milk and eggs (edited on B).";
    const bBefore = b.controller.getView().lastSyncAt ?? 0;
    b.native.edit(id, edited);
    await synced(b, bBefore, 15_000);
    await syncNow(a);
    ok(a.native.note(id)?.transcript === edited, "A has B's edit");
    ok(a.native.note(id)?.hasAudio === true, "A keeps its own recording");

    step("A deletes the note: the delete reaches B");
    const aBefore = a.controller.getView().lastSyncAt ?? 0;
    a.native.deleteByUser(id);
    await waitFor(
      "A uploads the delete",
      () =>
        (a.controller.getView().lastSyncAt ?? 0) > aBefore &&
        a.native.deletes.size === 0,
      15_000,
    );
    await a.controller.idle();
    await syncNow(b);
    ok(b.native.note(id) === undefined, "the note is gone on B");
    ok(b.native.captures.size === 0, "and B has nothing else");

    step("The server saw no note text and no key");
    const everything = sent.join("\n");
    ok(!everything.includes("buy milk"), "no note text in any request");
    ok(!everything.includes(a.native.key!), "never the root key");
    ok(
      !everything.includes(pairing!.code.replaceAll("-", "")),
      "never the code",
    );

    step("A turns sync off and deletes the server copy: B stops, notes kept");
    const kept = b.native.record("Kept on B.");
    await b.controller.idle();
    await a.controller.turnOff({ deleteServerCopy: true });
    ok(
      a.native.key === null && a.native.state.size === 0,
      "A forgot its key and its sync state",
    );
    await syncNow(b);
    ok(b.controller.getView().phase === "off", "sync is off on B");
    ok(
      b.controller.getView().problem?.kind === "deleted",
      "B says: This sync was deleted.",
    );
    ok(b.native.key === null, "B forgot the key");
    ok(b.native.note(kept)?.transcript === "Kept on B.", "B kept its notes");
    print(`\n${answered.length} requests:\n  ${answered.join("\n  ")}`);
  } finally {
    await a.controller.close();
    await b.controller.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const url = process.env.SONOLECT_SYNC_TEST_URL ?? "http://127.0.0.1:8712";
  checkTwoDesktops(url.replace(/\/+$/, ""), (line) => console.log(line)).then(
    () => console.log("\nTwo desktops synced through the server."),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
