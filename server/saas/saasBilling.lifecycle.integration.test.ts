/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK. */
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLegacyDayforgeSubscriptionCheckout,
  processLegacyDayforgeBillingWebhook,
} from "./saasBilling";
import {
  activateOnboardingOwner,
  saveOnboardingConfiguration,
  startSaasOnboarding,
} from "./saasStore";

const enabled = process.env.SAAS_BILLING_LIFECYCLE_EXAM === "1";
const suite = enabled ? describe : describe.skip;

function fakeStripe(state: { event: any; subscription: any; created?: any }) {
  return {
    checkout: {
      sessions: {
        create: async (params: any, options: any) => {
          state.created = { params, options };
          return { id: "cs_test_joystick_lifecycle", url: "https://example.invalid/checkout" };
        },
        retrieve: async () => ({ id: "cs_test_joystick_lifecycle", url: "https://example.invalid/checkout" }),
      },
    },
    webhooks: {
      constructEvent: () => state.event,
    },
    subscriptions: {
      retrieve: async () => state.subscription,
    },
  } as never;
}

suite("JOYSTICK configurable SaaS billing lifecycle", () => {
  let db: Connection;
  let sessionId = "";
  let resumeToken = "";
  let tenantId = "";
  const suffix = Date.now().toString(36);
  const selectedPlan = `growth-${suffix}`;
  const otherPlan = `starter-${suffix}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    db = await mysql.createConnection(process.env.DATABASE_URL);
    const [[database]] = await db.query("SELECT DATABASE() AS name");
    const name = String((database as { name?: string })?.name ?? "");
    if (!name.includes("billing_lifecycle")) {
      throw new Error(`Refusing billing lifecycle exam outside disposable database: ${name}`);
    }

    await db.execute(
      `INSERT INTO dayforge_saas_billing_plans
        (planKey,displayName,stripePriceId,trialDays,rulesJson,entitlementsJson,active)
       VALUES
        (?,?,?,?,?,?,true),
        (?,?,?,?,?,?,true)`,
      [
        otherPlan, "Starter Test", `price_starter_${suffix}`, 0,
        JSON.stringify({ usageBudgets: { llm: { warningCents: 100, hardCents: 200 } } }),
        JSON.stringify(["dayforge_core"]),
        selectedPlan, "Growth Test", `price_growth_${suffix}`, 9,
        JSON.stringify({ usageBudgets: { llm: { warningCents: 300, hardCents: 600 } } }),
        JSON.stringify(["dayforge_core", "dayforge_field"]),
      ]
    );

    const started = await startSaasOnboarding({
      businessName: "Billing Lifecycle Laundry",
      slug: `billing-${suffix}`,
      ownerEmail: `owner-${suffix}@example.invalid`,
      requestId: `start-${suffix}`,
    });
    sessionId = started.session.id;
    resumeToken = started.resumeToken!;
    await saveOnboardingConfiguration({
      sessionId,
      resumeToken,
      expectedVersion: 1,
      currentStep: "review",
      configuration: {
        businessName: "Billing Lifecycle Laundry",
        slug: `billing-${suffix}`,
        contactName: "Test Owner",
        contactEmail: `owner-${suffix}@example.invalid`,
        contactPhone: null,
        website: null,
        timeZone: "America/Los_Angeles",
        brandName: "Billing Lifecycle Laundry",
        logoUrl: null,
        primaryColor: "#111111",
        proposalTemplateKey: null,
        importProviderKey: "csv",
        locations: [{
          label: "Main",
          address: "1 Test Street",
          latitude: null,
          longitude: null,
          serviceRadiusMiles: 10,
          maxPoundsPerDay: 500,
          maxPoundsByWeekday: { monday: 500 },
          openCapacityPoundsPerWeek: 1000,
          pickupDays: ["monday"],
          routeWindows: ["09:00-12:00"],
          turnaroundHours: 24,
          deliveryEnabled: true,
        }],
        services: [{
          locationKey: "Main",
          serviceKey: "wash_fold",
          name: "Wash & Fold",
          enabled: true,
          commercialEnabled: false,
          pricePerPoundCents: 250,
          minimumOrderCents: null,
          terms: null,
        }],
      },
    });
  });

  afterAll(async () => {
    if (!db) return;
    if (tenantId) {
      for (const table of [
        "dayforge_saas_user_credentials",
        "dayforge_saas_memberships",
        "users",
        "dayforge_saas_entitlements",
        "dayforge_saas_subscriptions",
        "dayforge_saas_tenant_services",
        "dayforge_saas_tenant_locations",
      ]) {
        const key = table === "users" ? "tenantId" : "tenantId";
        await db.execute(`DELETE FROM \`${table}\` WHERE \`${key}\` = ?`, [tenantId]);
      }
      await db.execute("DELETE FROM dayforge_saas_tenants WHERE id = ?", [tenantId]);
    }
    await db.execute("DELETE FROM dayforge_saas_billing_events WHERE objectId LIKE 'sub_lifecycle_%'");
    await db.execute("DELETE FROM dayforge_saas_checkout_sessions WHERE onboardingSessionId = ?", [sessionId]);
    await db.execute("DELETE FROM dayforge_saas_onboarding_sessions WHERE id = ?", [sessionId]);
    await db.execute("DELETE FROM dayforge_saas_billing_plans WHERE planKey IN (?,?)", [selectedPlan, otherPlan]);
    await db.end();
  });

  it("selects plan-specific Stripe price/trial without a hard-coded launch price", async () => {
    const state = { event: null as any, subscription: null as any, created: undefined as any };
    const stripe = fakeStripe(state);
    const checkout = await createLegacyDayforgeSubscriptionCheckout({
      sessionId,
      resumeToken,
      planKey: selectedPlan,
      requestId: `checkout-${suffix}`,
      stripe,
    });
    expect(checkout.id).toBe("cs_test_joystick_lifecycle");
    expect(state.created.params.line_items).toEqual([
      { price: `price_growth_${suffix}`, quantity: 1 },
    ]);
    expect(state.created.params.subscription_data.trial_period_days).toBe(9);
    expect(state.created.params.metadata.legacyDayforgePlanKey).toBe(selectedPlan);
  });

  it("provisions exactly one tenant, ignores duplicate webhooks, activates owner, and cancels access", async () => {
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_lifecycle_test";
    const created = 1_800_000_000;
    const subscription = {
      id: `sub_lifecycle_${suffix}`,
      customer: `cus_lifecycle_${suffix}`,
      status: "trialing",
      cancel_at_period_end: false,
      current_period_end: created + 86400 * 30,
      trial_end: created + 86400 * 9,
      latest_invoice: `in_lifecycle_${suffix}`,
      metadata: {
        legacyDayforgeOnboardingSessionId: sessionId,
        legacyDayforgePlanKey: selectedPlan,
      },
    };
    const checkoutEvent = {
      id: `evt_checkout_${suffix}`,
      type: "checkout.session.completed",
      livemode: false,
      created,
      data: { object: {
        id: "cs_test_joystick_lifecycle",
        subscription: subscription.id,
        metadata: subscription.metadata,
      }},
    };
    const state = { event: checkoutEvent, subscription };
    const stripe = fakeStripe(state);

    const first = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from("checkout-lifecycle"),
      signature: "test-signature",
      stripe,
    });
    expect(first.status).toBe("processed");

    const duplicate = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from("checkout-lifecycle"),
      signature: "test-signature",
      stripe,
    });
    expect(duplicate).toMatchObject({ status: "ignored", reason: "duplicate_event" });

    const [sessions] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT tenantId FROM dayforge_saas_onboarding_sessions WHERE id = ?",
      [sessionId]
    );
    tenantId = String(sessions[0]?.tenantId ?? "");
    expect(tenantId).toMatch(/^dayforge-/);

    const [tenants] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    expect(Number(tenants[0]?.count ?? 0)).toBe(1);

    const [entitlements] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT entitlementKey, enabled FROM dayforge_saas_entitlements WHERE tenantId = ? AND enabled = true ORDER BY entitlementKey",
      [tenantId]
    );
    expect(entitlements.map(row => row.entitlementKey)).toEqual([
      "dayforge_core",
      "dayforge_field",
    ]);

    const activated = await activateOnboardingOwner({
      sessionId,
      resumeToken,
      name: "Test Owner",
      passwordHash: "test-password-hash-not-a-real-password",
    });
    expect(activated.tenantId).toBe(tenantId);

    const canceledSubscription = {
      ...subscription,
      status: "canceled",
      trial_end: null,
    };
    state.subscription = canceledSubscription;
    state.event = {
      id: `evt_cancel_${suffix}`,
      type: "customer.subscription.deleted",
      livemode: false,
      created: created + 100,
      data: { object: canceledSubscription },
    };
    const canceled = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from("cancel-lifecycle"),
      signature: "test-signature",
      stripe,
    });
    expect(canceled.status).toBe("processed");

    const [subscriptions] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT status, accessEndsAt FROM dayforge_saas_subscriptions WHERE tenantId = ?",
      [tenantId]
    );
    expect(subscriptions[0]?.status).toBe("canceled");
    expect(subscriptions[0]?.accessEndsAt).not.toBeNull();
  });
});
