import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyStripeSignature,
  parseStripeEvent,
  handleSubscriptionEvent,
  type StripeEvent,
} from "./stripe-helpers.js";

const SECRET = "whsec_test_secret_key";

const makeSignature = (
  payload: string,
  secret: string,
  timestamp?: string,
): string => {
  const ts = timestamp ?? Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", secret)
    .update(`${ts}.${payload}`)
    .digest("hex");
  return `t=${ts},v1=${sig}`;
};

const makeEvent = (
  type: string,
  obj: Record<string, unknown> = {},
): StripeEvent => ({
  id: "evt_test_123",
  type,
  data: { object: { customer: "cus_abc", status: "active", ...obj } },
  created: Math.floor(Date.now() / 1000),
});

describe("verifyStripeSignature", () => {
  it("returns true for a valid signature", () => {
    const payload = '{"id":"evt_1"}';
    const header = makeSignature(payload, SECRET);
    assert.equal(verifyStripeSignature(payload, header, SECRET), true);
  });

  it("returns true for a Buffer payload", () => {
    const payload = Buffer.from('{"id":"evt_1"}');
    const header = makeSignature(payload.toString(), SECRET);
    assert.equal(verifyStripeSignature(payload, header, SECRET), true);
  });

  it("returns false for a wrong secret", () => {
    const payload = '{"id":"evt_1"}';
    const header = makeSignature(payload, SECRET);
    assert.equal(verifyStripeSignature(payload, header, "wrong_secret"), false);
  });

  it("returns false for a tampered payload", () => {
    const payload = '{"id":"evt_1"}';
    const header = makeSignature(payload, SECRET);
    assert.equal(
      verifyStripeSignature('{"id":"evt_2"}', header, SECRET),
      false,
    );
  });

  it("returns false for a missing timestamp", () => {
    assert.equal(
      verifyStripeSignature('{"id":"evt_1"}', "v1=abcdef", SECRET),
      false,
    );
  });

  it("returns false for a missing v1 signature", () => {
    assert.equal(
      verifyStripeSignature('{"id":"evt_1"}', "t=12345", SECRET),
      false,
    );
  });

  it("returns false for a malformed header", () => {
    assert.equal(verifyStripeSignature('{"id":"evt_1"}', "", SECRET), false);
  });
});

describe("parseStripeEvent", () => {
  it("returns parsed event on valid signature", () => {
    const event = makeEvent("checkout.session.completed");
    const payload = JSON.stringify(event);
    const header = makeSignature(payload, SECRET);
    const result = parseStripeEvent(payload, header, SECRET);
    assert.notEqual(result, null);
    assert.equal(result!.id, event.id);
    assert.equal(result!.type, event.type);
  });

  it("returns null on invalid signature", () => {
    const payload = JSON.stringify(makeEvent("checkout.session.completed"));
    const header = makeSignature(payload, "wrong_secret");
    const result = parseStripeEvent(payload, header, SECRET);
    assert.equal(result, null);
  });

  it("returns null on tampered payload", () => {
    const payload = JSON.stringify(makeEvent("checkout.session.completed"));
    const header = makeSignature(payload, SECRET);
    const result = parseStripeEvent('{"id":"tampered"}', header, SECRET);
    assert.equal(result, null);
  });
});

describe("handleSubscriptionEvent", () => {
  it("handles customer.subscription.created", () => {
    const result = handleSubscriptionEvent(
      makeEvent("customer.subscription.created"),
    );
    assert.equal(result.action, "subscription_created");
    assert.equal(result.customerId, "cus_abc");
    assert.equal(result.status, "active");
  });

  it("handles customer.subscription.updated", () => {
    const result = handleSubscriptionEvent(
      makeEvent("customer.subscription.updated", { status: "past_due" }),
    );
    assert.equal(result.action, "subscription_updated");
    assert.equal(result.customerId, "cus_abc");
    assert.equal(result.status, "past_due");
  });

  it("handles customer.subscription.deleted", () => {
    const result = handleSubscriptionEvent(
      makeEvent("customer.subscription.deleted", { status: "canceled" }),
    );
    assert.equal(result.action, "subscription_canceled");
    assert.equal(result.customerId, "cus_abc");
    assert.equal(result.status, "canceled");
  });

  it("handles invoice.payment_succeeded", () => {
    const result = handleSubscriptionEvent(
      makeEvent("invoice.payment_succeeded"),
    );
    assert.equal(result.action, "payment_received");
    assert.equal(result.customerId, "cus_abc");
    assert.equal(result.status, undefined);
  });

  it("handles invoice.payment_failed", () => {
    const result = handleSubscriptionEvent(makeEvent("invoice.payment_failed"));
    assert.equal(result.action, "payment_failed");
    assert.equal(result.customerId, "cus_abc");
  });

  it("handles customer.subscription.trial_will_end", () => {
    const result = handleSubscriptionEvent(
      makeEvent("customer.subscription.trial_will_end", {
        status: "trialing",
      }),
    );
    assert.equal(result.action, "trial_ending");
    assert.equal(result.customerId, "cus_abc");
    assert.equal(result.status, "trialing");
  });

  it("handles checkout.session.completed", () => {
    const result = handleSubscriptionEvent(
      makeEvent("checkout.session.completed"),
    );
    assert.equal(result.action, "checkout_completed");
    assert.equal(result.customerId, "cus_abc");
  });

  it("returns unhandled for unknown event types", () => {
    const result = handleSubscriptionEvent(makeEvent("some.unknown.event"));
    assert.equal(result.action, "unhandled");
    assert.equal(result.customerId, undefined);
    assert.equal(result.status, undefined);
  });

  it("handles missing customer field gracefully", () => {
    const event: StripeEvent = {
      id: "evt_no_customer",
      type: "customer.subscription.created",
      data: { object: { status: "active" } },
      created: Math.floor(Date.now() / 1000),
    };
    const result = handleSubscriptionEvent(event);
    assert.equal(result.action, "subscription_created");
    assert.equal(result.customerId, undefined);
    assert.equal(result.status, "active");
  });
});

describe("timing-safe comparison", () => {
  it("rejects signatures of different lengths", () => {
    const payload = '{"id":"evt_1"}';
    const ts = Math.floor(Date.now() / 1000).toString();
    const header = `t=${ts},v1=abcd`;
    assert.equal(verifyStripeSignature(payload, header, SECRET), false);
  });

  it("produces consistent results for repeated calls", () => {
    const payload = '{"id":"evt_1"}';
    const header = makeSignature(payload, SECRET);
    const results = Array.from({ length: 100 }, () =>
      verifyStripeSignature(payload, header, SECRET),
    );
    assert.ok(results.every((r) => r === true));
  });

  it("rejects consistently for wrong signatures", () => {
    const payload = '{"id":"evt_1"}';
    const header = makeSignature(payload, "wrong");
    const results = Array.from({ length: 100 }, () =>
      verifyStripeSignature(payload, header, SECRET),
    );
    assert.ok(results.every((r) => r === false));
  });
});
