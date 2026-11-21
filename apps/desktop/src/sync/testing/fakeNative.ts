/**
 * A stand-in for the desktop app's native side, for tests and for driving
 * the real sync modules against a real server: the capture files, the sync
 * key in the keychain, the sync state files, the deletes kept for the
 * engine, and `sync_request`. It follows the Rust commands
 * (`local_history.rs`, `sync.rs`), including their compare-and-set rules and
 * their stamping of local changes. Not for the app.
 */
import {
  type Hlc,
  type HttpRequester,
  compareHlc,
  hlcEquals,
  isHlc,
} from "@sonolect/sync-core";

import type { CaptureSegment, StoredCapture } from "../desktopNotes";
import type { Invoke } from "../platform";

export interface FakeCapture extends StoredCapture {
  hasAudio: boolean;
}

export interface FakeNativeOptions {
  /** Answers `sync_request`: sync-core's memory server, or HTTP to a real one. */
  request: HttpRequester;
  now: () => number;
  /** False: a build without a sync server. */
  available?: boolean;
  server?: string;
}

interface Expected {
  exists: boolean;
  hlc?: Hlc;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROOT_KEY = /^[A-Za-z0-9_-]{43}$/;

/** What crosses the IPC boundary: JSON, as serde sees it. */
const copy = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

export class FakeNative {
  readonly captures = new Map<string, FakeCapture>();
  /** The engine's state files, by key ("meta", "r.<c>"). */
  readonly state = new Map<string, string>();
  /** deletes.json: deletes made here that the engine has not recorded yet. */
  readonly deletes = new Map<string, Hlc | null>();
  /** The sync key in the keychain. */
  key: string | null = null;
  /** Every command called, in order (never with its arguments' secrets checked). */
  readonly calls: string[] = [];
  /** The native "a note changed here" event (sent only while sync is on). */
  onLocalChange: (() => void) | undefined;
  /** The next `sync_request` calls reject with these, as Rust does without an answer. */
  readonly requestFailures: unknown[] = [];
  /** The recording in progress, left out of sync. */
  live: string | undefined;
  /** Throws this from the next `sync_state_save`. */
  failNextStateSave: string | undefined;
  private counter = 0;

  constructor(private readonly options: FakeNativeOptions) {}

  get available() {
    return this.options.available ?? true;
  }

  /** Sync is on once the engine saved its state (sync.rs `is_on`). */
  isOn() {
    return this.available && this.state.has("meta");
  }

  // ---- what the user does on this device ----

  /** A new recording, transcribed. */
  record(
    transcript: string,
    extra: Partial<Omit<FakeCapture, "id">> = {},
  ): string {
    const now = this.options.now();
    const id = `${now}${String((this.counter += 1)).padStart(6, "0")}-4242`;
    const capture: FakeCapture = {
      id,
      createdAtMs: now,
      durationMs: 1_000,
      transcript,
      error: null,
      language: "en",
      segments: [],
      hasAudio: true,
      ...extra,
    };
    this.saveLocal(capture);
    return id;
  }

  /** An edit in the studio (`update_local_capture`). */
  edit(id: string, transcript: string, segments?: CaptureSegment[]) {
    const capture = this.captures.get(id);
    if (!capture)
      throw new Error("This recording is no longer in your library.");
    capture.transcript = transcript;
    if (segments) capture.segments = segments;
    capture.updatedAtMs = this.options.now();
    this.saveLocal(capture);
  }

  /** A delete the user asked for (`delete_local_capture`). */
  deleteByUser(id: string) {
    const capture = this.captures.get(id);
    if (this.isOn()) this.deletes.set(id, capture?.hlc ?? null);
    this.captures.delete(id);
    if (this.isOn()) this.onLocalChange?.();
  }

  /** Retention or "delete all": no delete reaches the other devices. */
  purge(id: string) {
    this.captures.delete(id);
  }

  note(id: string): FakeCapture | undefined {
    const capture = this.captures.get(id);
    return capture ? copy(capture) : undefined;
  }

  /** The notes by transcript, for assertions. */
  transcripts(): string[] {
    return [...this.captures.values()]
      .map((capture) => capture.transcript ?? "")
      .sort();
  }

  private saveLocal(capture: FakeCapture) {
    const stamp = this.stamp(capture.hlc);
    if (stamp) capture.hlc = stamp;
    else delete capture.hlc;
    this.captures.set(capture.id, copy(capture));
    if (this.isOn()) this.onLocalChange?.();
  }

  /** sync.rs `local_stamp`: later than the note's version and than the engine's clock. */
  private stamp(previous: Hlc | undefined): Hlc | undefined {
    if (!this.isOn()) return undefined;
    const meta = JSON.parse(this.state.get("meta")!) as {
      deviceId: string;
      clock: Hlc;
    };
    const latest = meta.clock;
    const t = Math.max(this.options.now(), latest.t);
    let next: Hlc = {
      t,
      c: t === latest.t ? latest.c + 1 : 0,
      d: meta.deviceId,
    };
    if (previous && isHlc(previous) && compareHlc(next, previous) <= 0)
      next = { t: previous.t, c: previous.c + 1, d: meta.deviceId };
    return next;
  }

