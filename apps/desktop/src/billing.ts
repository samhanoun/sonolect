/* ── Client-side billing module ───────────────────────────────────── */

export interface UserPlan {
  planId: "free" | "pro" | "team";
  status: string;
  quotaUsed: number;
  quotaLimit: number;
  daysRemaining: number;
}

/* ── API ─────────────────────────────────────────────────────────── */

/**
 * Fetch the current user's plan and usage quota from the billing service.
 */
export async function fetchUserPlan(
  apiUrl: string,
  token: string,
): Promise<UserPlan> {
  const response = await fetch(`${apiUrl}/billing/users/me/quota`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch user plan: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    plan: string;
    transcripts?: { used: number; limit: number };
    periodEnd?: string;
    status?: string;
  };

  const used = data.transcripts?.used ?? 0;
  const limit = data.transcripts?.limit ?? 0;

  const periodEnd = data.periodEnd
    ? new Date(data.periodEnd).getTime()
    : Date.now();
  const daysRemaining = Math.max(
    0,
    Math.ceil((periodEnd - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  return {
    planId: (data.plan as UserPlan["planId"]) ?? "free",
    status: data.status ?? "active",
    quotaUsed: used,
    quotaLimit: limit,
    daysRemaining,
  };
}

/* ── Quota helpers ───────────────────────────────────────────────── */

/**
 * Returns true when the user has exceeded their transcript quota.
 */
export function isOverQuota(plan: UserPlan): boolean {
  return plan.quotaUsed >= plan.quotaLimit;
}

/**
 * Build a Stripe checkout URL for upgrading to the next plan.
 */
export function getUpgradeUrl(currentPlan: string): string {
  const priceKey =
    currentPlan === "free" ? "sonolect_pro_monthly" : "sonolect_team_monthly";
  return `https://checkout.stripe.com/pay/${priceKey}`;
}

/**
 * Format quota usage for display: "42/100 transcriptions used"
 */
export function formatQuotaDisplay(plan: UserPlan): string {
  return `${plan.quotaUsed}/${plan.quotaLimit} transcriptions used`;
}

/* ── Feature lists per plan ──────────────────────────────────────── */

const PLAN_FEATURES: Record<string, string[]> = {
  free: [
    "100 transcriptions/month",
    "25 voice commands/month",
    "2 hours of audio/month",
    "500 MB storage",
    "1 seat",
  ],
  pro: [
    "5,000 transcriptions/month",
    "2,000 voice commands/month",
    "166 hours of audio/month",
    "25 GB storage",
    "Priority support",
    "1 seat",
  ],
  team: [
    "25,000 transcriptions/month",
    "10,000 voice commands/month",
    "833 hours of audio/month",
    "250 GB storage",
    "Priority support",
    "Up to 10 seats",
    "Team collaboration",
  ],
};

/**
 * Return the feature list for a given plan (for UI display).
 */
export function getPlanFeatures(planId: string): string[] {
  return PLAN_FEATURES[planId] ?? PLAN_FEATURES.free!;
}
