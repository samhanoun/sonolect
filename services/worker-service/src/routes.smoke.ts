import { strict as assert } from "node:assert";
import { createApp } from "./index.js";
import type { WorkerTask } from "@sonolect/types";

const app = await createApp({ logger: false });

try {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const created = await app.inject({
    method: "POST",
    url: "/tasks",
    payload: {
      kind: "audio",
      type: "audio.transcribe",
      payload: { transcriptId: "tr-1" },
    },
  });
  assert.equal(created.statusCode, 202, created.body);
  const task = created.json<WorkerTask>();
  assert.equal(task.status, "queued");

  const dispatched = await app.inject({
    method: "POST",
    url: `/tasks/${task.id}/dispatch`,
  });
  assert.equal(dispatched.statusCode, 200, dispatched.body);
  assert.equal(dispatched.json<WorkerTask>().status, "completed");

  const billingEvent = await app.inject({
    method: "POST",
    url: "/events/billing",
    payload: { metric: "minutes", quantity: 1 },
  });
  assert.equal(billingEvent.statusCode, 202, billingEvent.body);

  const list = await app.inject({ method: "GET", url: "/tasks" });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json<{ items: WorkerTask[] }>().items.length >= 2);
} finally {
  await app.close();
}

console.log("Worker route smoke test passed");