  // ---- the native commands ----

  invoke: Invoke = async <T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    this.calls.push(command);
    return copy(await this.answer(command, copy(args))) as T;
  };

  private syncable(capture: FakeCapture | undefined) {
    return capture && capture.transcript !== null && capture.id !== this.live
      ? capture
      : undefined;
  }

  private matches(local: FakeCapture | undefined, expected: Expected) {
    return local === undefined
      ? !expected.exists
      : expected.exists && hlcEquals(local.hlc, expected.hlc);
  }

  private async answer(
    command: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const sync = this.available;
    switch (command) {
      case "sync_config":
        return sync
          ? { available: true, server: this.options.server ?? "sync.test" }
          : { available: false };
      case "sync_key_status":
        return sync && this.key !== null;
      case "sync_key_create": {
        const key = String(args.key);
        if (!ROOT_KEY.test(key)) throw "This is not a valid sync key.";
        if (this.key !== null && this.key !== key)
          throw "Sync is already on with another key. Turn it off first.";
        this.key = key;
        return null;
      }
      case "sync_key_import": {
        const key = String(args.key);
        if (!ROOT_KEY.test(key)) throw "This is not a valid sync key.";
        this.key = key;
        return null;
      }
      case "sync_key_load":
        return this.key;
      case "sync_key_forget":
        this.key = null;
        return null;
      case "sync_state_load":
        return Object.fromEntries(this.state);
      case "sync_state_save": {
        if (this.failNextStateSave) {
          const message = this.failNextStateSave;
          this.failNextStateSave = undefined;
          throw message;
        }
        const set = args.set as Record<string, string>;
        for (const [key, value] of Object.entries(set))
          if (key !== "meta") this.state.set(key, value);
        for (const key of args.remove as string[]) this.state.delete(key);
        if (set.meta !== undefined) this.state.set("meta", set.meta);
        return null;
      }
      case "sync_state_clear":
        this.state.clear();
        this.deletes.clear();
        return null;
      case "sync_pending_deletes":
        return [...this.deletes].map(([id, hlc]) => ({
          id,
          ...(hlc ? { hlc } : {}),
        }));
      case "sync_pending_deletes_done":
        for (const { id, hlc } of args.deletes as { id: string; hlc?: Hlc }[])
          if (
            this.deletes.has(id) &&
            hlcEquals(this.deletes.get(id) ?? undefined, hlc)
          )
            this.deletes.delete(id);
        return null;
      case "list_sync_notes":
        return [...this.captures.values()]
          .filter((capture) => this.syncable(capture))
          .map(({ id, hlc, createdAtMs, updatedAtMs }) => ({
            id,
            ...(hlc ? { hlc } : {}),
            createdAtMs,
            ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
          }));
      case "read_sync_note": {
        const capture = this.syncable(this.captures.get(String(args.id)));
        if (!capture) return null;
        const { hasAudio: _hasAudio, ...stored } = capture;
        return stored;
      }
      case "upsert_synced_capture": {
        const capture = args.capture as StoredCapture;
        const expected = args.expected as Expected | null;
        if (!ID.test(capture.id)) throw "Invalid recording ID.";
        if (capture.transcript === null || !isHlc(capture.hlc))
          throw "Invalid synced note.";
        if (capture.id === this.live) return "changed";
        const existing = this.captures.get(capture.id);
        if (expected && !this.matches(this.syncable(existing), expected))
          return "changed";
        this.captures.set(capture.id, {
          ...capture,
          error: existing?.error ?? null,
          hasAudio: existing?.hasAudio ?? false,
        });
        return "written";
      }
      case "apply_remote_delete": {
        const id = String(args.id);
        if (!ID.test(id)) throw "Invalid recording ID.";
        const existing = this.syncable(this.captures.get(id));
        if (!this.matches(existing, args.expected as Expected))
          return "changed";
        this.captures.delete(id);
        return "written";
      }
      case "sync_request": {
        if (!sync)
          throw {
            kind: "unavailable",
            message: "Sync is not available in this version of Sonolect.",
          };
        if (this.requestFailures.length > 0) throw this.requestFailures.shift();
        const bearer = args.bearer as string | null;
        const body = args.body as string | null;
        let response: Awaited<ReturnType<HttpRequester>>;
        try {
          response = await this.options.request({
            method: args.method as "GET" | "POST" | "DELETE",
            path: String(args.path),
            headers: {
              accept: "application/json",
              ...(body !== null ? { "content-type": "application/json" } : {}),
              ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            },
            ...(body !== null ? { body } : {}),
          });
        } catch {
          // Rust answers a request that got no answer with its kind only.
          throw {
            kind: "network",
            message: "The sync server could not be reached.",
          };
        }
        return {
          status: response.status,
          body: response.body,
          ...(response.retryAfter ? { retryAfter: response.retryAfter } : {}),
        };
      }
      default:
        throw `Unknown command ${command}`;
    }
  }
}
