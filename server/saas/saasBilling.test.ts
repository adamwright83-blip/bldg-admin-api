import { afterEach, describe, expect, it } from "vitest";
import { processDayforgeBillingWebhook } from "./saasBilling";

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
      processDayforgeBillingWebhook({
        rawBody: Buffer.from("{}"),
        signature: "bad",
        stripe: stripe as never,
      })
    ).resolves.toEqual({ status: "failed", reason: "invalid_signature" });
  });
});
