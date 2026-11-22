import { SyncError } from "./errors";
import type { VaultKeys } from "./keys";
import {
  type ChangesResponse,
  EPOCH_PATTERN,
  RECORD_ID_PATTERN,
  SYNC_ERROR_CODES,
  SYNC_PATHS,
  type WireRecord,
  type WireWrite,
  type WireWriteResult,
} from "./wire";

/**
 * How the engine reaches the sync server for one vault. createHttpTransport
 * implements it over any HTTP client; tests use an in-memory server
 * (`@sonolect/sync-core/testing`). Every method throws SyncError.
 */
export interface SyncTransport {
  /** Creates the vault, or confirms it exists with this key (idempotent). */
  createVault(): Promise<{ created: boolean; epoch: string }>;
  /** One page of records with seq > since. */
  changes(since: number, limit: number): Promise<ChangesResponse>;
  /** Compare-and-swap writes, answered in order. */
  putRecords(writes: readonly WireWrite[]): Promise<WireWriteResult[]>;
  /** Erases the vault and every record. Resolves when it is gone (204, or already deleted: 410). */
  deleteVault(): Promise<void>;
}

export interface HttpRequest {
  method: "GET" | "POST" | "DELETE";
  /** Path and query, starting with "/v1/". */
  path: string;
  headers: Record<string, string>;
  /** JSON text; absent for GET and DELETE. */
  body?: string;
}

export interface HttpResponse {
  status: number;
  /** The response body as text ("" when there is none). */
  body: string;
  /** The Retry-After header, when there is one. */
  retryAfter?: string | null | undefined;
}

/**
 * Sends one request to the sync server: the base URL is the requester's
 * business (it comes from the build). Throw on network failures; the
 * transport turns any thrown error that is not a SyncError into kind
 * "network". Apps add their own timeout.
 */
export type HttpRequester = (request: HttpRequest) => Promise<HttpResponse>;

export interface HttpTransportOptions {
  request: HttpRequester;
  /** The vault: its id and verifier, and the bearer token unless the requester adds it itself. */
  vault: Pick<VaultKeys, "vaultId" | "authVerifier"> & {
    authToken?: string | undefined;
  };
}

const DEFAULT_RETRY_AFTER_MS = 60_000;

