import { strict as assert } from "node:assert";
import type { UsageEvent, SonolectPlan } from "@sonolect/types";
import {
  computeRollup,
  checkQuota,
  findDiscrepancies,
  currentPeriod,
  processBillingTask,
  type BillingHandlerDeps,
  type BillingTask,
} from "./billing-handler.js";

// ---------------------------------------------------------------------------
// currentPeriod
// ---------------------------------------------------------------------------

{
  const period = currentPeriod();
  assert.match(period, /^\d{4}-\d{2}$/);
}

console.log("  currentPeriod tests passed");

// ---------------------------------------------------------------------------
// computeRollup
// ---------------------------------------------------------------------------

{
  const events: UsageEvent[] = [
    {
      id: "e1",
      userId: "u1",
      metric: "transcripts",
      quantity: 5,
      source: "audio",
      occurredAt: "2026-05-01T00:00:00Z",
    },
    {
      id: "e2",
      userId: "u1",
      metric: "minutes",
      quantity: 12,
      source: "audio",
      occurredAt: "2026-05-01T00:00:00Z",
    },
    {
      id: "e3",
      userId: "u1",
      metric: "agentRuns",
      quantity: 3,
      source: "agent",
      occurredAt: "2026-05-01T00:00:00Z",
    },
    {
      id: "e4",
      userId: "u1",
      metric: "storageMb",
      quantity: 100,
      source: "audio",
      occurredAt: "2026-05-01T00:00:00Z",
    },
    {
      id: "e5",
      userId: "u1",
      metric: "transcripts",
      quantity: 3,
      source: "audio",
      occurredAt: "2026-05-02T00:00:00Z",
    },
    {
      id: "e6",
      userId: "u1",
      metric: "commands",
      quantity: 10,
      source: "agent",
      occurredAt: "2026-05-02T00:00:00Z",
    },
  ];

  const rollup = computeRollup(events);
  assert.equal(rollup.transcriptions, 8);
  assert.equal(rollup.minutes, 12);
  assert.equal(rollup.agentRuns, 3);
  assert.equal(rollup.storageMb, 100);
}

{
  // Empty events
  const rollup = computeRollup([]);
  assert.equal(rollup.transcriptions, 0);
  assert.equal(rollup.minutes, 0);
  assert.equal(rollup.agentRuns, 0);
  assert.equal(rollup.storageMb, 0);
}

console.log("  computeRollup tests passed");

// ---------------------------------------------------------------------------
// checkQuota
// ---------------------------------------------------------------------------

{
  // Free plan, well under limits
  const result = checkQuota("free", {
    transcriptions: 10,
    minutes: 10,
    agentRuns: 5,
    storageMb: 100,
  });
  assert.equal(result.blocked, false);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.usage.transcripts.limit, 50);
  assert.equal(result.usage.transcripts.used, 10);
}

{
  // Free plan, approaching limit (>= 80%)
  const result = checkQuota("free", {
    transcriptions: 42,
    minutes: 10,
    agentRuns: 5,
    storageMb: 100,
  });
  assert.equal(result.blocked, false);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings.some((w) => w.includes("transcripts")));
}

{
  // Free plan, exceeded limit
  const result = checkQuota("free", {
    transcriptions: 55,
    minutes: 10,
    agentRuns: 5,
    storageMb: 100,
  });
  assert.equal(result.blocked, true);
  assert.ok(result.warnings.some((w) => w.includes("exceeded")));
}

{
  // Pro plan, generous limits
  const result = checkQuota("pro", {
    transcriptions: 100,
    minutes: 100,
    agentRuns: 50,
    storageMb: 500,
  });
  assert.equal(result.blocked, false);
  assert.equal(result.usage.transcripts.limit, 500);
}

console.log("  checkQuota tests passed");

// ---------------------------------------------------------------------------
// findDiscrepancies
// ---------------------------------------------------------------------------

{
  // In sync: free plan, no Stripe
  const discrepancies = findDiscrepancies("free", null);
  assert.equal(discrepancies.length, 0);
}

{
  // In sync: pro plan matches Stripe
  const discrepancies = findDiscrepancies("pro", "pro");
  assert.equal(discrepancies.length, 0);
}

