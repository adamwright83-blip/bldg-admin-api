/* LEGACY DAYFORGE COMPATIBILITY: retained historical billing literals only; canonical product is JOYSTICK. */
import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

vi.mock("./saasStore", async () => {
  const actual = await vi.importActual<typeof import("./saasStore")>("./saasStore");
  return {
    ...actual,
    requireOnboardingSession: vi.fn(),
    getActiveSaasPlan: vi.fn(),
    assertSaasPlanCanCheckout: vi.fn(),
    reserveOnboardingCheckout: vi.fn(),
    reserveSaasCheckoutSlot: vi.fn(),
    attachCheckoutToOnboarding: vi.fn(),
    getStripeCustomerForTenant: vi.fn(),
    reserveBillingEvent: vi.fn(),
    finishBillingEvent: vi.fn(),
    provisionTenantFromSubscription: vi.fn(),
    expireOnboardingCheckout: vi.fn(),
  };
});

import {
  createLegacyDayforgeBillingPortal,
  createLegacyDayforgeSubscriptionCheckout,
  processLegacyDayforgeBillingWebhook,
} from "./saasBilling";
import {
  advertisedPlanEnvSyncAllowed,
  checkAdvertisedStripePrice,
  JOYSTICK_ANNUAL_PLAN_KEY,
  JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS,
  JOYSTICK_MONTHLY_PLAN_KEY,
  JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
  JoystickCheckoutClosedError,
  recognizedSubscriptionRevenueCents,
  resolveConfiguredAnnualPriceId,
  revenueCentsForBillingEvent,
} from "./joystickStripeOffer";
import { syncConfiguredSaasPlan } from "./saasStore";
import {
  assertSaasPlanCanCheckout,
  attachCheckoutToOnboarding,
  finishBillingEvent,
  getActiveSaasPlan,
  getStripeCustomerForTenant,
  provisionTenantFromSubscription,
  requireOnboardingSession,
  reserveBillingEvent,
  reserveOnboardingCheckout,
  reserveSaasCheckoutSlot,
} from "./saasStore";

const originalEnv = {
  priceId: process.env.DAYFORGE_STRIPE_PRICE_ID,
  planKey: process.env.DAYFORGE_STRIPE_PLAN_KEY,
  trialDays: process.env.DAYFORGE_STRIPE_TRIAL_DAYS,
  webhook: process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET,
};

