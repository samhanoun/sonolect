import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import {
  verifyStripeSignature,
  parseStripeEvent,
  handleSubscriptionEvent,
} from "./stripe-helpers.js";
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

interface BillingStores {
  userPlans: Map<string, SonolectPlan>;
  usageEvents: Map<string, UsageEvent>;
}

const createStores = (): BillingStores => ({
  userPlans: new Map([["local-user", "pro"]]),
  usageEvents: new Map(),
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

export { verifyStripeSignature } from "./stripe-helpers.js";

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

  app.post("/webhooks/stripe", async (request, reply) => {
    const payload =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body ?? {});
    const signature = request.headers["stripe-signature"];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;
    const secret =
      options.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
    if (!signatureHeader || !secret) {
      return reply.status(400).send({
        error: "invalid_signature",
        message: "Stripe webhook signature verification failed",
      });
    }
    const event = parseStripeEvent(payload, signatureHeader, secret);
    if (!event) {
      return reply.status(400).send({
        error: "invalid_signature",
        message: "Stripe webhook signature verification failed",
      });
    }
    const result = handleSubscriptionEvent(event);
    return reply.status(202).send({
      received: true,
      processed: true,
      action: result.action,
      customerId: result.customerId,
      status: result.status,
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
