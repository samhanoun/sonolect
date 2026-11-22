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
  base64urlDecode,
  compareHlc,
  deriveVaultKeys,
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

/** One delete in deletes.json (sync.rs `DeleteEntry`). */
export interface FakeDelete {
  /** The note's version when it was deleted. */
  hlc?: Hlc;
  /** When the user deleted it, stamped as the engine would. */
  deletedAt?: Hlc;
  /** The version the engine last synced, kept with a delete not uploaded. */
  synced?: { hlc: Hlc; fp?: string };
  /** Kept when sync was turned off: only an engine for this vault takes it. */
  vault?: string;
}

const VAULT_ID = /^[A-Za-z0-9_-]{22}$/;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROOT_KEY = /^[A-Za-z0-9_-]{43}$/;

/** local_history.rs `same_words`: the same words, whatever the spacing. */
const sameWords = (saved: string | null, edited: string) => {
  if (saved === null) return false;
  const words = (text: string) => text.split(/\s+/).filter(Boolean);
  const a = words(saved);
  const b = words(edited);
  return a.length === b.length && a.every((word, index) => word === b[index]);
};

/**
 * local_history.rs `keep_segment_extras`: a segment the studio saves at the
 * times of a saved one keeps the fields of it the studio does not know.
 */
function keepSegmentExtras(
  saved: readonly CaptureSegment[],
  edited: readonly CaptureSegment[],
): CaptureSegment[] {
  const used = new Set<number>();
  return edited.map((segment) => {
    const index = saved.findIndex(
      (old, at) =>
        !used.has(at) &&
        old.startMs === segment.startMs &&
        old.endMs === segment.endMs,
    );
    if (index < 0) return segment;
    used.add(index);
    const {
      startMs: _startMs,
      endMs: _endMs,
      text: _text,
      speaker: _speaker,
      ...extra
    } = saved[index]!;
    const merged: CaptureSegment = { ...segment };
    for (const [key, value] of Object.entries(extra))
      if (!(key in merged)) merged[key] = value;
    return merged;
  });
}

/** Two entries of deletes.json are the same delete (sync.rs compares them whole). */
const sameDelete = (a: FakeDelete, b: FakeDelete) =>
  hlcEquals(a.hlc, b.hlc) &&
  hlcEquals(a.deletedAt, b.deletedAt) &&
  JSON.stringify(a.synced ?? null) === JSON.stringify(b.synced ?? null) &&
  (a.vault ?? null) === (b.vault ?? null);

/** What crosses the IPC boundary: JSON, as serde sees it. */
const copy = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

