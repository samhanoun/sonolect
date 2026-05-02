import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { createApp } from "./index.js";
import type { UsageEvent, UsageQuotaSummary } from "@sonolect/types";

const app = await createApp({
  logger: false,
  stripeWebhookSecret: "whsec_test",
});

try {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const plans = await app.inject({ method: "GET", url: "/billing/plans" });
  assert.equal(plans.statusCode, 200);
  assert.equal(plans.json<{ plans: unknown[] }>().plans.length, 3);

  const usage = await app.inject({
    method: "POST",
    url: "/billing/usage",
    payload: {
      userId: "local-user",
      metric: "minutes",
      quantity: 12,
      source: "audio",
    },
  });
  assert.equal(usage.statusCode, 201, usage.body);
  assert.equal(usage.json<UsageEvent>().metric, "minutes");

  const quota = await app.inject({
    method: "GET",
    url: "/billing/users/local-user/quota",
  });
  assert.equal(quota.statusCode, 200);
  assert.equal(quota.json<UsageQuotaSummary>().minutes.used, 12);

  const payload = JSON.stringify({
    id: "evt_test",
    type: "checkout.session.completed",
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", "whsec_test")
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const webhook = await app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: {
      "stripe-signature": `t=${timestamp},v1=${signature}`,
      "content-type": "application/json",
    },
    payload,
  });
  assert.equal(webhook.statusCode, 202, webhook.body);
} finally {
  await app.close();
}

console.log("Billing route smoke test passed");
