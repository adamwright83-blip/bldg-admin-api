/* LEGACY DAYFORGE COMPATIBILITY: retained historical Stripe environment literals and billing plan references only; canonical product is JOYSTICK. */
import { describe, expect, it } from "vitest";
import { runStripeProviderAcceptance } from "./stripeProviderAcceptance";

describe("JOYSTICK Stripe provider acceptance test-mode gate", () => {
  it("explicitly asserts BLOCKED when Stripe test-mode configuration is missing", async () => {
    // Ensure clean test environment without external credentials
    const originalKey = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    const originalSecret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
    const originalAppUrl = process.env.DAYFORGE_BILLING_APP_URL;

    try {
      delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
      delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
      delete process.env.DAYFORGE_BILLING_APP_URL;

      const result = await runStripeProviderAcceptance();
      expect(result.status).toBe("BLOCKED");
      expect(result.missingConfig).toBeDefined();
      expect(result.missingConfig).toContain("DAYFORGE_BILLING_STRIPE_SECRET_KEY");
      expect(result.missingConfig).toContain("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET");
      expect(result.missingConfig).toContain("DAYFORGE_BILLING_APP_URL");
      expect(result.reason).toContain("Missing or invalid Stripe provider test-mode configuration");
    } finally {
      if (originalKey) process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = originalKey;
      if (originalSecret) process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = originalSecret;
      if (originalAppUrl) process.env.DAYFORGE_BILLING_APP_URL = originalAppUrl;
    }
  });

  it("rejects non-test mode keys", async () => {
    const originalKey = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    try {
      process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = "sk_live_12345678901234567890";
      process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_test";
      process.env.DAYFORGE_BILLING_APP_URL = "http://localhost:4186";

      const result = await runStripeProviderAcceptance();
      expect(result.status).toBe("BLOCKED");
      expect(result.missingConfig?.some((c) => c.includes("must be a test-mode key"))).toBe(true);
    } finally {
      delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
      delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
      delete process.env.DAYFORGE_BILLING_APP_URL;
      if (originalKey) process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = originalKey;
    }
  });
});
