import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { SaasSubscriptionStatus } from "../../shared/saasTenant";
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

export function getDayforgeBillingStripe(): Stripe {
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

export async function createDayforgeSubscriptionCheckout(input: {
  sessionId: string;
  resumeToken: string;
  planKey: string;
  requestId: string;
}) {
  const existingOnboarding = await requireOnboardingSession(input);
  const stripe = getDayforgeBillingStripe();
  if (existingOnboarding.stripeCheckoutSessionId) {
    if (existingOnboarding.planKey !== input.planKey) {
      throw new Error(
        "Checkout is already linked to a different DayForge plan"
      );
    }
    const existing = await stripe.checkout.sessions.retrieve(
      existingOnboarding.stripeCheckoutSessionId
    );
    return { id: existing.id, url: existing.url };
  }
  await getActiveSaasPlan(input.planKey);
  const onboarding = await reserveOnboardingCheckout(input);
  if (onboarding.stripeCheckoutSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(
      onboarding.stripeCheckoutSessionId
    );
    return { id: existing.id, url: existing.url };
  }
  const plan = await assertSaasPlanCanCheckout(input.planKey);
  const checkoutRequestId = onboarding.checkoutRequestId ?? input.requestId;
  await reserveSaasCheckoutSlot({
    onboardingSessionId: onboarding.id,
    planKey: plan.planKey,
    requestId: checkoutRequestId,
  });
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer_email: onboarding.ownerEmail,
      client_reference_id: onboarding.id,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${appUrl()}/dayforge-onboarding?session=${onboarding.id}&checkout=success`,
      cancel_url: `${appUrl()}/dayforge-onboarding?session=${onboarding.id}&checkout=cancelled`,
      metadata: {
        dayforgeOnboardingSessionId: onboarding.id,
        dayforgePlanKey: plan.planKey,
      },
      subscription_data: {
        metadata: {
          dayforgeOnboardingSessionId: onboarding.id,
          dayforgePlanKey: plan.planKey,
        },
        ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
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

export async function createDayforgeBillingPortal(input: {
  tenantId: string;
  requestId: string;
}) {
  const stripe = getDayforgeBillingStripe();
  const customer = await getStripeCustomerForTenant(input.tenantId);
  const session = await stripe.billingPortal.sessions.create(
    { customer, return_url: `${appUrl()}/dayforge-settings` },
    { idempotencyKey: `dayforge:portal:${input.tenantId}:${input.requestId}` }
  );
  return { url: session.url };
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
}) {
  const metadata = input.subscription.metadata ?? {};
  const onboardingSessionId = metadata.dayforgeOnboardingSessionId;
  const planKey = metadata.dayforgePlanKey;
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
  const eventIsPaid = input.eventType === "invoice.paid";
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

export type DayforgeWebhookResult = {
  status: "processed" | "ignored" | "failed";
  reason?: string;
  stripeEventId?: string;
};

export async function processDayforgeBillingWebhook(input: {
  rawBody: Buffer | string;
  signature: string | string[] | undefined;
  stripe?: Stripe;
}): Promise<DayforgeWebhookResult> {
  const secret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return { status: "failed", reason: "missing_webhook_secret" };
  const stripe = input.stripe ?? getDayforgeBillingStripe();
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
