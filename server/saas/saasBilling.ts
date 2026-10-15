/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { SaasSubscriptionStatus } from "../../shared/saasTenant";
import {
  advertisedTrialRefusal,
  assertPortalCustomerForTenant,
  checkAdvertisedStripePrice,
  isAdvertisedJoystickPlan,
  isRefundBillingEvent,
  JOYSTICK_REQUIRED_TRIAL_DAYS,
  JoystickCheckoutClosedError,
  revenueCentsForBillingEvent,
} from "./joystickStripeOffer";
import {
  attachCheckoutToOnboarding,
  assertSaasPlanCanCheckout,
  expireOnboardingCheckout,
  finishBillingEvent,
  getActiveSaasPlan,
  getStripeCustomerForTenant,
  provisionTenantFromSubscription,
  requireOnboardingSession,
  reserveBillingEvent,
  reserveOnboardingCheckout,
  reserveSaasCheckoutSlot,
} from "./saasStore";

const STRIPE_API_VERSION = "2025-03-31.basil" as const;

export function getLegacyDayforgeBillingStripe(): Stripe {
  const key = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY?.trim();
  if (!key || key.length < 20) {
    throw new Error("DAYFORGE_BILLING_STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION as any });
}

function appUrl(): string {
  return (
    process.env.DAYFORGE_BILLING_APP_URL?.replace(/\/$/, "") ||
    "https://admin.bldg.chat"
  );
}

export async function createLegacyDayforgeSubscriptionCheckout(input: {
  sessionId: string;
  resumeToken: string;
  planKey: string;
  requestId: string;
  stripe?: Stripe;
}) {
  const existingOnboarding = await requireOnboardingSession(input);
  const customerEmail = existingOnboarding.ownerEmail;
  if (!customerEmail) {
    throw new Error("Complete account identity before checkout");
  }
  const returnPath =
    existingOnboarding.onboardingMode === "joystick_generic"
      ? "/joystick-start"
      : "/dayforge-onboarding";
  const stripe = input.stripe ?? getLegacyDayforgeBillingStripe();
  if (existingOnboarding.stripeCheckoutSessionId) {
    if (existingOnboarding.planKey !== input.planKey) {
      throw new Error(
        "Checkout is already linked to a different DayForge plan"
      );
    }
    if (isAdvertisedJoystickPlan(input.planKey)) {
      const plan = await assertSaasPlanCanCheckout(input.planKey);
      return reuseAdvertisedCheckoutSession(
        stripe,
        existingOnboarding.stripeCheckoutSessionId,
        plan
      );
    }
    const existing = await stripe.checkout.sessions.retrieve(
      existingOnboarding.stripeCheckoutSessionId
    );
    return { id: existing.id, url: existing.url };
  }
  await getActiveSaasPlan(input.planKey);
  const onboarding = await reserveOnboardingCheckout(input);
  const plan = await assertSaasPlanCanCheckout(input.planKey);
  if (onboarding.stripeCheckoutSessionId) {
    if (isAdvertisedJoystickPlan(plan.planKey)) {
      return reuseAdvertisedCheckoutSession(
        stripe,
        onboarding.stripeCheckoutSessionId,
        plan
      );
    }
    const existing = await stripe.checkout.sessions.retrieve(
      onboarding.stripeCheckoutSessionId
    );
    return { id: existing.id, url: existing.url };
  }
  const verifiedPriceId = isAdvertisedJoystickPlan(plan.planKey)
    ? (await assertAdvertisedCheckoutIsOpen(stripe, plan)).id
    : plan.stripePriceId;
  const checkoutRequestId = onboarding.checkoutRequestId ?? input.requestId;
  await reserveSaasCheckoutSlot({
    onboardingSessionId: onboarding.id,
    planKey: plan.planKey,
    requestId: checkoutRequestId,
  });
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer_email: customerEmail,
      client_reference_id: onboarding.id,
      line_items: [{ price: verifiedPriceId, quantity: 1 }],
      success_url: `${appUrl()}${returnPath}?session=${onboarding.id}&checkout=success`,
      cancel_url: `${appUrl()}${returnPath}?session=${onboarding.id}&checkout=cancelled`,
      metadata: {
        legacyDayforgeOnboardingSessionId: onboarding.id,
        legacyDayforgePlanKey: plan.planKey,
      },
      ...(isAdvertisedJoystickPlan(plan.planKey)
        ? {
            payment_method_collection: "always" as const,
            payment_method_types: ["card" as const],
          }
        : {}),
      subscription_data: {
        metadata: {
          legacyDayforgeOnboardingSessionId: onboarding.id,
          legacyDayforgePlanKey: plan.planKey,
        },
        ...(isAdvertisedJoystickPlan(plan.planKey)
          ? { trial_period_days: JOYSTICK_REQUIRED_TRIAL_DAYS }
          : plan.trialDays > 0
            ? { trial_period_days: plan.trialDays }
            : {}),
      },
    },
    {
      idempotencyKey: `dayforge:checkout:${onboarding.id}:${checkoutRequestId}`,
    }
  );
  await attachCheckoutToOnboarding({
    ...input,
    requestId: checkoutRequestId,
    stripeCheckoutSessionId: session.id,
  });
  return { id: session.id, url: session.url };
}

