import { createHmac, timingSafeEqual } from "node:crypto";

/* ── Types ─────────────────────────────────────────────────────────── */

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing";

export interface SubscriptionState {
  userId: string;
  planId: "free" | "pro" | "team";
  status: SubscriptionStatus;
  stripeCustomerId?: string | undefined;
  stripeSubscriptionId?: string | undefined;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

/* ── Stripe price ID mapping ─────────────────────────────────────── */

const STRIPE_PRICE_TO_PLAN: Record<string, "pro" | "team"> = {
  price_sonolect_pro_monthly: "pro",
  price_sonolect_pro_yearly: "pro",
  price_sonolect_team_monthly: "team",
  price_sonolect_team_yearly: "team",
};

/* ── Webhook signature verification ──────────────────────────────── */

/**
 * Verify a Stripe webhook signature using HMAC-SHA256.
 *
 * The Stripe-Signature header has the form `t=<timestamp>,v1=<hex>`.
 * The signed payload is `${timestamp}.${rawBody}`.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const parts = Object.fromEntries(
    signature.split(",").map((part) => {
      const [key, value] = part.split("=", 2);
      return [key, value];
    }),
  );

  const timestamp = parts.t;
  const sig = parts.v1;
  if (!timestamp || !sig) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const actualBuffer = Buffer.from(sig, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

/* ── Plan mapping ────────────────────────────────────────────────── */

/**
 * Map a Stripe price ID to an internal Sonolect plan.
 * Returns "free" when the price ID is unknown.
 */
export function mapStripePlanToSonolect(
  stripePriceId: string,
): "free" | "pro" | "team" {
  return STRIPE_PRICE_TO_PLAN[stripePriceId] ?? "free";
}

/* ── Event helpers ───────────────────────────────────────────────── */

/**
 * Build a partial SubscriptionState from a Stripe webhook event.
 * Extracts customer ID, subscription ID, plan, period, and status.
 */
export function buildSubscriptionFromEvent(
  event: Record<string, unknown>,
): Partial<SubscriptionState> {
  const obj = (event.data as Record<string, unknown> | undefined)?.object as
    | Record<string, unknown>
    | undefined;
  if (!obj) return {};

  const result: Partial<SubscriptionState> = {};

  if (typeof obj.customer === "string") {
    result.stripeCustomerId = obj.customer;
  }

  // For subscription objects
  if (typeof obj.id === "string" && String(obj.object) === "subscription") {
    result.stripeSubscriptionId = obj.id;
  }

  // For checkout sessions that include a subscription
  if (typeof obj.subscription === "string") {
    result.stripeSubscriptionId = obj.subscription;
  }

  // Extract plan from items (subscription events)
  const items = obj.items as Record<string, unknown> | undefined;
  const dataArray = items?.data as Array<Record<string, unknown>> | undefined;
  if (dataArray?.[0]) {
    const price = dataArray[0].price as Record<string, unknown> | undefined;
    if (typeof price?.id === "string") {
      result.planId = mapStripePlanToSonolect(price.id);
    }
  }

  // Extract period
  if (typeof obj.current_period_start === "number") {
    result.currentPeriodStart = new Date(
      (obj.current_period_start as number) * 1000,
    ).toISOString();
  }
  if (typeof obj.current_period_end === "number") {
    result.currentPeriodEnd = new Date(
      (obj.current_period_end as number) * 1000,
    ).toISOString();
  }

  // Extract status
  const statusMap: Record<string, SubscriptionStatus> = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    trialing: "trialing",
  };
  if (typeof obj.status === "string") {
    const mapped = statusMap[obj.status];
    if (mapped) {
      result.status = mapped;
    }
  }

  // Cancel at period end
  if (typeof obj.cancel_at_period_end === "boolean") {
    result.cancelAtPeriodEnd = obj.cancel_at_period_end;
  }

  return result;
}

/* ── Usage reset detection ───────────────────────────────────────── */

/**
 * Returns true when the event indicates usage counters should be reset.
 * This happens on `invoice.paid` events (new billing cycle).
 */
export function shouldResetUsage(event: Record<string, unknown>): boolean {
  return event.type === "invoice.paid";
}

/* ── Subscription state queries ──────────────────────────────────── */

/**
 * Check whether a subscription is considered active (active or trialing).
 */
export function isSubscriptionActive(state: SubscriptionState): boolean {
  return state.status === "active" || state.status === "trialing";
}

/**
 * Calculate the number of full days until the subscription period expires.
 * Returns 0 if the period has already ended.
 */
export function getDaysUntilExpiry(state: SubscriptionState): number {
  const now = Date.now();
  const end = new Date(state.currentPeriodEnd).getTime();
  const diff = end - now;
  return diff <= 0 ? 0 : Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/* ── Formatting ──────────────────────────────────────────────────── */

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
};

/**
 * Return a human-readable plan name.
 */
export function formatPlanName(planId: string): string {
  return PLAN_DISPLAY_NAMES[planId] ?? planId;
}
