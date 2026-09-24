/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { afterEach, describe, expect, it } from "vitest";
import { processLegacyDayforgeBillingWebhook } from "./saasBilling";

const originalWebhookSecret =
  process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  if (originalWebhookSecret === undefined) {
    delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  }
});

describe("DayForge Stripe webhook boundary", () => {
  it("fails closed before database writes when the signature is invalid", async () => {
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_test";
    const stripe = {
      webhooks: {
        constructEvent() {
          throw new Error("invalid signature");
        },
      },
    };
    await expect(
      processLegacyDayforgeBillingWebhook({
        rawBody: Buffer.from("{}"),
        signature: "bad",
        stripe: stripe as never,
      })
    ).resolves.toEqual({ status: "failed", reason: "invalid_signature" });
  });
});
