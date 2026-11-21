import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { createApp } from "./index.js";
import type {
  SonolectPlan,
  UsageEvent,
  UsageQuotaSummary,
} from "@sonolect/types";

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

  // Stripe sends pretty-printed JSON and signs those exact bytes. Verifying a
  // re-serialised body would reject every real delivery.
  const sign = (body: string, secret = "whsec_test") => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac("sha256", secret)
      .update(`${ts}.${body}`)
      .digest("hex");
    return `t=${ts},v1=${sig}`;
  };
  const deliver = (body: string, signatureHeader = sign(body)) =>
    app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: {
        "stripe-signature": signatureHeader,
        "content-type": "application/json; charset=utf-8",
      },
      payload: body,
    });
  const planOf = async (userId: string) =>
    (
      await app.inject({
        method: "GET",
        url: `/billing/users/${userId}/quota`,
      })
    ).json<UsageQuotaSummary>().plan;

  assert.equal(await planOf("user-42"), "free");

  const checkout = JSON.stringify(
    {
      id: "evt_checkout_1",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_42",
          client_reference_id: "user-42",
          payment_status: "paid",
          metadata: { plan: "pro" },
        },
      },
    },
    null,
    2,
  );
  const checkoutResponse = await deliver(checkout);
  assert.equal(checkoutResponse.statusCode, 202, checkoutResponse.body);
  assert.equal(
    checkoutResponse.json<{ planApplied: boolean }>().planApplied,
    true,
  );
  assert.equal(await planOf("user-42"), "pro");

  const redelivered = await deliver(checkout);
  assert.equal(redelivered.statusCode, 200, redelivered.body);
  assert.equal(redelivered.json<{ duplicate: boolean }>().duplicate, true);

  // A later subscription event only carries the customer; the link made at
  // checkout resolves it to the user.
  const upgraded = await deliver(
    JSON.stringify(
      {
        id: "evt_sub_updated_1",
        type: "customer.subscription.updated",
        data: {
          object: {
            customer: "cus_42",
            status: "active",
            items: {
              data: [{ price: { lookup_key: "sonolect_team_monthly" } }],
            },
          },
        },
      },
      null,
      2,
    ),
  );
  assert.equal(upgraded.statusCode, 202, upgraded.body);
  assert.equal(await planOf("user-42"), "team");

  const cancelled = await deliver(
    JSON.stringify({
      id: "evt_sub_deleted_1",
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_42", status: "canceled" } },
    }),
  );
  assert.equal(cancelled.statusCode, 202, cancelled.body);
  assert.equal(await planOf("user-42"), "free");

  const forged = await deliver(checkout, sign(checkout, "whsec_attacker"));
  assert.equal(forged.statusCode, 400, forged.body);

  const tampered = await deliver(
    checkout.replace("user-42", "user-43"),
    sign(checkout),
  );
  assert.equal(tampered.statusCode, 400, tampered.body);
  assert.equal(await planOf("user-43"), "free");

  const notJson = "not json";
  const garbage = await deliver(notJson);
  assert.equal(garbage.statusCode, 400, garbage.body);
} finally {
  await app.close();
}

