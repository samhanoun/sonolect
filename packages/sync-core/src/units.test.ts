import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SyncError } from "./errors";
import { HLC_MAX_FUTURE_MS, HlcClock, compareHlc, isHlc } from "./hlc";
import {
  PAIRING_CODE_LENGTH,
  PairingError,
  pairingCode,
  pairingCodeGroups,
  pairingLink,
  parsePairing,
  parsePairingCode,
  parsePairingLink,
  parsePairingParams,
} from "./pairing";
import {
  InvalidPayloadError,
  conflictCopyId,
  extraFields,
  isPastRetention,
  noteFingerprint,
  parseNotePayload,
  parseSyncNote,
  syncNote,
} from "./payload";
import { qrMatrix } from "./qr";
import { checkSyncServerUrl } from "./server-url";
import {
  createKeyValueStateStore,
  createMemoryStateStore,
  type SyncMeta,
} from "./state";
import {
  createHttpTransport,
  errorForResponse,
  parseRetryAfter,
  type HttpRequest,
} from "./transport";
import { DAY, VECTOR_ROOT, newKeys, note, randomBytes } from "./test-helpers";
import { generateRootKey } from "./keys";
import { base64urlEncode } from "./encoding";

describe("hlc", () => {
  it("orders by time, then counter, then device", () => {
    const hlcs = [
      { t: 2, c: 0, d: "a" },
      { t: 1, c: 5, d: "b" },
      { t: 1, c: 5, d: "a" },
      { t: 1, c: 0, d: "z" },
    ];
    const sorted = [...hlcs].sort(compareHlc);
    assert.deepEqual(sorted, [hlcs[3], hlcs[2], hlcs[1], hlcs[0]]);
    assert.equal(compareHlc(hlcs[0]!, { ...hlcs[0]! }), 0);
  });

  it("ticks strictly forward, even when the wall clock goes back", () => {
    let wall = 1_000;
    const clock = new HlcClock("dev", () => wall);
    const a = clock.tick();
    const b = clock.tick();
    wall = 500;
    const c = clock.tick();
    assert.ok(compareHlc(a, b) < 0 && compareHlc(b, c) < 0);
    assert.equal(c.t, 1_000);
  });

  it("stamps an edit after the version it replaces, even one from a fast clock", () => {
    const clock = new HlcClock("dev", () => 1_000);
    const ahead = { t: 1_000 + 10 * HLC_MAX_FUTURE_MS, c: 3, d: "zzz" };
    const edit = clock.tick(ahead);
    assert.ok(compareHlc(edit, ahead) > 0);
    // ...without dragging the clock far into the future.
    assert.ok(clock.last.t <= 1_000 + HLC_MAX_FUTURE_MS);
  });

  it("observes remote clocks, capped one hour ahead", () => {
    const clock = new HlcClock("dev", () => 1_000);
    clock.observe({ t: 5_000, c: 2, d: "other" });
    assert.deepEqual(clock.last, { t: 5_000, c: 2, d: "dev" });
    clock.observe({ t: 1_000 + 2 * HLC_MAX_FUTURE_MS, c: 0, d: "other" });
    assert.equal(clock.last.t, 1_000 + HLC_MAX_FUTURE_MS);
    assert.ok(compareHlc(clock.tick(), { t: 5_000, c: 2, d: "other" }) > 0);
  });

  it("validates", () => {
    assert.ok(isHlc({ t: 1, c: 0, d: "a" }));
    for (const bad of [
      null,
      {},
      { t: -1, c: 0, d: "a" },
      { t: 1.5, c: 0, d: "a" },
      { t: 1, c: 0, d: "" },
      { t: 1, c: 0, d: "a/b" },
    ])
      assert.ok(!isHlc(bad));
    assert.throws(() => new HlcClock("bad id", () => 0));
  });
});

