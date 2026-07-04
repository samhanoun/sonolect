import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  created: number;
};

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing"
  | "incomplete";

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
  return JSON.parse(payload) as StripeEvent;
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
