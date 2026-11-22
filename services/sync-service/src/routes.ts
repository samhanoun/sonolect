import { createHash, timingSafeEqual } from "node:crypto";

import {
  AUTH_TOKEN_PATTERN,
  AUTH_VERIFIER_PATTERN,
  BASE64URL_PATTERN,
  type ChangesResponse,
  type CreateVaultResponse,
  RECORD_ID_PATTERN,
  SYNC_ERROR_CODES,
  SYNC_LIMITS,
  VAULT_ID_PATTERN,
  type WireRecord,
  type WireWriteResult,
  type WriteResponse,
} from "@sonolect/sync-core/wire";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ServiceLimits } from "./config.js";
import {
  FixedWindowLimiter,
  clientKey,
  retryAfterSeconds,
} from "./rate-limit.js";
import {
  type CreateOutcome,
  type StoreWriteResult,
  type StoredRecord,
  type VaultMeta,
  type VaultStore,
  VaultGoneError,
  type WriteInput,
} from "./store.js";

/** The vault routes, which authenticate callers with the vault's bearer token. */
export const VAULT_ROUTES = [
  "POST /v1/vaults",
  "GET /v1/vaults/:vaultId/changes",
  "POST /v1/vaults/:vaultId/records",
  "DELETE /v1/vaults/:vaultId",
] as const;

/** An answer with one of SYNC_ERROR_CODES. */
export class SyncHttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** Seconds, for 429. */
  readonly retryAfter: number | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "SyncHttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const badRequest = (message: string) =>
  new SyncHttpError(400, SYNC_ERROR_CODES.badRequest, message);
const tooLarge = () =>
  new SyncHttpError(
    413,
    SYNC_ERROR_CODES.recordTooLarge,
    `a record is larger than ${SYNC_LIMITS.maxRecordBytes} bytes`,
  );
const vaultDeleted = () =>
  new SyncHttpError(
    410,
    SYNC_ERROR_CODES.vaultDeleted,
    "this sync was deleted",
  );
export const rateLimited = (waitMs: number) =>
  new SyncHttpError(
    429,
    SYNC_ERROR_CODES.rateLimited,
    "too many requests",
    retryAfterSeconds(waitMs),
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256 = (bytes: Uint8Array): Buffer =>
  createHash("sha256").update(bytes).digest();

const base64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64url",
  );

/** A copy in its own buffer (Buffer.from may hand out a slice of a shared pool). */
const decodeBase64url = (text: string): Uint8Array =>
  new Uint8Array(Buffer.from(text, "base64url"));

/**
 * The token from "Bearer <token>", parsed by hand in linear time (the header
 * is the caller's). Undefined when absent or malformed.
 */
export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (value.slice(0, 6).toLowerCase() !== "bearer") return undefined;
  const rest = value.slice(6);
  if (rest[0] !== " " && rest[0] !== "\t") return undefined;
  const token = rest.trimStart();
  return AUTH_TOKEN_PATTERN.test(token) ? token : undefined;
}

const toWire = (record: StoredRecord): WireRecord => ({
  rid: record.rid,
  rev: record.rev,
  seq: record.seq,
  deleted: record.deleted,
  ct: base64url(record.ct),
});

const toWireResult = (result: StoreWriteResult): WireWriteResult =>
  result.status === "conflict"
    ? {
        rid: result.rid,
        status: "conflict",
        current: result.current && toWire(result.current),
      }
    : result;

/** A non-negative integer from the query string, or `fallback` when absent. */
function queryCount(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,14})$/.test(value))
    throw badRequest(`${name} must be a non-negative integer`);
  return Number(value);
}

export interface VaultRoutesOptions {
  store: VaultStore;
  limits: ServiceLimits;
  now: () => number;
  randomBytes: (size: number) => Uint8Array;
}

/**
 * The vault routes (the HTTP protocol in @sonolect/sync-core/wire), as a
 * plugin with its own error handler. They are public to the service-token
 * check: each authenticates the vault's bearer token itself.
 */