describe("pairing", () => {
  const root = generateRootKey(randomBytes);

  it("puts only the key in the link, in the fragment", () => {
    const link = pairingLink(VECTOR_ROOT);
    assert.equal(
      link,
      "sonolect://sync/join#v=1&k=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    );
    assert.deepEqual(parsePairingLink(pairingLink(root)), root);
  });

  it("accepts the query form, three slashes and parameters it does not know", () => {
    const k = base64urlEncode(root);
    for (const link of [
      `sonolect://sync/join?v=1&k=${k}`,
      `sonolect:///sync/join?v=1&k=${k}`,
      `SONOLECT://sync/join/#v=1&k=${k}&s=https://example.org`,
      `sonolect://sync/join?x=1#k=${k}&v=1&later=yes`,
      `  sonolect://sync/join#v=1&k=${k}  `,
    ])
      assert.deepEqual(parsePairingLink(link), root, link);
    assert.deepEqual(
      parsePairingParams({ v: "1", k, other: ["a", "b"] }),
      root,
    );
    assert.deepEqual(parsePairingParams({ v: ["1"], k: [k] }), root);
  });

  it("explains what is wrong with a link", () => {
    const k = base64urlEncode(root);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error instanceof PairingError ? error.code : "other";
      }
      return "none";
    };
    assert.equal(
      code(() => parsePairingLink("https://sonolect.app/join")),
      "invalid",
    );
    assert.equal(
      code(() => parsePairingLink(`sonolect://sync/join#v=2&k=${k}`)),
      "version",
    );
    assert.equal(
      code(() => parsePairingLink("sonolect://sync/join#v=1&k=AAAA")),
      "key",
    );
    assert.equal(
      code(() => parsePairingLink("sonolect://sync/join#v=1&k=***")),
      "key",
    );
    assert.equal(
      code(() => parsePairingParams({ v: "1" })),
      "key",
    );
  });

  it("types a 56-character code in 14 groups that round-trips", () => {
    const groups = pairingCodeGroups(root);
    assert.equal(groups.length, 14);
    assert.ok(groups.every((group) => /^[0-9A-HJKMNP-TV-Z]{4}$/.test(group)));
    assert.equal(groups.join("").length, PAIRING_CODE_LENGTH);
    assert.equal(
      pairingCode(VECTOR_ROOT),
      "000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFP-63ED",
    );
    assert.deepEqual(parsePairingCode(pairingCode(root)), root);
    const sloppy = pairingCode(VECTOR_ROOT)
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/0/g, "o")
      .replace(/1/g, "l");
    assert.deepEqual(parsePairingCode(sloppy), VECTOR_ROOT);
  });

  it("catches typos, wrong lengths and foreign characters", () => {
    const code = pairingCodeGroups(root).join("");
    let caught = 0;
    for (let i = 0; i < code.length; i += 1) {
      const swapped =
        code.slice(0, i) + (code[i] === "7" ? "8" : "7") + code.slice(i + 1);
      try {
        parsePairingCode(swapped);
      } catch (error) {
        if (error instanceof PairingError && error.code === "typo") caught += 1;
      }
    }
    // A changed character in the last group's padding bits may go unnoticed; every other one is caught.
    assert.ok(caught >= code.length - 1, `${caught} of ${code.length}`);
    assert.throws(
      () => parsePairingCode(code.slice(1)),
      (e: unknown) => e instanceof PairingError && e.code === "length",
    );
    assert.throws(
      () => parsePairingCode(`${code.slice(1)}U`),
      (e: unknown) => e instanceof PairingError && e.code === "character",
    );
  });

  it("tells a link from a code", () => {
    assert.deepEqual(parsePairing(pairingLink(root)), root);
    assert.deepEqual(parsePairing(pairingCode(root)), root);
  });

  it("draws the link as a version 5 QR matrix", () => {
    const matrix = qrMatrix(pairingLink(root));
    assert.equal(matrix.version, 5);
    assert.equal(matrix.size, 37);
    assert.equal(matrix.modules.length, 37);
    assert.ok(matrix.modules.every((row) => row.length === 37));
    // Finder pattern: the top-left corner is dark.
    assert.equal(matrix.modules[0]![0], true);
  });
});

