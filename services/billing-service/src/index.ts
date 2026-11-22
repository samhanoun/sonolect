import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import {
  parseStripeEvent,
  handleSubscriptionEvent,
  resolvePlanChange,
  type PaidPlan,
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
import {
  BoundedMap,
  disableEndpoints,
  isProduction,
  isValidUserId,
  registerServiceSecurity,
  resolveListenOptions,
  resolveRequestUserId,
  type ServiceEnv,
  type UnavailableEndpoint,
} from "@sonolect/service-kit";

const serviceName = "sonolect-billing-service";
const MAX_USAGE_EVENTS = 100_000;
const MAX_TRACKED_USERS = 100_000;
const MAX_REMEMBERED_STRIPE_EVENTS = 10_000;
const STRIPE_WEBHOOK_BODY_LIMIT_BYTES = 1_048_576;

/**
 * Usage events, plans and the Stripe customer links live only in memory, so a
 * restart loses them. Production refuses these endpoints instead of taking
 * data it would lose. A non-2xx answer makes Stripe retry the event later
 * instead of dropping it. The plan list is off too: no plan can be bought yet.
 */
const PRODUCTION_UNAVAILABLE: readonly UnavailableEndpoint[] = [
  {
    route: "GET /billing/plans",
    message:
      "No plan can be bought yet, so production does not publish the plan list.",
  },
  {
    route: "GET /billing/users/:userId/quota",
    message:
      "Usage and plans are kept only in memory, so production does not report quotas.",
  },
  {
    route: "POST /billing/usage",
    message:
      "Usage is kept only in memory, so production does not accept usage events.",
  },
  {
    route: "POST /webhooks/stripe",
    message:
      "Plan changes are kept only in memory, so production does not accept Stripe events.",
  },
].map(({ route, message }) => ({
  route,
  statusCode: 501,
  error: "not_implemented",
  message,
}));

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
  /** Stripe customer ID to Sonolect user ID, learned at checkout. */
  stripeCustomers?: Map<string, string>;
  /** Stripe event IDs already applied, so a redelivery is not applied twice. */
  processedStripeEvents?: Map<string, true>;
  /** Per user, the `created` time of the last Stripe event that set the plan. */
  planChangedAt?: Map<string, number>;
}

const createStores = (): Required<BillingStores> => ({
  userPlans: new BoundedMap<string, SonolectPlan>(MAX_TRACKED_USERS, [
    ["local-user", "pro"],
  ]),
  usageEvents: new BoundedMap(MAX_USAGE_EVENTS),
  stripeCustomers: new BoundedMap(MAX_TRACKED_USERS),
  processedStripeEvents: new BoundedMap(MAX_REMEMBERED_STRIPE_EVENTS),
  planChangedAt: new BoundedMap(MAX_TRACKED_USERS),
});

const stripeLookupKeys: Readonly<Record<string, PaidPlan>> = Object.fromEntries(
  Object.values(billingPlans).flatMap((plan) =>
    plan.stripePriceLookupKey && plan.id !== "free"
      ? [[plan.stripePriceLookupKey, plan.id] as const]
      : [],
  ),
);

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

const usageMetrics = [
  "transcripts",
  "commands",
  "minutes",
  "storageMb",
  "agentRuns",
] as const satisfies readonly UsageMetric[];

const toQuotaSummary = (
  stores: BillingStores,
  userId: string,
): UsageQuotaSummary => {
  const plan = stores.userPlans.get(userId) ?? "free";
  const { periodStart, periodEnd } = currentBillingPeriod();
  const quotas = billingPlans[plan].quotas;
  // One pass over the events instead of one pass per metric.
  const used: Record<UsageMetric, number> = {
    transcripts: 0,
    commands: 0,
    minutes: 0,
    storageMb: 0,
    agentRuns: 0,
  };
  for (const event of stores.usageEvents.values()) {
    if (
      event.userId === userId &&
      event.occurredAt >= periodStart &&
      event.occurredAt < periodEnd
    )
      used[event.metric] += event.quantity;
  }
  return {
    userId,
    plan,
    periodStart,
    periodEnd,
    ...(Object.fromEntries(
      usageMetrics.map((metric) => [
        metric,
        { used: used[metric], limit: quotas[metric] },
      ]),
    ) as Pick<UsageQuotaSummary, UsageMetric>),
  };
};

export { verifyStripeSignature } from "./stripe-helpers.js";