export async function createLegacyDayforgeBillingPortal(input: {
  tenantId: string;
  requestId: string;
  requestedCustomerId?: string | null;
  stripe?: Stripe;
}) {
  const customer = await getStripeCustomerForTenant(input.tenantId);
  assertPortalCustomerForTenant({
    tenantId: input.tenantId,
    tenantCustomerId: customer,
    requestedCustomerId: input.requestedCustomerId,
  });
  const stripe = input.stripe ?? getLegacyDayforgeBillingStripe();
  const session = await stripe.billingPortal.sessions.create(
    { customer, return_url: `${appUrl()}/dayforge-settings` },
    { idempotencyKey: `dayforge:portal:${input.tenantId}:${input.requestId}` }
  );
  return { url: session.url };
}

type AdvertisedPlanPrice = {
  planKey: string;
  stripePriceId: string;
  trialDays: number;
};

function checkoutSessionPriceId(session: Stripe.Checkout.Session): string | null {
  const price = session.line_items?.data?.[0]?.price;
  if (!price) return null;
  return typeof price === "string" ? price : (price.id ?? null);
}

async function assertAdvertisedCheckoutIsOpen(
  stripe: Stripe,
  plan: AdvertisedPlanPrice
): Promise<Stripe.Price> {
  const trial = advertisedTrialRefusal(plan.planKey, plan.trialDays);
  if (trial && !trial.ok) {
    throw new JoystickCheckoutClosedError(trial.code, trial.reason);
  }
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(plan.stripePriceId);
  } catch {
    throw new JoystickCheckoutClosedError(
      "price_unverified",
      "Configured Stripe price could not be retrieved"
    );
  }
  const check = checkAdvertisedStripePrice({
    planKey: plan.planKey,
    trialDays: plan.trialDays,
    configuredPriceId: plan.stripePriceId,
    price,
  });
  if (!check.ok) {
    throw new JoystickCheckoutClosedError(check.code, check.reason);
  }
  return price;
}

async function reuseAdvertisedCheckoutSession(
  stripe: Stripe,
  sessionId: string,
  plan: AdvertisedPlanPrice
) {
  await assertAdvertisedCheckoutIsOpen(stripe, plan);
  const existing = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items"],
  });
  if (checkoutSessionPriceId(existing) !== plan.stripePriceId) {
    throw new JoystickCheckoutClosedError(
      "stale_price",
      `Checkout session ${sessionId} does not use configured price ${plan.stripePriceId}`
    );
  }
  return { id: existing.id, url: existing.url };
}

function mapSubscriptionStatus(
  value: Stripe.Subscription.Status
): SaasSubscriptionStatus {
  const allowed = new Set<SaasSubscriptionStatus>([
    "trialing",
    "active",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
    "incomplete_expired",
    "canceled",
  ]);
  return allowed.has(value as SaasSubscriptionStatus)
    ? (value as SaasSubscriptionStatus)
    : "none";
}

function unixDate(value: number | null | undefined): Date | null {
  return value ? new Date(value * 1000) : null;
}

function idFromExpandable(
  value: string | { id: string } | null | undefined
): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

async function syncStripeSubscription(input: {
  subscription: Stripe.Subscription;
  eventId: string;
  eventCreatedAt: Date;
  eventType: string;
  recognizeRevenue: boolean;
}) {
  const metadata = input.subscription.metadata ?? {};
  const onboardingSessionId = metadata.legacyDayforgeOnboardingSessionId;
  const planKey = metadata.legacyDayforgePlanKey;
  if (!onboardingSessionId || !planKey) {
    throw new Error("Stripe subscription is missing DayForge metadata");
  }
  const customerId = idFromExpandable(input.subscription.customer);
  if (!customerId)
    throw new Error("Stripe subscription is missing its customer");
  const subscription = input.subscription as Stripe.Subscription & {
    current_period_end?: number | null;
    trial_end?: number | null;
  };
  const eventIsFailure = input.eventType === "invoice.payment_failed";
  const eventIsPaid =
    input.recognizeRevenue && input.eventType === "invoice.paid";
  const graceDays = Math.max(
    0,
    Number(process.env.DAYFORGE_BILLING_GRACE_DAYS ?? "7") || 0
  );
  const status = mapSubscriptionStatus(subscription.status);
  const accessEndsAt =
    status === "canceled" || status === "unpaid"
      ? input.eventCreatedAt
      : undefined;
  const result = await provisionTenantFromSubscription({
    onboardingSessionId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    planKey,
    status,
    eventId: input.eventId,
    eventCreatedAt: input.eventCreatedAt,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: unixDate(subscription.current_period_end),
    trialEnd: unixDate(subscription.trial_end),
    latestInvoiceId: idFromExpandable(subscription.latest_invoice),
    ...(eventIsFailure
      ? {
          delinquentAt: input.eventCreatedAt,
          graceEndsAt: new Date(
            input.eventCreatedAt.getTime() + graceDays * 24 * 60 * 60 * 1000
          ),
        }
      : {}),
    ...(eventIsPaid
      ? {
          delinquentAt: null,
          graceEndsAt: null,
          lastInvoicePaidAt: input.eventCreatedAt,
        }
      : {}),
    ...(accessEndsAt !== undefined ? { accessEndsAt } : {}),
  });
  return result.tenantId;
}