describe("server url", () => {
  it("accepts https and normalizes the trailing slash", () => {
    assert.deepEqual(
      checkSyncServerUrl(" https://Sync.Example.org/ ", {
        allowLocalHttp: false,
      }),
      {
        ok: true,
        url: "https://sync.example.org",
      },
    );
    assert.deepEqual(
      checkSyncServerUrl("https://example.org:8443/sync/", {
        allowLocalHttp: false,
      }),
      {
        ok: true,
        url: "https://example.org:8443/sync",
      },
    );
  });

  it("allows plain http only to this machine or the emulator host, in development", () => {
    for (const url of [
      "http://127.0.0.1:8080",
      "http://localhost:8080",
      "http://10.0.2.2:8080",
    ]) {
      assert.equal(
        checkSyncServerUrl(url, { allowLocalHttp: true }).ok,
        true,
        url,
      );
      assert.deepEqual(checkSyncServerUrl(url, { allowLocalHttp: false }), {
        ok: false,
        reason: "insecure",
      });
    }
    assert.deepEqual(
      checkSyncServerUrl("http://example.org", { allowLocalHttp: true }),
      { ok: false, reason: "insecure" },
    );
  });

  it("refuses anything else", () => {
    assert.deepEqual(checkSyncServerUrl(undefined, { allowLocalHttp: true }), {
      ok: false,
      reason: "missing",
    });
    assert.deepEqual(checkSyncServerUrl("  ", { allowLocalHttp: true }), {
      ok: false,
      reason: "missing",
    });
    for (const url of [
      "ftp://example.org",
      "https://user:pw@example.org",
      "https://example.org/?q=1",
      "https://example.org/#x",
      "https://exa mple.org",
      "https://example.org:99999",
      "https://.example.org",
      "example.org",
    ])
      assert.deepEqual(
        checkSyncServerUrl(url, { allowLocalHttp: true }),
        { ok: false, reason: "invalid" },
        url,
      );
  });
});

describe("payload", () => {
  it("keeps fields it does not know and drops undefined ones", () => {
    const parsed = parseSyncNote({
      ...note("hi"),
      title: undefined,
      privacyMode: "local",
      future: { a: 1 },
    });
    assert.equal("title" in parsed, false);
    assert.deepEqual(extraFields(parsed), {
      privacyMode: "local",
      future: { a: 1 },
    });
    assert.equal(
      syncNote({
        createdAt: "2026-01-01T00:00:00Z",
        rawText: "",
        durationMs: 0,
        origin: "mobile",
        language: undefined,
      }).language,
      undefined,
    );
  });

  it("builds notes without the optional text fields an app left empty", () => {
    const built = syncNote({
      createdAt: "2026-01-01T00:00:00Z",
      rawText: "hello",
      durationMs: 0,
      origin: "mobile",
      updatedAt: "",
      title: "",
      language: "",
      mode: "",
      source: "",
      refinedText: "",
    });
    for (const key of ["updatedAt", "title", "language", "mode", "source"])
      assert.equal(key in built, false, key);
    // An empty refined text is still text.
    assert.equal(built.refinedText, "");
    assert.throws(
      () => syncNote({ ...built, origin: "" }),
      InvalidPayloadError,
    );
  });

  it("rejects notes with fields of the wrong type", () => {
    const good = note("hi");
    for (const bad of [
      { ...good, createdAt: "yesterday" },
      { ...good, rawText: 1 },
      { ...good, durationMs: -1 },
      { ...good, origin: "" },
      { ...good, pinned: "yes" },
      { ...good, segments: [{ startMs: 0, text: "x" }] },
      { ...good, conflictOf: "../x" },
      { ...good, title: "" },
    ])
      assert.throws(() => parseSyncNote(bad), InvalidPayloadError);
    assert.throws(
      () =>
        parseNotePayload({
          schema: "note/9",
          id: "a",
          hlc: { t: 1, c: 0, d: "d" },
          deleted: false,
        }),
      (e: unknown) => e instanceof InvalidPayloadError && e.newerSchema,
    );
    assert.throws(
      () => parseNotePayload({ schema: "other", id: "a" }),
      (e: unknown) => e instanceof InvalidPayloadError && !e.newerSchema,
    );
  });

  it("fingerprints what was written, not metadata", () => {
    const base = note("hello", {
      segments: [{ startMs: 0, endMs: 10, text: "hello" }],
    });
    assert.equal(
      noteFingerprint(base),
      noteFingerprint({ ...base, pinned: true, language: "en" }),
    );
    assert.notEqual(
      noteFingerprint(base),
      noteFingerprint({ ...base, rawText: "hello!" }),
    );
    assert.notEqual(
      noteFingerprint(base),
      noteFingerprint({ ...base, title: "Title" }),
    );
    assert.notEqual(
      noteFingerprint(base),
      noteFingerprint({
        ...base,
        segments: [{ startMs: 0, endMs: 10, text: "hello", speaker: "A" }],
      }),
    );
  });

  it("names conflict copies deterministically, within the id limit", () => {
    const loser = { t: 1732100000000, c: 2, d: "deviceXYZ" };
    const id = conflictCopyId("turn_1732100000000_abc123", loser);
    assert.equal(id, conflictCopyId("turn_1732100000000_abc123", loser));
    assert.match(id, /^turn_1732100000000_abc123-c[0-9a-z]+x2devi$/);
    const long = conflictCopyId("n".repeat(64), loser);
    assert.equal(long.length, 64);
    assert.match(long, /^[A-Za-z0-9_-]{1,64}$/);
    assert.notEqual(
      id,
      conflictCopyId("turn_1732100000000_abc123", { ...loser, c: 3 }),
    );
  });

  it("applies the shared retention rule", () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    const old = { createdAt: "2026-01-01T00:00:00Z" };
    assert.equal(isPastRetention(old, 30, now), true);
    assert.equal(isPastRetention({ ...old, pinned: true }, 30, now), false);
    assert.equal(isPastRetention(old, 0, now), false);
    assert.equal(isPastRetention({ createdAt: "not a date" }, 30, now), false);
    assert.equal(
      isPastRetention(
        { createdAt: new Date(now - 2 * DAY).toISOString() },
        30,
        now,
      ),
      false,
    );
  });
});