export class FakeNative {
  readonly captures = new Map<string, FakeCapture>();
  /** The engine's state files, by key ("meta", "r.<c>"). */
  readonly state = new Map<string, string>();
  /** deletes.json: deletes made here that the engine has not recorded yet. */
  readonly deletes = new Map<string, FakeDelete>();
  /** The sync key in the keychain. */
  key: string | null = null;
  /**
   * sync.rs's `key-saved` marker: sync is on with the key in the keychain.
   * Without it a key still in the keychain is a leftover that is never read.
   */
  keyInUse = false;
  /** The vault the marker names (null: an earlier version's empty marker). */
  markedVault: string | null = null;
  /** The next keychain call fails with this message (a locked keychain, say). */
  failNextKeychain: string | undefined;
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
    // As local_history.rs: an edit that changes a word drops the refined
    // text; one that only changes the spacing keeps it.
    if (!sameWords(capture.transcript ?? null, transcript))
      delete capture.refinedText;
    capture.transcript = transcript;
    if (segments)
      capture.segments = keepSegmentExtras(capture.segments, segments);
    capture.updatedAtMs = this.options.now();
    this.saveLocal(capture);
  }

  /** A delete the user asked for (`delete_local_capture`), stamped now. */
  deleteByUser(id: string) {
    const capture = this.captures.get(id);
    if (this.isOn()) {
      const deletedAt = this.stamp(capture?.hlc);
      this.deletes.set(id, {
        ...(capture?.hlc ? { hlc: capture.hlc } : {}),
        ...(deletedAt ? { deletedAt } : {}),
      });
    }
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

  /** sync.rs `mark_key_saved`: sync is on with this key, for its vault. */
  private mark(key: string) {
    this.keyInUse = true;
    this.markedVault = deriveVaultKeys(base64urlDecode(key)).vaultId;
  }

  private requestAllowed(path: string, body: string | null): boolean {
    if (!this.keyInUse) return false;
    if (this.markedVault === null) return true;
    let vault: unknown;
    if (path === "/v1/vaults") {
      try {
        vault = (JSON.parse(body ?? "null") as { vaultId?: unknown } | null)
          ?.vaultId;
      } catch {
        vault = undefined;
      }
    } else vault = path.slice("/v1/vaults/".length).split(/[/?]/)[0];
    return vault === this.markedVault;
  }

  /** A keychain call: fails once after `failNextKeychain`. */
  private keychain() {
    const failure = this.failNextKeychain;
    if (failure === undefined) return;
    this.failNextKeychain = undefined;
    throw failure;
  }

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
        if (!sync || !this.keyInUse) return false;
        this.keychain();
        return this.key !== null;
      case "sync_key_create": {
        const key = String(args.key);
        if (!ROOT_KEY.test(key)) throw "This is not a valid sync key.";
        if (this.keyInUse) {
          this.keychain();
          if (this.key === key) {
            this.mark(key);
            return null;
          }
          if (this.key !== null)
            throw "Sync is already on with another key. Turn it off first.";
        }
        this.keychain();
        this.key = key;
        this.mark(key);
        return null;
      }
      case "sync_key_import": {
        const key = String(args.key);
        if (!ROOT_KEY.test(key)) throw "This is not a valid sync key.";
        this.keychain();
        this.key = key;
        this.mark(key);
        return null;
      }
      case "sync_key_load":
        if (!this.keyInUse) return null;
        this.keychain();
        if (this.key && this.markedVault === null) this.mark(this.key);
        return this.key;
      case "sync_key_forget":
        // Off first, whatever the keychain then says.
        this.keyInUse = false;
        this.markedVault = null;
        this.keychain();
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
      case "sync_state_clear": {
        // sync.rs `clear_state`: without `keep` the deletes go too; with it
        // they stay, with those the engine had not uploaded, tagged with
        // their vault.
        const keep = args.keep as
          | { vault?: string | null; deletes?: ({ id: string } & FakeDelete)[] }
          | null
          | undefined;
        this.state.clear();
        if (!keep) {
          this.deletes.clear();
          return null;
        }
        const vault =
          typeof keep.vault === "string" && VAULT_ID.test(keep.vault)
            ? keep.vault
            : undefined;
        for (const entry of this.deletes.values())
          if (entry.vault === undefined && vault) entry.vault = vault;
        for (const { id, ...entry } of keep.deletes ?? []) {
          if (!ID.test(id)) continue;
          const tagged =
            entry.vault && VAULT_ID.test(entry.vault) ? entry.vault : vault;
          this.deletes.set(id, {
            ...(entry.hlc ? { hlc: entry.hlc } : {}),
            ...(entry.deletedAt ? { deletedAt: entry.deletedAt } : {}),
            ...(entry.synced ? { synced: entry.synced } : {}),
            ...(tagged ? { vault: tagged } : {}),
          });
        }
        return null;
      }
      case "sync_pending_deletes":
        return [...this.deletes].map(([id, entry]) => ({ id, ...entry }));
      case "sync_pending_deletes_done":
        for (const { id, ...entry } of args.deletes as ({
          id: string;
        } & FakeDelete)[])
          if (this.deletes.has(id) && sameDelete(this.deletes.get(id)!, entry))
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
        const bearer = args.bearer as string | null;
        const body = args.body as string | null;
        // sync.rs `request_allowed`: only while sync is on, for its vault.
        if (!this.requestAllowed(String(args.path), body))
          throw { kind: "invalid", message: "Invalid sync request." };
        if (this.requestFailures.length > 0) throw this.requestFailures.shift();
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
