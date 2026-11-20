import { strict as assert } from "node:assert";
import { createApp } from "./index.js";
import type { SyncPullResponse, SyncPushResponse } from "@sonolect/types";

const app = await createApp({ logger: false });

try {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const pushed = await app.inject({
    method: "POST",
    url: "/sync/push",
    payload: {
      userId: "local-user",
      deviceId: "desktop-test",
      changes: [
        {
          clientChangeId: "change-1",
          entity: "transcript",
          id: "transcript-1",
          updatedAt: new Date().toISOString(),
          data: { title: "Synced transcript" },
        },
      ],
    },
  });
  assert.equal(pushed.statusCode, 202, pushed.body);
  assert.equal(pushed.json<SyncPushResponse>().accepted.length, 1);

  const pulled = await app.inject({
    method: "POST",
    url: "/sync/pull",
    payload: { userId: "local-user" },
  });
  assert.equal(pulled.statusCode, 200, pulled.body);
  assert.equal(pulled.json<SyncPullResponse>().records.length, 1);

  const manifest = await app.inject({
    method: "GET",
    url: "/sync/manifest?userId=local-user",
  });
  assert.equal(manifest.statusCode, 200);
  assert.equal(manifest.json<{ items: unknown[] }>().items.length, 1);

  // Paging: several changes pushed together must all come back when pulled
  // one page at a time. Identical timestamps used to hide the rest.
  const batchTime = new Date().toISOString();
  const batch = await app.inject({
    method: "POST",
    url: "/sync/push",
    payload: {
      userId: "pager",
      deviceId: "desktop-test",
      changes: [1, 2, 3, 4, 5].map((index) => ({
        clientChangeId: `batch-${index}`,
        entity: "transcript",
        id: `paged-${index}`,
        updatedAt: batchTime,
        data: { index },
      })),
    },
  });
  assert.equal(batch.statusCode, 202, batch.body);
  const seen = new Set<string>();
  let since: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const pageResponse = await app.inject({
      method: "POST",
      url: "/sync/pull",
      payload: { userId: "pager", limit: 2, ...(since ? { since } : {}) },
    });
    assert.equal(pageResponse.statusCode, 200, pageResponse.body);
    const body = pageResponse.json<SyncPullResponse>();
    for (const record of body.records) seen.add(record.id);
    since = body.cursor;
    if (!body.hasMore) break;
  }
  assert.equal(seen.size, 5, `pulled ${[...seen].join(", ")}`);

  // A device with a clock far in the future must not block later edits.
  const future = await app.inject({
    method: "POST",
    url: "/sync/push",
    payload: {
      userId: "pager",
      deviceId: "broken-clock",
      changes: [
        {
          clientChangeId: "future-1",
          entity: "transcript",
          id: "clock-test",
          updatedAt: "2999-01-01T00:00:00.000Z",
          data: { from: "future" },
        },
      ],
    },
  });
  assert.equal(future.json<SyncPushResponse>().accepted.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const afterFuture = await app.inject({
    method: "POST",
    url: "/sync/push",
    payload: {
      userId: "pager",
      deviceId: "desktop-test",
      changes: [
        {
          clientChangeId: "present-1",
          entity: "transcript",
          id: "clock-test",
          updatedAt: new Date(Date.now() + 1_000).toISOString(),
          data: { from: "present" },
        },
      ],
    },
  });
  assert.equal(
    afterFuture.json<SyncPushResponse>().accepted.length,
    1,
    afterFuture.body,
  );

  // Record keys must not collide across users whose IDs contain ":".
  const collisionTime = new Date(Date.now() + 2_000).toISOString();
  for (const [userId, id] of [
    ["u:transcript:1", "2"],
    ["u", "1:transcript:2"],
  ] as const) {
    const pushedCollision = await app.inject({
      method: "POST",
      url: "/sync/push",
      payload: {
        userId,
        deviceId: "desktop-test",
        changes: [
          {
            clientChangeId: `collision-${userId}`,
            entity: "transcript",
            id,
            updatedAt: collisionTime,
            data: { owner: userId },
          },
        ],
      },
    });
    assert.equal(
      pushedCollision.json<SyncPushResponse>().accepted.length,
      1,
      pushedCollision.body,
    );
  }
  const ownRecords = await app.inject({
    method: "POST",
    url: "/sync/pull",
    payload: { userId: "u" },
  });
  assert.deepEqual(
    ownRecords.json<SyncPullResponse>().records.map((record) => record.data),
    [{ owner: "u" }],
  );
} finally {
  await app.close();
}

// Production: a caller acting for one user cannot read or write another's data.
const serviceToken = "y".repeat(40);
const production = await createApp({
  logger: false,
  env: { NODE_ENV: "production", SONOLECT_SERVICE_TOKENS: serviceToken },
});
try {
  const asAlice = {
    authorization: `Bearer ${serviceToken}`,
    "x-user-id": "alice",
  };
  const change = {
    clientChangeId: "c1",
    entity: "transcript",
    id: "t1",
    updatedAt: new Date().toISOString(),
    data: { title: "Private" },
  };

  const anonymous = await production.inject({
    method: "POST",
    url: "/sync/pull",
    payload: { userId: "alice" },
  });
  assert.equal(anonymous.statusCode, 401, anonymous.body);

  const own = await production.inject({
    method: "POST",
    url: "/sync/push",
    headers: asAlice,
    payload: { userId: "alice", deviceId: "d1", changes: [change] },
  });
  assert.equal(own.statusCode, 202, own.body);

  const writeAsOther = await production.inject({
    method: "POST",
    url: "/sync/push",
    headers: asAlice,
    payload: { userId: "bob", deviceId: "d1", changes: [change] },
  });
  assert.equal(writeAsOther.statusCode, 403, writeAsOther.body);

  const readOther = await production.inject({
    method: "POST",
    url: "/sync/pull",
    headers: { ...asAlice, "x-user-id": "bob" },
    payload: { userId: "alice" },
  });
  assert.equal(readOther.statusCode, 403, readOther.body);

  const manifestOther = await production.inject({
    method: "GET",
    url: "/sync/manifest?userId=alice",
    headers: { ...asAlice, "x-user-id": "bob" },
  });
  assert.equal(manifestOther.statusCode, 403, manifestOther.body);

  const manifestOwn = await production.inject({
    method: "GET",
    url: "/sync/manifest",
    headers: asAlice,
  });
  assert.equal(manifestOwn.statusCode, 200, manifestOwn.body);
  assert.equal(manifestOwn.json<{ items: unknown[] }>().items.length, 1);
} finally {
  await production.close();
}

console.log("Sync route smoke test passed");