const meta = (vaultId: string): SyncMeta => ({
  v: 1,
  vaultId,
  deviceId: "dev",
  clock: { t: 5, c: 1, d: "dev" },
  cursor: 7,
  highSeq: 9,
  epoch: "e0000000001",
  vaultCreated: true,
  startedAt: 1,
  lastPullAt: 2,
  pendingDeletes: { "note-1": { t: 3, c: 0, d: "dev" } },
  tooLarge: {},
  unreadable: 0,
  reader: 1,
});

describe("state stores", () => {
  const rid = (char: string, n: number) =>
    `${char}${String(n).padStart(23, "0")}`;

  it("keeps state in memory", async () => {
    const store = createMemoryStateStore();
    assert.equal(await store.load(), null);
    await store.save({
      meta: meta("v"),
      records: new Map([
        [
          rid("A", 1),
          {
            id: "n1",
            rev: 1,
            hlc: { t: 1, c: 0, d: "d" },
            deleted: false,
            fp: "f",
          },
        ],
      ]),
    });
    const loaded = await store.load();
    assert.equal(loaded?.meta.cursor, 7);
    assert.equal(loaded?.records.size, 1);
    await store.save({ records: new Map([[rid("A", 1), null]]) });
    assert.equal((await store.load())?.records.size, 0);
    await store.clear();
    assert.equal(await store.load(), null);
  });

  it("keeps state in a key-value store, in 64 buckets", async () => {
    const kv = new Map<string, string>();
    let writes = 0;
    const storage = {
      getItem: async (key: string) => kv.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        writes += 1;
        kv.set(key, value);
      },
      removeItem: async (key: string) => {
        kv.delete(key);
      },
    };
    const store = createKeyValueStateStore(storage, "t.");
    assert.equal(await store.load(), null);
    const records = new Map(
      Array.from({ length: 300 }, (_, i) => [
        rid("ABCDEFGH"[i % 8]!, i),
        {
          id: `n${i}`,
          rev: i + 1,
          hlc: { t: i, c: 0, d: "d" },
          deleted: i % 3 === 0,
          ...(i % 3 ? { fp: "fp" } : {}),
          ...(i % 5 === 0 ? { ahead: true } : {}),
          ...(i % 2 ? { tag: "AbCdEfGhIjKl" } : {}),
        },
      ]),
    );
    await store.save({ meta: meta("v"), records });
    assert.equal(kv.size, 1 + 8);
    const reopened = createKeyValueStateStore(storage, "t.");
    const loaded = await reopened.load();
    assert.deepEqual(loaded?.meta, meta("v"));
    assert.deepEqual(loaded?.records, records);
    assert.equal(loaded?.damaged, undefined);
    // An incremental save rewrites one bucket and the meta.
    writes = 0;
    await reopened.save({
      meta: meta("v"),
      records: new Map([[rid("A", 0), null]]),
    });
    assert.equal(writes, 2);
    // A damaged bucket is reported, the rest still loads.
    kv.set("t.r.B", "{not json");
    const damaged = await createKeyValueStateStore(storage, "t.").load();
    assert.equal(damaged?.damaged, true);
    assert.ok((damaged?.records.size ?? 0) > 200);
    // Unreadable meta: no state at all.
    kv.set("t.meta", JSON.stringify({ v: 2 }));
    assert.equal(await createKeyValueStateStore(storage, "t.").load(), null);
    await reopened.clear();
    assert.equal(kv.size, 0);
  });
});