// With a token configured, usage and quota need the service token, and a
// caller acting for one user cannot read or write another user's usage.
const serviceToken = "b".repeat(40);
const guarded = await createApp({
  logger: false,
  stripeWebhookSecret: "whsec_test",
  env: { SONOLECT_SERVICE_TOKENS: serviceToken },
});
try {
  const asAlice = {
    authorization: `Bearer ${serviceToken}`,
    "x-user-id": "alice",
  };
  const anonymousQuota = await guarded.inject({
    method: "GET",
    url: "/billing/users/alice/quota",
  });
  assert.equal(anonymousQuota.statusCode, 401, anonymousQuota.body);

  const anonymousUsage = await guarded.inject({
    method: "POST",
    url: "/billing/usage",
    payload: { userId: "alice", metric: "minutes", quantity: 5, source: "api" },
  });
  assert.equal(anonymousUsage.statusCode, 401, anonymousUsage.body);

  const ownUsage = await guarded.inject({
    method: "POST",
    url: "/billing/usage",
    headers: asAlice,
    payload: { userId: "alice", metric: "minutes", quantity: 5, source: "api" },
  });
  assert.equal(ownUsage.statusCode, 201, ownUsage.body);

  const ownQuota = await guarded.inject({
    method: "GET",
    url: "/billing/users/alice/quota",
    headers: asAlice,
  });
  assert.equal(ownQuota.statusCode, 200, ownQuota.body);
  assert.equal(ownQuota.json<UsageQuotaSummary>().minutes.used, 5);

  const otherQuota = await guarded.inject({
    method: "GET",
    url: "/billing/users/bob/quota",
    headers: asAlice,
  });
  assert.equal(otherQuota.statusCode, 403, otherQuota.body);

  const otherUsage = await guarded.inject({
    method: "POST",
    url: "/billing/usage",
    headers: asAlice,
    payload: { userId: "bob", metric: "minutes", quantity: 5, source: "api" },
  });
  assert.equal(otherUsage.statusCode, 403, otherUsage.body);

  const publicPlans = await guarded.inject({
    method: "GET",
    url: "/billing/plans",
  });
  assert.equal(publicPlans.statusCode, 200);

  // The webhook stays reachable for Stripe and still demands a signature.
  const unsignedWebhook = await guarded.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: { "content-type": "application/json" },
    payload: "{}",
  });
  assert.equal(unsignedWebhook.statusCode, 400, unsignedWebhook.body);
} finally {
  await guarded.close();
}

// Production: usage, plans and Stripe customers would live only in memory, so
// every billing endpoint answers 501 and stores nothing. The service token is
// still checked first on the routes that need it.
const productionStores = {
  userPlans: new Map<string, SonolectPlan>(),
  usageEvents: new Map<string, UsageEvent>(),
  stripeCustomers: new Map<string, string>(),
  processedStripeEvents: new Map<string, true>(),
};
const production = await createApp({
  logger: false,
  stripeWebhookSecret: "whsec_test",
  stores: productionStores,
  env: { NODE_ENV: "production", SONOLECT_SERVICE_TOKENS: serviceToken },
});
try {
  const asAlice = {
    authorization: `Bearer ${serviceToken}`,
    "x-user-id": "alice",
  };
  const health = await production.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const assertNotImplemented = (
    response: Awaited<ReturnType<typeof production.inject>>,
    label: string,
  ) => {
    assert.equal(response.statusCode, 501, `${label}: ${response.body}`);
    assert.equal(
      response.json<{ error: string }>().error,
      "not_implemented",
      label,
    );
  };

  const guardedRequests = [
    { method: "GET", url: "/billing/users/alice/quota" },
    {
      method: "POST",
      url: "/billing/usage",
      payload: {
        userId: "alice",
        metric: "transcripts",
        quantity: 3,
        source: "api",
      },
    },
  ] as const;
  for (const request of guardedRequests) {
    const label = `${request.method} ${request.url}`;
    const anonymous = await production.inject(request);
    assert.equal(anonymous.statusCode, 401, `${label}: ${anonymous.body}`);
    assertNotImplemented(
      await production.inject({ ...request, headers: asAlice }),
      label,
    );
  }

  // The plan list is public, and no plan can be bought yet.
  assertNotImplemented(
    await production.inject({ method: "GET", url: "/billing/plans" }),
    "GET /billing/plans",
  );

  // A correctly signed Stripe event gets 501 too, so Stripe keeps it and
  // retries later instead of treating it as delivered.
  const signedCheckout = JSON.stringify({
    id: "evt_production_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        customer: "cus_alice",
        client_reference_id: "alice",
        payment_status: "paid",
        metadata: { plan: "pro" },
      },
    },
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", "whsec_test")
    .update(`${ts}.${signedCheckout}`)
    .digest("hex");
  assertNotImplemented(
    await production.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: {
        "stripe-signature": `t=${ts},v1=${sig}`,
        "content-type": "application/json",
      },
      payload: signedCheckout,
    }),
    "POST /webhooks/stripe",
  );

  assert.equal(productionStores.usageEvents.size, 0);
  assert.equal(productionStores.userPlans.size, 0);
  assert.equal(productionStores.stripeCustomers.size, 0);
  assert.equal(productionStores.processedStripeEvents.size, 0);
} finally {
  await production.close();
}

console.log("Billing route smoke test passed");
