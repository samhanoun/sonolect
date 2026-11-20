/**
 * Test doubles for apps and for sync-core itself (`@sonolect/sync-core/testing`):
 * an in-memory sync server that answers the HTTP protocol like
 * services/sync-service, and an in-memory note store. Not for production.
 */
import { sha256 } from "@noble/hashes/sha2.js";

import { base64urlDecode, base64urlEncode, equalBytes } from "./encoding";
import {
  type LocalNote,
  type LocalNoteSummary,
  type NoteStore,
  type RemoteChange,
  localMatches,
} from "./engine";
import type { Hlc } from "./hlc";
import type { VaultKeys } from "./keys";
import type { SyncNote } from "./payload";
import {
  type HttpRequest,
  type HttpRequester,
  type HttpResponse,
  type SyncTransport,
  createHttpTransport,
} from "./transport";
import {
  AUTH_TOKEN_PATTERN,
  AUTH_VERIFIER_PATTERN,
  RECORD_ID_PATTERN,
  SYNC_ERROR_CODES,
  SYNC_LIMITS,
  VAULT_ID_PATTERN,
  type WireRecord,
  type WireWriteResult,
} from "./wire";

type Limits = { -readonly [K in keyof typeof SYNC_LIMITS]: number };

interface StoredRecord {
  rev: number;
  seq: number;
  deleted: boolean;
  ct: string;
  size: number;
  updatedAt: number;
}

interface StoredVault {
  verifier: string;
  epoch: string;
  head: number;
  bytes: number;
  purgedSeq: number;
  purgedAt: number;
  deletedAt?: number;
  records: Map<string, StoredRecord>;
}

export interface MemoryVaultServerOptions {
  /** Server clock in ms (default Date.now). */
  now?: () => number;
  /** Smaller limits for tests (pages, batches, quotas). */
  limits?: Partial<Limits>;
}

export interface MemoryVaultServerSnapshot {
  readonly vaults: ReadonlyMap<string, unknown>;
}

export interface MemoryVaultServer {
  /** Answers one request like the real service. */
  request: HttpRequester;
  /** createHttpTransport over `request` for one vault. */
  transport(
    keys: Pick<VaultKeys, "vaultId" | "authVerifier" | "authToken">,
  ): SyncTransport;
  /** The records of a vault as the server stores them, in seq order. */
  records(vaultId: string): WireRecord[];
  head(vaultId: string): number;
  /** A copy of everything the server holds. */
  snapshot(): MemoryVaultServerSnapshot;
  /** Goes back to a snapshot: a server restored from a backup, or one rolling records back. */
  restore(snapshot: MemoryVaultServerSnapshot): void;
  /** Forgets every vault: a server that lost its data. */
  wipe(): void;
  /** Purges tombstones older than the tombstone TTL now. */
  purgeTombstones(): void;
  /** The next `count` requests throw (a network failure), or answer `status`. */
  failNext(count?: number, status?: number): void;
  /** Requests answered so far: method, path and status, never bodies. */
  readonly log: { method: string; path: string; status: number }[];
}

const json = (status: number, body: unknown): HttpResponse => ({
  status,
  body: body === undefined ? "" : JSON.stringify(body),
});
const error = (status: number, code: string, message: string): HttpResponse =>
  json(status, { error: code, message });

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const copyVault = (vault: StoredVault): StoredVault => ({
  ...vault,
  records: new Map(
    [...vault.records].map(([rid, record]) => [rid, { ...record }]),
  ),
});

const verifierOf = (token: string) =>
  base64urlEncode(sha256(base64urlDecode(token)));

