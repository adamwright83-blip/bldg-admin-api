/* LEGACY DAYFORGE COMPATIBILITY: the billing metadata keys below keep their historical names; canonical product is JOYSTICK. */
import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

vi.mock("./saasStore", async () => {
  const actual = await vi.importActual<typeof import("./saasStore")>("./saasStore");
  return {
    ...actual,
    reserveBillingEvent: vi.fn(),
    finishBillingEvent: vi.fn(),
    provisionTenantFromSubscription: vi.fn(),
    expireOnboardingCheckout: vi.fn(),
  };
});

import { processLegacyDayforgeBillingWebhook } from "./saasBilling";
import { JOYSTICK_MONTHLY_PLAN_KEY } from "./joystickStripeOffer";
import { finishBillingEvent, provisionTenantFromSubscription, reserveBillingEvent } from "./saasStore";
import {
  invoiceSubscriptionId,
  subscriptionCurrentPeriodEnd,
  subscriptionScheduledToCancel,
} from "./stripeWebhookShapes";

/**
 * Payload fixtures shaped like the JOYSTICK sandbox webhook endpoint's API version (2026-09-30), per the installed
 * SDK types (stripe 20.3.1, 2026-01-28.clover): Invoice.parent.subscription_details.subscription, no top-level
 * invoice.subscription; Subscription.items.data[].current_period_end, no top-level current_period_end. The release
 * name that follows "2026-09-30" in a real api_version string could not be checked offline, so it is left out.
 */
const API_VERSION = "2026-09-30";
const SECRET = "whsec_stripe_webhook_shapes_unit_only";
const PRICE = "price_1UWX4RDygmVPA3tjPx1S5NMD";
const PRODUCT = "prod_VXcJu4mQ9O10Df";
const SUB = "sub_1StandIn2026ShapeAA";
const CUS = "cus_StandIn2026Shape";
const INV = "in_1StandIn2026ShapeAA";
const ONBOARDING = "11111111-1111-4111-8111-111111111111";
const CREATED = 1_793_000_000;
const PERIOD_END = CREATED + 30 * 86_400;

const verifier = new Stripe("sk_test_webhook_shapes_verify_only", {
  apiVersion: "2025-03-31.basil" as never,
});

function subscription2026(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB,
    object: "subscription",
    livemode: false,
    status: "active",
    customer: CUS,
    currency: "usd",
    collection_method: "charge_automatically",
    billing_mode: { type: "classic" },
    billing_cycle_anchor: CREATED,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    created: CREATED,
    start_date: CREATED,
    trial_start: null,
    trial_end: null,
    latest_invoice: INV,
    default_payment_method: "pm_card_visa_standin",
    metadata: {
      legacyDayforgeOnboardingSessionId: ONBOARDING,
      legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY,
    },
    items: {
      object: "list",
      has_more: false,
      data: [
        {
          id: "si_StandIn2026Shape",
          object: "subscription_item",
          subscription: SUB,
          quantity: 1,
          current_period_start: CREATED,
          current_period_end: PERIOD_END,
          price: {
            id: PRICE,
            object: "price",
            product: PRODUCT,
            unit_amount: 7900,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
    ...overrides,
  };
}

function invoice2026(overrides: Record<string, unknown> = {}) {
  return {
    id: INV,
    object: "invoice",
    livemode: false,
    status: "paid",
    billing_reason: "subscription_create",
    currency: "usd",
    customer: CUS,
    amount_due: 7900,
    amount_paid: 7900,
    amount_remaining: 0,
    total: 7900,
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: {
        metadata: {
          legacyDayforgeOnboardingSessionId: ONBOARDING,
          legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY,
        },
        subscription: SUB,
      },
    },
    lines: {
      object: "list",
      has_more: false,
      data: [
        {
          id: "il_StandIn2026Shape",
          object: "line_item",
          amount: 7900,
          currency: "usd",
          period: { start: CREATED, end: PERIOD_END },
          parent: {
            type: "subscription_item_details",
            invoice_item_details: null,
            subscription_item_details: {
              invoice_item: null,
              proration: false,
              proration_details: { credited_items: null },
              subscription: SUB,
              subscription_item: "si_StandIn2026Shape",
            },
          },
          pricing: {
            type: "price_details",
            price_details: { price: PRICE, product: PRODUCT },
            unit_amount_decimal: "7900",
          },
        },
      ],
    },
    ...overrides,
  };
}

function checkoutSession2026() {
  return {
    id: "cs_test_StandIn2026Shape",
    object: "checkout.session",
    livemode: false,
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    amount_total: 7900,
    currency: "usd",
    customer: CUS,
    subscription: SUB,
    client_reference_id: ONBOARDING,
    metadata: {
      legacyDayforgeOnboardingSessionId: ONBOARDING,
      legacyDayforgePlanKey: JOYSTICK_MONTHLY_PLAN_KEY,
    },
  };
}

function signed(type: string, object: unknown, created = CREATED, previous?: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: `evt_shape_${type.replace(/\W/g, "_")}_${created}`,
    object: "event",
    api_version: API_VERSION,
    created,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object, ...(previous ? { previous_attributes: previous } : {}) },
  });
  return {
    rawBody: Buffer.from(payload),
    signature: verifier.webhooks.generateTestHeaderString({ payload, secret: SECRET }),
  };
}

