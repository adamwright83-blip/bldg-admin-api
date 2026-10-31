/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLegacyDayforgeBillingPortalSession,
  createLegacyDayforgeSubscriptionCheckout,
  processLegacyDayforgeBillingWebhook,
} from "./saasBilling";
import {
  JOYSTICK_MONTHLY_PLAN_KEY,
  JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
} from "./joystickStripeOffer";
import { screenPaidLifecycleWebhook } from "./paidCustomerLifecycle";
import {
  activateOnboardingOwner,
  generateJoystickDraftPreview,
  saveJoystickDraftAnswer,
  saveJoystickOnboardingIdentity,
  saveOnboardingConfiguration,
  startJoystickOnboardingDraft,
  startSaasOnboarding,
} from "./saasStore";

// The login route signs a session; its secret is read when the server modules load.
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "billing-lifecycle-standin-jwt-secret-000000";
});

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
    expect(tenantId).toMatch(/^df_[0-9a-f]{24}$/);

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

/**
 * STAND-IN STRIPE, real local MySQL. The advertised JOYSTICK monthly offer end to end: $79 a month, no trial, card at
 * signup, charged at checkout. No Stripe API is called and no key is used. What is real: the plan synced from the
 * environment, the checkout parameters this code sends, HMAC webhook signatures (constructEvent with a test secret)
 * over payloads shaped like the sandbox endpoint's API version (2026-09-30: invoice.parent.subscription_details,
 * subscription items' current_period_end), tenant provisioning, the owner's bcrypt password, the actual login route,
 * the portal parameters, and cancellation. What is stood in: Stripe's answers to prices/checkout/subscriptions/portal.
 * The real-Stripe sandbox run is server/saas/stripeProviderAcceptance.ts.
 */
