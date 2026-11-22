import {
  type HttpRequester,
  MAX_RESPONSE_BYTES as PAGE_RESPONSE_BYTES,
  SYNC_LIMITS,
  SyncError,
} from "@sonolect/sync-core";

import type { Timers } from "./timers";

/**
 * The sync server's HTTP client on the phone: `fetch` against the build's
 * server URL, with a timeout and size caps. It never logs: a request
 * carries the bearer token and ciphertext.
 */

/** No answer within this time counts as no answer (SyncError "network"). */
export const REQUEST_TIMEOUT_MS = 30_000;
/**
 * The largest answer read: a full page of changes. The server counts a
 * page's 4 MiB of ciphertext in decoded bytes; as base64url in JSON it is
 * about 5.4 MiB (sync-core's MAX_RESPONSE_BYTES).
 */
export const MAX_RESPONSE_BYTES = PAGE_RESPONSE_BYTES;

/** What the requester needs from `fetch` (React Native's, or Node's in scripts). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect: "error";
  },
) => Promise<{
  status: number;
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface FetchRequesterOptions {
  /** The sync server URL (features.ts SYNC_URL), without a trailing slash. */
  baseUrl: string;
  fetch: FetchLike;
  timers: Timers;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

const tooLarge = () =>
  new SyncError("tooLarge", "the request is over the sync server's limit", {
    status: 413,
  });
const badAnswer = (what: string) =>
  new SyncError("server", `unexpected answer from the sync server (${what})`);

/** An HttpRequester over fetch. Network failures and timeouts throw (the transport maps them to "network"). */
export function createFetchRequester({
  baseUrl,
  fetch,
  timers,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxRequestBytes = SYNC_LIMITS.maxRequestBytes,
  maxResponseBytes = MAX_RESPONSE_BYTES,
}: FetchRequesterOptions): HttpRequester {
  const base = baseUrl.replace(/\/+$/, "");
  return async ({ method, path, headers, body }) => {
    if (!path.startsWith("/")) throw new Error("a sync path starts with /");
    // The engine's batches stay under the limit; a request over it is
    // refused here, as the server would (the engine then splits it).
    if (body !== undefined && body.length > maxRequestBytes) throw tooLarge();
    const controller = new AbortController();
    const timer = timers.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${base}${path}`;
      const response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
        // A redirect would send the token somewhere else.
        redirect: "error",
      });
      if (response.url && !response.url.startsWith(`${base}/`))
        throw badAnswer("redirected");
      const length = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(length) && length > maxResponseBytes)
        throw badAnswer("too large");
      const text = await response.text();
      if (text.length > maxResponseBytes) throw badAnswer("too large");
      return {
        status: response.status,
        body: text,
        retryAfter: response.headers.get("retry-after"),
      };
    } finally {
      timers.clearTimeout(timer);
    }
  };
}
