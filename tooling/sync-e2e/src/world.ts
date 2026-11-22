/**
 * A desktop and a phone on one sync server, all in one process, for the
 * cross-client tests (interop.test.ts). Each side runs its app's own sync
 * code:
 *
 * - the desktop: the webview's SyncController, note store adapter, transport
 *   and state store, over FakeNative, the desktop's in-memory stand-in for
 *   the Rust commands (capture files, keychain, sync files, sync_request);
 * - the phone: the SyncController, the note store adapter and its companion
 *   values, the key store and the fetch transport, over the in-memory
 *   AsyncStorage and SecureStore of the phone's own tests;
 * - the server: the real sync service (Fastify routes, auth, limits) on its
 *   MemoryStore, reached through Fastify's in-process `inject`, so no port is
 *   opened.
 *
 * Time is one shared clock that moves only when a test says so: every timer
 * (the 5 s debounce, the periodic sync, the request timeouts) and every
 * clock (both apps, both engines, the server) reads it.
 */
import { setImmediate as nextTurn } from "node:timers/promises";

import {
  type Hlc,
  type HttpRequest,
  type HttpRequester,
  type HttpResponse,
  type SyncEngine,
  type SyncNote,
  base64urlDecode,
  createHttpTransport,
  createKeyValueStateStore,
  createMemoryStateStore,
  deriveVaultKeys,
  openSyncEngine,
} from "@sonolect/sync-core";
import {
  type MemoryNoteStore,
  createMemoryNoteStore,
} from "@sonolect/sync-core/testing";

import type { SyncPlatform } from "../../../apps/desktop/src/sync/platform";
import { SyncController as DesktopSyncController } from "../../../apps/desktop/src/sync/syncController";
import { FakeNative } from "../../../apps/desktop/src/sync/testing/fakeNative";
import type { TranscriptTurn } from "../../../apps/mobile/src/domain";
import { SYNC_STATE_PREFIX } from "../../../apps/mobile/src/storageCore";
import { SyncController as PhoneSyncController } from "../../../apps/mobile/src/sync/controller";
import { createSyncKeyStore } from "../../../apps/mobile/src/sync/keyStore";
import {
  MemorySecrets,
  TestPhone,
  makeTurn,
} from "../../../apps/mobile/src/sync/testSupport";
import {
  type FetchLike,
  createFetchRequester,
} from "../../../apps/mobile/src/sync/transport";
import type { ServiceLimits } from "../../../services/sync-service/src/config";
import { createApp } from "../../../services/sync-service/src/index";
import { MemoryStore } from "../../../services/sync-service/src/memory-store";

/** The phone's build-time server URL; requests to it reach the in-process service. */
export const SERVER_URL = "https://sync.sonolect.test";

export const randomBytes = (length: number): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

interface Timer {
  id: number;
  due: number;
  run: () => void;
}

/** One clock and one set of timers for every device and the server. */
export class SharedClock {
  private pending: Timer[] = [];
  private nextId = 1;
  /** Work started outside the timers that a settle waits for (HTTP requests). */
  private readonly busy = new Set<Promise<unknown>>();
  private started = 0;

  constructor(public time: number) {}

  now = (): number => this.time;

  readonly timers = {
    setTimeout: (run: () => void, ms: number): unknown => {
      const id = this.nextId++;
      this.pending.push({ id, due: this.time + Math.max(0, ms), run });
      return id;
    },
    clearTimeout: (handle: unknown): void => {
      this.pending = this.pending.filter((timer) => timer.id !== handle);
    },
  };

  /** Counts `work` as running until it ends, so `settle` waits for it. */
  track<T>(work: Promise<T>): Promise<T> {
    this.started += 1;
    this.busy.add(work);
    const done = () => {
      this.busy.delete(work);
    };
    work.then(done, done);
    return work;
  }

  /** Waits until no request is in flight and none starts for a while. */
  async settle(): Promise<void> {
    let quiet = 0;
    while (quiet < 3) {
      const before = this.started;
      for (let i = 0; i < 10; i += 1) await nextTurn();
      if (this.busy.size > 0) {
        await Promise.allSettled([...this.busy]);
        quiet = 0;
      } else if (this.started !== before) quiet = 0;
      else quiet += 1;
    }
  }

