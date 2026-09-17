import { beforeEach, describe, expect, it } from "vitest";
import {
  getActivePlaygroundRules,
  resetInMemoryRulesForTesting,
  setPlaygroundRules,
} from "./playgroundRulesService";
import {
  cleanupStalePlannedReservations,
  commitSpend,
  getMonthToDateSpend,
  releaseSpend,
  reserveSpend,
  resetInMemorySpendLedgerForTesting,
} from "./spendClearance";
import {
  formatGoalVoiceReadback,
  GOAL_METRIC_TYPES,
  validateVoiceReadbackConfirmation,
} from "../claire/macroGoalService";

describe("Slice 3: Playground Rules & Spend Clearance", () => {
  beforeEach(() => {
    resetInMemoryRulesForTesting();
    resetInMemorySpendLedgerForTesting();
  });

  describe("guardrail.G6.default_ceiling_zero", () => {
    it("defaults to $0 ceiling and blocks autonomous spend when unset", async () => {
      const tenant = "t-default-zero";
      const rules = await getActivePlaygroundRules(tenant);
      expect(rules.monthlySpendCeilingCents).toBe(0);

      // Attempting any spend under $0 ceiling is rejected as over_ceiling
      const res = await reserveSpend({
        tenantId: tenant,
        category: "software_tool", // non-approval category
        amountCents: 500,
        businessMonth: "2026-09",
      });

      expect(res.cleared).toBe(false);
      expect(res.status).toBe("over_ceiling");
    });
  });

  describe("guardrail.G6.approval_category_blocks_even_under_ceiling", () => {
    it("blocks spend in approval category even when ample ceiling is available", async () => {
      const tenant = "t-approval-cat";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 50000, // $500 ceiling
        approvalCategories: ["paid_ads", "print_order"],
      });

      // paid_ads requires approval
      const res = await reserveSpend({
        tenantId: tenant,
        category: "paid_ads",
        amountCents: 1000, // $10
        businessMonth: "2026-09",
      });

      expect(res.cleared).toBe(false);
      expect(res.status).toBe("needs_approval");
      expect(res.reason).toContain("approval_category_blocks_even_under_ceiling");
    });
  });

  describe("guardrail.G6.over_ceiling_blocked", () => {
    it("clears spend within ceiling, and blocks spend exceeding ceiling", async () => {
      const tenant = "t-ceiling-check";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 10000, // $100 ceiling
        approvalCategories: [], // no categories blocked
      });

      // First spend: $60 (clears)
      const res1 = await reserveSpend({
        tenantId: tenant,
        category: "growth_ops",
        amountCents: 6000,
        businessMonth: "2026-09",
        dedupeKey: "spend-1",
      });
      expect(res1.cleared).toBe(true);
      expect(res1.status).toBe("cleared");

      // Second spend: $50 (would total $110 > $100 -> blocked)
      const res2 = await reserveSpend({
        tenantId: tenant,
        category: "growth_ops",
        amountCents: 5000,
        businessMonth: "2026-09",
        dedupeKey: "spend-2",
      });
      expect(res2.cleared).toBe(false);
      expect(res2.status).toBe("over_ceiling");
      expect(res2.remainingCents).toBe(4000);
    });
  });

  describe("guardrail.G6.concurrent_reservations_cannot_exceed_ceiling", () => {
    it("safely serializes concurrent reservations so total never exceeds ceiling", async () => {
      const tenant = "t-concurrent";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 10000, // $100 ceiling
        approvalCategories: [],
      });

      // Launch 5 concurrent requests for $30 each (total $150 attempted)
      const promises = Array.from({ length: 5 }, (_, i) =>
        reserveSpend({
          tenantId: tenant,
          category: "equipment",
          amountCents: 3000,
          businessMonth: "2026-09",
          dedupeKey: `concurrent-${i}`,
        })
      );

      const results = await Promise.all(promises);
      const cleared = results.filter(r => r.cleared);
      const blocked = results.filter(r => !r.cleared);

      // Exactly 3 should clear ($90 <= $100), and 2 should be over_ceiling ($120 > $100)
      expect(cleared).toHaveLength(3);
      expect(blocked).toHaveLength(2);

      const spend = await getMonthToDateSpend(tenant, "2026-09");
      expect(spend.plannedCents).toBe(9000);
      expect(spend.plannedCents + spend.committedCents).toBeLessThanOrEqual(spend.ceilingCents);
    });
  });

  describe("guardrail.G6.reservation_released_on_drop_or_denial", () => {
    it("releases planned reservation on denial, freeing capacity", async () => {
      const tenant = "t-release";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 5000, // $50
        approvalCategories: [],
      });

      const res = await reserveSpend({
        tenantId: tenant,
        category: "tools",
        amountCents: 4000,
        businessMonth: "2026-09",
        dedupeKey: "mission-to-drop",
      });
      expect(res.cleared).toBe(true);

      let spend = await getMonthToDateSpend(tenant, "2026-09");
      expect(spend.plannedCents).toBe(4000);
      expect(spend.remainingCents).toBe(1000);

      // Mission dropped or spend denied -> release reservation
      const released = await releaseSpend({
        tenantId: tenant,
        dedupeKey: "mission-to-drop",
        reason: "mission_dropped",
      });
      expect(released).toBe(true);

      spend = await getMonthToDateSpend(tenant, "2026-09");
      expect(spend.plannedCents).toBe(0);
      expect(spend.remainingCents).toBe(5000); // full $50 available again
    });
  });

  describe("guardrail.G6.stale_planned_does_not_consume_new_month", () => {
    it("expires prior month planned reservations upon rollover", async () => {
      const tenant = "t-rollover";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 5000,
        approvalCategories: [],
      });

      // August planned reservation
      await reserveSpend({
        tenantId: tenant,
        category: "ads",
        amountCents: 4000,
        businessMonth: "2026-08",
        dedupeKey: "aug-res",
      });

      // Rollover to September: cleanup stale reservations
      const cleaned = await cleanupStalePlannedReservations(tenant, "2026-09");
      expect(cleaned).toBeGreaterThanOrEqual(1);

      // September available spend is unaffected by August
      const septSpend = await getMonthToDateSpend(tenant, "2026-09");
      expect(septSpend.plannedCents).toBe(0);
      expect(septSpend.remainingCents).toBe(5000);
    });
  });

  it("ensures idempotent reservations with identical dedupeKey", async () => {
    const tenant = "t-idempotent";
    await setPlaygroundRules({
      tenantId: tenant,
      monthlySpendCeilingCents: 10000,
      approvalCategories: [],
    });

    const res1 = await reserveSpend({
      tenantId: tenant,
      category: "tools",
      amountCents: 2500,
      businessMonth: "2026-09",
      dedupeKey: "idemp-key-1",
    });

    const res2 = await reserveSpend({
      tenantId: tenant,
      category: "tools",
      amountCents: 2500,
      businessMonth: "2026-09",
      dedupeKey: "idemp-key-1",
    });

    expect(res1.cleared).toBe(true);
    expect(res2.cleared).toBe(true);
    expect(res2.reason).toContain("idempotent_existing_reservation");

    const spend = await getMonthToDateSpend(tenant, "2026-09");
    expect(spend.plannedCents).toBe(2500); // not 5000
  });

  it("preserves tenant isolation in playground rules and spend ledger", async () => {
    await setPlaygroundRules({
      tenantId: "tenant-A",
      monthlySpendCeilingCents: 20000,
      approvalCategories: [],
    });
    await setPlaygroundRules({
      tenantId: "tenant-B",
      monthlySpendCeilingCents: 5000,
      approvalCategories: [],
    });

    await reserveSpend({
      tenantId: "tenant-A",
      category: "ops",
      amountCents: 15000,
      businessMonth: "2026-09",
      dedupeKey: "tA-1",
    });

    const spendA = await getMonthToDateSpend("tenant-A", "2026-09");
    const spendB = await getMonthToDateSpend("tenant-B", "2026-09");

    expect(spendA.plannedCents).toBe(15000);
    expect(spendB.plannedCents).toBe(0);
    expect(spendB.ceilingCents).toBe(5000);
  });

  it("requires read-back before voice write", () => {
    expect(GOAL_METRIC_TYPES).toContain("active_customers");
    expect(GOAL_METRIC_TYPES).toContain("new_paying_customers");

    const readback = formatGoalVoiceReadback({
      metricKey: "active_customers",
      targetValue: 50,
      targetDate: "2026-10-31",
    });
    expect(readback).toContain("50 active customers");
    expect(readback).toContain("2026-10-31");
    expect(readback).toContain("Did I get that right?");

    expect(validateVoiceReadbackConfirmation("Yes, that's right")).toBe(true);
    expect(validateVoiceReadbackConfirmation("No, that's wrong")).toBe(false);
    expect(validateVoiceReadbackConfirmation("What?")).toBe(false);
  });
});
