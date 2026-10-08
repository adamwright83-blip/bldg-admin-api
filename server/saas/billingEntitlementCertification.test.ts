/* LEGACY DAYFORGE COMPATIBILITY: retained historical environment/API literals only; canonical product is JOYSTICK. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SaaS Slice 5 billing and entitlement certification", () => {
  it("keeps SaaS Stripe configuration namespaced from laundry payment", () => {
    const billing = source("./saasBilling.ts");
    expect(billing).toContain("DAYFORGE_BILLING_STRIPE_SECRET_KEY");
    expect(billing).toContain("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET");
    expect(billing).not.toContain("admitNativeStripePayment");
    expect(billing).not.toContain('claimType: "payment_verified"');
    expect(billing).not.toContain("cleancloud_paid_observed");
    expect(billing).not.toContain("orders.paid");
    expect(billing).not.toContain("stripePaymentIntentId");
  });

  it("admits billing webhooks only after Stripe signature verification", () => {
    const billing = source("./saasBilling.ts");
    const webhook = billing.slice(
      billing.indexOf("export async function processLegacyDayforgeBillingWebhook")
    );
    expect(webhook).toContain("stripe.webhooks.constructEvent");
    expect(webhook.indexOf("stripe.webhooks.constructEvent")).toBeLessThan(
      webhook.indexOf("const isNew = await reserveBillingEvent")
    );
  });

  it("binds provider events through durable onboarding/subscription identity rather than tenant metadata", () => {
    const billing = source("./saasBilling.ts");
    expect(billing).toContain("legacyDayforgeOnboardingSessionId");
    expect(billing).toContain("provisionTenantFromSubscription");
    expect(billing).not.toMatch(/tenantId:\s*metadata\./);
    expect(billing).not.toContain("metadata.tenantId");
  });

  it("uses tenant-bound Stripe customer lookup for the billing portal", () => {
    const billing = source("./saasBilling.ts");
    expect(billing).toContain("getStripeCustomerForTenant(input.tenantId)");
    const store = source("./saasStore.ts");
    expect(store).toContain("getStripeCustomerForTenant");
    expect(store).toContain("legacyDayforgeSaasSubscriptions.tenantId");
  });

  it("keeps duplicate webhook delivery idempotent", () => {
    const billing = source("./saasBilling.ts");
    expect(billing).toContain("reserveBillingEvent");
    expect(billing).toContain('reason: "duplicate_event"');
    const lifecycle = source("./saasBilling.lifecycle.integration.test.ts");
    expect(lifecycle).toContain('reason: "duplicate_event"');
    expect(lifecycle).toContain("expect(Number(tenants[0]?.count ?? 0)).toBe(1)");
  });

  it("derives entitlements from SaaS subscription and plan state only", () => {
    const access = source("./tenantAccess.ts");
    expect(access).toContain("legacyDayforgeSaasSubscriptions");
    expect(access).toContain("subscriptionAllowsLegacyDayforgeAccess");
    expect(access).toContain('row.source === "plan"');
    expect(access).toContain('row.source === "manual"');
    expect(access).not.toContain("orders.paid");
    expect(access).not.toContain("payment_verified");
    expect(access).not.toContain("cleancloud");
  });

  it("does not absorb the tenantless legacy CleanCloud importer into SaaS entitlement", () => {
    const legacy = source("../integrations/cleancloud/cleancloudLegacy.ts");
    expect(legacy).not.toContain("hasTenantEntitlement");
    expect(legacy).not.toContain("legacyDayforgeSaasSubscriptions");
    expect(legacy).not.toContain('?? "default"');
  });
});
