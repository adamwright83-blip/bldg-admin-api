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
  checkoutTrialPeriodDays,
  JOYSTICK_ANNUAL_PLAN_KEY,
  JOYSTICK_ANNUAL_TRIAL_DAYS,
  JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS,
  JOYSTICK_MONTHLY_PLAN_KEY,
  JOYSTICK_MONTHLY_TRIAL_DAYS,
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
  portalConfiguration: process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID,
};

afterEach(() => {
  restore("DAYFORGE_STRIPE_PRICE_ID", originalEnv.priceId);
  restore("DAYFORGE_STRIPE_PLAN_KEY", originalEnv.planKey);
  restore("DAYFORGE_STRIPE_TRIAL_DAYS", originalEnv.trialDays);
  restore("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET", originalEnv.webhook);
  restore("DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID", originalEnv.portalConfiguration);
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
  it("advertises $79 a month with no trial and keeps the annual offer at 46800 cents with its seven days", () => {
    expect(JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS).toBe(46800);
    expect(JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS).toBe(7900);
    expect(JOYSTICK_MONTHLY_TRIAL_DAYS).toBe(0);
    expect(JOYSTICK_ANNUAL_TRIAL_DAYS).toBe(7);
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

  it("accepts the monthly and annual advertised prices and rejects a stale price or the wrong trial", () => {
    expect(
      checkAdvertisedStripePrice({
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        trialDays: 0,
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

    // the retired monthly contract: a seven-day trial no longer matches the advertised offer
    const oldTrial = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 7,
      configuredPriceId: "price_monthly_test",
      price: monthlyPrice(),
    });
    expect(oldTrial.ok).toBe(false);
    if (!oldTrial.ok) {
      expect(oldTrial.code).toBe("trial_days");
      expect(oldTrial.reason).toContain("expected 0");
    }
    const oldPrice = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 0,
      configuredPriceId: "price_monthly_test",
      price: monthlyPrice({ unit_amount: 4900 }),
    });
    expect(oldPrice.ok).toBe(false);
    if (!oldPrice.ok) {
      expect(oldPrice.code).toBe("price_mismatch");
      expect(oldPrice.reason).toContain("expected 7900");
    }
    const annualWithoutTrial = checkAdvertisedStripePrice({
      planKey: JOYSTICK_ANNUAL_PLAN_KEY,
      trialDays: 0,
      configuredPriceId: "price_annual_test",
      price: annualPrice(),
    });
    expect(annualWithoutTrial.ok).toBe(false);
    if (!annualWithoutTrial.ok) expect(annualWithoutTrial.code).toBe("trial_days");

    const inactive = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 0,
      configuredPriceId: "price_monthly_test",
      price: monthlyPrice({ active: false }),
    });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.code).toBe("stale_price");

    const swapped = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 0,
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

  it("syncs an advertised plan from the environment only with that plan's advertised trial", async () => {
    // monthly: no trial; the retired seven days is refused
    expect(advertisedPlanEnvSyncAllowed(JOYSTICK_MONTHLY_PLAN_KEY, 0)).toBe(true);
    expect(advertisedPlanEnvSyncAllowed(JOYSTICK_MONTHLY_PLAN_KEY, 7)).toBe(false);
    // annual keeps its seven days; an unset trial (falls back to zero) is refused
    expect(advertisedPlanEnvSyncAllowed(JOYSTICK_ANNUAL_PLAN_KEY, 7)).toBe(true);
    expect(advertisedPlanEnvSyncAllowed(JOYSTICK_ANNUAL_PLAN_KEY, 0)).toBe(false);
    expect(advertisedPlanEnvSyncAllowed("growth-exam", 0)).toBe(true);
    expect(advertisedPlanEnvSyncAllowed("growth-exam", 9)).toBe(true);
    // refused before any database write (this unit run has no database)
    process.env.DAYFORGE_STRIPE_PRICE_ID = "price_should_not_sync";
    process.env.DAYFORGE_STRIPE_PLAN_KEY = JOYSTICK_MONTHLY_PLAN_KEY;
    process.env.DAYFORGE_STRIPE_TRIAL_DAYS = "7";
    await expect(syncConfiguredSaasPlan()).resolves.toBeUndefined();
    process.env.DAYFORGE_STRIPE_PLAN_KEY = JOYSTICK_ANNUAL_PLAN_KEY;
    delete process.env.DAYFORGE_STRIPE_TRIAL_DAYS;
    await expect(syncConfiguredSaasPlan()).resolves.toBeUndefined();
  });

  it("gives Checkout no trial for advertised monthly, seven days for annual, and the row's trial otherwise", () => {
    expect(checkoutTrialPeriodDays({ planKey: JOYSTICK_MONTHLY_PLAN_KEY, trialDays: 0 })).toBe(0);
    // even a stale row cannot put a trial back on the advertised monthly offer
    expect(checkoutTrialPeriodDays({ planKey: JOYSTICK_MONTHLY_PLAN_KEY, trialDays: 7 })).toBe(0);
    expect(checkoutTrialPeriodDays({ planKey: JOYSTICK_ANNUAL_PLAN_KEY, trialDays: 7 })).toBe(7);
    expect(checkoutTrialPeriodDays({ planKey: "growth-exam", trialDays: 9 })).toBe(9);
    expect(checkoutTrialPeriodDays({ planKey: "growth-exam", trialDays: 0 })).toBe(0);
  });

  it("does not count a refund as revenue", () => {
    expect(
      recognizedSubscriptionRevenueCents({
        amountPaidCents: 7900,
        amountRefundedCents: 7900,
      })
    ).toBe(0);
    expect(
      recognizedSubscriptionRevenueCents({
        amountPaidCents: 7900,
        amountRefundedCents: 1000,
      })
    ).toBe(6900);
    expect(
      revenueCentsForBillingEvent({
        type: "charge.refunded",
        data: { object: { amount: 7900, amount_refunded: 7900 } },
      })
    ).toBe(0);
    expect(
      revenueCentsForBillingEvent({
        type: "invoice.paid",
        data: { object: { amount_paid: 7900, amount_refunded: 0 } },
      })
    ).toBe(7900);
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

  it("refuses the retired seven-day monthly trial before creating a Checkout session", async () => {
    const stripe = checkoutStripe();
    await preparePlan({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripePriceId: "price_monthly_test",
      trialDays: 7,
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

  it("refuses a monthly price that is not 7900 usd cents (the old $49 included) and any monthly trial", async () => {
    const stripe = checkoutStripe();
    await preparePlan({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripePriceId: "price_monthly_test",
      trialDays: 0,
    });
    stripe.prices.retrieve.mockResolvedValue(monthlyPrice({ unit_amount: 4900 }));
    await expect(
      createLegacyDayforgeSubscriptionCheckout({
        sessionId: "11111111-1111-4111-8111-111111111111",
        resumeToken: "resume-token",
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        requestId: "req-checkout-monthly-mismatch",
        stripe: stripe as never,
      })
    ).rejects.toMatchObject({
      name: "JoystickCheckoutClosedError",
      code: "price_mismatch",
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();

    await preparePlan({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripePriceId: "price_monthly_test",
      trialDays: 14,
    });
    await expect(
      createLegacyDayforgeSubscriptionCheckout({
        sessionId: "11111111-1111-4111-8111-111111111111",
        resumeToken: "resume-token",
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        requestId: "req-checkout-trial-mismatch",
        stripe: stripe as never,
      })
    ).rejects.toMatchObject({
      name: "JoystickCheckoutClosedError",
      code: "trial_days",
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS).toBe(7900);
    expect(JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS).toBe(46800);
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

  it("opens monthly checkout only for the verified 7900 usd month price, card at signup, charged at checkout (no trial)", async () => {
    const stripe = checkoutStripe();
    await preparePlan({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripePriceId: "price_monthly_test",
      trialDays: 0,
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
        mode: "subscription",
      }),
      expect.any(Object)
    );
    const params = stripe.checkout.sessions.create.mock.calls[0]?.[0] as unknown as {
      subscription_data: Record<string, unknown>;
    };
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params.subscription_data).toMatchObject({
      metadata: { legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY },
    });
  });

  it("opens annual checkout with the seven-day trial it was published with", async () => {
    const stripe = checkoutStripe();
    await preparePlan({
      planKey: JOYSTICK_ANNUAL_PLAN_KEY,
      stripePriceId: "price_annual_test",
      trialDays: 7,
    });
    stripe.prices.retrieve.mockResolvedValue(annualPrice());
    await createLegacyDayforgeSubscriptionCheckout({
      sessionId: "11111111-1111-4111-8111-111111111111",
      resumeToken: "resume-token",
      planKey: JOYSTICK_ANNUAL_PLAN_KEY,
      requestId: "req-checkout-annual",
      stripe: stripe as never,
    });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_annual_test", quantity: 1 }],
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
      trialDays: 0,
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
          amount: 7900,
          amount_refunded: 7900,
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
          amount_paid: 7900,
          amount_refunded: 7900,
          post_payment_credit_notes_amount: 0,
          // a payload rendered before 2025-03-31.basil: top-level subscription is still read
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

    delete process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID;
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
    // no configured portal: Stripe's default configuration, no configuration param at all
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("configuration");
  });

  it("opens the billing portal with the configured portal configuration and refuses a malformed one", async () => {
    vi.mocked(getStripeCustomerForTenant).mockResolvedValue("cus_a");
    const create = vi.fn(async (params: Record<string, unknown>) => ({
      url: "https://billing.stripe.com/p/session/test_portal",
      configuration: params.configuration,
      livemode: false,
    }));
    const stripe = { billingPortal: { sessions: { create } } };
    process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID = "bpc_1UWX6fDygmVPA3tjqzUEn5uD";
    const portal = await createLegacyDayforgeBillingPortal({
      tenantId: "tenant-a",
      requestId: "req-portal-2",
      stripe: stripe as never,
    });
    expect(portal).toEqual({ url: "https://billing.stripe.com/p/session/test_portal" });
    expect(create).toHaveBeenCalledWith(
      {
        customer: "cus_a",
        return_url: "https://admin.bldg.chat/dayforge-settings",
        configuration: "bpc_1UWX6fDygmVPA3tjqzUEn5uD",
      },
      { idempotencyKey: "dayforge:portal:tenant-a:req-portal-2" }
    );

    process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID = "prod_not_a_portal";
    create.mockClear();
    await expect(
      createLegacyDayforgeBillingPortal({
        tenantId: "tenant-a",
        requestId: "req-portal-3",
        stripe: stripe as never,
      })
    ).rejects.toThrow(/portal configuration id/);
    expect(create).not.toHaveBeenCalled();
  });
});