afterEach(() => {
  restore("DAYFORGE_STRIPE_PRICE_ID", originalEnv.priceId);
  restore("DAYFORGE_STRIPE_PLAN_KEY", originalEnv.planKey);
  restore("DAYFORGE_STRIPE_TRIAL_DAYS", originalEnv.trialDays);
  restore("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET", originalEnv.webhook);
  vi.clearAllMocks();
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function monthlyPrice(overrides: Record<string, unknown> = {}) {
  return {
    id: "price_monthly_test",
    active: true,
    unit_amount: JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
    currency: "usd",
    recurring: { interval: "month" },
    ...overrides,
  };
}

function annualPrice(overrides: Record<string, unknown> = {}) {
  return {
    id: "price_annual_test",
    active: true,
    unit_amount: JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS,
    currency: "usd",
    recurring: { interval: "year" },
    ...overrides,
  };
}

describe("JOYSTICK advertised Stripe offer", () => {
  it("keeps the annual offer at 46800 cents", () => {
    expect(JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS).toBe(46800);
    expect(JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS).toBe(4900);
    const rejected = checkAdvertisedStripePrice({
      planKey: JOYSTICK_ANNUAL_PLAN_KEY,
      trialDays: 7,
      configuredPriceId: "price_annual_test",
      price: annualPrice({ unit_amount: 49000 }),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe("price_mismatch");
      expect(rejected.reason).toContain("expected 46800");
      expect(rejected.reason).toContain("amount=49000");
    }
  });

  it("accepts the monthly and annual advertised prices and rejects a stale or zero-trial price", () => {
    expect(
      checkAdvertisedStripePrice({
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        trialDays: 7,
        configuredPriceId: "price_monthly_test",
        price: monthlyPrice(),
      }).ok
    ).toBe(true);
    expect(
      checkAdvertisedStripePrice({
        planKey: JOYSTICK_ANNUAL_PLAN_KEY,
        trialDays: 7,
        configuredPriceId: "price_annual_test",
        price: annualPrice(),
      }).ok
    ).toBe(true);

    const zeroTrial = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 0,
      configuredPriceId: "price_monthly_test",
      price: monthlyPrice(),
    });
    expect(zeroTrial.ok).toBe(false);
    if (!zeroTrial.ok) expect(zeroTrial.code).toBe("trial_days");

    const inactive = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 7,
      configuredPriceId: "price_monthly_test",
      price: monthlyPrice({ active: false }),
    });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.code).toBe("stale_price");

    const swapped = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 7,
      configuredPriceId: "price_monthly_test",
      price: monthlyPrice({ id: "price_old" }),
    });
    expect(swapped.ok).toBe(false);
    if (!swapped.ok) expect(swapped.code).toBe("stale_price");
  });

  it("treats a missing annual price as unconfigured and a mismatched pair as a conflict", () => {
    expect(
      resolveConfiguredAnnualPriceId({ planPriceId: null, envPriceId: "  " })
    ).toEqual({ status: "absent" });
    expect(
      resolveConfiguredAnnualPriceId({
        planPriceId: "price_annual_test",
        envPriceId: "price_annual_test",
      })
    ).toEqual({ status: "configured", priceId: "price_annual_test" });
    const conflict = resolveConfiguredAnnualPriceId({
      planPriceId: "price_annual_row",
      envPriceId: "price_annual_env",
    });
    expect(conflict.status).toBe("conflict");
  });

  it("does not sync an advertised plan when the env trial would fall back to zero", async () => {
    expect(advertisedPlanEnvSyncAllowed(JOYSTICK_MONTHLY_PLAN_KEY, 0)).toBe(false);
    expect(advertisedPlanEnvSyncAllowed(JOYSTICK_MONTHLY_PLAN_KEY, 7)).toBe(true);
    expect(advertisedPlanEnvSyncAllowed("growth-exam", 0)).toBe(true);
    process.env.DAYFORGE_STRIPE_PRICE_ID = "price_should_not_sync";
    process.env.DAYFORGE_STRIPE_PLAN_KEY = JOYSTICK_MONTHLY_PLAN_KEY;
    delete process.env.DAYFORGE_STRIPE_TRIAL_DAYS;
    await expect(syncConfiguredSaasPlan()).resolves.toBeUndefined();
  });

  it("does not count a refund as revenue", () => {
    expect(
      recognizedSubscriptionRevenueCents({
        amountPaidCents: 4900,
        amountRefundedCents: 4900,
      })
    ).toBe(0);
    expect(
      recognizedSubscriptionRevenueCents({
        amountPaidCents: 4900,
        amountRefundedCents: 1000,
      })
    ).toBe(3900);
    expect(
      revenueCentsForBillingEvent({
        type: "charge.refunded",
        data: { object: { amount: 4900, amount_refunded: 4900 } },
      })
    ).toBe(0);
    expect(
      revenueCentsForBillingEvent({
        type: "invoice.paid",
        data: { object: { amount_paid: 4900, amount_refunded: 0 } },
      })
    ).toBe(4900);
  });
});