function standInStripe(current: unknown) {
  const retrieve = vi.fn(async (_id: string) => current);
  return { stripe: { webhooks: verifier.webhooks, subscriptions: { retrieve } }, retrieve };
}

function provisioned() {
  const call = vi.mocked(provisionTenantFromSubscription).mock.calls.at(-1)?.[0];
  if (!call) throw new Error("provisionTenantFromSubscription was not called");
  return call;
}

const originalSecret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET;
  else process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = originalSecret;
  vi.clearAllMocks();
});

function prepare() {
  process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = SECRET;
  vi.mocked(reserveBillingEvent).mockResolvedValue(true);
  vi.mocked(finishBillingEvent).mockResolvedValue(undefined as never);
  vi.mocked(provisionTenantFromSubscription).mockResolvedValue({
    tenantId: "df_shape_tenant",
    ignoredAsStale: false,
  } as never);
}

describe("reading 2026-09-30 and older Stripe shapes", () => {
  it("finds an invoice's subscription under parent.subscription_details, the old top level, or its lines", () => {
    expect(invoiceSubscriptionId(invoice2026())).toBe(SUB);
    expect(
      invoiceSubscriptionId(
        invoice2026({
          parent: {
            type: "subscription_details",
            subscription_details: { metadata: null, subscription: { id: SUB, object: "subscription" } },
          },
        })
      )
    ).toBe(SUB);
    expect(invoiceSubscriptionId({ id: INV, subscription: "sub_old_shape" })).toBe("sub_old_shape");
    expect(invoiceSubscriptionId(invoice2026({ parent: null }))).toBe(SUB);
    expect(invoiceSubscriptionId({ id: "in_one_off", parent: null, lines: { data: [] } })).toBeNull();
    expect(invoiceSubscriptionId(null)).toBeNull();
  });

  it("reads the period end from the subscription items, or the old top-level field", () => {
    expect(subscriptionCurrentPeriodEnd(subscription2026())).toBe(PERIOD_END);
    expect(subscriptionCurrentPeriodEnd({ current_period_end: 1_700_000_000 })).toBe(1_700_000_000);
    expect(
      subscriptionCurrentPeriodEnd({
        items: { data: [{ current_period_end: PERIOD_END - 10 }, { current_period_end: PERIOD_END }] },
      })
    ).toBe(PERIOD_END);
    expect(subscriptionCurrentPeriodEnd({ items: { data: [] } })).toBeNull();
    expect(subscriptionCurrentPeriodEnd({})).toBeNull();
  });

  it("treats cancel_at_period_end or a scheduled cancel_at as set to end, and nothing else", () => {
    expect(subscriptionScheduledToCancel(subscription2026())).toBe(false);
    expect(subscriptionScheduledToCancel(subscription2026({ cancel_at_period_end: true }))).toBe(true);
    expect(subscriptionScheduledToCancel(subscription2026({ cancel_at: PERIOD_END }))).toBe(true);
  });
});

