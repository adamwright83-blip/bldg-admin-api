/* LEGACY DAYFORGE COMPATIBILITY: retained historical table literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTenantMonthlyCogs,
  recordTenantProviderCost,
  resolveTenantUsagePolicy,
} from "./tenantCogs";
import { getTenantAiLimitState, trackModelUsage } from "../agents/costTracking";

const enabled = process.env.SAAS_COGS_EXAM === "1";
const suite = enabled ? describe : describe.skip;

suite("JOYSTICK plan-aware tenant COGS", () => {
  let db: Connection;
  const suffix = Date.now().toString(36);
  const tenantA = `cogs-a-${suffix}`;
  const tenantB = `cogs-b-${suffix}`;
  const planA = `plan-a-${suffix}`;
  const planB = `plan-b-${suffix}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    db = await mysql.createConnection(process.env.DATABASE_URL);
    const [[database]] = await db.query("SELECT DATABASE() AS name");
    const name = String((database as { name?: string })?.name ?? "");
    if (!name.includes("saas_cogs")) {
      throw new Error(`Refusing COGS exam outside disposable DB: ${name}`);
    }

    for (const [tenantId, planKey, aiWarning, aiHard] of [
      [tenantA, planA, 300, 500],
      [tenantB, planB, 30, 50],
    ] as const) {
      await db.execute(
        `INSERT INTO dayforge_saas_tenants
          (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
         VALUES (?,?,?,?,?,?,?,?, 'active')`,
        [
          tenantId,
          tenantId,
          `Business ${tenantId}`,
          `Business ${tenantId}`,
          "#111111",
          "Owner",
          `${tenantId}@example.invalid`,
          "America/Los_Angeles",
        ]
      );
      await db.execute(
        `INSERT INTO dayforge_saas_billing_plans
          (planKey,displayName,stripePriceId,trialDays,rulesJson,entitlementsJson,active)
         VALUES (?,?,?,0,?,JSON_ARRAY(),true)`,
        [
          planKey,
          `Plan ${planKey}`,
          `price_${planKey}`,
          JSON.stringify({
            usageBudgets: {
              aiWarningCents: aiWarning,
              aiHardCents: aiHard,
              totalWarningCents: aiWarning * 2,
              totalHardCents: aiHard * 2,
              providers: {
                twilio: { warningCents: 100, hardCents: 200 },
              },
            },
          }),
        ]
      );
      await db.execute(
        `INSERT INTO dayforge_saas_subscriptions
          (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,lastStripeEventId,lastStripeEventCreatedAt)
         VALUES (?,?,?,?, 'active', ?, NOW())`,
        [
          tenantId,
          planKey,
          `cus_${tenantId}`,
          `sub_${tenantId}`,
          `evt_${tenantId}`,
        ]
      );
    }
  });

  afterAll(async () => {
    if (!db) return;
    for (const tenantId of [tenantA, tenantB]) {
      await db.execute("DELETE FROM tenant_provider_usage WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM tenant_ai_usage WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM dayforge_saas_subscriptions WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM dayforge_saas_tenants WHERE id = ?", [tenantId]);
    }
    for (const planKey of [planA, planB]) {
      await db.execute("DELETE FROM dayforge_saas_billing_plans WHERE planKey = ?", [planKey]);
    }
    await db.end();
  });

  it("derives AI and provider budgets from the tenant's subscribed plan", async () => {
    const policyA = await resolveTenantUsagePolicy(tenantA);
    const policyB = await resolveTenantUsagePolicy(tenantB);
    expect(policyA.planKey).toBe(planA);
    expect(policyA.ai).toEqual({ warningCents: 300, hardCents: 500 });
    expect(policyA.totalCogs).toEqual({ warningCents: 600, hardCents: 1000 });
    expect(policyA.providers.twilio).toEqual({ warningCents: 100, hardCents: 200 });
    expect(policyB.ai).toEqual({ warningCents: 30, hardCents: 50 });

    const aiState = await getTenantAiLimitState(tenantA);
    expect(aiState.warningLimitCents).toBe(300);
    expect(aiState.hardLimitCents).toBe(500);
  });

  it("attributes provider cost and model usage to only the correct tenant", async () => {
    await recordTenantProviderCost({
      tenantId: tenantA,
      provider: "twilio",
      category: "voice",
      usageUnit: "seconds",
      usageQuantity: 120,
      estimatedCostCents: 7,
    });
    await trackModelUsage({
      tenantId: tenantA,
      modelUsed: "test-model",
      inputTokens: 1000,
      outputTokens: 100,
    });
    await recordTenantProviderCost({
      tenantId: tenantB,
      provider: "twilio",
      category: "voice",
      usageUnit: "seconds",
      usageQuantity: 30,
      estimatedCostCents: 2,
    });

    const a = await getTenantMonthlyCogs(tenantA);
    const b = await getTenantMonthlyCogs(tenantB);
    expect(a.providers.some(row => row.provider === "twilio" && row.usageQuantity === 120)).toBe(true);
    expect(a.providers.some(row => row.provider === "anthropic" && row.category === "llm")).toBe(true);
    expect(b.providers).toHaveLength(1);
    expect(b.providers[0]?.tenantId).toBe(tenantB);
    expect(a.providers.every(row => row.tenantId === tenantA)).toBe(true);
  });

  it("keeps plan policy independent between tenants", async () => {
    const a = await getTenantAiLimitState(tenantA);
    const b = await getTenantAiLimitState(tenantB);
    expect(a.hardLimitCents).toBe(500);
    expect(b.hardLimitCents).toBe(50);
  });
});