/** An in-memory sync server with the semantics of services/sync-service. */
export function createMemoryVaultServer(
  options: MemoryVaultServerOptions = {},
): MemoryVaultServer {
  const now = options.now ?? (() => Date.now());
  const limits: Limits = { ...SYNC_LIMITS, ...options.limits };
  let vaults = new Map<string, StoredVault>();
  let epochs = 0;
  // Unique per vault creation; the real service draws 8 random bytes.
  const nextEpoch = () => `e${String((epochs += 1)).padStart(10, "0")}`;
  const log: { method: string; path: string; status: number }[] = [];
  let failures: { count: number; status: number | undefined } = {
    count: 0,
    status: undefined,
  };

  const purge = (vault: StoredVault, force: boolean) => {
    const time = now();
    if (!force && time - vault.purgedAt < 24 * 60 * 60_000) return;
    vault.purgedAt = time;
    for (const [rid, record] of vault.records)
      if (record.deleted && time - record.updatedAt > limits.tombstoneTtlMs) {
        vault.records.delete(rid);
        vault.bytes -= record.size;
        vault.purgedSeq = Math.max(vault.purgedSeq, record.seq);
      }
  };

  const authorize = (
    request: HttpRequest,
    vaultId: string,
  ): StoredVault | HttpResponse => {
    if (!VAULT_ID_PATTERN.test(vaultId))
      return error(404, SYNC_ERROR_CODES.notFound, "no such vault");
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const vault = vaults.get(vaultId);
    if (
      !vault ||
      !AUTH_TOKEN_PATTERN.test(token) ||
      !equalBytes(
        base64urlDecode(verifierOf(token)),
        base64urlDecode(vault.verifier),
      )
    )
      return error(
        401,
        SYNC_ERROR_CODES.unauthorized,
        "unknown vault or wrong token",
      );
    if (vault.deletedAt !== undefined)
      return error(
        410,
        SYNC_ERROR_CODES.vaultDeleted,
        "this vault was deleted",
      );
    return vault;
  };

  const createVault = (body: unknown): HttpResponse => {
    if (
      !isRecordObject(body) ||
      typeof body.vaultId !== "string" ||
      !VAULT_ID_PATTERN.test(body.vaultId) ||
      typeof body.authVerifier !== "string" ||
      !AUTH_VERIFIER_PATTERN.test(body.authVerifier)
    )
      return error(400, SYNC_ERROR_CODES.badRequest, "invalid vault");
    const existing = vaults.get(body.vaultId);
    if (existing) {
      if (existing.verifier !== body.authVerifier)
        return error(409, SYNC_ERROR_CODES.vaultExists, "vault exists");
      if (existing.deletedAt !== undefined)
        return error(
          410,
          SYNC_ERROR_CODES.vaultDeleted,
          "this vault was deleted",
        );
      return json(200, {
        vaultId: body.vaultId,
        created: false,
        epoch: existing.epoch,
      });
    }
    const epoch = nextEpoch();
    vaults.set(body.vaultId, {
      verifier: body.authVerifier,
      epoch,
      head: 0,
      bytes: 0,
      purgedSeq: 0,
      purgedAt: now(),
      records: new Map(),
    });
    return json(201, { vaultId: body.vaultId, created: true, epoch });
  };

  const changes = (vault: StoredVault, query: string): HttpResponse => {
    const params = new Map(
      query
        .split("&")
        .filter(Boolean)
        .map((part) => {
          const equals = part.indexOf("=");
          return equals < 0
            ? ([part, ""] as const)
            : ([part.slice(0, equals), part.slice(equals + 1)] as const);
        }),
    );
    const since = Number(params.get("since") ?? "0");
    const limit = Number(params.get("limit") ?? String(limits.maxPageRecords));
    if (
      !Number.isSafeInteger(since) ||
      since < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > SYNC_LIMITS.maxPageRecords
    )
      return error(400, SYNC_ERROR_CODES.badRequest, "invalid since or limit");
    purge(vault, false);
    if (since > vault.head)
      return error(
        410,
        SYNC_ERROR_CODES.cursorReset,
        "cursor is past the head",
      );
    if (since > 0 && since < vault.purgedSeq)
      return error(410, SYNC_ERROR_CODES.cursorExpired, "cursor expired");
    const all = [...vault.records]
      .filter(([, record]) => record.seq > since)
      .sort((a, b) => a[1].seq - b[1].seq);
    const page: WireRecord[] = [];
    let bytes = 0;
    for (const [rid, record] of all) {
      if (page.length >= Math.min(limit, limits.maxPageRecords)) break;
      if (page.length > 0 && bytes + record.ct.length > limits.maxPageBytes)
        break;
      page.push({
        rid,
        rev: record.rev,
        seq: record.seq,
        deleted: record.deleted,
        ct: record.ct,
      });
      bytes += record.ct.length;
    }
    return json(200, {
      records: page,
      next: page.length > 0 ? page[page.length - 1]!.seq : since,
      hasMore: page.length < all.length,
      head: vault.head,
      epoch: vault.epoch,
    });
  };

  const write = (vault: StoredVault, body: unknown): HttpResponse => {
    if (!isRecordObject(body) || !Array.isArray(body.writes))
      return error(400, SYNC_ERROR_CODES.badRequest, "invalid writes");
    const writes = body.writes as unknown[];
    if (writes.length < 1 || writes.length > limits.maxBatchWrites)
      return error(
        400,
        SYNC_ERROR_CODES.badRequest,
        "invalid number of writes",
      );
    const rids = new Set<string>();
    for (const item of writes) {
      if (
        !isRecordObject(item) ||
        typeof item.rid !== "string" ||
        !RECORD_ID_PATTERN.test(item.rid) ||
        !Number.isSafeInteger(item.baseRev) ||
        (item.baseRev as number) < 0 ||
        typeof item.deleted !== "boolean" ||
        typeof item.ct !== "string" ||
        rids.has(item.rid)
      )
        return error(400, SYNC_ERROR_CODES.badRequest, "invalid write");
      let size: number;
      try {
        size = base64urlDecode(item.ct).length;
      } catch {
        return error(400, SYNC_ERROR_CODES.badRequest, "invalid ciphertext");
      }
      if (size > limits.maxRecordBytes)
        return error(413, SYNC_ERROR_CODES.recordTooLarge, "record too large");
      if (size < limits.minRecordBytes)
        return error(400, SYNC_ERROR_CODES.badRequest, "invalid ciphertext");
      rids.add(item.rid);
    }
    purge(vault, false);
    const results: WireWriteResult[] = [];
    for (const item of writes as {
      rid: string;
      baseRev: number;
      deleted: boolean;
      ct: string;
    }[]) {
      const current = vault.records.get(item.rid);
      if ((current?.rev ?? 0) !== item.baseRev) {
        results.push({
          rid: item.rid,
          status: "conflict",
          current: current
            ? {
                rid: item.rid,
                rev: current.rev,
                seq: current.seq,
                deleted: current.deleted,
                ct: current.ct,
              }
            : null,
        });
        continue;
      }
      const size = base64urlDecode(item.ct).length;
      const exempt = item.deleted && current !== undefined;
      if (
        !exempt &&
        !current &&
        vault.records.size + 1 > limits.maxVaultRecords
      ) {
        results.push({
          rid: item.rid,
          status: "rejected",
          reason: "quota_records",
        });
        continue;
      }
      if (
        !exempt &&
        vault.bytes - (current?.size ?? 0) + size > limits.maxVaultBytes
      ) {
        results.push({
          rid: item.rid,
          status: "rejected",
          reason: "quota_bytes",
        });
        continue;
      }
      vault.head += 1;
      const rev = (current?.rev ?? 0) + 1;
      vault.bytes += size - (current?.size ?? 0);
      vault.records.set(item.rid, {
        rev,
        seq: vault.head,
        deleted: item.deleted,
        ct: item.ct,
        size,
        updatedAt: now(),
      });
      results.push({ rid: item.rid, status: "ok", rev, seq: vault.head });
    }
    return json(200, { results });
  };

  const answer = (request: HttpRequest): HttpResponse => {
    const [path = "", query = ""] = request.path.split("?");
    let body: unknown;
    if (request.body !== undefined) {
      if (request.body.length > limits.maxRequestBytes)
        return error(413, SYNC_ERROR_CODES.recordTooLarge, "request too large");
      try {
        body = JSON.parse(request.body);
      } catch {
        return error(400, SYNC_ERROR_CODES.badRequest, "invalid JSON");
      }
    }
    if (request.method === "GET" && path === "/health")
      return json(200, { ok: true });
    if (request.method === "POST" && path === "/v1/vaults")
      return createVault(body);
    const match = /^\/v1\/vaults\/([^/]+)(\/changes|\/records)?$/.exec(path);
    if (!match) return error(404, SYNC_ERROR_CODES.notFound, "no such route");
    const vault = authorize(request, match[1]!);
    if (!("records" in vault)) return vault;
    if (request.method === "GET" && match[2] === "/changes")
      return changes(vault, query);
    if (request.method === "POST" && match[2] === "/records")
      return write(vault, body);
    if (request.method === "DELETE" && match[2] === undefined) {
      vault.deletedAt = now();
      vault.records = new Map();
      vault.bytes = 0;
      return json(204, undefined);
    }
    return error(404, SYNC_ERROR_CODES.notFound, "no such route");
  };

  const request: HttpRequester = async (incoming) => {
    const path = incoming.path.split("?")[0]!;
    if (failures.count > 0) {
      failures.count -= 1;
      if (failures.status === undefined) {
        log.push({ method: incoming.method, path, status: 0 });
        throw new Error("network failure (test)");
      }
      log.push({ method: incoming.method, path, status: failures.status });
      return error(failures.status, "test", "injected failure");
    }
    const response = answer(incoming);
    log.push({ method: incoming.method, path, status: response.status });
    return response;
  };

  return {
    request,
    transport: (keys) =>
      createHttpTransport({ request, vault: keys }, () => now()),
    records(vaultId) {
      const vault = vaults.get(vaultId);
      if (!vault) return [];
      return [...vault.records]
        .map(([rid, record]) => ({
          rid,
          rev: record.rev,
          seq: record.seq,
          deleted: record.deleted,
          ct: record.ct,
        }))
        .sort((a, b) => a.seq - b.seq);
    },
    head: (vaultId) => vaults.get(vaultId)?.head ?? 0,
    snapshot: () => ({
      vaults: new Map([...vaults].map(([id, vault]) => [id, copyVault(vault)])),
    }),
    restore(snapshot) {
      vaults = new Map(
        [...(snapshot.vaults as ReadonlyMap<string, StoredVault>)].map(
          ([id, vault]) => [id, copyVault(vault)],
        ),
      );
    },
    wipe() {
      vaults = new Map();
    },
    purgeTombstones() {
      for (const vault of vaults.values()) purge(vault, true);
    },
    failNext(count = 1, status) {
      failures = { count, status };
    },
    log,
  };
}