export async function vaultRoutes(
  app: FastifyInstance,
  options: VaultRoutesOptions,
): Promise<void> {
  const { store, limits, now, randomBytes } = options;
  const quotas = {
    maxVaultRecords: limits.maxVaultRecords,
    maxVaultTombstones: limits.maxVaultTombstones,
    maxVaultBytes: limits.maxVaultBytes,
    maxTombstoneBytes: limits.maxTombstoneBytes,
  };
  const perVault = new FixedWindowLimiter(
    limits.vaultRequestsPerMinute,
    60_000,
  );
  const creations = new FixedWindowLimiter(
    limits.vaultCreatesPerHour,
    60 * 60_000,
  );
  const maxCtChars = Math.ceil((limits.maxRecordBytes * 4) / 3);
  // Compared against when the vault is unknown, so that path costs the same.
  const unknownVerifier = sha256(randomBytes(32));

  app.setErrorHandler((rawError, request, reply) => {
    if (rawError instanceof SyncHttpError) {
      if (rawError.retryAfter !== undefined)
        reply.header("retry-after", String(rawError.retryAfter));
      if (rawError.statusCode === 401)
        reply.header("www-authenticate", "Bearer");
      return reply
        .status(rawError.statusCode)
        .send({ error: rawError.code, message: rawError.message });
    }
    if (rawError instanceof VaultGoneError)
      return reply.status(410).send({
        error: SYNC_ERROR_CODES.vaultDeleted,
        message: "this sync was deleted",
      });
    const status = (rawError as { statusCode?: unknown }).statusCode;
    if (status === 413)
      return reply.status(413).send({
        error: SYNC_ERROR_CODES.recordTooLarge,
        message: "the request body is too large",
      });
    if (typeof status === "number" && status >= 400 && status < 500)
      // Fastify's own client errors (malformed JSON, wrong content type).
      // Their messages can quote the body, so none is sent back or logged.
      return reply.status(status).send({
        error: SYNC_ERROR_CODES.badRequest,
        message: "malformed request",
      });
    request.log.error({ err: rawError }, "sync request failed");
    return reply
      .status(500)
      .send({ error: "internal_error", message: "internal server error" });
  });

  /** Checks the vault id and the bearer token; counts the vault's rate limit. */
  async function authorize(
    request: FastifyRequest,
    vaultId: string,
    allowDeleted: boolean,
  ): Promise<VaultMeta> {
    if (!VAULT_ID_PATTERN.test(vaultId))
      throw new SyncHttpError(404, SYNC_ERROR_CODES.notFound, "no such vault");
    const token = parseBearer(request.headers.authorization);
    const meta = await store.getVault(vaultId);
    const presented = sha256(
      token === undefined ? new Uint8Array(0) : decodeBase64url(token),
    );
    const expected = meta
      ? Buffer.from(meta.verifier, "base64url")
      : unknownVerifier;
    const matches =
      expected.length === presented.length &&
      timingSafeEqual(presented, expected);
    // The same answer for an unknown vault and a wrong token.
    if (!meta || token === undefined || !matches)
      throw new SyncHttpError(
        401,
        SYNC_ERROR_CODES.unauthorized,
        "unknown vault or wrong token",
      );
    if (meta.deletedAt !== undefined && !allowDeleted) throw vaultDeleted();
    const wait = perVault.hit(vaultId, now());
    if (wait > 0) throw rateLimited(wait);
    return meta;
  }

  /** Purges old tombstones when the vault is due, and answers fresh metadata. */
  async function purged(vaultId: string, meta: VaultMeta): Promise<VaultMeta> {
    const time = now();
    if (time - meta.purgedAt < limits.purgeIntervalMs) return meta;
    await store.purge(
      vaultId,
      time,
      limits.tombstoneTtlMs,
      limits.purgeIntervalMs,
    );
    const fresh = await store.getVault(vaultId);
    if (!fresh || fresh.deletedAt !== undefined) throw vaultDeleted();
    return fresh;
  }

  function parseWrites(body: unknown): WriteInput[] {
    if (!isObject(body) || !Array.isArray(body.writes))
      throw badRequest("the body must be {writes: [...]}");
    const writes: unknown[] = body.writes;
    if (writes.length < 1 || writes.length > limits.maxBatchWrites)
      throw badRequest(`send 1 to ${limits.maxBatchWrites} writes`);
    const seen = new Set<string>();
    return writes.map((item, index): WriteInput => {
      const at = `writes[${index}]`;
      if (!isObject(item)) throw badRequest(`${at} must be an object`);
      const { rid, baseRev, deleted, ct } = item;
      if (typeof rid !== "string" || !RECORD_ID_PATTERN.test(rid))
        throw badRequest(`${at}.rid must be a record id`);
      if (seen.has(rid)) throw badRequest(`${at}.rid repeats an earlier write`);
      seen.add(rid);
      if (
        typeof baseRev !== "number" ||
        !Number.isSafeInteger(baseRev) ||
        baseRev < 0
      )
        throw badRequest(`${at}.baseRev must be a non-negative integer`);
      if (typeof deleted !== "boolean")
        throw badRequest(`${at}.deleted must be a boolean`);
      if (typeof ct !== "string")
        throw badRequest(`${at}.ct must be base64url`);
      if (ct.length > maxCtChars) throw tooLarge();
      if (!BASE64URL_PATTERN.test(ct) || ct.length % 4 === 1)
        throw badRequest(`${at}.ct must be base64url`);
      const bytes = decodeBase64url(ct);
      if (bytes.length > limits.maxRecordBytes) throw tooLarge();
      if (bytes.length < limits.minRecordBytes)
        throw badRequest(`${at}.ct is too short to be a sealed record`);
      // A delete carries a sealed tombstone (298 bytes), never a note.
      if (deleted && bytes.length > limits.maxTombstoneBytes)
        throw badRequest(`${at}.ct is too large for a delete`);
      return { rid, baseRev, deleted, ct: bytes };
    });
  }

  app.post("/v1/vaults", async (request, reply) => {
    const time = now();
    const body = request.body;
    if (
      !isObject(body) ||
      typeof body.vaultId !== "string" ||
      !VAULT_ID_PATTERN.test(body.vaultId) ||
      typeof body.authVerifier !== "string" ||
      !AUTH_VERIFIER_PATTERN.test(body.authVerifier)
    )
      throw badRequest("the body must be {vaultId, authVerifier}");
    const vaultId = body.vaultId;
    // Canonical base64url, so one key always names one verifier.
    const verifier = base64url(decodeBase64url(body.authVerifier));
    // Confirming an existing vault is not a creation: only new vaults count
    // against the caller's hourly limit. The slot is taken before the store
    // is asked, so concurrent requests cannot all pass the check, and given
    // back when no vault was created.
    const caller = clientKey(request.ip);
    const wait = creations.hit(caller, time);
    let created: CreateOutcome;
    try {
      const existing = await store.getVault(vaultId);
      if (existing)
        created =
          existing.verifier !== verifier
            ? { outcome: "mismatch" }
            : existing.deletedAt !== undefined
              ? { outcome: "deleted" }
              : { outcome: "exists", epoch: existing.epoch };
      else {
        if (wait > 0) throw rateLimited(wait);
        created = await store.createVault(
          vaultId,
          verifier,
          base64url(randomBytes(8)),
          time,
        );
      }
    } catch (error) {
      if (wait === 0) creations.release(caller, time);
      throw error;
    }
    if (wait === 0 && created.outcome !== "created")
      creations.release(caller, time);
    switch (created.outcome) {
      case "created":
        return reply.status(201).send({
          vaultId,
          created: true,
          epoch: created.epoch,
        } satisfies CreateVaultResponse);
      case "exists":
        return reply.status(200).send({
          vaultId,
          created: false,
          epoch: created.epoch,
        } satisfies CreateVaultResponse);
      case "mismatch":
        throw new SyncHttpError(
          409,
          SYNC_ERROR_CODES.vaultExists,
          "this vault id is taken by another key",
        );
      case "deleted":
        throw vaultDeleted();
    }
  });

  app.get<{ Params: { vaultId: string } }>(
    "/v1/vaults/:vaultId/changes",
    async (request): Promise<ChangesResponse> => {
      const { vaultId } = request.params;
      let meta = await authorize(request, vaultId, false);
      const query = (request.query ?? {}) as Record<string, unknown>;
      const since = queryCount(query.since, "since", 0);
      const limit = queryCount(
        query.limit,
        "limit",
        SYNC_LIMITS.maxPageRecords,
      );
      if (limit < 1 || limit > SYNC_LIMITS.maxPageRecords)
        throw badRequest(`limit must be 1 to ${SYNC_LIMITS.maxPageRecords}`);
      meta = await purged(vaultId, meta);
      if (since > meta.head)
        throw new SyncHttpError(
          410,
          SYNC_ERROR_CODES.cursorReset,
          "the cursor is past the vault's head: sync again from 0",
        );
      if (since > 0 && since < meta.purgedSeq)
        throw new SyncHttpError(
          410,
          SYNC_ERROR_CODES.cursorExpired,
          "deletes after this cursor were purged: sync again from 0",
        );
      const page = await store.changes(
        vaultId,
        since,
        Math.min(limit, limits.maxPageRecords),
        limits.maxPageBytes,
      );
      const last = page.records[page.records.length - 1];
      return {
        records: page.records.map(toWire),
        next: last?.seq ?? since,
        hasMore: page.hasMore,
        // A write may land between reading the vault and reading the page.
        head: Math.max(meta.head, last?.seq ?? 0),
        epoch: meta.epoch,
      };
    },
  );

  app.post<{ Params: { vaultId: string } }>(
    "/v1/vaults/:vaultId/records",
    async (request): Promise<WriteResponse> => {
      const { vaultId } = request.params;
      const meta = await authorize(request, vaultId, false);
      const writes = parseWrites(request.body);
      await purged(vaultId, meta);
      const results = await store.write(vaultId, writes, quotas, now());
      return { results: results.map(toWireResult) };
    },
  );

  app.delete<{ Params: { vaultId: string } }>(
    "/v1/vaults/:vaultId",
    async (request, reply) => {
      const { vaultId } = request.params;
      // Deleting again answers 204 too, and erases anything a failed delete left.
      await authorize(request, vaultId, true);
      await store.deleteVault(vaultId, now());
      return reply.status(204).send();
    },
  );
}
