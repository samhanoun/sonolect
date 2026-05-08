import type {
  SonolectPlan,
  PlanQuota,
  UsageEvent,
  BillingPlanDefinition,
} from "@sonolect/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillingTaskType = "usage-rollup" | "quota-check" | "reconcile";

export interface BillingTask {
  taskType: BillingTaskType;
  userId: string;
  period?: string;
}

export interface UsageRollupResult {
  success: boolean;
  taskType: "usage-rollup";
  userId: string;
  period: string;
  transcriptions: number;
  minutes: number;
  agentRuns: number;
  storageMb: number;
  durationMs: number;
  error?: string;
}

export interface QuotaCheckResult {
  success: boolean;
  taskType: "quota-check";
  userId: string;
  plan: SonolectPlan;
  usage: {
    transcripts: { used: number; limit: number; percentUsed: number };
    minutes: { used: number; limit: number; percentUsed: number };
    agentRuns: { used: number; limit: number; percentUsed: number };
    storageMb: { used: number; limit: number; percentUsed: number };
  };
  warnings: string[];
  blocked: boolean;
  durationMs: number;
  error?: string;
}

export interface ReconcileResult {
  success: boolean;
  taskType: "reconcile";
  userId: string;
  internalPlan: SonolectPlan;
  stripePlan: SonolectPlan | null;
  inSync: boolean;
  discrepancies: string[];
  durationMs: number;
  error?: string;
}

export type BillingTaskResult =
  | UsageRollupResult
  | QuotaCheckResult
  | ReconcileResult;

export interface BillingHandlerDeps {
  getUsageEvents?: (userId: string, period: string) => Promise<UsageEvent[]>;
  getUserPlan?: (userId: string) => Promise<SonolectPlan>;
  getStripePlan?: (userId: string) => Promise<SonolectPlan | null>;
}

// ---------------------------------------------------------------------------
// Plan definitions (shared with types package)
// ---------------------------------------------------------------------------

const PLAN_QUOTAS: Record<SonolectPlan, PlanQuota> = {
  free: {
    transcripts: 50,
    commands: 100,
    minutes: 60,
    storageMb: 500,
    agentRuns: 20,
    seats: 1,
  },
  pro: {
    transcripts: 500,
    commands: 1000,
    minutes: 600,
    storageMb: 5000,
    agentRuns: 200,
    seats: 1,
  },
  team: {
    transcripts: 2000,
    commands: 5000,
    minutes: 3000,
    storageMb: 25000,
    agentRuns: 1000,
    seats: 25,
  },
};

export const PLAN_DEFINITIONS: BillingPlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    monthlyPriceUsdCents: 0,
    quotas: PLAN_QUOTAS.free,
  },
  {
    id: "pro",
    name: "Pro",
    stripePriceLookupKey: "sonolect_pro_monthly",
    monthlyPriceUsdCents: 1499,
    quotas: PLAN_QUOTAS.pro,
  },
  {
    id: "team",
    name: "Team",
    stripePriceLookupKey: "sonolect_team_monthly",
    monthlyPriceUsdCents: 3999,
    quotas: PLAN_QUOTAS.team,
  },
];

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

const QUOTA_WARNING_THRESHOLD = 0.8;

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Default dependency stubs (in-memory / demo)
// ---------------------------------------------------------------------------

const defaultGetUsageEvents = async (
  _userId: string,
  _period: string,
): Promise<UsageEvent[]> => [];

const defaultGetUserPlan = async (_userId: string): Promise<SonolectPlan> =>
  "free";

const defaultGetStripePlan = async (
  _userId: string,
): Promise<SonolectPlan | null> => null;

// ---------------------------------------------------------------------------
// Usage rollup
// ---------------------------------------------------------------------------

export function computeRollup(events: UsageEvent[]): {
  transcriptions: number;
  minutes: number;
  agentRuns: number;
  storageMb: number;
} {
  let transcriptions = 0;
  let minutes = 0;
  let agentRuns = 0;
  let storageMb = 0;

  for (const event of events) {
    switch (event.metric) {
      case "transcripts":
        transcriptions += event.quantity;
        break;
      case "minutes":
        minutes += event.quantity;
        break;
      case "agentRuns":
        agentRuns += event.quantity;
        break;
      case "storageMb":
        storageMb += event.quantity;
        break;
      default:
        // commands and other metrics are not rolled up here
        break;
    }
  }

  return { transcriptions, minutes, agentRuns, storageMb };
}

// ---------------------------------------------------------------------------
// Quota check
// ---------------------------------------------------------------------------

function percentUsed(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.round((used / limit) * 100);
}

