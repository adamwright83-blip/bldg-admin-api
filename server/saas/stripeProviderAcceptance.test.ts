/* LEGACY DAYFORGE COMPATIBILITY: retained historical Stripe environment literals and billing plan references only; canonical product is JOYSTICK. */
import { afterEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  checkFirstChargeNoTrial,
  checkWebhookEndpoint,
  JOYSTICK_WEBHOOK_EVENT_TYPES,
  runStripeProviderAcceptance,
} from "./stripeProviderAcceptance";

const ACCEPTANCE_ENV = [
  "DAYFORGE_BILLING_STRIPE_SECRET_KEY",
  "DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET",
  "DAYFORGE_BILLING_APP_URL",
  "DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID",
  "JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID",
  "JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_SERVICE_NAME",
  "PORT",
] as const;
const savedAcceptanceEnv = Object.fromEntries(ACCEPTANCE_ENV.map(key => [key, process.env[key]]));
afterEach(() => {
  for (const key of ACCEPTANCE_ENV) {
    const value = savedAcceptanceEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configuredSandboxEnv() {
  process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = "sk_test_12345678901234567890";
  process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_12345678901234567890";
  process.env.DAYFORGE_BILLING_APP_URL = "http://localhost:4186";
  process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID = "bpc_1UWX6fDygmVPA3tjqzUEn5uD";
  process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID = "acct_test_approved";
}

describe("JOYSTICK Stripe provider acceptance test-mode gate", () => {
  it("accepts a legitimate Stripe-signed local replay and rejects fabricated signatures", () => {
    const stripe = new Stripe("sk_test_no_api_calls", { apiVersion: "2025-03-31.basil" as any });
    const secret = "whsec_local_hmac_test_only";
    const payload = JSON.stringify({
      id: "evt_genuine_signature_unit",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      created: 1700000000,
      data: { object: { id: "cs_test_local", object: "checkout.session" } },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, signature, secret).id)
      .toBe("evt_genuine_signature_unit");
    expect(() => stripe.webhooks.constructEvent(payload, "test_signed_event", secret))
      .toThrow();
    expect(() => stripe.webhooks.constructEvent(payload, signature, "whsec_wrong"))
      .toThrow();
  });

  it("explicitly asserts BLOCKED when Stripe test-mode configuration is missing", async () => {
    const originalKey = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    const originalSecret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
    const originalAppUrl = process.env.DAYFORGE_BILLING_APP_URL;
    const originalAccount = process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID;

    try {
      delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
      delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
      delete process.env.DAYFORGE_BILLING_APP_URL;
      delete process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID;

      const result = await runStripeProviderAcceptance();
      expect(result.status).toBe("BLOCKED");
      expect(result.missingConfig).toBeDefined();
      expect(result.missingConfig).toContain("DAYFORGE_BILLING_STRIPE_SECRET_KEY");
      expect(result.missingConfig).toContain("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET");
      expect(result.missingConfig).toContain("DAYFORGE_BILLING_APP_URL");
      expect(result.missingConfig).toContain(
        "JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID (must provide explicitly approved test account ID)"
      );
      expect(result.missingConfig?.some(c => c.startsWith("DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID"))).toBe(true);
      expect(result.reason).toContain("Missing or invalid Stripe provider test-mode configuration");
    } finally {
      if (originalKey) process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = originalKey;
      if (originalSecret) process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = originalSecret;
      if (originalAppUrl) process.env.DAYFORGE_BILLING_APP_URL = originalAppUrl;
      if (originalAccount) process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID = originalAccount;
    }
  });

  it("rejects non-test mode keys", async () => {
    const originalKey = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    try {
      process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = "sk_live_12345678901234567890";
      process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_test";
      process.env.DAYFORGE_BILLING_APP_URL = "http://localhost:4186";
      process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID = "acct_test123";

      const result = await runStripeProviderAcceptance();
      expect(result.status).toBe("BLOCKED");
      expect(result.missingConfig?.some((c) => c.includes("must be a test-mode key"))).toBe(true);
    } finally {
      delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
      delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
      delete process.env.DAYFORGE_BILLING_APP_URL;
      delete process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID;
      if (originalKey) process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = originalKey;
    }
  });

  it("requires explicit allowlisted Stripe account ID and rejects unsafe databases", async () => {
    process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = "sk_test_12345678901234567890";
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_12345678901234567890";
    process.env.DAYFORGE_BILLING_APP_URL = "http://localhost:4186";
    process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID = "bpc_1UWX6fDygmVPA3tjqzUEn5uD";

    // Test missing account ID
    delete process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID;
    const blockedResult = await runStripeProviderAcceptance();
    expect(blockedResult.status).toBe("BLOCKED");
    expect(blockedResult.missingConfig?.some((c) => c.includes("JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID"))).toBe(true);

    // Test safe database name check failure
    const mockDb = {
      query: async (sql: string) => {
        if (sql.includes("DATABASE()")) return [[{ name: "production_db" }]];
        return [];
      },
      end: async () => {},
    } as any;

    const fakeStripe = {
      accounts: {
        retrieve: async () => ({
          id: "acct_test_approved",
          settings: { dashboard: { display_name: "JOYSTICK Test" } },
        }),
      },
    } as any;

    process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID = "acct_test_approved";

    // Call with unapproved database URL
    const unsafeDbResult = await runStripeProviderAcceptance({
      dbConnection: mockDb,
      allowlistedAccountId: "acct_test_approved",
      stripeClient: fakeStripe,
    });
    expect(unsafeDbResult.status).toBe("FAILED");
    expect(unsafeDbResult.failureStep).toBe("database_safety_guard");
    expect(unsafeDbResult.reason).toContain("Refusing Stripe acceptance execution outside designated disposable test database");

    // Clean up
    delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
    delete process.env.DAYFORGE_BILLING_APP_URL;
    delete process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID;
  });

  it("rejects Laundry Farm account detected during retrieval", async () => {
    process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = "sk_test_12345678901234567890";
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_12345678901234567890";
    process.env.DAYFORGE_BILLING_APP_URL = "http://localhost:4186";
    process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID = "bpc_1UWX6fDygmVPA3tjqzUEn5uD";
    process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID = "acct_laundry_farm_id";

    const fakeStripe = {
      accounts: {
        retrieve: async () => ({
          id: "acct_laundry_farm_id",
          settings: { dashboard: { display_name: "Laundry Farm Inc" } },
        }),
      },
    } as any;

    const mockDb = {
      query: async (sql: string) => {
        if (sql.includes("DATABASE()")) return [[{ name: "joystick_stripe_acceptance" }]];
        throw new Error("No onboarding or billing query may execute with injected clients");
      },
      end: async () => {},
    } as any;

    const result = await runStripeProviderAcceptance({
      dbConnection: mockDb,
      allowlistedAccountId: "acct_laundry_farm_id",
      stripeClient: fakeStripe,
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureStep).toBe("account_safeguard");
    expect(result.reason).toContain("Laundry Farm account detected");

    delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
    delete process.env.DAYFORGE_BILLING_APP_URL;
    delete process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID;
  });

  it("refuses restricted live keys and keys that are not sk_test_, before any Stripe call", async () => {
    for (const key of [`rk_live_${"z".repeat(24)}`, `rk_test_${"z".repeat(24)}`, `pk_test_${"z".repeat(24)}`, "sk_test_short"]) {
      configuredSandboxEnv();
      process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = key;
      const result = await runStripeProviderAcceptance({
        stripeClient: { accounts: { retrieve: async () => { throw new Error("no Stripe call may happen"); } } } as never,
      });
      expect(result.status).toBe("BLOCKED");
      expect(result.missingConfig?.some(c => c.includes("must be a test-mode key"))).toBe(true);
    }
  });

  it("blocks the Railway sandbox target until the webhook endpoint id is given, and refuses it outside Railway", async () => {
    configuredSandboxEnv();
    delete process.env.DAYFORGE_BILLING_APP_URL; // not needed on Railway: checkout returns to the deployed default
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.RAILWAY_SERVICE_NAME;
    const blocked = await runStripeProviderAcceptance({ target: "railway_sandbox" });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.missingConfig).toEqual(["JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID (the sandbox webhook endpoint, we_...)"]);

    process.env.JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID = "we_1UWXCnDygmVPA3tjb1GakMBW";
    const outside = await runStripeProviderAcceptance({ target: "railway_sandbox" });
    expect(outside).toMatchObject({ status: "FAILED", failureStep: "railway_target_guard" });
    expect(outside.reason).toContain("railway ssh --service bldg-admin-api");
  });

  it("on Railway accepts the deployed database, logs in over the app's loopback port, and never runs on injected adapters", async () => {
    configuredSandboxEnv();
    delete process.env.DAYFORGE_BILLING_APP_URL;
    process.env.JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID = "we_1UWXCnDygmVPA3tjb1GakMBW";
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    delete process.env.PORT;
    const noPort = await runStripeProviderAcceptance({
      target: "railway_sandbox",
      dbConnection: { query: async () => [[{ name: "railway" }]], end: async () => {} } as never,
      stripeClient: {} as never,
    });
    expect(noPort).toMatchObject({ status: "FAILED", failureStep: "app_origin_guard" });

    process.env.PORT = "8080";
    const queries: string[] = [];
    const result = await runStripeProviderAcceptance({
      target: "railway_sandbox",
      dbConnection: {
        query: async (sql: string) => {
          queries.push(sql);
          if (sql.includes("DATABASE()")) return [[{ name: "railway" }]];
          throw new Error("No onboarding or billing query may execute with injected clients");
        },
        end: async () => {},
      } as never,
      stripeClient: {
        accounts: { retrieve: async () => ({ id: "acct_test_approved", settings: { dashboard: { display_name: "JOYSTICK Sandbox" } } }) },
      } as never,
    });
    expect(result).toMatchObject({ status: "FAILED", failureStep: "injected_dependencies" });
    expect(queries).toEqual(["SELECT DATABASE() AS name"]);
  });
});

describe("the sandbox contract the real run checks", () => {
  const endpoint = {
    id: "we_1UWXCnDygmVPA3tjb1GakMBW",
    livemode: false,
    status: "enabled",
    url: "https://admin.bldg.chat/api/dayforge/billing/stripe-webhook",
    api_version: "2026-09-30",
    enabled_events: [...JOYSTICK_WEBHOOK_EVENT_TYPES],
  };

  it("accepts the sandbox endpoint on 2026-09-30 delivering every handled event to the billing route", () => {
    expect(checkWebhookEndpoint(endpoint)).toBeNull();
    expect(checkWebhookEndpoint({ ...endpoint, api_version: "2026-09-30.release", enabled_events: ["*"] })).toBeNull();
  });

  it("refuses a live, disabled, misrouted, differently versioned or under-subscribed endpoint", () => {
    expect(checkWebhookEndpoint({ ...endpoint, livemode: true })?.failureStep).toBe("webhook_endpoint_mode");
    expect(checkWebhookEndpoint({ ...endpoint, status: "disabled" })?.failureStep).toBe("webhook_endpoint_status");
    expect(checkWebhookEndpoint({ ...endpoint, url: "https://admin.bldg.chat/api/stripe/webhook" })?.failureStep).toBe("webhook_endpoint_url");
    expect(checkWebhookEndpoint({ ...endpoint, api_version: "2025-03-31.basil" })?.failureStep).toBe("webhook_endpoint_api_version");
    expect(checkWebhookEndpoint({ ...endpoint, api_version: null })?.failureStep).toBe("webhook_endpoint_api_version");
    const missing = checkWebhookEndpoint({ ...endpoint, enabled_events: ["checkout.session.completed", "invoice.paid"] });
    expect(missing?.failureStep).toBe("webhook_endpoint_events");
    expect(missing?.reason).toContain("customer.subscription.deleted");
  });

  const paid = {
    planPriceId: "price_1UWX4RDygmVPA3tjPx1S5NMD",
    session: { livemode: false, mode: "subscription", payment_status: "paid", amount_total: 7900, currency: "usd" },
    subscription: {
      id: "sub_test",
      livemode: false,
      status: "active",
      trial_start: null,
      trial_end: null,
      default_payment_method: "pm_card_visa",
      items: { data: [{ price: { id: "price_1UWX4RDygmVPA3tjPx1S5NMD" } }] },
    },
    invoice: { id: "in_test", livemode: false, status: "paid", billing_reason: "subscription_create", amount_paid: 7900, currency: "usd" },
  };

  it("passes $79 charged on the first invoice at checkout, with no trial, in test mode", () => {
    expect(checkFirstChargeNoTrial(paid)).toBeNull();
  });

  it("fails a trial, an uncharged or wrongly charged first invoice, a wrong price, or anything in live mode", () => {
    const trialing = { ...paid, subscription: { ...paid.subscription, status: "trialing", trial_end: 1_800_000_000 } };
    expect(checkFirstChargeNoTrial(trialing)?.failureStep).toBe("subscription_status_check");
    const activeWithTrial = { ...paid, subscription: { ...paid.subscription, trial_start: 1_790_000_000, trial_end: 1_790_600_000 } };
    expect(checkFirstChargeNoTrial(activeWithTrial)?.failureStep).toBe("no_trial_check");
    expect(checkFirstChargeNoTrial({ ...paid, invoice: { ...paid.invoice, amount_paid: 0 } })?.failureStep).toBe("first_charge_check");
    expect(checkFirstChargeNoTrial({ ...paid, invoice: { ...paid.invoice, amount_paid: 4900 } })?.failureStep).toBe("first_charge_check");
    expect(checkFirstChargeNoTrial({ ...paid, invoice: null })?.failureStep).toBe("test_mode_check");
    expect(checkFirstChargeNoTrial({ ...paid, planPriceId: "price_old_49" })?.failureStep).toBe("subscription_price_check");
    expect(checkFirstChargeNoTrial({ ...paid, invoice: { ...paid.invoice, livemode: true } })?.failureStep).toBe("test_mode_check");
    expect(checkFirstChargeNoTrial({ ...paid, session: { ...paid.session, livemode: true } })?.failureStep).toBe("test_mode_check");
    expect(checkFirstChargeNoTrial({ ...paid, subscription: { ...paid.subscription, default_payment_method: null } })?.failureStep).toBe("payment_method_check");
    expect(checkFirstChargeNoTrial({ ...paid, session: { ...paid.session, amount_total: 0 } })?.failureStep).toBe("checkout_charge_check");
  });
});