suite("JOYSTICK $79/month, no trial — stand-in Stripe through checkout, signed webhooks, login, portal and cancellation", () => {
  const SANDBOX_PRICE = "price_1UWX4RDygmVPA3tjPx1S5NMD";
  const SANDBOX_PRODUCT = "prod_VXcJu4mQ9O10Df";
  const SANDBOX_PORTAL = "bpc_1UWX6fDygmVPA3tjqzUEn5uD";
  const WEBHOOK_SECRET = "whsec_standin_lifecycle_79_no_trial";
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const eventPrefix = `evt_standin79_${suffix}`;
  const ids = {
    checkout: `cs_test_standin79_${suffix}`,
    customer: `cus_standin79_${suffix}`,
    subscription: `sub_standin79_${suffix}`,
    invoice: `in_standin79_${suffix}`,
  };
  const ownerEmail = `owner-79-${suffix}@example.invalid`;
  const password = randomBytes(18).toString("base64url");
  const base = Math.floor(Date.now() / 1000) - 3600;
  const periodEnd = base + 30 * 86_400;
  const envKeys = [
    "DAYFORGE_STRIPE_PRICE_ID",
    "DAYFORGE_STRIPE_PRODUCT_ID",
    "DAYFORGE_STRIPE_PLAN_KEY",
    "DAYFORGE_STRIPE_TRIAL_DAYS",
    "DAYFORGE_STRIPE_PLAN_NAME",
    "DAYFORGE_STRIPE_MAX_SUBSCRIPTIONS",
    "DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID",
    "DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET",
    "DAYFORGE_BILLING_APP_URL",
  ] as const;
  const savedEnv = new Map<string, string | undefined>();
  let db: Connection;
  let server: http.Server | null = null;
  let origin = "";
  let sessionId = "";
  let resumeToken = "";
  let tenantId = "";
  let slug = "";
  let priorPlanRow: RowDataPacket | null = null;

  const verifier = new Stripe("sk_test_standin_lifecycle_verify_only", {
    apiVersion: "2025-03-31.basil" as never,
  });
  const world = {
    subscription: null as Record<string, unknown> | null,
    prices: [] as string[],
    checkout: [] as Array<{ params: Record<string, any>; options: Record<string, any> }>,
    portal: [] as Array<{ params: Record<string, any>; options: Record<string, any> }>,
    retrieved: [] as string[],
  };
  const standIn = {
    webhooks: verifier.webhooks,
    prices: {
      retrieve: async (id: string) => {
        world.prices.push(id);
        return {
          id,
          object: "price",
          active: true,
          livemode: false,
          type: "recurring",
          product: SANDBOX_PRODUCT,
          unit_amount: JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
          currency: "usd",
          recurring: { interval: "month", interval_count: 1 },
        };
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, any>, options: Record<string, any>) => {
          world.checkout.push({ params, options });
          return { id: ids.checkout, object: "checkout.session", livemode: false, url: `https://checkout.stripe.com/c/pay/${ids.checkout}` };
        },
        retrieve: async (id: string) => ({
          id,
          url: `https://checkout.stripe.com/c/pay/${id}`,
          line_items: { data: [{ price: { id: SANDBOX_PRICE } }] },
        }),
      },
    },
    subscriptions: {
      retrieve: async (id: string) => {
        world.retrieved.push(id);
        return world.subscription;
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: Record<string, any>, options: Record<string, any>) => {
          world.portal.push({ params, options });
          return {
            id: `bps_standin79_${suffix}`,
            object: "billing_portal.session",
            livemode: false,
            customer: params.customer,
            configuration: params.configuration ?? "bpc_account_default",
            return_url: params.return_url,
            url: `https://billing.stripe.com/p/session/test_standin79_${suffix}`,
          };
        },
      },
    },
  } as unknown as Stripe;

  function subscription2026(overrides: Record<string, unknown> = {}) {
    return {
      id: ids.subscription,
      object: "subscription",
      livemode: false,
      status: "active",
      customer: ids.customer,
      currency: "usd",
      collection_method: "charge_automatically",
      billing_mode: { type: "classic" },
      cancel_at: null,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      created: base,
      start_date: base,
      trial_start: null,
      trial_end: null,
      latest_invoice: ids.invoice,
      default_payment_method: `pm_standin79_${suffix}`,
      metadata: {
        legacyDayforgeOnboardingSessionId: sessionId,
        legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY,
      },
      items: {
        object: "list",
        data: [{
          id: `si_standin79_${suffix}`,
          object: "subscription_item",
          subscription: ids.subscription,
          quantity: 1,
          current_period_start: base,
          current_period_end: periodEnd,
          price: { id: SANDBOX_PRICE, product: SANDBOX_PRODUCT, unit_amount: 7900, currency: "usd", recurring: { interval: "month" } },
        }],
      },
      ...overrides,
    };
  }

  function invoice2026() {
    return {
      id: ids.invoice,
      object: "invoice",
      livemode: false,
      status: "paid",
      billing_reason: "subscription_create",
      currency: "usd",
      customer: ids.customer,
      amount_due: 7900,
      amount_paid: 7900,
      amount_remaining: 0,
      parent: {
        type: "subscription_details",
        quote_details: null,
        subscription_details: { metadata: subscription2026().metadata, subscription: ids.subscription },
      },
      lines: {
        object: "list",
        data: [{
          id: `il_standin79_${suffix}`,
          object: "line_item",
          amount: 7900,
          period: { start: base, end: periodEnd },
          parent: {
            type: "subscription_item_details",
            subscription_item_details: { subscription: ids.subscription, subscription_item: `si_standin79_${suffix}`, proration: false },
          },
        }],
      },
    };
  }

  let eventCount = 0;
  async function deliver(type: string, object: unknown, created: number, livemode = false) {
    eventCount += 1;
    const payload = JSON.stringify({
      id: `${eventPrefix}_${eventCount}`,
      object: "event",
      api_version: "2026-09-30",
      created,
      livemode,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: { object },
    });
    const signature = verifier.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    // the route's screen first: a valid signature over these bytes, not a live-mode event
    const screened = screenPaidLifecycleWebhook({ rawBody: payload, signature, webhookSecret: WEBHOOK_SECRET });
    if (!screened.proceed) return { screened, processed: null };
    const processed = await processLegacyDayforgeBillingWebhook({ rawBody: Buffer.from(payload), signature, stripe: standIn });
    return { screened, processed, payload, signature };
  }

  async function login() {
    const response = await fetch(`${origin}/api/dayforge/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ slug, email: ownerEmail, password }),
    });
    const body = (await response.json().catch(() => ({}))) as { tenantId?: string; error?: string };
    return { status: response.status, body, cookie: response.headers.get("set-cookie") };
  }

  async function subscriptionRow() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, cancelAtPeriodEnd, currentPeriodEnd, trialEnd, accessEndsAt, lastInvoicePaidAt, latestInvoiceId,
              stripeCustomerId, stripeSubscriptionId, planKey
         FROM dayforge_saas_subscriptions WHERE tenantId = ?`,
      [tenantId]
    );
    return rows[0];
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    db = await mysql.createConnection(process.env.DATABASE_URL);
    const [[database]] = await db.query("SELECT DATABASE() AS name");
    const name = String((database as { name?: string })?.name ?? "");
    if (!name.includes("billing_lifecycle")) {
      throw new Error(`Refusing billing lifecycle exam outside disposable database: ${name}`);
    }
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM dayforge_saas_billing_plans WHERE planKey = ?",
      [JOYSTICK_MONTHLY_PLAN_KEY]
    );
    priorPlanRow = existing[0] ?? null;
    for (const key of envKeys) savedEnv.set(key, process.env[key]);
    // the Railway variables Adam sets for the sandbox, read by syncConfiguredSaasPlan and the portal
    process.env.DAYFORGE_STRIPE_PRICE_ID = SANDBOX_PRICE;
    process.env.DAYFORGE_STRIPE_PRODUCT_ID = SANDBOX_PRODUCT;
    process.env.DAYFORGE_STRIPE_PLAN_KEY = JOYSTICK_MONTHLY_PLAN_KEY;
    process.env.DAYFORGE_STRIPE_TRIAL_DAYS = "0";
    process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID = SANDBOX_PORTAL;
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.DAYFORGE_STRIPE_PLAN_NAME;
    delete process.env.DAYFORGE_STRIPE_MAX_SUBSCRIPTIONS;
    delete process.env.DAYFORGE_BILLING_APP_URL; // unset in Railway: the default origin is what is checked

    const express = (await import("express")).default;
    const { registerLegacyDayforgeSaasAuthRoute } = await import("./saasAuthRoute");
    const app = express();
    app.use(express.json());
    registerLegacyDayforgeSaasAuthRoute(app);
    server = http.createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (!db) return;
    if (tenantId) {
      for (const table of [
        "dayforge_saas_user_credentials",
        "dayforge_saas_memberships",
        "dayforge_saas_entitlements",
        "dayforge_saas_subscriptions",
        "dayforge_saas_tenant_services",
        "dayforge_saas_tenant_locations",
        "goldline_onboarding_sessions",
        "users",
      ]) {
        await db.execute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [tenantId]).catch(() => undefined);
      }
      await db.execute("DELETE FROM dayforge_saas_tenants WHERE id = ?", [tenantId]);
    }
    if (sessionId) {
      await db.execute("DELETE FROM dayforge_saas_checkout_sessions WHERE onboardingSessionId = ?", [sessionId]);
      await db.execute("DELETE FROM dayforge_saas_onboarding_sessions WHERE id = ?", [sessionId]);
    }
    await db.execute("DELETE FROM dayforge_saas_billing_events WHERE stripeEventId LIKE ?", [`${eventPrefix}%`]);
    if (priorPlanRow) {
      await db.execute(
        "UPDATE dayforge_saas_billing_plans SET stripePriceId = ?, stripeProductId = ?, trialDays = ?, active = ? WHERE planKey = ?",
        [priorPlanRow.stripePriceId, priorPlanRow.stripeProductId, priorPlanRow.trialDays, priorPlanRow.active, JOYSTICK_MONTHLY_PLAN_KEY]
      );
    } else {
      await db.execute("DELETE FROM dayforge_saas_billing_plans WHERE planKey = ?", [JOYSTICK_MONTHLY_PLAN_KEY]);
    }
    await db.end();
  });

  it("stand-in Stripe: checkout opens at 7900 cents a month with a card and no trial, from the environment's plan", async () => {
    const started = await startJoystickOnboardingDraft({ requestId: randomUUID() });
    let session = started.session;
    sessionId = session.id;
    resumeToken = started.resumeToken!;
    for (const [questionKey, answer] of [
      ["daily_work", "I run carpet cleaning jobs and quote restorations"],
      ["service_area", "Glendale"],
      ["avoidance", "following up on estimates"],
    ] as const) {
      session = await saveJoystickDraftAnswer({ sessionId, resumeToken, expectedVersion: session.version, questionKey, answer });
    }
    session = await generateJoystickDraftPreview({ sessionId, resumeToken, expectedVersion: session.version });
    await saveJoystickOnboardingIdentity({
      sessionId,
      resumeToken,
      expectedVersion: session.version,
      businessName: `Glendale Carpet ${suffix}`,
      contactName: "Test Owner",
      ownerEmail,
      timeZone: "America/Los_Angeles",
    });

    const checkout = await createLegacyDayforgeSubscriptionCheckout({
      sessionId,
      resumeToken,
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      requestId: randomUUID(),
      stripe: standIn,
    });
    expect(checkout).toEqual({ id: ids.checkout, url: `https://checkout.stripe.com/c/pay/${ids.checkout}` });

    // plan config: synced from DAYFORGE_STRIPE_* with no trial
    const [plans] = await db.execute<RowDataPacket[]>(
      "SELECT stripePriceId, stripeProductId, trialDays, active FROM dayforge_saas_billing_plans WHERE planKey = ?",
      [JOYSTICK_MONTHLY_PLAN_KEY]
    );
    expect(plans[0]).toMatchObject({ stripePriceId: SANDBOX_PRICE, stripeProductId: SANDBOX_PRODUCT, trialDays: 0 });
    expect(Boolean(plans[0]?.active)).toBe(true);
    // the price was verified before checkout
    expect(world.prices).toEqual([SANDBOX_PRICE]);

    expect(world.checkout).toHaveLength(1);
    const { params, options } = world.checkout[0]!;
    expect(params).toMatchObject({
      mode: "subscription",
      customer_email: ownerEmail,
      client_reference_id: sessionId,
      line_items: [{ price: SANDBOX_PRICE, quantity: 1 }],
      payment_method_collection: "always",
      payment_method_types: ["card"],
      success_url: `https://admin.bldg.chat/joystick-start?session=${sessionId}&checkout=success`,
      cancel_url: `https://admin.bldg.chat/joystick-start?session=${sessionId}&checkout=cancelled`,
      metadata: { legacyDayforgeOnboardingSessionId: sessionId, legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY },
    });
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params.subscription_data.metadata).toEqual({
      legacyDayforgeOnboardingSessionId: sessionId,
      legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY,
    });
    expect(String(options.idempotencyKey)).toContain(sessionId);
  });

  it("stand-in Stripe: signed 2026-09-30 webhooks provision exactly one paid tenant; duplicates and live-mode events change nothing", async () => {
    world.subscription = subscription2026();
    const created = await deliver("customer.subscription.created", subscription2026(), base);
    expect(created.processed?.status).toBe("processed");
    const paid = await deliver("invoice.paid", invoice2026(), base + 2);
    expect(paid.processed?.status).toBe("processed");
    const completed = await deliver(
      "checkout.session.completed",
      {
        id: ids.checkout,
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        amount_total: 7900,
        currency: "usd",
        customer: ids.customer,
        subscription: ids.subscription,
        client_reference_id: sessionId,
        metadata: { legacyDayforgeOnboardingSessionId: sessionId, legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY },
      },
      base + 3
    );
    expect(completed.processed?.status).toBe("processed");
    // invoice.paid found its subscription under invoice.parent.subscription_details
    expect(world.retrieved).toEqual([ids.subscription, ids.subscription, ids.subscription]);

    // the same signed bytes again: the event-id gate ignores them
    const replay = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(completed.payload!),
      signature: completed.signature!,
      stripe: standIn,
    });
    expect(replay).toMatchObject({ status: "ignored", reason: "duplicate_event" });
    // a live-mode event is refused at the route's screen, before any provisioning
    const live = await deliver("checkout.session.completed", { id: "cs_live_refused", object: "checkout.session" }, base + 4, true);
    expect(live.processed).toBeNull();
    expect(live.screened).toMatchObject({ proceed: false, httpStatus: 200, body: { status: "ignored", reason: "live_mode_refused" } });

    const [sessions] = await db.execute<RowDataPacket[]>(
      "SELECT tenantId, status FROM dayforge_saas_onboarding_sessions WHERE id = ?",
      [sessionId]
    );
    tenantId = String(sessions[0]?.tenantId ?? "");
    expect(tenantId).toMatch(/^df_[0-9a-f]{24}$/);
    expect(sessions[0]?.status).toBe("provisioned");
    const [tenants] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count, MAX(slug) AS slug FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    expect(Number(tenants[0]?.count ?? 0)).toBe(1);
    slug = String(tenants[0]?.slug ?? "");
    const [subscriptions] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_subscriptions WHERE tenantId = ? AND stripeSubscriptionId = ?",
      [tenantId, ids.subscription]
    );
    expect(Number(subscriptions[0]?.count ?? 0)).toBe(1);
    const row = await subscriptionRow();
    expect(row).toMatchObject({
      status: "active",
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripeCustomerId: ids.customer,
      latestInvoiceId: ids.invoice,
      trialEnd: null,
      accessEndsAt: null,
    });
    expect(Boolean(row?.cancelAtPeriodEnd)).toBe(false);
    // charged at checkout: the invoice payment is recorded, and the period end comes from the subscription item
    expect(row?.lastInvoicePaidAt).not.toBeNull();
    expect(new Date(row?.currentPeriodEnd).getTime()).toBe(periodEnd * 1000);
  });

  it("stand-in Stripe: the owner sets a password, signs in, and signs in again as a returning owner", async () => {
    const activated = await activateOnboardingOwner({
      sessionId,
      resumeToken,
      name: "Test Owner",
      passwordHash: await bcrypt.hash(password, 10),
    });
    expect(activated.tenantId).toBe(tenantId);

    const first = await login();
    expect(first.status).toBe(200);
    expect(first.body.tenantId).toBe(tenantId);
    expect(first.cookie).toContain("app_session_id=");

    const returning = await login();
    expect(returning.status).toBe(200);
    expect(returning.body.tenantId).toBe(tenantId);
    expect(returning.cookie).toContain("app_session_id=");
    const [credentials] = await db.execute<RowDataPacket[]>(
      "SELECT failedLoginCount FROM dayforge_saas_user_credentials WHERE tenantId = ?",
      [tenantId]
    );
    expect(Number(credentials[0]?.failedLoginCount)).toBe(0);
  });

  it("stand-in Stripe: the billing portal opens for this tenant's customer with the configured portal and returns to settings", async () => {
    const portal = await createLegacyDayforgeBillingPortalSession({ tenantId, requestId: randomUUID(), stripe: standIn });
    expect(world.portal).toHaveLength(1);
    expect(world.portal[0]!.params).toEqual({
      customer: ids.customer,
      return_url: "https://admin.bldg.chat/dayforge-settings",
      configuration: SANDBOX_PORTAL,
    });
    expect(portal.configuration).toBe(SANDBOX_PORTAL);
    expect(portal.livemode).toBe(false);
    await expect(
      createLegacyDayforgeBillingPortalSession({
        tenantId,
        requestId: randomUUID(),
        requestedCustomerId: "cus_someone_else",
        stripe: standIn,
      })
    ).rejects.toThrow(/Cross-tenant/);
  });

  it("stand-in Stripe: cancel at period end keeps access; the subscription ending at period end closes it", async () => {
    world.subscription = subscription2026({ cancel_at_period_end: true, cancel_at: periodEnd, canceled_at: base + 100 });
    const scheduled = await deliver("customer.subscription.updated", world.subscription, base + 100);
    expect(scheduled.processed?.status).toBe("processed");
    let row = await subscriptionRow();
    expect(row?.status).toBe("active");
    expect(Boolean(row?.cancelAtPeriodEnd)).toBe(true);
    expect(row?.accessEndsAt).toBeNull();
    const stillIn = await login();
    expect(stillIn.status).toBe(200);
    expect(stillIn.body.tenantId).toBe(tenantId);

    // Stripe ends the subscription at period end (here: the next event, standing in for that moment)
    const ended = subscription2026({ status: "canceled", cancel_at_period_end: true, cancel_at: periodEnd, canceled_at: base + 100, ended_at: base + 200 });
    const deleted = await deliver("customer.subscription.deleted", ended, base + 200);
    expect(deleted.processed?.status).toBe("processed");
    row = await subscriptionRow();
    expect(row?.status).toBe("canceled");
    expect(new Date(row?.accessEndsAt).getTime()).toBe((base + 200) * 1000);
    const [tenants] = await db.execute<RowDataPacket[]>("SELECT status FROM dayforge_saas_tenants WHERE id = ?", [tenantId]);
    expect(tenants[0]?.status).toBe("canceled");

    const refused = await login();
    expect([401, 403]).toContain(refused.status);
    expect(refused.body.tenantId).toBeUndefined();
    expect(refused.cookie).toBeNull();
  });
});
