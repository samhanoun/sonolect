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
} finally {
  await app.close();
}

console.log("Sync route smoke test passed");
