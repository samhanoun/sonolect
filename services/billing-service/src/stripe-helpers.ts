import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  created: number;
};

export type SubscriptionStatus =
  "active" | "past_due" | "canceled" | "trialing" | "incomplete";

export const verifyStripeSignature = (
  payload: string | Buffer,
  signature: string,
  secret: string,
  tolerance: number = 300,
): boolean => {
  const parts = Object.fromEntries(
    signature.split(",").map((part) => {
      const [key, value] = part.split("=", 2);
      return [key, value];
    }),
  );
  const timestampStr = parts.t;
  const sig = parts.v1;
  if (!timestampStr || !sig) return false;

  const timestamp = parseInt(timestampStr, 10);
  if (Number.isNaN(timestamp)) return false;

  if (tolerance > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      return false;
    }
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestampStr}.${payload}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  const signatures = signature
    .split(",")
    .map((part) => part.split("=", 2))
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);

  if (signatures.length === 0) return false;

  for (const s of signatures) {
    if (!s) continue;
    const actualBuffer = Buffer.from(s, "hex");
    if (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return true;
    }
  }

  return false;
};

export const parseStripeEvent = (
  payload: string,
  signature: string,
  webhookSecret: string,
): StripeEvent | null => {
  if (!verifyStripeSignature(payload, signature, webhookSecret)) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StripeEvent).type !== "string"
    )
      return null;
    return parsed as StripeEvent;
  } catch {
    return null;
  }
};

export type PaidPlan = "pro" | "team";

/** What a verified Stripe event means for a Sonolect account. */
export interface PlanChange {
  /** Sonolect user ID from `client_reference_id` or `metadata.userId`. */
  userId?: string;
  customerId?: string;
  /** The plan to apply, or undefined when the event does not change it. */
  plan?: PaidPlan | "free";
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const planFromLookupKey = (
  lookupKey: string | undefined,
  lookupKeys: Readonly<Record<string, PaidPlan>>,
): PaidPlan | undefined =>
  lookupKey && Object.hasOwn(lookupKeys, lookupKey)
    ? lookupKeys[lookupKey]
    : undefined;

const subscriptionLookupKey = (
  subscription: Record<string, unknown>,
): string | undefined => {
  const items = asRecord(subscription.items).data;
  const first = Array.isArray(items) ? asRecord(items[0]) : {};
  return asString(asRecord(first.price).lookup_key);
};

/**
 * Works out the plan a verified event grants or revokes.
 *
 * - `checkout.session.completed` links the Stripe customer to the Sonolect
 *   user (`client_reference_id`) and applies `metadata.plan` when present.
 * - Subscription created/updated applies the plan of the price lookup key
 *   while the subscription is active or trialing, and drops to free once it
 *   is canceled, unpaid or expired. `past_due` keeps the plan during retries.
 * - Subscription deleted drops to free.
 */
export const resolvePlanChange = (
  event: StripeEvent,
  lookupKeys: Readonly<Record<string, PaidPlan>>,
): PlanChange => {
  const object = asRecord(event.data?.object);
  const metadata = asRecord(object.metadata);
  const change: PlanChange = {};
  const customerId = asString(object.customer);
  if (customerId) change.customerId = customerId;
  const userId =
    asString(object.client_reference_id) ?? asString(metadata.userId);
  if (userId) change.userId = userId;

  switch (event.type) {
    case "checkout.session.completed": {
      const requested = asString(metadata.plan);
      const paid = asString(object.payment_status) !== "unpaid";
      if (paid && (requested === "pro" || requested === "team"))
        change.plan = requested;
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const status = asString(object.status);
      if (status === "active" || status === "trialing") {
        const plan = planFromLookupKey(
          subscriptionLookupKey(object),
          lookupKeys,
        );
        if (plan) change.plan = plan;
      } else if (
        status === "canceled" ||
        status === "unpaid" ||
        status === "incomplete_expired"
      ) {
        change.plan = "free";
      }
      break;
    }
    case "customer.subscription.deleted":
      change.plan = "free";
      break;
    default:
      break;
  }
  return change;
};

type SubscriptionResult = {
  action: string;
  customerId?: string;
  status?: SubscriptionStatus;
};

const withOptional = (
  base: { action: string },
  extras: Record<string, string | undefined>,
): SubscriptionResult => {
  const result: SubscriptionResult = { action: base.action };
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};

export const handleSubscriptionEvent = (
  event: StripeEvent,
): SubscriptionResult => {
  const obj = event.data?.object ?? {};
  const customerId =
    typeof obj.customer === "string" ? obj.customer : undefined;
  const status =
    typeof obj.status === "string"
      ? (obj.status as SubscriptionStatus)
      : undefined;

  switch (event.type) {
    case "customer.subscription.created":
      return withOptional(
        { action: "subscription_created" },
        { customerId, status },
      );
    case "customer.subscription.updated":
      return withOptional(
        { action: "subscription_updated" },
        { customerId, status },
      );
    case "customer.subscription.deleted":
      return withOptional(
        { action: "subscription_canceled" },
        { customerId, status },
      );
    case "invoice.payment_succeeded":
      return withOptional({ action: "payment_received" }, { customerId });
    case "invoice.payment_failed":
      return withOptional({ action: "payment_failed" }, { customerId });
    case "customer.subscription.trial_will_end":
      return withOptional({ action: "trial_ending" }, { customerId, status });
    case "checkout.session.completed":
      return withOptional({ action: "checkout_completed" }, { customerId });
    default:
      return { action: "unhandled" };
  }
};