export function checkQuota(
  plan: SonolectPlan,
  rollup: ReturnType<typeof computeRollup>,
): {
  usage: QuotaCheckResult["usage"];
  warnings: string[];
  blocked: boolean;
} {
  const quotas = PLAN_QUOTAS[plan];
  const usage: QuotaCheckResult["usage"] = {
    transcripts: {
      used: rollup.transcriptions,
      limit: quotas.transcripts,
      percentUsed: percentUsed(rollup.transcriptions, quotas.transcripts),
    },
    minutes: {
      used: rollup.minutes,
      limit: quotas.minutes,
      percentUsed: percentUsed(rollup.minutes, quotas.minutes),
    },
    agentRuns: {
      used: rollup.agentRuns,
      limit: quotas.agentRuns,
      percentUsed: percentUsed(rollup.agentRuns, quotas.agentRuns),
    },
    storageMb: {
      used: rollup.storageMb,
      limit: quotas.storageMb,
      percentUsed: percentUsed(rollup.storageMb, quotas.storageMb),
    },
  };

  const warnings: string[] = [];
  let blocked = false;

  for (const [key, value] of Object.entries(usage)) {
    if (value.used >= value.limit) {
      warnings.push(`${key} quota exceeded: ${value.used}/${value.limit}`);
      blocked = true;
    } else if (value.percentUsed >= QUOTA_WARNING_THRESHOLD * 100) {
      warnings.push(
        `${key} approaching limit: ${value.used}/${value.limit} (${value.percentUsed}%)`,
      );
    }
  }

  return { usage, warnings, blocked };
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

export function findDiscrepancies(
  internalPlan: SonolectPlan,
  stripePlan: SonolectPlan | null,
): string[] {
  const discrepancies: string[] = [];

  if (stripePlan === null) {
    if (internalPlan !== "free") {
      discrepancies.push(
        `Internal plan is "${internalPlan}" but no Stripe subscription found`,
      );
    }
  } else if (internalPlan !== stripePlan) {
    discrepancies.push(
      `Internal plan "${internalPlan}" does not match Stripe plan "${stripePlan}"`,
    );
  }

  return discrepancies;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function processBillingTask(
  task: BillingTask,
  deps: BillingHandlerDeps = {},
): Promise<BillingTaskResult> {
  const start = Date.now();
  const getUsageEvents = deps.getUsageEvents ?? defaultGetUsageEvents;
  const getUserPlan = deps.getUserPlan ?? defaultGetUserPlan;
  const getStripePlan = deps.getStripePlan ?? defaultGetStripePlan;

  const period = task.period ?? currentPeriod();

  switch (task.taskType) {
    case "usage-rollup": {
      try {
        const events = await getUsageEvents(task.userId, period);
        const rollup = computeRollup(events);
        return {
          success: true,
          taskType: "usage-rollup",
          userId: task.userId,
          period,
          ...rollup,
          durationMs: Date.now() - start,
        };
      } catch (error) {
        return {
          success: false,
          taskType: "usage-rollup",
          userId: task.userId,
          period,
          transcriptions: 0,
          minutes: 0,
          agentRuns: 0,
          storageMb: 0,
          durationMs: Date.now() - start,
          error:
            error instanceof Error ? error.message : "Unknown billing error",
        };
      }
    }

    case "quota-check": {
      try {
        const [events, plan] = await Promise.all([
          getUsageEvents(task.userId, period),
          getUserPlan(task.userId),
        ]);
        const rollup = computeRollup(events);
        const { usage, warnings, blocked } = checkQuota(plan, rollup);
        return {
          success: true,
          taskType: "quota-check",
          userId: task.userId,
          plan,
          usage,
          warnings,
          blocked,
          durationMs: Date.now() - start,
        };
      } catch (error) {
        return {
          success: false,
          taskType: "quota-check",
          userId: task.userId,
          plan: "free",
          usage: {
            transcripts: { used: 0, limit: 0, percentUsed: 0 },
            minutes: { used: 0, limit: 0, percentUsed: 0 },
            agentRuns: { used: 0, limit: 0, percentUsed: 0 },
            storageMb: { used: 0, limit: 0, percentUsed: 0 },
          },
          warnings: [],
          blocked: false,
          durationMs: Date.now() - start,
          error:
            error instanceof Error ? error.message : "Unknown billing error",
        };
      }
    }

    case "reconcile": {
      try {
        const [internalPlan, stripePlan] = await Promise.all([
          getUserPlan(task.userId),
          getStripePlan(task.userId),
        ]);
        const discrepancies = findDiscrepancies(internalPlan, stripePlan);
        return {
          success: true,
          taskType: "reconcile",
          userId: task.userId,
          internalPlan,
          stripePlan,
          inSync: discrepancies.length === 0,
          discrepancies,
          durationMs: Date.now() - start,
        };
      } catch (error) {
        return {
          success: false,
          taskType: "reconcile",
          userId: task.userId,
          internalPlan: "free",
          stripePlan: null,
          inSync: false,
          discrepancies: [],
          durationMs: Date.now() - start,
          error:
            error instanceof Error ? error.message : "Unknown billing error",
        };
      }
    }
  }
}