{
  // Mismatch: internal says pro, Stripe says free
  const discrepancies = findDiscrepancies("pro", "free");
  assert.equal(discrepancies.length, 1);
  assert.ok(discrepancies[0]!.includes("does not match"));
}

{
  // Mismatch: internal says pro, no Stripe subscription
  const discrepancies = findDiscrepancies("pro", null);
  assert.equal(discrepancies.length, 1);
  assert.ok(discrepancies[0]!.includes("no Stripe subscription"));
}

console.log("  findDiscrepancies tests passed");

// ---------------------------------------------------------------------------
// processBillingTask — usage-rollup
// ---------------------------------------------------------------------------

{
  const deps: BillingHandlerDeps = {
    getUsageEvents: async () => [
      {
        id: "e1",
        userId: "u1",
        metric: "transcripts",
        quantity: 10,
        source: "audio",
        occurredAt: "2026-05-01T00:00:00Z",
      },
      {
        id: "e2",
        userId: "u1",
        metric: "minutes",
        quantity: 30,
        source: "audio",
        occurredAt: "2026-05-01T00:00:00Z",
      },
    ],
  };

  const task: BillingTask = {
    taskType: "usage-rollup",
    userId: "u1",
    period: "2026-05",
  };

  const result = await processBillingTask(task, deps);
  assert.equal(result.taskType, "usage-rollup");
  assert.equal(result.success, true);
  if (result.taskType === "usage-rollup") {
    assert.equal(result.transcriptions, 10);
    assert.equal(result.minutes, 30);
    assert.equal(result.period, "2026-05");
  }
}

console.log("  processBillingTask usage-rollup tests passed");

// ---------------------------------------------------------------------------
// processBillingTask — quota-check
// ---------------------------------------------------------------------------

{
  const deps: BillingHandlerDeps = {
    getUsageEvents: async () => [
      {
        id: "e1",
        userId: "u1",
        metric: "transcripts",
        quantity: 45,
        source: "audio",
        occurredAt: "2026-05-01T00:00:00Z",
      },
    ],
    getUserPlan: async () => "free" as SonolectPlan,
  };

  const task: BillingTask = {
    taskType: "quota-check",
    userId: "u1",
  };

  const result = await processBillingTask(task, deps);
  assert.equal(result.taskType, "quota-check");
  assert.equal(result.success, true);
  if (result.taskType === "quota-check") {
    assert.equal(result.plan, "free");
    assert.ok(result.warnings.length > 0);
    assert.equal(result.usage.transcripts.used, 45);
  }
}

console.log("  processBillingTask quota-check tests passed");

// ---------------------------------------------------------------------------
// processBillingTask — reconcile
// ---------------------------------------------------------------------------

{
  const deps: BillingHandlerDeps = {
    getUserPlan: async () => "pro" as SonolectPlan,
    getStripePlan: async () => "pro" as SonolectPlan,
  };

  const task: BillingTask = {
    taskType: "reconcile",
    userId: "u1",
  };

  const result = await processBillingTask(task, deps);
  assert.equal(result.taskType, "reconcile");
  assert.equal(result.success, true);
  if (result.taskType === "reconcile") {
    assert.equal(result.inSync, true);
    assert.equal(result.discrepancies.length, 0);
  }
}

{
  // Reconcile with mismatch
  const deps: BillingHandlerDeps = {
    getUserPlan: async () => "pro" as SonolectPlan,
    getStripePlan: async () => "free" as SonolectPlan,
  };

  const task: BillingTask = {
    taskType: "reconcile",
    userId: "u1",
  };

  const result = await processBillingTask(task, deps);
  assert.equal(result.taskType, "reconcile");
  assert.equal(result.success, true);
  if (result.taskType === "reconcile") {
    assert.equal(result.inSync, false);
    assert.ok(result.discrepancies.length > 0);
  }
}

{
  // Error handling
  const deps: BillingHandlerDeps = {
    getUsageEvents: async () => {
      throw new Error("Database unavailable");
    },
  };

  const task: BillingTask = {
    taskType: "usage-rollup",
    userId: "u1",
  };

  const result = await processBillingTask(task, deps);
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("Database unavailable"));
}

console.log("  processBillingTask reconcile tests passed");

console.log("Billing handler tests passed");