  /** Moves time forward, firing each timer due on the way and letting its work end. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await this.settle();
    for (;;) {
      const due = this.pending
        .filter((timer) => timer.due <= target)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!due) break;
      this.pending = this.pending.filter((timer) => timer !== due);
      this.time = Math.max(this.time, due.due);
      due.run();
      await this.settle();
    }
    this.time = target;
    await this.settle();
  }
}

/** One request as the server received it, with its answer. */
export interface Exchange {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  status: number;
  answer: string;
}

/** The real sync service on its memory store, reached in process. */
export async function startServer(
  clock: SharedClock,
  limits?: Partial<ServiceLimits>,
) {
  const logs: string[] = [];
  const exchanges: Exchange[] = [];
  const store = new MemoryStore();
  const app = await createApp({
    store,
    env: { NODE_ENV: "test", LOG_LEVEL: "info" },
    limits,
    logger: {
      write: (line: string) => {
        logs.push(line);
      },
    },
    now: clock.now,
    randomBytes,
  });
  await app.ready();

  const send = async (
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string | undefined,
  ) => {
    const response = await app.inject({
      method: method as "GET" | "POST" | "DELETE",
      url: path,
      headers,
      ...(body !== undefined ? { payload: body } : {}),
    });
    exchanges.push({
      method,
      path,
      headers,
      body: body ?? "",
      status: response.statusCode,
      answer: response.body,
    });
    const retryAfter = response.headers["retry-after"];
    return {
      status: response.statusCode,
      body: response.body,
      retryAfter: retryAfter === undefined ? null : String(retryAfter),
      headers: response.headers,
    };
  };

  /** HttpRequester for FakeNative's `sync_request` and for raw engines. */
  const request: HttpRequester = (incoming: HttpRequest) =>
    clock.track(
      (async (): Promise<HttpResponse> => {
        const { status, body, retryAfter } = await send(
          incoming.method,
          incoming.path,
          incoming.headers,
          incoming.body,
        );
        return { status, body, retryAfter };
      })(),
    );

  /** `fetch` for the phone's transport: only its build's server answers. */
  const fetch: FetchLike = (url, init) =>
    clock.track(
      (async () => {
        if (!url.startsWith(`${SERVER_URL}/`))
          throw new TypeError(`no route to ${url}`);
        if (init.redirect !== "error") throw new Error("redirects must fail");
        const { status, body, headers } = await send(
          init.method,
          url.slice(SERVER_URL.length),
          init.headers,
          init.body,
        );
        return {
          status,
          url,
          headers: {
            get: (name: string) => {
              const value = headers[name.toLowerCase()];
              return value === undefined ? null : String(value);
            },
          },
          text: async () => body,
        };
      })(),
    );

  return {
    app,
    store,
    logs,
    exchanges,
    request,
    fetch,
    close: () => app.close(),
  };
}

export type Server = Awaited<ReturnType<typeof startServer>>;

/** A desktop: FakeNative (the Rust side) under the webview's real sync code. */
export function startDesktop(clock: SharedClock, server: Server) {
  const native = new FakeNative({
    request: server.request,
    now: clock.now,
    server: new URL(SERVER_URL).host,
  });
  const platform: SyncPlatform = {
    invoke: native.invoke,
    timers: clock.timers,
    now: clock.now,
    randomBytes,
    random: () => 0.5,
  };
  let notesChanged = 0;
  const controller = new DesktopSyncController({
    platform,
    retentionDays: () => 0,
    onNotesChanged: () => {
      notesChanged += 1;
    },
  });
  native.onLocalChange = () => controller.localChange();

  return {
    native,
    controller,
    view: () => controller.getView(),
    notesChanged: () => notesChanged,
    /** The vault's root key, from the keychain. */
    root: () => base64urlDecode(native.key!),
    /** "Sync now", and waits until that run is over. */
    async sync() {
      controller.syncNow();
      await clock.advance(0);
      await controller.idle();
    },
    /** The captures by id. */
    capture: (id: string) => native.note(id),
    ids: () => [...native.captures.keys()].sort(),
    close: () => controller.close(),
  };
}

export type Desktop = ReturnType<typeof startDesktop>;

/** A phone: the in-memory storage of the phone's tests under its real sync code. */
export async function startPhone(
  clock: SharedClock,
  server: Server,
  options: { retentionDays?: number } = {},
) {
  const notes = new TestPhone(clock.now);
  await notes.load();
  const secrets = new MemorySecrets();
  /** No network on this phone while set. */
  const network = { offline: false };
  const controller = new PhoneSyncController({
    request: createFetchRequester({
      baseUrl: SERVER_URL,
      fetch: (url, init) =>
        network.offline
          ? Promise.reject(new TypeError("Network request failed"))
          : server.fetch(url, init),
      timers: clock.timers,
    }),
    keyStore: createSyncKeyStore(secrets, notes.kv),
    state: createKeyValueStateStore(notes.kv, SYNC_STATE_PREFIX),
    kept: notes.kv,
    notes: notes.notes,
    randomBytes,
    now: clock.now,
    timers: clock.timers,
    random: () => 0.5,
    paused: () => (notes.writable ? null : "historyOff"),
    retentionDays: () => options.retentionDays ?? 0,
  });
  const stamp = (previous?: Hlc) => controller.stamp(previous);

  return {
    notes,
    secrets,
    controller,
    network,
    view: () => controller.view(),
    /**
     * History turned off, then on again (store.ts updateSettings): the notes
     * are cleared on this phone only, then download again.
     */
    async historyOffAndOn() {
      notes.writable = false;
      controller.refresh();
      await notes.wipe();
      await controller.notesClearedLocally();
      notes.writable = true;
      controller.refresh();
    },
    /** A dictation, as store.ts adds one: stamped, saved, then a change for sync. */
    async dictate(rawText: string, patch: Partial<TranscriptTurn> = {}) {
      const turn = await notes.add(
        makeTurn({
          rawText,
          refinedText: rawText,
          createdAt: new Date(clock.now()).toISOString(),
          ...patch,
        }),
        stamp,
      );
      controller.noteChanged();
      return turn;
    },
    /** An edit, a refine or a pin, as store.ts's replaceTurn makes it. */
    async change(id: string, patch: Partial<TranscriptTurn>) {
      const turn = await notes.edit(id, patch, stamp);
      controller.noteChanged();
      return turn;
    },
    /** A note's Delete, as store.ts's deleteTurn makes it. */
    async delete(id: string) {
      await notes.delete([id], "everywhere", (tombstones) =>
        controller.recordDeletes(tombstones),
      );
    },
    /** The note as the phone's sync adapter gives it to the engine. */
    async syncedNote(id: string): Promise<SyncNote | undefined> {
      return (await notes.notes.read(id))?.note;
    },
    turn: (id: string) => notes.get(id),
    ids: () => notes.history.map((turn) => turn.id).sort(),
    /** Back in the foreground, which syncs at once; waits until that run is over. */
    async sync() {
      controller.setForeground(true);
      await clock.advance(0);
    },
    close: () => controller.shutdown(),
  };
}

export type Phone = Awaited<ReturnType<typeof startPhone>>;

/**
 * A client of a later app version on the same vault: sync-core's engine over
 * an in-memory note store, writing note/1 fields neither app knows.
 */
export async function startFutureClient(
  clock: SharedClock,
  server: Server,
  root: Uint8Array,
): Promise<{ engine: SyncEngine; notes: MemoryNoteStore }> {
  const keys = deriveVaultKeys(root);
  const notes = createMemoryNoteStore();
  const engine = await openSyncEngine({
    keys,
    transport: createHttpTransport({ request: server.request, vault: keys }),
    notes,
    state: createMemoryStateStore(),
    randomBytes,
    now: clock.now,
  });
  return { engine, notes };
}
