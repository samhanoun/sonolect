import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  BillingPlanDefinition,
  SonolectPlan,
  UsageEvent,
  UsageMetric,
  UsageQuotaSummary,
} from "@sonolect/types";
import { trackUsageSchema, type TrackUsageInput } from "@sonolect/validation";
import {
  verifyWebhookSignature,
  buildSubscriptionFromEvent,
  shouldResetUsage,
  type SubscriptionState,
} from "./stripe-helpers.js";

const serviceName = "sonolect-billing-service";

export const billingPlans: Record<SonolectPlan, BillingPlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    monthlyPriceUsdCents: 0,
    quotas: {
      transcripts: 100,
      commands: 25,
      minutes: 120,
      storageMb: 500,
      agentRuns: 25,
      seats: 1,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    stripePriceLookupKey: "sonolect_pro_monthly",
    monthlyPriceUsdCents: 1200,
    quotas: {
      transcripts: 5000,
      commands: 2000,
      minutes: 10000,
      storageMb: 25_000,
      agentRuns: 1000,
      seats: 1,
    },
  },
  team: {
    id: "team",
    name: "Team",
    stripePriceLookupKey: "sonolect_team_monthly",
    monthlyPriceUsdCents: 3000,
    quotas: {
      transcripts: 25_000,
      commands: 10_000,
      minutes: 50_000,
      storageMb: 250_000,
      agentRuns: 10_000,
      seats: 10,
    },
  },
};

export interface WebhookLogEntry {
  id: string;
  eventId: string;
  eventType: string;
  receivedAt: string;
  processed: boolean;
  error?: string;
}

export interface BillingStores {
  userPlans: Map<string, SonolectPlan>;
  usageEvents: Map<string, UsageEvent>;
  subscriptions: Map<string, SubscriptionState>;
  webhookLog: WebhookLogEntry[];
}

const createStores = (): BillingStores => ({
  userPlans: new Map([["local-user", "pro"]]),
  usageEvents: new Map(),
  subscriptions: new Map(),
  webhookLog: [],
});

const parseBody = <T>(
  schema: { parse: (value: unknown) => T },
  request: FastifyRequest,
): T => schema.parse(request.body ?? {});

const sendValidationError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: "validation_error",
      message: "Request validation failed",
      issues: error.issues,
    });
  }
  throw error;
};

const optionalProps = (
  value: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([, prop]) => prop !== undefined),
  );

