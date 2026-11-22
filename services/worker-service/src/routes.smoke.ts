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

  const dispatchedAgain = await app.inject({
    method: "POST",
    url: `/tasks/${task.id}/dispatch`,
  });
  assert.equal(dispatchedAgain.statusCode, 409, dispatchedAgain.body);

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

const queueRequests = [
  { method: "GET", url: "/tasks" },
  { method: "POST", url: "/tasks" },
  { method: "POST", url: "/events/audio" },
  { method: "POST", url: "/events/agent" },
  { method: "POST", url: "/events/billing" },
  { method: "POST", url: "/tasks/any-id/dispatch" },
] as const;

// With a token configured, the task queue is only reachable with the token.
const serviceToken = "w".repeat(40);
const guarded = await createApp({
  logger: false,
  env: { SONOLECT_SERVICE_TOKENS: serviceToken },
});
try {
  for (const request of queueRequests) {
    const anonymous = await guarded.inject(request);
    assert.equal(anonymous.statusCode, 401, `${request.method} ${request.url}`);
  }

  const authorised = await guarded.inject({
    method: "GET",
    url: "/tasks",
    headers: { authorization: `Bearer ${serviceToken}` },
  });
  assert.equal(authorised.statusCode, 200, authorised.body);
} finally {
  await guarded.close();
}

// Production: the handlers are placeholders, so the queue answers 501 and
// stores nothing. The service token is still checked first.
const production = await createApp({
  logger: false,
  env: { NODE_ENV: "production", SONOLECT_SERVICE_TOKENS: serviceToken },
});
try {
  const health = await production.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  for (const request of queueRequests) {
    const label = `${request.method} ${request.url}`;
    const anonymous = await production.inject(request);
    assert.equal(anonymous.statusCode, 401, label);

    const authorised = await production.inject({
      ...request,
      headers: { authorization: `Bearer ${serviceToken}` },
      ...(request.method === "POST"
        ? {
            payload: {
              kind: "audio",
              type: "audio.transcribe",
              payload: { transcriptId: "tr-1" },
            },
          }
        : {}),
    });
    assert.equal(authorised.statusCode, 501, `${label}: ${authorised.body}`);
    assert.equal(
      authorised.json<{ error: string }>().error,
      "not_implemented",
      label,
    );
  }
} finally {
  await production.close();
}

console.log("Worker route smoke test passed");
