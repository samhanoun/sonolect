import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  type ChangesResponse,
  SYNC_LIMITS,
  SyncError,
  createHttpTransport,
  deriveVaultKeys,
} from "@sonolect/sync-core";

import { FakeClock } from "./testSupport";
import {
  type FetchLike,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  UPLOAD_BYTES_PER_SECOND,
  createFetchRequester,
} from "./transport";

const BASE = "https://sync.example.com";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fetch that answers from `answer` and records each call (bodies kept only for the assertions). */
function fakeFetch(
  answer: (call: Call) => {
    status: number;
    body?: string;
    headers?: Record<string, string>;
    url?: string;
  },
): { fetch: FetchLike; calls: Call[]; signals: AbortSignal[] } {
  const calls: Call[] = [];
  const signals: AbortSignal[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    };
    calls.push(call);
    signals.push(init.signal);
    assert.equal(init.redirect, "error");
    const reply = answer(call);
    const headers = new Map(
      Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      status: reply.status,
      url: reply.url ?? url,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => reply.body ?? "",
    };
  };
  return { fetch, calls, signals };
}

const clock = () => new FakeClock(Date.parse("2026-11-20T12:00:00Z"));

describe("fetch requester", () => {
  it("sends the request to the build's server and returns status, body and Retry-After", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 429,
      body: '{"error":"rate_limited"}',
      headers: { "Retry-After": "7" },
    }));
    const request = createFetchRequester({
      baseUrl: `${BASE}/`,
      fetch,
      timers: clock().timersApi,
    });
    const response = await request({
      method: "POST",
      path: "/v1/vaults",
      headers: { accept: "application/json" },
      body: "{}",
    });
    assert.deepEqual(response, {
      status: 429,
      body: '{"error":"rate_limited"}',
      retryAfter: "7",
    });
    assert.equal(calls[0]?.url, `${BASE}/v1/vaults`);
    assert.equal(calls[0]?.body, "{}");
  });

  it("gives up after 30 s: the transport reports it as offline", async () => {
    const timers = clock();
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const request = createFetchRequester({
      baseUrl: BASE,
      fetch,
      timers: timers.timersApi,
    });
    const transport = createHttpTransport({
      request,
      vault: deriveVaultKeys(new Uint8Array(32).fill(3)),
    });
    const outcome = assert.rejects(
      transport.changes(0, 10),
      (error) => error instanceof SyncError && error.kind === "network",
    );
    assert.deepEqual(timers.pending(), [REQUEST_TIMEOUT_MS]);
    await timers.advance(REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it("gives an upload time to send its body on a slow uplink", async () => {
    const timers = clock();
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const request = createFetchRequester({
      baseUrl: BASE,
      fetch,
      timers: timers.timersApi,
    });
    // A full batch: about 4.75 MiB, 152 s at 256 kbit/s.
    const body = "x".repeat(SYNC_LIMITS.maxRequestBytes - 256 * 1024);
    const outcome = assert.rejects(
      request({
        method: "POST",
        path: "/v1/vaults/x/records",
        headers: {},
        body,
      }),
      /aborted/,
    );
    const deadline =
      REQUEST_TIMEOUT_MS +
      Math.ceil(body.length / UPLOAD_BYTES_PER_SECOND) * 1000;
    assert.deepEqual(timers.pending(), [deadline]);
    assert.ok(deadline > 180_000);
    await timers.advance(deadline - 1);
    assert.deepEqual(timers.pending(), [1]);
    await timers.advance(1);
    await outcome;
  });

  it("clears its timer once answered", async () => {
    const timers = clock();
    const { fetch } = fakeFetch(() => ({ status: 204 }));
    const request = createFetchRequester({
      baseUrl: BASE,
      fetch,
      timers: timers.timersApi,
    });
    await request({ method: "DELETE", path: "/v1/vaults/x", headers: {} });
    assert.deepEqual(timers.pending(), []);
  });

  it("refuses a request over the server's limit before sending it", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200 }));
    const request = createFetchRequester({
      baseUrl: BASE,
      fetch,
      timers: clock().timersApi,
      maxRequestBytes: 10,
    });
    await assert.rejects(
      request({
        method: "POST",
        path: "/v1/vaults/x/records",
        headers: {},
        body: "x".repeat(11),
      }),
      (error) => error instanceof SyncError && error.kind === "tooLarge",
    );
    assert.equal(calls.length, 0);
  });

  it("does not read an answer over its cap", async () => {
    const big = fakeFetch(() => ({ status: 200, body: "y".repeat(20) }));
    const request = createFetchRequester({
      baseUrl: BASE,
      fetch: big.fetch,
      timers: clock().timersApi,
      maxResponseBytes: 10,
    });
    await assert.rejects(
      request({ method: "GET", path: "/v1/x", headers: {} }),
      (error) => error instanceof SyncError && error.kind === "server",
    );
    const announced = fakeFetch(() => ({
      status: 200,
      body: "",
      headers: { "content-length": "11" },
    }));
    const request2 = createFetchRequester({
      baseUrl: BASE,
      fetch: announced.fetch,
      timers: clock().timersApi,
      maxResponseBytes: 10,
    });
    await assert.rejects(
      request2({ method: "GET", path: "/v1/x", headers: {} }),
      (error) => error instanceof SyncError && error.kind === "server",
    );
  });

  it("reads a full page of changes at the server's limit", async () => {
    // The largest page the server sends: 200 records holding 4 MiB of
    // ciphertext (counted decoded), as base64url, with the widest numbers.
    const vault = deriveVaultKeys(new Uint8Array(32).fill(5));
    const records = SYNC_LIMITS.maxPageRecords;
    const share = Math.floor(SYNC_LIMITS.maxPageBytes / records);
    const page: ChangesResponse = {
      records: Array.from({ length: records }, (_, index) => ({
        rid: "A".repeat(23) + String.fromCharCode(65 + (index % 26)),
        rev: Number.MAX_SAFE_INTEGER,
        seq: Number.MAX_SAFE_INTEGER - records + index,
        deleted: false,
        ct: Buffer.alloc(share, index).toString("base64url"),
      })),
      next: Number.MAX_SAFE_INTEGER,
      hasMore: true,
      head: Number.MAX_SAFE_INTEGER,
      epoch: "e0000000001",
    };
    const body = JSON.stringify(page);
    // Over the 5 MiB this cap once was, which refused such a page forever.
    assert.ok(body.length > 5 * 1024 * 1024);
    assert.ok(body.length <= MAX_RESPONSE_BYTES);
    const { fetch } = fakeFetch(() => ({
      status: 200,
      body,
      headers: { "content-length": String(body.length) },
    }));
    const transport = createHttpTransport({
      request: createFetchRequester({
        baseUrl: BASE,
        fetch,
        timers: clock().timersApi,
      }),
      vault,
    });
    const answer = await transport.changes(0, records);
    assert.equal(answer.records.length, records);
  });

  it("refuses an answer from another server (a redirect)", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 200,
      body: "{}",
      url: "https://sync.example.com.evil.test/v1/x",
    }));
    const request = createFetchRequester({
      baseUrl: BASE,
      fetch,
      timers: clock().timersApi,
    });
    await assert.rejects(
      request({ method: "GET", path: "/v1/x", headers: {} }),
      (error) => error instanceof SyncError && error.kind === "server",
    );
  });

  it("goes through Expo's fetch on the phone, which refuses redirects", () => {
    // React Native's global fetch follows a redirect whatever `redirect`
    // says, with the body and maybe the token: runtime.ts must not use it.
    const runtime = readFileSync(path.join(__dirname, "runtime.ts"), "utf8");
    assert.match(
      runtime,
      /import \{ fetch as expoFetch \} from "expo\/fetch";/,
    );
    assert.match(runtime, /fetch: \(url, init\) => expoFetch\(url, init\),/);
    assert.doesNotMatch(runtime, /=> fetch\(/);
  });

  it("reports a redirect the fetch refused as a server problem, not offline", async () => {
    // Expo's fetch on iOS and Android, then Node's.
    const expoRefusal = new Error(
      "fetch failed: Redirect is not allowed when redirect mode is 'error'",
    );
    const nodeRefusal = new TypeError("fetch failed", {
      cause: new Error("unexpected redirect"),
    });
    for (const refusal of [expoRefusal, nodeRefusal]) {
      const fetch: FetchLike = async () => {
        throw refusal;
      };
      const transport = createHttpTransport({
        request: createFetchRequester({
          baseUrl: BASE,
          fetch,
          timers: clock().timersApi,
        }),
        vault: deriveVaultKeys(new Uint8Array(32).fill(4)),
      });
      await assert.rejects(
        transport.createVault(),
        (error) =>
          error instanceof SyncError &&
          error.kind === "server" &&
          /redirected/.test(error.message),
        refusal.message,
      );
    }
  });

  it("lets a network failure through for the transport to map", async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError("Network request failed");
    };
    const request = createFetchRequester({
      baseUrl: BASE,
      fetch,
      timers: clock().timersApi,
    });
    const transport = createHttpTransport({
      request,
      vault: deriveVaultKeys(new Uint8Array(32).fill(4)),
    });
    await assert.rejects(
      transport.createVault(),
      (error) => error instanceof SyncError && error.kind === "network",
    );
  });
});