const currentBillingPeriod = () => {
  const now = new Date();
  return {
    periodStart: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString(),
    periodEnd: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
};

const usageFor = (
  events: Iterable<UsageEvent>,
  userId: string,
  metric: UsageMetric,
  periodStart: string,
  periodEnd: string,
) =>
  [...events]
    .filter(
      (event) =>
        event.userId === userId &&
        event.metric === metric &&
        event.occurredAt >= periodStart &&
        event.occurredAt < periodEnd,
    )
    .reduce((sum, event) => sum + event.quantity, 0);

const toQuotaSummary = (
  stores: BillingStores,
  userId: string,
): UsageQuotaSummary => {
  const plan = stores.userPlans.get(userId) ?? "free";
  const { periodStart, periodEnd } = currentBillingPeriod();
  const quotas = billingPlans[plan].quotas;
  return {
    userId,
    plan,
    periodStart,
    periodEnd,
    transcripts: {
      used: usageFor(
        stores.usageEvents.values(),
        userId,
        "transcripts",
        periodStart,
        periodEnd,
      ),
      limit: quotas.transcripts,
    },
    commands: {
      used: usageFor(
        stores.usageEvents.values(),
        userId,
        "commands",
        periodStart,
        periodEnd,
      ),
      limit: quotas.commands,
    },
    minutes: {
      used: usageFor(
        stores.usageEvents.values(),
        userId,
        "minutes",
        periodStart,
        periodEnd,
      ),
      limit: quotas.minutes,
    },
    storageMb: {
      used: usageFor(
        stores.usageEvents.values(),
        userId,
        "storageMb",
        periodStart,
        periodEnd,
      ),
      limit: quotas.storageMb,
    },
    agentRuns: {
      used: usageFor(
        stores.usageEvents.values(),
        userId,
        "agentRuns",
        periodStart,
        periodEnd,
      ),
      limit: quotas.agentRuns,
    },
  };
};

/**
 * Thin wrapper that keeps backward-compat: when no secret is configured
 * we skip verification (local dev), otherwise delegate to stripe-helpers.
 */
export const verifyStripeSignature = (
  payload: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean => {
  if (!secret) return true;
  if (!signatureHeader) return false;
  return verifyWebhookSignature(payload, signatureHeader, secret);
};

export interface CreateAppOptions {
  stores?: BillingStores;
  logger?: boolean;
  stripeWebhookSecret?: string;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores = options.stores ?? createStores();
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });

  app.get("/health", async () => ({ status: "ok", service: serviceName }));
  app.get("/billing/plans", async () => ({
    plans: Object.values(billingPlans),
  }));

  app.get<{ Params: { userId: string } }>(
    "/billing/users/:userId/quota",
    async (request) => toQuotaSummary(stores, request.params.userId),
  );

  app.post(
    "/billing/usage",
    async (request, reply): Promise<UsageEvent | FastifyReply> => {
      try {
        const input = parseBody<TrackUsageInput>(trackUsageSchema, request);
        const event: UsageEvent = {
          id: randomUUID(),
          userId: input.userId,
          metric: input.metric,
          quantity: input.quantity,
          source: input.source,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
          ...optionalProps({ metadata: input.metadata }),
        } as UsageEvent;
        stores.usageEvents.set(event.id, event);
        return reply.status(201).send(event);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  /* ── Stripe webhook handler ──────────────────────────────────────── */

  app.post("/webhooks/stripe", async (request, reply) => {
    const payload = JSON.stringify(request.body ?? {});
    const signature = request.headers["stripe-signature"];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;
    const secret =
      options.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;

    if (!verifyStripeSignature(payload, signatureHeader, secret)) {
      return reply.status(400).send({
        error: "invalid_signature",
        message: "Stripe webhook signature verification failed",
      });
    }

    const event = request.body as Record<string, unknown>;
    const eventId = String(event.id ?? randomUUID());
    const eventType = String(event.type ?? "unknown");

    const logEntry: WebhookLogEntry = {
      id: randomUUID(),
      eventId,
      eventType,
      receivedAt: new Date().toISOString(),
      processed: false,
    };

    // Return 200 quickly, then process asynchronously
    // (In production this would be a background job; here we process inline
    //  but still reply fast so Stripe doesn't retry.)
    try {
      const subState = buildSubscriptionFromEvent(event);
      const obj = (event.data as Record<string, unknown> | undefined)
        ?.object as Record<string, unknown> | undefined;

      // Resolve userId: from metadata, client_reference_id, or customer
      const metadata = (obj?.metadata ?? {}) as Record<string, unknown>;
      const userId = String(
        metadata.userId ??
          metadata.user_id ??
          obj?.client_reference_id ??
          subState.stripeCustomerId ??
          "unknown",
      );

      switch (eventType) {
        /* ── Checkout completed ─────────────────────────────────────── */
        case "checkout.session.completed": {
          const planId = subState.planId ?? "pro";
          stores.userPlans.set(userId, planId);
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          const fullState: SubscriptionState = {
            userId,
            planId,
            status: "active",
            stripeCustomerId: subState.stripeCustomerId,
            stripeSubscriptionId: subState.stripeSubscriptionId,
            currentPeriodStart:
              subState.currentPeriodStart ?? now.toISOString(),
            currentPeriodEnd:
              subState.currentPeriodEnd ?? periodEnd.toISOString(),
            cancelAtPeriodEnd: false,
          };
          stores.subscriptions.set(userId, fullState);
          break;
        }

        /* ── Subscription created ───────────────────────────────────── */
        case "customer.subscription.created": {
          const planId = subState.planId ?? "pro";
          stores.userPlans.set(userId, planId);
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          stores.subscriptions.set(userId, {
            userId,
            planId,
            status: subState.status ?? "active",
            stripeCustomerId: subState.stripeCustomerId,
            stripeSubscriptionId: subState.stripeSubscriptionId,
            currentPeriodStart:
              subState.currentPeriodStart ?? now.toISOString(),
            currentPeriodEnd:
              subState.currentPeriodEnd ?? periodEnd.toISOString(),
            cancelAtPeriodEnd: subState.cancelAtPeriodEnd ?? false,
          });
          break;
        }

        /* ── Subscription updated (upgrade/downgrade) ───────────────── */
        case "customer.subscription.updated": {
          const existing = stores.subscriptions.get(userId);
          const planId = subState.planId ?? existing?.planId ?? "pro";
          stores.userPlans.set(userId, planId);
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          stores.subscriptions.set(userId, {
            userId,
            planId,
            status: subState.status ?? existing?.status ?? "active",
            stripeCustomerId:
              subState.stripeCustomerId ?? existing?.stripeCustomerId,
            stripeSubscriptionId:
              subState.stripeSubscriptionId ?? existing?.stripeSubscriptionId,
            currentPeriodStart:
              subState.currentPeriodStart ??
              existing?.currentPeriodStart ??
              now.toISOString(),
            currentPeriodEnd:
              subState.currentPeriodEnd ??
              existing?.currentPeriodEnd ??
              periodEnd.toISOString(),
            cancelAtPeriodEnd:
              subState.cancelAtPeriodEnd ??
              existing?.cancelAtPeriodEnd ??
              false,
          });
          break;
        }

        /* ── Subscription deleted → downgrade to Free ───────────────── */
        case "customer.subscription.deleted": {
          stores.userPlans.set(userId, "free");
          const existing = stores.subscriptions.get(userId);
          if (existing) {
            stores.subscriptions.set(userId, {
              ...existing,
              planId: "free",
              status: "canceled",
              cancelAtPeriodEnd: false,
            });
          }
          break;
        }

        /* ── Invoice paid → reset usage counters ────────────────────── */
        case "invoice.paid": {
          if (shouldResetUsage(event)) {
            // Remove usage events for this user in the current period
            for (const [id, evt] of stores.usageEvents.entries()) {
              if (evt.userId === userId) {
                stores.usageEvents.delete(id);
              }
            }
          }
          // Update period dates if available
          const existing = stores.subscriptions.get(userId);
          if (existing && subState.currentPeriodStart) {
            stores.subscriptions.set(userId, {
              ...existing,
              currentPeriodStart: subState.currentPeriodStart,
              currentPeriodEnd:
                subState.currentPeriodEnd ?? existing.currentPeriodEnd,
            });
          }
          break;
        }

        /* ── Invoice payment failed → mark past_due ─────────────────── */
        case "invoice.payment_failed": {
          const existing = stores.subscriptions.get(userId);
          if (existing) {
            stores.subscriptions.set(userId, {
              ...existing,
              status: "past_due",
            });
          }
          break;
        }

        /* ── Payment intent succeeded → confirm payment ─────────────── */
        case "payment_intent.succeeded": {
          // Payment confirmed — no subscription state change needed.
          // Log entry below captures the audit trail.
          break;
        }

        default:
          // Unhandled event type — log and acknowledge.
          break;
      }

      logEntry.processed = true;
    } catch (err) {
      logEntry.error = err instanceof Error ? err.message : String(err);
    }

    stores.webhookLog.push(logEntry);

    return reply.status(200).send({
      received: true,
      processed: logEntry.processed,
      eventType,
    });
  });

  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port });
}