describe("JOYSTICK public checkout fail-closed", () => {
  function onboarding(overrides: Record<string, unknown> = {}) {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      ownerEmail: "owner@example.invalid",
      onboardingMode: "joystick_generic",
      stripeCheckoutSessionId: null,
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      checkoutRequestId: "req-checkout-1",
      ...overrides,
    };
  }

  function checkoutStripe() {
    return {
      prices: { retrieve: vi.fn() },
      checkout: {
        sessions: {
          create: vi.fn(async () => ({
            id: "cs_new",
            url: "https://checkout.example/new",
          })),
          retrieve: vi.fn(),
        },
      },
    };
  }

  async function preparePlan(plan: {
    planKey: string;
    stripePriceId: string;
    trialDays: number;
  }) {
    vi.mocked(requireOnboardingSession).mockResolvedValue(onboarding({ planKey: plan.planKey }) as never);
    vi.mocked(getActiveSaasPlan).mockResolvedValue(plan as never);
    vi.mocked(reserveOnboardingCheckout).mockResolvedValue(onboarding({ planKey: plan.planKey }) as never);
    vi.mocked(assertSaasPlanCanCheckout).mockResolvedValue(plan as never);
    vi.mocked(reserveSaasCheckoutSlot).mockResolvedValue({} as never);
    vi.mocked(attachCheckoutToOnboarding).mockResolvedValue({} as never);
  }

  it("refuses a zero-day trial before creating a Checkout session", async () => {
    const stripe = checkoutStripe();
    await preparePlan({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripePriceId: "price_monthly_test",
      trialDays: 0,
    });
    await expect(
      createLegacyDayforgeSubscriptionCheckout({
        sessionId: "11111111-1111-4111-8111-111111111111",
        resumeToken: "resume-token",
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        requestId: "req-checkout-1",
        stripe: stripe as never,
      })
    ).rejects.toMatchObject({
      name: "JoystickCheckoutClosedError",
      code: "trial_days",
    });
    expect(stripe.prices.retrieve).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("refuses an unverified, stale, or non-advertised annual amount", async () => {
    const stripe = checkoutStripe();
    await preparePlan({
      planKey: JOYSTICK_ANNUAL_PLAN_KEY,
      stripePriceId: "price_annual_test",
      trialDays: 7,
    });
    stripe.prices.retrieve.mockResolvedValue(annualPrice({ unit_amount: 49000 }));
    await expect(
      createLegacyDayforgeSubscriptionCheckout({
        sessionId: "11111111-1111-4111-8111-111111111111",
        resumeToken: "resume-token",
        planKey: JOYSTICK_ANNUAL_PLAN_KEY,
        requestId: "req-checkout-1",
        stripe: stripe as never,
      })
    ).rejects.toBeInstanceOf(JoystickCheckoutClosedError);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();

    stripe.prices.retrieve.mockRejectedValue(new Error("missing price"));
    await expect(
      createLegacyDayforgeSubscriptionCheckout({
        sessionId: "11111111-1111-4111-8111-111111111111",
        resumeToken: "resume-token",
        planKey: JOYSTICK_ANNUAL_PLAN_KEY,
        requestId: "req-checkout-1",
        stripe: stripe as never,
      })
    ).rejects.toMatchObject({ code: "price_unverified" });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("opens monthly checkout only for the verified 4900 usd month price with a card and a seven-day trial", async () => {
    const stripe = checkoutStripe();
    await preparePlan({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripePriceId: "price_monthly_test",
      trialDays: 7,
    });
    stripe.prices.retrieve.mockResolvedValue(monthlyPrice());
    const checkout = await createLegacyDayforgeSubscriptionCheckout({
      sessionId: "11111111-1111-4111-8111-111111111111",
      resumeToken: "resume-token",
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      requestId: "req-checkout-1",
      stripe: stripe as never,
    });
    expect(checkout).toEqual({ id: "cs_new", url: "https://checkout.example/new" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_monthly_test", quantity: 1 }],
        payment_method_collection: "always",
        payment_method_types: ["card"],
        subscription_data: expect.objectContaining({ trial_period_days: 7 }),
      }),
      expect.any(Object)
    );
  });

  it("does not reuse a checkout session whose price no longer matches the plan", async () => {
    const stripe = checkoutStripe();
    const plan = {
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripePriceId: "price_monthly_test",
      trialDays: 7,
    };
    vi.mocked(requireOnboardingSession).mockResolvedValue(
      onboarding({ stripeCheckoutSessionId: "cs_old" }) as never
    );
    vi.mocked(assertSaasPlanCanCheckout).mockResolvedValue(plan as never);
    stripe.prices.retrieve.mockResolvedValue(monthlyPrice());
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_old",
      url: "https://checkout.example/old",
      line_items: { data: [{ price: { id: "price_old" } }] },
    });
    await expect(
      createLegacyDayforgeSubscriptionCheckout({
        sessionId: "11111111-1111-4111-8111-111111111111",
        resumeToken: "resume-token",
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        requestId: "req-checkout-1",
        stripe: stripe as never,
      })
    ).rejects.toMatchObject({ code: "stale_price" });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("JOYSTICK billing webhook and portal guards", () => {
  it("accepts a locally signed webhook and ignores a duplicate before provisioning a tenant", async () => {
    const stripe = new Stripe("sk_test_no_api_calls", {
      apiVersion: "2025-03-31.basil" as never,
    });
    const secret = "whsec_local_hmac_test_only";
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = secret;
    const payload = JSON.stringify({
      id: "evt_duplicate_guard",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      created: 1700000000,
      data: { object: { id: "cs_test_local", object: "checkout.session" } },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, signature, secret).id).toBe(
      "evt_duplicate_guard"
    );
    vi.mocked(reserveBillingEvent).mockResolvedValue(false);
    const duplicate = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(payload),
      signature,
      stripe,
    });
    expect(duplicate).toMatchObject({ status: "ignored", reason: "duplicate_event" });
    expect(provisionTenantFromSubscription).not.toHaveBeenCalled();
    expect(finishBillingEvent).not.toHaveBeenCalled();
  });

  it("records a refund webhook as non-revenue and does not provision a tenant", async () => {
    const stripe = new Stripe("sk_test_no_api_calls", {
      apiVersion: "2025-03-31.basil" as never,
    });
    const secret = "whsec_local_hmac_test_only";
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = secret;
    const payload = JSON.stringify({
      id: "evt_refund_guard",
      object: "event",
      type: "charge.refunded",
      livemode: false,
      created: 1700000000,
      data: {
        object: {
          id: "ch_refunded",
          object: "charge",
          amount: 4900,
          amount_refunded: 4900,
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    vi.mocked(reserveBillingEvent).mockResolvedValue(true);
    vi.mocked(finishBillingEvent).mockResolvedValue(undefined as never);
    const result = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(payload),
      signature,
      stripe,
    });
    expect(result).toMatchObject({
      status: "ignored",
      reason: "refund_not_revenue",
      stripeEventId: "evt_refund_guard",
    });
    expect(provisionTenantFromSubscription).not.toHaveBeenCalled();
  });

  it("does not stamp a fully refunded invoice as paid revenue", async () => {
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_local_hmac_test_only";
    const subscription = {
      id: "sub_refunded_invoice",
      customer: "cus_tenant_a",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: 1_700_086_400,
      trial_end: null,
      latest_invoice: "in_refunded",
      metadata: {
        legacyDayforgeOnboardingSessionId: "session-1",
        legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY,
      },
    };
    const event = {
      id: "evt_invoice_refunded",
      type: "invoice.paid",
      livemode: false,
      created: 1_700_000_000,
      data: {
        object: {
          id: "in_refunded",
          object: "invoice",
          amount_paid: 4900,
          amount_refunded: 4900,
          post_payment_credit_notes_amount: 0,
          subscription: subscription.id,
        },
      },
    };
    vi.mocked(reserveBillingEvent).mockResolvedValue(true);
    vi.mocked(finishBillingEvent).mockResolvedValue(undefined as never);
    vi.mocked(provisionTenantFromSubscription).mockResolvedValue({
      tenantId: "tenant-a",
    } as never);
    const stripe = {
      webhooks: { constructEvent: () => event },
      subscriptions: { retrieve: async () => subscription },
    };
    const result = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(JSON.stringify(event)),
      signature: "signed-by-test-double",
      stripe: stripe as never,
    });
    expect(result.status).toBe("processed");
    const provisioned = vi.mocked(provisionTenantFromSubscription).mock.calls[0]?.[0];
    expect(provisioned?.lastInvoicePaidAt).toBeUndefined();
  });

  it("refuses a billing portal session for another tenant's customer", async () => {
    vi.mocked(getStripeCustomerForTenant).mockImplementation(async (tenantId: string) => {
      if (tenantId === "tenant-a") return "cus_a";
      throw new Error("Tenant does not have a JOYSTICK subscription");
    });
    const create = vi.fn(async () => ({ url: "https://billing.example/portal" }));
    const stripe = { billingPortal: { sessions: { create } } };
    await expect(
      createLegacyDayforgeBillingPortal({
        tenantId: "tenant-a",
        requestId: "req-portal-1",
        requestedCustomerId: "cus_b",
        stripe: stripe as never,
      })
    ).rejects.toThrow("Cross-tenant billing portal access is not allowed");
    expect(create).not.toHaveBeenCalled();

    await createLegacyDayforgeBillingPortal({
      tenantId: "tenant-a",
      requestId: "req-portal-1",
      stripe: stripe as never,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_a" }),
      expect.objectContaining({
        idempotencyKey: "dayforge:portal:tenant-a:req-portal-1",
      })
    );
  });
});
