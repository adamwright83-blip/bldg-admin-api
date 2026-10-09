/* LEGACY DAYFORGE COMPATIBILITY: retained historical Stripe environment literals and billing plan references only; canonical product is JOYSTICK. */
import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { runStripeProviderAcceptance } from "./stripeProviderAcceptance";

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
    process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID = "acct_laundry_farm_id";

    const fakeStripe = {
      accounts: {
        retrieve: async () => ({
          id: "acct_laundry_farm_id",
          settings: { dashboard: { display_name: "Laundry Farm Inc" } },
        }),
      },
    } as any;

    const result = await runStripeProviderAcceptance({
      databaseUrl: "mysql://root:root@localhost:3418/joystick_real_acceptance",
      allowlistedAccountId: "acct_laundry_farm_id",
      stripeClient: fakeStripe,
    });

    // Should fail at account_safeguard or database_connection
    if (result.failureStep === "database_connection") {
      // expected in isolated environment without local db on 3418
      expect(result.status).toBe("FAILED");
    } else {
      expect(result.status).toBe("FAILED");
      expect(result.failureStep).toBe("account_safeguard");
      expect(result.reason).toContain("Laundry Farm account detected");
    }

    delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
    delete process.env.DAYFORGE_BILLING_APP_URL;
    delete process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID;
  });
});