describe("the billing webhook on 2026-09-30 payloads (signed with a test secret; Stripe API calls are stand-ins)", () => {
  it("checkout.session.completed: provisions from the retrieved subscription with its item period end and no trial", async () => {
    prepare();
    const { stripe, retrieve } = standInStripe(subscription2026());
    const result = await processLegacyDayforgeBillingWebhook({
      ...signed("checkout.session.completed", checkoutSession2026()),
      stripe: stripe as never,
    });
    expect(result.status).toBe("processed");
    expect(retrieve).toHaveBeenCalledWith(SUB);
    expect(provisioned()).toMatchObject({
      onboardingSessionId: ONBOARDING,
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      stripeCustomerId: CUS,
      stripeSubscriptionId: SUB,
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(PERIOD_END * 1000),
      trialEnd: null,
      latestInvoiceId: INV,
    });
    expect(provisioned()).not.toHaveProperty("accessEndsAt");
  });

  it("customer.subscription.created: retrieves the subscription and records its period end", async () => {
    prepare();
    const { stripe, retrieve } = standInStripe(subscription2026());
    const result = await processLegacyDayforgeBillingWebhook({
      ...signed("customer.subscription.created", subscription2026()),
      stripe: stripe as never,
    });
    expect(result.status).toBe("processed");
    expect(retrieve).toHaveBeenCalledWith(SUB);
    expect(provisioned().currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it("customer.subscription.updated with cancel_at_period_end: keeps access, records the scheduled end", async () => {
    prepare();
    const canceling = subscription2026({
      cancel_at_period_end: true,
      cancel_at: PERIOD_END,
      canceled_at: CREATED + 3600,
      cancellation_details: { comment: null, feedback: null, reason: "cancellation_requested" },
    });
    const { stripe } = standInStripe(canceling);
    const result = await processLegacyDayforgeBillingWebhook({
      ...signed("customer.subscription.updated", canceling, CREATED + 3600, {
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
      }),
      stripe: stripe as never,
    });
    expect(result.status).toBe("processed");
    expect(provisioned()).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(PERIOD_END * 1000),
    });
    expect(provisioned()).not.toHaveProperty("accessEndsAt");
  });

  it("customer.subscription.deleted: uses the event's own subscription and ends access", async () => {
    prepare();
    const ended = subscription2026({
      status: "canceled",
      canceled_at: CREATED + 3600,
      ended_at: PERIOD_END,
      cancel_at_period_end: false,
    });
    const { stripe, retrieve } = standInStripe(null);
    const result = await processLegacyDayforgeBillingWebhook({
      ...signed("customer.subscription.deleted", ended, PERIOD_END),
      stripe: stripe as never,
    });
    expect(result.status).toBe("processed");
    expect(retrieve).not.toHaveBeenCalled();
    expect(provisioned()).toMatchObject({
      status: "canceled",
      accessEndsAt: new Date(PERIOD_END * 1000),
      currentPeriodEnd: new Date(PERIOD_END * 1000),
    });
  });

  it("invoice.paid: finds the subscription under parent.subscription_details and records the $79 payment", async () => {
    prepare();
    const { stripe, retrieve } = standInStripe(subscription2026());
    const result = await processLegacyDayforgeBillingWebhook({
      ...signed("invoice.paid", invoice2026(), CREATED + 5),
      stripe: stripe as never,
    });
    expect(result.status).toBe("processed");
    expect(retrieve).toHaveBeenCalledWith(SUB);
    expect(provisioned()).toMatchObject({
      status: "active",
      delinquentAt: null,
      graceEndsAt: null,
      lastInvoicePaidAt: new Date((CREATED + 5) * 1000),
    });
  });

  it("invoice.payment_failed: finds the subscription the same way and opens the grace period", async () => {
    prepare();
    const failed = invoice2026({
      status: "open",
      billing_reason: "subscription_cycle",
      amount_paid: 0,
      amount_remaining: 7900,
    });
    const { stripe, retrieve } = standInStripe(subscription2026({ status: "past_due" }));
    const failedAt = PERIOD_END + 60;
    const result = await processLegacyDayforgeBillingWebhook({
      ...signed("invoice.payment_failed", failed, failedAt),
      stripe: stripe as never,
    });
    expect(result.status).toBe("processed");
    expect(retrieve).toHaveBeenCalledWith(SUB);
    const call = provisioned();
    expect(call.status).toBe("past_due");
    expect(call.delinquentAt).toEqual(new Date(failedAt * 1000));
    expect(call.graceEndsAt).toBeInstanceOf(Date);
    expect(call).not.toHaveProperty("lastInvoicePaidAt");
  });

  it("an invoice with no subscription fails the event instead of provisioning anything", async () => {
    prepare();
    const { stripe, retrieve } = standInStripe(subscription2026());
    const result = await processLegacyDayforgeBillingWebhook({
      ...signed("invoice.paid", invoice2026({ parent: null, lines: { object: "list", data: [] } })),
      stripe: stripe as never,
    });
    expect(result).toMatchObject({ status: "failed", reason: "processing_failed" });
    expect(retrieve).not.toHaveBeenCalled();
    expect(provisionTenantFromSubscription).not.toHaveBeenCalled();
    expect(finishBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "Stripe event has no subscription" })
    );
  });

  it("refuses a payload whose signature was not made with the endpoint secret", async () => {
    prepare();
    const { stripe } = standInStripe(subscription2026());
    const good = signed("invoice.paid", invoice2026());
    const result = await processLegacyDayforgeBillingWebhook({
      rawBody: good.rawBody,
      signature: verifier.webhooks.generateTestHeaderString({
        payload: good.rawBody.toString(),
        secret: "whsec_someone_else",
      }),
      stripe: stripe as never,
    });
    expect(result).toEqual({ status: "failed", reason: "invalid_signature" });
    expect(reserveBillingEvent).not.toHaveBeenCalled();
  });
});