export interface CreateAppOptions {
  stores?: BillingStores;
  logger?: boolean;
  stripeWebhookSecret?: string;
  env?: ServiceEnv;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores: Required<BillingStores> = {
    ...createStores(),
    ...options.stores,
  };
  const env = options.env ?? process.env;
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });
  registerServiceSecurity(app, {
    serviceName,
    env,
    // Stripe cannot send a service token; the webhook verifies the Stripe
    // signature instead. The plan catalogue is public pricing information.
    publicRoutes: ["GET /billing/plans", "POST /webhooks/stripe"],
  });
  if (isProduction(env)) disableEndpoints(app, PRODUCTION_UNAVAILABLE);

  app.get("/health", async () => ({ status: "ok", service: serviceName }));
  app.get("/billing/plans", async () => ({
    plans: Object.values(billingPlans),
  }));

  app.get<{ Params: { userId: string } }>(
    "/billing/users/:userId/quota",
    async (request) =>
      toQuotaSummary(
        stores,
        resolveRequestUserId(request, request.params.userId),
      ),
  );

  app.post(
    "/billing/usage",
    async (request, reply): Promise<UsageEvent | FastifyReply> => {
      try {
        const input = parseBody<TrackUsageInput>(trackUsageSchema, request);
        const userId = resolveRequestUserId(request, input.userId);
        const event: UsageEvent = {
          id: randomUUID(),
          userId,
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

  // Stripe signs the exact bytes it sent, so this route must see the raw
  // body. Re-serialising parsed JSON changes whitespace and key escaping and
  // makes every real signature fail. The parser override is scoped to this
  // plugin so the other routes keep Fastify's JSON parsing.
  await app.register(async (webhooks) => {
    webhooks.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: STRIPE_WEBHOOK_BODY_LIMIT_BYTES },
      (_request, body, done) => done(null, body),
    );

    webhooks.post("/webhooks/stripe", async (request, reply) => {
      const invalidSignature = () =>
        reply.status(400).send({
          error: "invalid_signature",
          message: "Stripe webhook signature verification failed",
        });
      const payload = typeof request.body === "string" ? request.body : "";
      const signature = request.headers["stripe-signature"];
      const signatureHeader = Array.isArray(signature)
        ? signature[0]
        : signature;
      const secret = options.stripeWebhookSecret ?? env.STRIPE_WEBHOOK_SECRET;
      if (!payload || !signatureHeader || !secret) return invalidSignature();
      const event = parseStripeEvent(payload, signatureHeader, secret);
      if (!event) return invalidSignature();

      // Stripe retries deliveries; applying an event twice must be a no-op.
      const eventId = typeof event.id === "string" ? event.id : undefined;
      if (eventId && stores.processedStripeEvents.has(eventId))
        return reply.status(200).send({ received: true, duplicate: true });

      const result = handleSubscriptionEvent(event);
      const change = resolvePlanChange(event, stripeLookupKeys);
      if (
        change.customerId &&
        isValidUserId(change.userId) &&
        event.type === "checkout.session.completed"
      )
        stores.stripeCustomers.set(change.customerId, change.userId);
      const candidateUserId =
        change.userId ??
        (change.customerId
          ? stores.stripeCustomers.get(change.customerId)
          : undefined);
      const userId = isValidUserId(candidateUserId)
        ? candidateUserId
        : undefined;
      // Stripe does not deliver events in order, and retries a failed one
      // later. A plan change older than the last one applied for the user is
      // stale: a late "updated" (active) must not undo a newer "deleted".
      const created =
        typeof event.created === "number" && Number.isFinite(event.created)
          ? event.created
          : undefined;
      const lastChangedAt = userId
        ? stores.planChangedAt.get(userId)
        : undefined;
      const stale =
        created !== undefined &&
        lastChangedAt !== undefined &&
        created < lastChangedAt;
      const planApplied = Boolean(userId && change.plan && !stale);
      if (userId && change.plan && !stale) {
        stores.userPlans.set(userId, change.plan);
        if (created !== undefined) stores.planChangedAt.set(userId, created);
      }
      if (stale)
        request.log.info(
          { eventId, eventType: event.type },
          "Stripe event is older than the last plan change and was not applied",
        );
      if (change.plan && !userId)
        request.log.warn(
          { eventId, eventType: event.type },
          "Stripe event changes a plan but names no known Sonolect user",
        );
      if (eventId) stores.processedStripeEvents.set(eventId, true);

      return reply.status(202).send({
        received: true,
        processed: result.action !== "unhandled",
        action: result.action,
        customerId: result.customerId,
        status: result.status,
        planApplied,
      });
    });
  });

  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await createApp();
  await app.listen(resolveListenOptions());
}
