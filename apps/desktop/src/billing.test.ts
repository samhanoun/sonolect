import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOverQuota,
  getUpgradeUrl,
  formatQuotaDisplay,
  getPlanFeatures,
  type UserPlan,
} from "./billing.js";

/* ── isOverQuota ─────────────────────────────────────────────────── */

describe("isOverQuota", () => {
  it("returns true when usage meets the limit", () => {
    const plan: UserPlan = {
      planId: "free",
      status: "active",
      quotaUsed: 100,
      quotaLimit: 100,
      daysRemaining: 10,
    };
    assert.equal(isOverQuota(plan), true);
  });

  it("returns true when usage exceeds the limit", () => {
    const plan: UserPlan = {
      planId: "pro",
      status: "active",
      quotaUsed: 5001,
      quotaLimit: 5000,
      daysRemaining: 5,
    };
    assert.equal(isOverQuota(plan), true);
  });

  it("returns false when usage is below the limit", () => {
    const plan: UserPlan = {
      planId: "pro",
      status: "active",
      quotaUsed: 42,
      quotaLimit: 5000,
      daysRemaining: 20,
    };
    assert.equal(isOverQuota(plan), false);
  });

  it("returns true when both are zero (edge case)", () => {
    const plan: UserPlan = {
      planId: "free",
      status: "active",
      quotaUsed: 0,
      quotaLimit: 0,
      daysRemaining: 30,
    };
    assert.equal(isOverQuota(plan), true);
  });
});

/* ── getUpgradeUrl ───────────────────────────────────────────────── */

describe("getUpgradeUrl", () => {
  it("returns pro URL for free plan", () => {
    assert.equal(
      getUpgradeUrl("free"),
      "https://checkout.stripe.com/pay/sonolect_pro_monthly",
    );
  });

  it("returns team URL for pro plan", () => {
    assert.equal(
      getUpgradeUrl("pro"),
      "https://checkout.stripe.com/pay/sonolect_team_monthly",
    );
  });

  it("returns team URL for unknown plan", () => {
    assert.equal(
      getUpgradeUrl("enterprise"),
      "https://checkout.stripe.com/pay/sonolect_team_monthly",
    );
  });
});

/* ── formatQuotaDisplay ──────────────────────────────────────────── */

describe("formatQuotaDisplay", () => {
  it("formats usage correctly", () => {
    const plan: UserPlan = {
      planId: "pro",
      status: "active",
      quotaUsed: 42,
      quotaLimit: 100,
      daysRemaining: 15,
    };
    assert.equal(formatQuotaDisplay(plan), "42/100 transcriptions used");
  });

  it("formats zero usage", () => {
    const plan: UserPlan = {
      planId: "free",
      status: "active",
      quotaUsed: 0,
      quotaLimit: 100,
      daysRemaining: 30,
    };
    assert.equal(formatQuotaDisplay(plan), "0/100 transcriptions used");
  });
});

/* ── getPlanFeatures ─────────────────────────────────────────────── */

describe("getPlanFeatures", () => {
  it("returns features for free plan", () => {
    const features = getPlanFeatures("free");
    assert.ok(features.length > 0);
    assert.ok(features.some((f) => f.includes("100 transcriptions")));
  });

  it("returns features for pro plan", () => {
    const features = getPlanFeatures("pro");
    assert.ok(features.some((f) => f.includes("5,000")));
    assert.ok(features.some((f) => f.includes("Priority support")));
  });

  it("returns features for team plan", () => {
    const features = getPlanFeatures("team");
    assert.ok(features.some((f) => f.includes("10 seats")));
    assert.ok(features.some((f) => f.includes("Team collaboration")));
  });

  it("falls back to free features for unknown plan", () => {
    const features = getPlanFeatures("unknown_plan");
    assert.deepEqual(features, getPlanFeatures("free"));
  });
});