/** One note in a MemoryNoteStore. */
export interface MemoryNote {
  note: SyncNote;
  hlc?: Hlc | undefined;
}

export interface MemoryNoteStore extends NoteStore {
  /** The notes, by id. Tests may read them directly. */
  readonly notes: Map<string, MemoryNote>;
  get(id: string): MemoryNote | undefined;
  /** A local change: stores the note with the given HLC (from engine.stamp). */
  put(id: string, note: SyncNote, hlc?: Hlc): void;
  /** A local removal (a delete or retention). */
  remove(id: string): void;
  /** Called before each applyRemote: lets a test change a note at the worst moment. */
  beforeApply: ((change: RemoteChange) => void) | undefined;
}

const copyNote = (note: SyncNote): SyncNote =>
  JSON.parse(JSON.stringify(note)) as SyncNote;

const parseMs = (date: string | undefined): number | undefined => {
  if (date === undefined) return undefined;
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? ms : undefined;
};

/** A NoteStore over a Map, implementing the adapter contract exactly. */
export function createMemoryNoteStore(): MemoryNoteStore {
  const notes = new Map<string, MemoryNote>();
  const store: MemoryNoteStore = {
    notes,
    beforeApply: undefined,
    get: (id) => notes.get(id),
    put(id, note, hlc) {
      notes.set(id, {
        note: copyNote(note),
        ...(hlc ? { hlc: { ...hlc } } : {}),
      });
    },
    remove(id) {
      notes.delete(id);
    },
    async list(): Promise<LocalNoteSummary[]> {
      return [...notes].map(([id, entry]) => ({
        id,
        hlc: entry.hlc,
        createdAtMs: parseMs(entry.note.createdAt) ?? 0,
        updatedAtMs: parseMs(entry.note.updatedAt),
      }));
    },
    async read(id): Promise<LocalNote | undefined> {
      const entry = notes.get(id);
      return entry
        ? {
            note: copyNote(entry.note),
            ...(entry.hlc ? { hlc: { ...entry.hlc } } : {}),
          }
        : undefined;
    },
    async applyRemote(change) {
      store.beforeApply?.(change);
      if (!localMatches(notes.get(change.id), change.expected)) return false;
      if (change.note === null) notes.delete(change.id);
      else
        notes.set(change.id, {
          note: copyNote(change.note),
          hlc: { ...change.hlc },
        });
      return true;
    },
    async saveConflictCopy(id, note, hlc) {
      notes.set(id, { note: copyNote(note), hlc: { ...hlc } });
    },
  };
  return store;
}