/** Parses Retry-After (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: number,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

function badAnswer(what: string): never {
  throw new SyncError(
    "server",
    `unexpected answer from the sync server (${what})`,
  );
}

function asWireRecord(value: unknown): WireRecord {
  if (!isRecord(value)) badAnswer("record");
  const { rid, rev, seq, deleted, ct } = value;
  if (
    typeof rid !== "string" ||
    !RECORD_ID_PATTERN.test(rid) ||
    !isCount(rev) ||
    !isCount(seq) ||
    typeof deleted !== "boolean" ||
    typeof ct !== "string"
  )
    badAnswer("record");
  return { rid, rev, seq, deleted, ct };
}

const isEpoch = (value: unknown): value is string =>
  typeof value === "string" && EPOCH_PATTERN.test(value);

function asChanges(value: unknown): ChangesResponse {
  if (!isRecord(value) || !Array.isArray(value.records)) badAnswer("changes");
  const { next, hasMore, head, epoch, purgedSeq } = value;
  if (
    !isCount(next) ||
    typeof hasMore !== "boolean" ||
    !isCount(head) ||
    !isEpoch(epoch) ||
    (purgedSeq !== undefined && !isCount(purgedSeq))
  )
    badAnswer("changes");
  return {
    records: value.records.map(asWireRecord),
    next,
    hasMore,
    head,
    epoch,
    ...(purgedSeq !== undefined ? { purgedSeq } : {}),
  };
}

function asResults(
  value: unknown,
  writes: readonly WireWrite[],
): WireWriteResult[] {
  if (!isRecord(value) || !Array.isArray(value.results)) badAnswer("results");
  const results = value.results as unknown[];
  if (results.length !== writes.length) badAnswer("result count");
  return results.map((raw, index): WireWriteResult => {
    if (!isRecord(raw) || raw.rid !== writes[index]!.rid) badAnswer("result");
    const rid = raw.rid as string;
    if (raw.status === "ok" && isCount(raw.rev) && isCount(raw.seq))
      return { rid, status: "ok", rev: raw.rev, seq: raw.seq };
    if (raw.status === "conflict")
      return {
        rid,
        status: "conflict",
        current: raw.current === null ? null : asWireRecord(raw.current),
      };
    if (
      raw.status === "rejected" &&
      (raw.reason === "quota_records" || raw.reason === "quota_bytes")
    )
      return { rid, status: "rejected", reason: raw.reason };
    badAnswer("result");
  });
}

function errorCode(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) && typeof parsed.error === "string"
      ? parsed.error
      : undefined;
  } catch {
    return undefined;
  }
}

/** The SyncError for a non-2xx answer. */
export function errorForResponse(
  response: HttpResponse,
  nowMs: number,
): SyncError {
  const { status } = response;
  const code = errorCode(response.body);
  const options = { status, code };
  if (status === 401 || status === 409)
    return new SyncError(
      "unauthorized",
      "the sync server does not accept this sync key",
      options,
    );
  if (status === 410)
    return new SyncError(
      "gone",
      code === SYNC_ERROR_CODES.vaultDeleted
        ? "this sync was deleted"
        : "the sync server asked for a full resync",
      options,
    );
  if (status === 413)
    return new SyncError(
      "tooLarge",
      "the request was too large for the sync server",
      options,
    );
  if (status === 429)
    return new SyncError("rateLimited", "too many sync requests", {
      ...options,
      retryAfterMs:
        parseRetryAfter(response.retryAfter, nowMs) ?? DEFAULT_RETRY_AFTER_MS,
    });
  return new SyncError("server", `the sync server answered ${status}`, options);
}

/** A SyncTransport over HTTP, for any client the app provides. */
export function createHttpTransport(
  options: HttpTransportOptions,
  now: () => number = () => Date.now(),
): SyncTransport {
  const { vault } = options;
  const send = async (
    method: HttpRequest["method"],
    path: string,
    body?: unknown,
    authenticated = true,
  ): Promise<{ status: number; json: unknown }> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (authenticated && vault.authToken)
      headers.authorization = `Bearer ${vault.authToken}`;
    // A JSON content type on a request without a body is a 400 from Fastify.
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: HttpResponse;
    try {
      response = await options.request({
        method,
        path,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError("network", "the sync server could not be reached", {
        cause: error,
      });
    }
    if (response.status < 200 || response.status > 299)
      throw errorForResponse(response, now());
    if (response.status === 204 || response.body === "")
      return { status: response.status, json: undefined };
    try {
      return { status: response.status, json: JSON.parse(response.body) };
    } catch {
      badAnswer("not JSON");
    }
  };

  return {
    async createVault() {
      const { status, json } = await send(
        "POST",
        SYNC_PATHS.vaults,
        { vaultId: vault.vaultId, authVerifier: vault.authVerifier },
        false,
      );
      const answer = isRecord(json) ? json : {};
      if (answer.vaultId !== vault.vaultId || !isEpoch(answer.epoch))
        badAnswer("vault");
      return { created: status === 201, epoch: answer.epoch };
    },
    async changes(since, limit) {
      const { json } = await send(
        "GET",
        SYNC_PATHS.changes(vault.vaultId, since, limit),
      );
      return asChanges(json);
    },
    async putRecords(writes) {
      const { json } = await send("POST", SYNC_PATHS.records(vault.vaultId), {
        writes,
      });
      return asResults(json, writes);
    },
    async deleteVault() {
      try {
        await send("DELETE", SYNC_PATHS.vault(vault.vaultId));
      } catch (error) {
        if (
          error instanceof SyncError &&
          error.kind === "gone" &&
          error.code === SYNC_ERROR_CODES.vaultDeleted
        )
          return;
        throw error;
      }
    },
  };
}