async function subscriptionForEvent(
  stripe: Stripe,
  event: Stripe.Event
): Promise<Stripe.Subscription | null> {
  if (event.type.startsWith("customer.subscription.")) {
    const eventSubscription = event.data.object as Stripe.Subscription;
    if (event.type === "customer.subscription.deleted")
      return eventSubscription;
    return stripe.subscriptions.retrieve(eventSubscription.id);
  }
  if (event.type === "checkout.session.completed") {
    const checkout = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = idFromExpandable(checkout.subscription);
    return subscriptionId
      ? stripe.subscriptions.retrieve(subscriptionId)
      : null;
  }
  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed"
  ) {
    const invoice = event.data.object as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null;
    };
    const subscriptionId = idFromExpandable(invoice.subscription);
    return subscriptionId
      ? stripe.subscriptions.retrieve(subscriptionId)
      : null;
  }
  return null;
}

export type LegacyDayforgeWebhookResult = {
  status: "processed" | "ignored" | "failed";
  reason?: string;
  stripeEventId?: string;
};

export async function processLegacyDayforgeBillingWebhook(input: {
  rawBody: Buffer | string;
  signature: string | string[] | undefined;
  stripe?: Stripe;
}): Promise<LegacyDayforgeWebhookResult> {
  const secret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return { status: "failed", reason: "missing_webhook_secret" };
  const stripe = input.stripe ?? getLegacyDayforgeBillingStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      input.rawBody,
      input.signature as string,
      secret
    );
  } catch {
    return { status: "failed", reason: "invalid_signature" };
  }

  const object = event.data.object as { id?: string; metadata?: unknown };
  const isNew = await reserveBillingEvent({
    stripeEventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    stripeCreatedAt: new Date(event.created * 1000),
    payloadHash: createHash("sha256").update(input.rawBody).digest("hex"),
    objectId: object.id ?? null,
    metadata: object.metadata ?? null,
  });
  if (!isNew) {
    return {
      status: "ignored",
      reason: "duplicate_event",
      stripeEventId: event.id,
    };
  }

  if (isRefundBillingEvent(event.type)) {
    await finishBillingEvent({
      stripeEventId: event.id,
      status: "ignored",
    });
    return {
      status: "ignored",
      reason: "refund_not_revenue",
      stripeEventId: event.id,
    };
  }

  const recognized =
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired" ||
    event.type.startsWith("customer.subscription.") ||
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed";
  if (!recognized) {
    await finishBillingEvent({ stripeEventId: event.id, status: "ignored" });
    return {
      status: "ignored",
      reason: "unrecognized_event",
      stripeEventId: event.id,
    };
  }
  if (event.type === "checkout.session.expired") {
    try {
      const checkout = event.data.object as Stripe.Checkout.Session;
      await expireOnboardingCheckout(checkout.id);
      await finishBillingEvent({
        stripeEventId: event.id,
        status: "processed",
      });
      return { status: "processed", stripeEventId: event.id };
    } catch {
      await finishBillingEvent({
        stripeEventId: event.id,
        status: "failed",
        errorCode: "checkout_expiration_failed",
      });
      return {
        status: "failed",
        reason: "processing_failed",
        stripeEventId: event.id,
      };
    }
  }

  try {
    const subscription = await subscriptionForEvent(stripe, event);
    if (!subscription) throw new Error("Stripe event has no subscription");
    const tenantId = await syncStripeSubscription({
      subscription,
      eventId: event.id,
      eventCreatedAt: new Date(event.created * 1000),
      eventType: event.type,
      recognizeRevenue: revenueCentsForBillingEvent(event) > 0,
    });
    await finishBillingEvent({
      stripeEventId: event.id,
      status: "processed",
      tenantId,
    });
    return { status: "processed", stripeEventId: event.id };
  } catch (error) {
    await finishBillingEvent({
      stripeEventId: event.id,
      status: "failed",
      errorCode:
        error instanceof Error
          ? error.message.slice(0, 128)
          : "processing_failed",
    });
    return {
      status: "failed",
      reason: "processing_failed",
      stripeEventId: event.id,
    };
  }
}