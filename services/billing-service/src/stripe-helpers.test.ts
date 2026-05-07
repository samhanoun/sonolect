import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  verifyWebhookSignature,
  mapStripePlanToSonolect,
  buildSubscriptionFromEvent,
  shouldResetUsage,
  isSubscriptionActive,
  getDaysUntilExpiry,
  formatPlanName,
  type SubscriptionState,
} from "./stripe-helpers.js";

/* ── verifyWebhookSignature ──────────────────────────────────────── */

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test_secret";
  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const timestamp = "1700000000";

  function sign(body: string, ts: string, key: string): string {
    const sig = createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
    return `t=${ts},v1=${sig}`;
  }

  it("accepts a valid signature", () => {
    const header = sign(payload, timestamp, secret);
    assert.equal(verifyWebhookSignature(payload, header, secret), true);
  });

  it("rejects a tampered payload", () => {
    const header = sign(payload, timestamp, secret);
    const tampered = payload.replace("evt_1", "evt_hacked");
    assert.equal(verifyWebhookSignature(tampered, header, secret), false);
  });

  it("rejects a wrong secret", () => {
    const header = sign(payload, timestamp, "wrong_secret");
    assert.equal(verifyWebhookSignature(payload, header, secret), false);
  });

  it("rejects when timestamp is missing", () => {
    const sig = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    assert.equal(verifyWebhookSignature(payload, `v1=${sig}`, secret), false);
  });

  it("rejects when v1 signature is missing", () => {
    assert.equal(
      verifyWebhookSignature(payload, `t=${timestamp}`, secret),
      false,
    );
  });
});

/* ── mapStripePlanToSonolect ─────────────────────────────────────── */

describe("mapStripePlanToSonolect", () => {
  it("maps pro monthly price ID to pro", () => {
    assert.equal(mapStripePlanToSonolect("price_sonolect_pro_monthly"), "pro");
  });

  it("maps pro yearly price ID to pro", () => {
    assert.equal(mapStripePlanToSonolect("price_sonolect_pro_yearly"), "pro");
  });

  it("maps team monthly price ID to team", () => {
    assert.equal(
      mapStripePlanToSonolect("price_sonolect_team_monthly"),
      "team",
    );
  });

  it("maps team yearly price ID to team", () => {
    assert.equal(mapStripePlanToSonolect("price_sonolect_team_yearly"), "team");
  });

  it("returns free for unknown price IDs", () => {
    assert.equal(mapStripePlanToSonolect("price_unknown_xyz"), "free");
  });

  it("returns free for empty string", () => {
    assert.equal(mapStripePlanToSonolect(""), "free");
  });
});

/* ── buildSubscriptionFromEvent ──────────────────────────────────── */

describe("buildSubscriptionFromEvent", () => {
  it("extracts customer, subscription, plan, period, and status", () => {
    const event = {
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_abc",
          object: "subscription",
          customer: "cus_123",
          status: "active",
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          cancel_at_period_end: false,
          items: {
            data: [{ price: { id: "price_sonolect_pro_monthly" } }],
          },
        },
      },
    };

    const result = buildSubscriptionFromEvent(event);
    assert.equal(result.stripeCustomerId, "cus_123");
    assert.equal(result.stripeSubscriptionId, "sub_abc");
    assert.equal(result.planId, "pro");
    assert.equal(result.status, "active");
    assert.equal(result.cancelAtPeriodEnd, false);
    assert.ok(result.currentPeriodStart);
    assert.ok(result.currentPeriodEnd);
  });

  it("extracts subscription from checkout session", () => {
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          object: "checkout.session",
          customer: "cus_456",
          subscription: "sub_def",
        },
      },
    };

    const result = buildSubscriptionFromEvent(event);
    assert.equal(result.stripeCustomerId, "cus_456");
    assert.equal(result.stripeSubscriptionId, "sub_def");
  });

  it("returns empty object when data.object is missing", () => {
    const result = buildSubscriptionFromEvent({ type: "unknown" });
    assert.deepEqual(result, {});
  });

  it("handles missing items gracefully", () => {
    const event = {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_no_items",
          object: "subscription",
          customer: "cus_789",
          status: "past_due",
        },
      },
    };

    const result = buildSubscriptionFromEvent(event);
    assert.equal(result.stripeCustomerId, "cus_789");
    assert.equal(result.status, "past_due");
    assert.equal(result.planId, undefined);
  });
});

/* ── shouldResetUsage ────────────────────────────────────────────── */

describe("shouldResetUsage", () => {
  it("returns true for invoice.paid", () => {
    assert.equal(shouldResetUsage({ type: "invoice.paid" }), true);
  });

  it("returns false for other event types", () => {
    assert.equal(
      shouldResetUsage({ type: "customer.subscription.updated" }),
      false,
    );
  });

  it("returns false for missing type", () => {
    assert.equal(shouldResetUsage({}), false);
  });
});

/* ── isSubscriptionActive ────────────────────────────────────────── */

describe("isSubscriptionActive", () => {
  const base: SubscriptionState = {
    userId: "u1",
    planId: "pro",
    status: "active",
    currentPeriodStart: "2024-01-01T00:00:00Z",
    currentPeriodEnd: "2024-02-01T00:00:00Z",
    cancelAtPeriodEnd: false,
  };

  it("returns true for active", () => {
    assert.equal(isSubscriptionActive(base), true);
  });

  it("returns true for trialing", () => {
    assert.equal(isSubscriptionActive({ ...base, status: "trialing" }), true);
  });

  it("returns false for past_due", () => {
    assert.equal(isSubscriptionActive({ ...base, status: "past_due" }), false);
  });

  it("returns false for canceled", () => {
    assert.equal(isSubscriptionActive({ ...base, status: "canceled" }), false);
  });
});

/* ── getDaysUntilExpiry ──────────────────────────────────────────── */

describe("getDaysUntilExpiry", () => {
  it("returns positive days for future expiry", () => {
    const future = new Date();
    future.setDate(future.getDate() + 15);
    const state: SubscriptionState = {
      userId: "u1",
      planId: "pro",
      status: "active",
      currentPeriodStart: "2024-01-01T00:00:00Z",
      currentPeriodEnd: future.toISOString(),
      cancelAtPeriodEnd: false,
    };
    const days = getDaysUntilExpiry(state);
    assert.ok(days >= 14 && days <= 16, `Expected ~15 days, got ${days}`);
  });

  it("returns 0 for past expiry", () => {
    const state: SubscriptionState = {
      userId: "u1",
      planId: "pro",
      status: "active",
      currentPeriodStart: "2023-01-01T00:00:00Z",
      currentPeriodEnd: "2023-02-01T00:00:00Z",
      cancelAtPeriodEnd: false,
    };
    assert.equal(getDaysUntilExpiry(state), 0);
  });
});

/* ── formatPlanName ──────────────────────────────────────────────── */

describe("formatPlanName", () => {
  it("formats known plans", () => {
    assert.equal(formatPlanName("free"), "Free");
    assert.equal(formatPlanName("pro"), "Pro");
    assert.equal(formatPlanName("team"), "Team");
  });

  it("returns the raw ID for unknown plans", () => {
    assert.equal(formatPlanName("enterprise"), "enterprise");
  });
});