describe("http transport", () => {
  const keys = newKeys();

  it("maps answers to typed errors", () => {
    const kind = (status: number, body = "") =>
      errorForResponse({ status, body }, 0);
    assert.equal(kind(401).kind, "unauthorized");
    assert.equal(kind(409).kind, "unauthorized");
    assert.equal(
      kind(410, JSON.stringify({ error: "vault_deleted" })).code,
      "vault_deleted",
    );
    assert.equal(
      kind(410, JSON.stringify({ error: "vault_deleted" })).vaultGone,
      true,
    );
    assert.equal(kind(413).kind, "tooLarge");
    assert.equal(kind(500).retryable, true);
    assert.equal(kind(401).retryable, false);
    const limited = errorForResponse(
      { status: 429, body: "", retryAfter: "7" },
      0,
    );
    assert.equal(limited.kind, "rateLimited");
    assert.equal(limited.retryAfterMs, 7_000);
    assert.equal(
      parseRetryAfter(
        "Wed, 21 Oct 2015 07:28:10 GMT",
        Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"),
      ),
      10_000,
    );
    assert.equal(parseRetryAfter("soon", 0), undefined);
  });

  it("sends the bearer token, and a content type only with a body", async () => {
    const seen: HttpRequest[] = [];
    const transport = createHttpTransport({
      request: async (request) => {
        seen.push(request);
        if (request.method === "DELETE") return { status: 204, body: "" };
        return {
          status: 200,
          body: JSON.stringify({
            records: [],
            next: 0,
            hasMore: false,
            head: 0,
            epoch: "e0000000001",
          }),
        };
      },
      vault: keys,
    });
    await transport.changes(0, 10);
    await transport.deleteVault();
    assert.equal(seen[0]!.headers.authorization, `Bearer ${keys.authToken}`);
    assert.equal(seen[0]!.headers["content-type"], undefined);
    assert.equal(seen[1]!.headers["content-type"], undefined);
    assert.equal(seen[1]!.body, undefined);
    assert.equal(
      seen[0]!.path,
      `/v1/vaults/${keys.vaultId}/changes?since=0&limit=10`,
    );
  });

  it("wraps network failures and refuses answers it does not understand", async () => {
    const failing = createHttpTransport({
      request: async () => {
        throw new Error("offline");
      },
      vault: keys,
    });
    await assert.rejects(
      failing.changes(0, 1),
      (e: unknown) => e instanceof SyncError && e.kind === "network",
    );
    const epoch = "e0000000001";
    for (const body of [
      "not json",
      JSON.stringify({
        records: [{ rid: "x" }],
        next: 0,
        hasMore: false,
        head: 0,
        epoch,
      }),
      JSON.stringify({ records: [], next: -1, hasMore: false, head: 0, epoch }),
      JSON.stringify({
        records: [],
        next: 0,
        hasMore: false,
        head: 0,
        epoch: "short",
      }),
    ]) {
      const odd = createHttpTransport({
        request: async () => ({ status: 200, body }),
        vault: keys,
      });
      await assert.rejects(
        odd.changes(0, 1),
        (e: unknown) => e instanceof SyncError && e.kind === "server",
        body,
      );
    }
    const shortResults = createHttpTransport({
      request: async () => ({
        status: 200,
        body: JSON.stringify({ results: [] }),
      }),
      vault: keys,
    });
    await assert.rejects(
      shortResults.putRecords([
        { rid: "A".repeat(24), baseRev: 0, deleted: true, ct: "AA" },
      ]),
      (e: unknown) => e instanceof SyncError && e.kind === "server",
    );
  });

  it("treats deleting an already deleted vault as done", async () => {
    const transport = createHttpTransport({
      request: async () => ({
        status: 410,
        body: JSON.stringify({ error: "vault_deleted" }),
      }),
      vault: keys,
    });
    await transport.deleteVault();
  });
});
