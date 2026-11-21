/**
 * The HTTP routes, run against every store: memory and SQLite in
 * routes.test.ts, Firestore in firestore.test.ts.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  EPOCH_PATTERN,
  SYNC_LIMITS,
  type ChangesResponse,
  type WireRecord,
  type WireWrite,
  type WriteResponse,
} from "@sonolect/sync-core/wire";
import type { FastifyInstance, InjectOptions } from "fastify";

import type { ServiceLimits } from "./config.js";
import { type CreateAppOptions, createApp } from "./index.js";
import type { VaultStore } from "./store.js";
import {
  DAY,
  type StoreFactory,
  b64,
  manualClock,
  newKeys,
  newRid,
  sealedBytes,
} from "./test-support.js";

type Keys = ReturnType<typeof newKeys>;

const SERVICE_TOKEN = "service-token-for-tests-0123456789abcdef";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const write = (
  rid: string,
  baseRev = 0,
  size = 300,
  deleted = false,
): WireWrite => ({ rid, baseRev, deleted, ct: b64(sealedBytes(size)) });

export function defineRouteTests(factory: StoreFactory): void {
  describe(`sync routes (${factory.label} store)`, () => {
    const cleanups: (() => Promise<void>)[] = [];
    after(async () => {
      for (const cleanup of cleanups) await cleanup();
      factory.cleanup?.();
    });

    async function setup(
      options: {
        limits?: Partial<ServiceLimits>;
        env?: Record<string, string>;
        logger?: CreateAppOptions["logger"];
        store?: (store: VaultStore) => VaultStore;
      } = {},
    ) {
      const opened = await factory.open();
      const store = options.store ? options.store(opened) : opened;
      const clock = manualClock();
      const app = await createApp({
        store,
        env: { NODE_ENV: "test", ...options.env },
        logger: options.logger ?? false,
        now: clock.now,
        limits: options.limits,
      });
      cleanups.push(async () => {
        await app.close();
        await opened.close();
      });
      const send = (request: InjectOptions) => app.inject(request);
      const createVault = async (
        keys: Keys,
        headers: Record<string, string> = {},
      ) =>
        send({
          method: "POST",
          url: "/v1/vaults",
          headers,
          payload: { vaultId: keys.vaultId, authVerifier: keys.authVerifier },
        });
      const vault = async () => {
        const keys = newKeys();
        const created = await createVault(keys);
        assert.equal(created.statusCode, 201, created.body);
        return keys;
      };
      const changes = (keys: Keys, query = "since=0&limit=200") =>
        send({
          method: "GET",
          url: `/v1/vaults/${keys.vaultId}/changes?${query}`,
          headers: bearer(keys.authToken),
        });
      const put = (keys: Keys, writes: unknown) =>
        send({
          method: "POST",
          url: `/v1/vaults/${keys.vaultId}/records`,
          headers: bearer(keys.authToken),
          payload: { writes },
        });
      return { app, store, clock, send, createVault, vault, changes, put };
    }

    it("answers the health check without any token", async () => {
      const { send } = await setup({
        env: { SONOLECT_SERVICE_TOKENS: SERVICE_TOKEN },
      });
      const health = await send({ method: "GET", url: "/health" });
      assert.equal(health.statusCode, 200);
      assert.deepEqual(health.json(), {
        status: "ok",
        service: "sonolect-sync-service",
      });
    });

    it("creates a vault once: 201, then 200 with the same epoch, 409 for another key", async () => {
      const { createVault, send } = await setup();
      const keys = newKeys();
      const created = await createVault(keys);
      assert.equal(created.statusCode, 201);
      const body = created.json<{
        vaultId: string;
        created: boolean;
        epoch: string;
      }>();
      assert.equal(body.vaultId, keys.vaultId);
      assert.equal(body.created, true);
      assert.match(body.epoch, EPOCH_PATTERN);
      const again = await createVault(keys);
      assert.equal(again.statusCode, 200);
      assert.deepEqual(again.json(), {
        vaultId: keys.vaultId,
        created: false,
        epoch: body.epoch,
      });
      const other = newKeys();
      const taken = await send({
        method: "POST",
        url: "/v1/vaults",
        payload: { vaultId: keys.vaultId, authVerifier: other.authVerifier },
      });
      assert.equal(taken.statusCode, 409);
      assert.equal(taken.json().error, "vault_exists");
      // A second vault gets its own epoch.
      const second = await createVault(other);
      assert.notEqual(second.json().epoch, body.epoch);
    });

    it("refuses malformed vault creations", async () => {
      const { send } = await setup();
      const keys = newKeys();
      const bodies: unknown[] = [
        {},
        [],
        { vaultId: keys.vaultId },
        { authVerifier: keys.authVerifier },
        { vaultId: `${keys.vaultId}A`, authVerifier: keys.authVerifier },
        { vaultId: keys.vaultId, authVerifier: keys.authVerifier.slice(1) },
        {
          vaultId: keys.vaultId,
          authVerifier: `${keys.authVerifier.slice(1)}+`,
        },
        { vaultId: 42, authVerifier: keys.authVerifier },
      ];
      for (const payload of bodies) {
        const response = await send({
          method: "POST",
          url: "/v1/vaults",
          payload: payload as object,
        });
        assert.equal(response.statusCode, 400, JSON.stringify(payload));
        assert.equal(response.json().error, "bad_request");
      }
      const notJson = await send({
        method: "POST",
        url: "/v1/vaults",
        headers: { "content-type": "application/json" },
        payload: "{not json",
      });
      assert.equal(notJson.statusCode, 400);
      assert.deepEqual(notJson.json(), {
        error: "bad_request",
        message: "malformed request",
      });
    });

    it("answers 401 alike for an unknown vault, a wrong token and no token", async () => {
      const { send, vault } = await setup();
      const keys = await vault();
      const stranger = newKeys();
      const attempts = [
        {
          url: `/v1/vaults/${stranger.vaultId}/changes?since=0`,
          headers: bearer(stranger.authToken),
        },
        {
          url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
          headers: bearer(stranger.authToken),
        },
        { url: `/v1/vaults/${keys.vaultId}/changes?since=0`, headers: {} },
        {
          url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
          headers: { authorization: keys.authToken },
        },
        {
          url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
          headers: { authorization: `Basic ${keys.authToken}` },
        },
        {
          url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
          headers: bearer(`${keys.authToken}x`),
        },
        // The verifier is not the token.
        {
          url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
          headers: bearer(keys.authVerifier),
        },
      ];
      const bodies = new Set<string>();
      for (const attempt of attempts) {
        const response = await send({ method: "GET", ...attempt });
        assert.equal(response.statusCode, 401, attempt.url);
        assert.equal(response.headers["www-authenticate"], "Bearer");
        bodies.add(response.body);
      }
      assert.equal(bodies.size, 1);
      // Case and spacing of the scheme do not matter.
      const loose = await send({
        method: "GET",
        url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
        headers: { authorization: `bearer \t${keys.authToken} ` },
      });
      assert.equal(loose.statusCode, 200);
    });

    it("answers 404 for a malformed or traversing vault id", async () => {
      const { send, vault } = await setup();
      const keys = await vault();
      for (const url of [
        `/v1/vaults/..%2F..%2Fhealth/changes?since=0`,
        `/v1/vaults/%2E%2E/changes?since=0`,
        `/v1/vaults/${keys.vaultId.slice(1)}/changes?since=0`,
        `/v1/vaults/${keys.vaultId}%00/changes?since=0`,
        `/v1/vaults/${"A".repeat(300)}/changes?since=0`,
        `/v1/vaults/${keys.vaultId}/other`,
        `/v1/nothing`,
      ]) {
        const response = await send({
          method: "GET",
          url,
          headers: bearer(keys.authToken),
        });
        assert.equal(response.statusCode, 404, url);
        assert.equal(response.json().error, "not_found", url);
      }
      const badEscape = await send({
        method: "GET",
        url: `/v1/vaults/%E0%A4%A/changes?since=0`,
        headers: bearer(keys.authToken),
      });
      assert.equal(badEscape.statusCode, 400);
      assert.deepEqual(badEscape.json(), {
        error: "bad_request",
        message: "malformed request",
      });
    });

    it("writes with compare-and-swap and reads the changes back", async () => {
      const { put, changes, vault } = await setup();
      const keys = await vault();
      const [a, b] = [newRid(), newRid()];
      const first = [write(a), write(b, 0, 1000, true)];
      const written = await put(keys, first);
      assert.equal(written.statusCode, 200, written.body);
      assert.deepEqual(written.json<WriteResponse>().results, [
        { rid: a, status: "ok", rev: 1, seq: 1 },
        { rid: b, status: "ok", rev: 1, seq: 2 },
      ]);
      const missing = newRid();
      const conflicts = await put(keys, [write(a, 0), write(missing, 3)]);
      const results = conflicts.json<WriteResponse>().results;
      assert.deepEqual(results[0], {
        rid: a,
        status: "conflict",
        current: { rid: a, rev: 1, seq: 1, deleted: false, ct: first[0]!.ct },
      });
      assert.deepEqual(results[1], {
        rid: missing,
        status: "conflict",
        current: null,
      });

      const page = await changes(keys);
      assert.equal(page.statusCode, 200);
      const body = page.json<ChangesResponse>();
      assert.deepEqual(body.records, [
        { rid: a, rev: 1, seq: 1, deleted: false, ct: first[0]!.ct },
        { rid: b, rev: 1, seq: 2, deleted: true, ct: first[1]!.ct },
      ] satisfies WireRecord[]);
      assert.equal(body.next, 2);
      assert.equal(body.hasMore, false);
      assert.equal(body.head, 2);
      assert.match(body.epoch, EPOCH_PATTERN);
      const later = await changes(keys, "since=2&limit=10");
      assert.deepEqual(later.json<ChangesResponse>().records, []);
      assert.equal(later.json<ChangesResponse>().next, 2);
      // Defaults: since 0, a full page.
      const defaults = await changes(keys, "");
      assert.equal(defaults.json<ChangesResponse>().records.length, 2);
    });

    it("pages changes by record count and by bytes", async () => {
      const { put, changes, vault } = await setup({
        limits: { maxPageRecords: 3, maxPageBytes: 1000 },
      });
      const keys = await vault();
      const rids = Array.from({ length: 7 }, () => newRid());
      await put(
        keys,
        rids.map((rid) => write(rid, 0, 300)),
      );
      const seen: number[] = [];
      let since = 0;
      for (let round = 0; round < 10; round += 1) {
        const page = (
          await changes(keys, `since=${since}&limit=200`)
        ).json<ChangesResponse>();
        assert.ok(page.records.length <= 3);
        seen.push(...page.records.map((r) => r.seq));
        since = page.next;
        if (!page.hasMore) break;
      }
      assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7]);
      const small = (
        await changes(keys, "since=0&limit=2")
      ).json<ChangesResponse>();
      assert.deepEqual(
        small.records.map((r) => r.seq),
        [1, 2],
      );
      assert.equal(small.hasMore, true);
      // A record larger than the page cap comes alone.
      const big = newRid();
      await put(keys, [write(big, 0, 1500)]);
      const alone = (await changes(keys, "since=7")).json<ChangesResponse>();
      assert.deepEqual(
        alone.records.map((r) => r.rid),
        [big],
      );
      assert.equal(alone.hasMore, false);
      for (const query of [
        "since=-1",
        "since=1.5",
        "since=abc",
        "since=01",
        "limit=0",
        `limit=${SYNC_LIMITS.maxPageRecords + 1}`,
        "since=1&since=2",
        "since=99999999999999999",
      ]) {
        const response = await changes(keys, query);
        assert.equal(response.statusCode, 400, query);
        assert.equal(response.json().error, "bad_request");
      }
    });

    it("answers 410 past the head and after a purge of deletes the cursor missed", async () => {
      const { put, changes, vault, clock } = await setup();
      const keys = await vault();
      const [a, b, c] = [newRid(), newRid(), newRid()];
      await put(keys, [write(a), write(b)]);
      const past = await changes(keys, "since=3");
      assert.equal(past.statusCode, 410);
      assert.equal(past.json().error, "cursor_reset");
      // seq 3: a tombstone; seq 4: a live record written 91 days later.
      await put(keys, [write(a, 1, 64, true)]);
      clock.advance(91 * DAY);
      await put(keys, [write(c)]);
      // The write above ran the purge: the tombstone at seq 3 is gone.
      const expired = await changes(keys, "since=2");
      assert.equal(expired.statusCode, 410);
      assert.equal(expired.json().error, "cursor_expired");
      assert.equal((await changes(keys, "since=3")).statusCode, 200);
      const fresh = (await changes(keys, "since=0")).json<ChangesResponse>();
      assert.deepEqual(
        fresh.records.map((r) => r.rid),
        [b, c],
      );
      assert.equal(fresh.head, 4);
    });

    it("validates every write", async () => {
      const { put, vault, send } = await setup({
        limits: { maxBatchWrites: 3 },
      });
      const keys = await vault();
      const rid = newRid();
      const good = write(rid);
      const bad: unknown[] = [
        undefined,
        "writes",
        [],
        [good, write(newRid()), write(newRid()), write(newRid())],
        [null],
        [{ ...good, rid: "short" }],
        [{ ...good, rid: `${rid.slice(1)}=` }],
        [good, { ...write(newRid()), rid }],
        [{ ...good, baseRev: -1 }],
        [{ ...good, baseRev: 1.5 }],
        [{ ...good, baseRev: "1" }],
        [{ ...good, baseRev: 2 ** 53 }],
        [{ ...good, deleted: "no" }],
        [{ ...good, ct: 42 }],
        [{ ...good, ct: `${good.ct.slice(1)}+/` }],
        [{ ...good, ct: `${good.ct}A`.slice(0, 401) }],
        [{ ...good, ct: b64(sealedBytes(SYNC_LIMITS.minRecordBytes - 1)) }],
        [{ ...good, ct: "" }],
        // A delete carries a tombstone: anything larger is not one.
        [write(newRid(), 0, SYNC_LIMITS.maxTombstoneBytes + 1, true)],
      ];
      for (const writes of bad) {
        const response = await put(keys, writes);
        assert.equal(
          response.statusCode,
          400,
          JSON.stringify(writes)?.slice(0, 200),
        );
        assert.equal(response.json().error, "bad_request");
      }
      const noBody = await send({
        method: "POST",
        url: `/v1/vaults/${keys.vaultId}/records`,
        headers: bearer(keys.authToken),
      });
      assert.equal(noBody.statusCode, 400);
      // Nothing was written by any of them.
      const page = await send({
        method: "GET",
        url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
        headers: bearer(keys.authToken),
      });
      assert.equal(page.json<ChangesResponse>().head, 0);
    });

    it("answers 413 for a record or a body over the limits", async () => {
      const { put, vault } = await setup();
      const keys = await vault();
      const huge = await put(keys, [
        write(newRid(), 0, SYNC_LIMITS.maxRecordBytes + 1),
      ]);
      assert.equal(huge.statusCode, 413);
      assert.equal(huge.json().error, "record_too_large");
      const largest = await put(keys, [
        write(newRid(), 0, SYNC_LIMITS.maxRecordBytes),
      ]);
      assert.equal(largest.statusCode, 200);
      // Seven records of 768 KiB are about 7 MiB of base64url, over the 5 MiB body limit.
      const body = await put(
        keys,
        Array.from({ length: 7 }, () =>
          write(newRid(), 0, SYNC_LIMITS.maxRecordBytes),
        ),
      );
      assert.equal(body.statusCode, 413);
      assert.equal(body.json().error, "record_too_large");
    });

    it("rejects writes over the vault quotas", async () => {
      const { put, vault } = await setup({
        limits: { maxVaultRecords: 2, maxVaultBytes: 10_000 },
      });
      const keys = await vault();
      const [a, b, c] = [newRid(), newRid(), newRid()];
      const results = (
        await put(keys, [write(a, 0, 200), write(b, 0, 200), write(c, 0, 200)])
      ).json<WriteResponse>().results;
      assert.deepEqual(
        results.map((r) => r.status),
        ["ok", "ok", "rejected"],
      );
      assert.deepEqual(results[2], {
        rid: c,
        status: "rejected",
        reason: "quota_records",
      });
      const bytes = (await put(keys, [write(a, 1, 9900)])).json<WriteResponse>()
        .results;
      assert.deepEqual(bytes[0], {
        rid: a,
        status: "rejected",
        reason: "quota_bytes",
      });
      // A full vault can still delete.
      const removed = (
        await put(keys, [write(a, 1, 64, true)])
      ).json<WriteResponse>().results;
      assert.equal(removed[0]?.status, "ok");
    });

    it("deletes a vault: 204, then 410 for its key, and 204 again", async () => {
      const { send, vault, changes, put, createVault } = await setup();
      const keys = await vault();
      await put(keys, [write(newRid())]);
      const wrong = await send({
        method: "DELETE",
        url: `/v1/vaults/${keys.vaultId}`,
        headers: bearer(newKeys().authToken),
      });
      assert.equal(wrong.statusCode, 401);
      const deleted = await send({
        method: "DELETE",
        url: `/v1/vaults/${keys.vaultId}`,
        headers: bearer(keys.authToken),
      });
      assert.equal(deleted.statusCode, 204);
      assert.equal(deleted.body, "");
      for (const response of [
        await changes(keys),
        await put(keys, [write(newRid())]),
        await createVault(keys),
      ]) {
        assert.equal(response.statusCode, 410);
        assert.deepEqual(response.json(), {
          error: "vault_deleted",
          message: "this sync was deleted",
        });
      }
      // Still 401 for a wrong token: a deletion is not disclosed to strangers.
      const stranger = await send({
        method: "GET",
        url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
        headers: bearer(newKeys().authToken),
      });
      assert.equal(stranger.statusCode, 401);
      const again = await send({
        method: "DELETE",
        url: `/v1/vaults/${keys.vaultId}`,
        headers: bearer(keys.authToken),
      });
      assert.equal(again.statusCode, 204);
    });

    it("rate limits each vault, each IP and vault creations, with Retry-After", async () => {
      const { changes, vault, clock, createVault } = await setup({
        limits: {
          vaultRequestsPerMinute: 3,
          vaultCreatesPerHour: 2,
          ipRequestsPerMinute: 1000,
        },
      });
      const keys = await vault();
      for (let i = 0; i < 3; i += 1)
        assert.equal((await changes(keys)).statusCode, 200);
      const limited = await changes(keys);
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json().error, "rate_limited");
      const retry = Number(limited.headers["retry-after"]);
      assert.ok(retry >= 1 && retry <= 60, String(retry));
      // Another vault is not affected.
      const other = newKeys();
      assert.equal((await createVault(other)).statusCode, 201);
      assert.equal((await changes(other)).statusCode, 200);
      clock.advance(60_000);
      assert.equal((await changes(keys)).statusCode, 200);
      // Confirming an existing vault does not count as a creation...
      assert.equal((await createVault(keys)).statusCode, 200);
      // ...but this IP has created two vaults this hour.
      const third = await createVault(newKeys());
      assert.equal(third.statusCode, 429);
      assert.ok(Number(third.headers["retry-after"]) > 60);
      clock.advance(60 * 60_000);
      assert.equal((await createVault(newKeys())).statusCode, 201);

      const perIp = await setup({ limits: { ipRequestsPerMinute: 4 } });
      const ipKeys = await perIp.vault();
      for (let i = 0; i < 3; i += 1)
        assert.equal((await perIp.changes(ipKeys)).statusCode, 200);
      const blocked = await perIp.changes(ipKeys);
      assert.equal(blocked.statusCode, 429);
      assert.ok(Number(blocked.headers["retry-after"]) >= 1);
      // The health check is never limited.
      assert.equal(
        (await perIp.send({ method: "GET", url: "/health" })).statusCode,
        200,
      );
    });

    it("counts concurrent vault creations against the hourly limit", async () => {
      // A store with real latency (Firestore): every creation awaits it.
      const slow = (store: VaultStore): VaultStore => {
        const later = () => new Promise((done) => setTimeout(done, 20));
        return Object.assign(Object.create(store) as VaultStore, {
          getVault: async (vaultId: string) => {
            await later();
            return store.getVault(vaultId);
          },
          createVault: async (
            ...args: Parameters<VaultStore["createVault"]>
          ) => {
            await later();
            return store.createVault(...args);
          },
        });
      };
      const { createVault } = await setup({
        limits: { vaultCreatesPerHour: 2, ipRequestsPerMinute: 1000 },
        store: slow,
      });
      const statuses = (
        await Promise.all(
          Array.from({ length: 8 }, () => createVault(newKeys())),
        )
      ).map((response) => response.statusCode);
      assert.deepEqual(
        statuses.filter((status) => status === 201).length,
        2,
        String(statuses),
      );
      assert.deepEqual(
        statuses.filter((status) => status === 429).length,
        6,
        String(statuses),
      );
      // Confirming vaults that exist gave their slot back.
      const confirmed = await setup({
        limits: { vaultCreatesPerHour: 1, ipRequestsPerMinute: 1000 },
        store: slow,
      });
      const keys = newKeys();
      assert.equal((await confirmed.createVault(keys)).statusCode, 201);
      assert.equal((await confirmed.createVault(newKeys())).statusCode, 429);
      // A confirmation is still answered over the limit.
      assert.equal((await confirmed.createVault(keys)).statusCode, 200);
    });

    it("counts an IPv6 client by its /64", async () => {
      const { createVault, send } = await setup({
        limits: { vaultCreatesPerHour: 1, ipRequestsPerMinute: 3 },
        env: { K_SERVICE: "sync" },
      });
      const from = (ip: string) => ({ "x-forwarded-for": ip });
      assert.equal(
        (await createVault(newKeys(), from("2001:db8:1:2::1"))).statusCode,
        201,
      );
      // Another address in the same /64 is the same client...
      assert.equal(
        (await createVault(newKeys(), from("2001:db8:1:2:abcd::99")))
          .statusCode,
        429,
      );
      // ...one in another /64 is another.
      const keys = newKeys();
      assert.equal(
        (await createVault(keys, from("2001:db8:1:3::1"))).statusCode,
        201,
      );
      // The request limit counts the /64 as well: 3 requests a minute.
      const read = (ip: string) =>
        send({
          method: "GET",
          url: `/v1/vaults/${keys.vaultId}/changes?since=0&limit=200`,
          headers: { ...bearer(keys.authToken), ...from(ip) },
        });
      assert.equal((await read("2001:db8:1:3::5")).statusCode, 200);
      assert.equal((await read("2001:db8:1:3::6")).statusCode, 200);
      const limited = await read("2001:db8:1:3::7");
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json().error, "rate_limited");
      // An IPv4 address mapped into IPv6 is that IPv4 address.
      assert.equal(
        (await createVault(newKeys(), from("::ffff:203.0.113.9"))).statusCode,
        201,
      );
      assert.equal(
        (await createVault(newKeys(), from("203.0.113.9"))).statusCode,
        429,
      );
    });

    it("trusts X-Forwarded-For only behind a configured proxy", async () => {
      const limits = { vaultCreatesPerHour: 1 };
      const direct = await setup({ limits });
      const spoofed = { "x-forwarded-for": "203.0.113.1" };
      assert.equal(
        (await direct.createVault(newKeys(), spoofed)).statusCode,
        201,
      );
      assert.equal(
        (
          await direct.createVault(newKeys(), {
            "x-forwarded-for": "203.0.113.2",
          })
        ).statusCode,
        429,
      );

      const cloudRun = await setup({ limits, env: { K_SERVICE: "sync" } });
      assert.equal(
        (
          await cloudRun.createVault(newKeys(), {
            "x-forwarded-for": "203.0.113.1",
          })
        ).statusCode,
        201,
      );
      assert.equal(
        (
          await cloudRun.createVault(newKeys(), {
            "x-forwarded-for": "203.0.113.2",
          })
        ).statusCode,
        201,
      );
      // Only the address the front end appended counts, not one the caller sent.
      assert.equal(
        (
          await cloudRun.createVault(newKeys(), {
            "x-forwarded-for": "198.51.100.7, 203.0.113.1",
          })
        ).statusCode,
        429,
      );
    });

    it("keeps the admin routes behind the service token and the vault routes open", async () => {
      const { send, vault, changes } = await setup({
        env: { SONOLECT_SERVICE_TOKENS: SERVICE_TOKEN },
      });
      const denied = await send({ method: "GET", url: "/v1/admin/status" });
      assert.equal(denied.statusCode, 401);
      const vaultToken = newKeys();
      assert.equal(
        (
          await send({
            method: "GET",
            url: "/v1/admin/status",
            headers: bearer(vaultToken.authToken),
          })
        ).statusCode,
        401,
      );
      const status = await send({
        method: "GET",
        url: "/v1/admin/status",
        headers: bearer(SERVICE_TOKEN),
      });
      assert.equal(status.statusCode, 200);
      assert.equal(status.json().store, factory.label);
      const keys = await vault();
      assert.equal((await changes(keys)).statusCode, 200);
      // The service token opens no vault.
      const crossed = await send({
        method: "GET",
        url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
        headers: bearer(SERVICE_TOKEN),
      });
      assert.equal(crossed.statusCode, 401);
    });

    it("turns CORS on only for the configured origins", async () => {
      const closed = await setup();
      const plain = await closed.send({
        method: "GET",
        url: "/health",
        headers: { origin: "https://app.example.com" },
      });
      assert.equal(plain.headers["access-control-allow-origin"], undefined);

      const open = await setup({
        env: {
          SONOLECT_SYNC_ALLOWED_ORIGINS:
            "https://app.example.com, tauri://localhost",
        },
      });
      const preflight = await open.send({
        method: "OPTIONS",
        url: "/v1/vaults/AAAAAAAAAAAAAAAAAAAAAA/changes",
        headers: {
          origin: "tauri://localhost",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });
      assert.equal(preflight.statusCode, 204);
      assert.equal(
        preflight.headers["access-control-allow-origin"],
        "tauri://localhost",
      );
      const foreign = await open.send({
        method: "GET",
        url: "/health",
        headers: { origin: "https://evil.example" },
      });
      assert.equal(foreign.headers["access-control-allow-origin"], undefined);
    });

    it("never logs tokens, verifiers, ciphertext or bodies, even on errors", async () => {
      const lines: string[] = [];
      let fail = false;
      const { put, changes, vault, send } = await setup({
        logger: { write: (line) => void lines.push(line) },
        store: (store) =>
          new Proxy(store, {
            get(target, property, receiver) {
              if (property === "write" && fail)
                return async () => {
                  throw new Error("store unavailable");
                };
              const value: unknown = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
      });
      const keys = await vault();
      const record = write(newRid());
      await put(keys, [record]);
      await changes(keys);
      await send({
        method: "GET",
        url: `/v1/vaults/${keys.vaultId}/changes?since=0`,
        headers: bearer(newKeys().authToken),
      });
      const secret = "secret-note-text-in-a-bad-body";
      await send({
        method: "POST",
        url: `/v1/vaults/${keys.vaultId}/records`,
        headers: {
          ...bearer(keys.authToken),
          "content-type": "application/json",
        },
        payload: `{"writes": [${secret}`,
      });
      fail = true;
      const failed = await put(keys, [write(newRid())]);
      assert.equal(failed.statusCode, 500);
      assert.deepEqual(failed.json(), {
        error: "internal_error",
        message: "internal server error",
      });
      const log = lines.join("");
      assert.ok(log.includes("store unavailable"), "the 500 is logged");
      assert.ok(log.includes(keys.vaultId), "requests are logged");
      for (const value of [
        keys.authToken,
        keys.authVerifier,
        record.ct.slice(0, 40),
        secret,
      ])
        assert.ok(
          !log.includes(value),
          `the log must not contain ${value.slice(0, 12)}...`,
        );
    });
  });
}
