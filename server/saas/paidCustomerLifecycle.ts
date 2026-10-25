/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Paid-customer decisions that sit beside the billing store.
 * Price interval checks and trialEnd entitlement stay in the modules PR #686 owns.
 * This module does not open public checkout and does not call Stripe's API.
 */
import Stripe from "stripe";
import { normalizeSaasEmail } from "../../shared/saasTenant";
import {
  JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS,
  JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
  JOYSTICK_REQUIRED_TRIAL_DAYS,
} from "./joystickStripeOffer";

export const JOYSTICK_PUBLIC_CHECKOUT_LIVE = false;

export const PAID_WORKSPACE_ENTITLEMENT = "dayforge_core" as const;

export const PAID_WORKSPACE_CLOSED_MESSAGE =
  "This workspace does not have an active subscription";

export const TEST_MODE_CHECKOUT_CLOSED_MESSAGE =
  "Checkout is closed until the Stripe test key is configured";

export const LIVE_KEY_CHECKOUT_CLOSED_MESSAGE =
  "Checkout is closed because the billing key is not a Stripe test key";

export const UNRECOGNIZED_KEY_CHECKOUT_CLOSED_MESSAGE =
  "Checkout is closed until billing is configured with a Stripe test key";

/** One action for Adam when the JOYSTICK sandbox secret is not in this process. */
export const ADAM_JOYSTICK_STRIPE_TEST_KEY_STEP =
  "Set DAYFORGE_BILLING_STRIPE_SECRET_KEY to the JOYSTICK Stripe sandbox secret that starts with sk_test_. Do not use a live key and do not use the Laundry Farm Stripe account. Leave public checkout closed (checkout_live stays false).";

export const ADVERTISED_PAID_OFFER = {
  monthlyUnitAmountCents: JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
  annualUnitAmountCents: JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS,
  trialDays: JOYSTICK_REQUIRED_TRIAL_DAYS,
  checkoutLive: JOYSTICK_PUBLIC_CHECKOUT_LIVE,
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DELAYED_AFTER_MS = 15 * 60 * 1000;
const STRIPE_API_VERSION = "2025-03-31.basil";

export function assertAdvertisedOfferUnchanged(): void {
  if (
    ADVERTISED_PAID_OFFER.monthlyUnitAmountCents !== 4900 ||
    ADVERTISED_PAID_OFFER.annualUnitAmountCents !== 46800 ||
    ADVERTISED_PAID_OFFER.trialDays !== 7 ||
    ADVERTISED_PAID_OFFER.checkoutLive !== false
  ) {
    throw new Error("Advertised JOYSTICK offer drifted");
  }
}

export function assertNewBusinessIdentity(input: {
  businessName: string;
  contactName: string;
  ownerEmail: string;
  timeZone: string;
}): {
  businessName: string;
  contactName: string;
  ownerEmail: string;
  timeZone: string;
} {
  const businessName = input.businessName.trim();
  const contactName = input.contactName.trim();
  const ownerEmail = normalizeSaasEmail(input.ownerEmail);
  const timeZone = input.timeZone.trim();
  if (!businessName || !contactName) {
    throw new Error("Business and owner identity are required before checkout");
  }
  if (!ownerEmail || !EMAIL.test(ownerEmail)) {
    throw new Error("A valid owner email is required before checkout");
  }
  if (!timeZone) {
    throw new Error("A valid time zone is required before checkout");
  }
  return { businessName, contactName, ownerEmail, timeZone };
}

export type BillingSecretGate =
  | { action: "absent"; blocker: string; adamStep: string }
  | { action: "allow_test" }
  | { action: "refuse"; reason: "live_key" | "unrecognized_key"; message: string };

/**
 * Absent is not a live charge. Callers that only record the blocker use this.
 * Checkout itself still refuses to create a session until a test key exists.
 */
export function billingSecretGate(secret: string | undefined | null): BillingSecretGate {
  const key = secret?.trim() ?? "";
  if (!key) {
    return {
      action: "absent",
      blocker: "DAYFORGE_BILLING_STRIPE_SECRET_KEY is unset",
      adamStep: ADAM_JOYSTICK_STRIPE_TEST_KEY_STEP,
    };
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    return {
      action: "refuse",
      reason: "live_key",
      message: LIVE_KEY_CHECKOUT_CLOSED_MESSAGE,
    };
  }
  if (!key.startsWith("sk_test_") || key.length < 20) {
    return {
      action: "refuse",
      reason: "unrecognized_key",
      message: UNRECOGNIZED_KEY_CHECKOUT_CLOSED_MESSAGE,
    };
  }
  return { action: "allow_test" };
}

export function assertTestModeCheckoutKey(secret: string | undefined | null): void {
  const gate = billingSecretGate(secret);
  if (gate.action === "allow_test") return;
  if (gate.action === "absent") {
    throw new Error(TEST_MODE_CHECKOUT_CLOSED_MESSAGE);
  }
  throw new Error(gate.message);
}

export type WebhookDeliveryClass = "duplicate" | "delayed" | "out_of_order" | "in_order";

/**
 * Same ordering rule the billing store already applies with lastStripeEventCreatedAt:
 * an older event does not overwrite a newer one, and an event id is applied once.
 * A delayed arrival still applies when it is the newest event.
 */
export function classifyWebhookDelivery(input: {
  eventId: string;
  eventCreatedAt: Date;
  receivedAt: Date;
  appliedEventIds: ReadonlySet<string>;
  latestAppliedCreatedAt: Date | null;
}): WebhookDeliveryClass {
  if (input.appliedEventIds.has(input.eventId)) return "duplicate";
  if (
    input.latestAppliedCreatedAt &&
    input.eventCreatedAt.getTime() < input.latestAppliedCreatedAt.getTime()
  ) {
    return "out_of_order";
  }
  if (input.receivedAt.getTime() - input.eventCreatedAt.getTime() > DELAYED_AFTER_MS) {
    return "delayed";
  }
  return "in_order";
}

export function deliveryShouldMutateSubscription(kind: WebhookDeliveryClass): boolean {
  return kind === "in_order" || kind === "delayed";
}

export type PaidLoginDecision =
  | { allow: true; kind: "first" | "returning" }
  | { allow: false; httpStatus: 403; error: string };

export function decidePaidLogin(input: {
  membershipActive: boolean;
  tenantStatus: string;
  entitlementAllows: boolean;
  priorSuccessfulLogin: boolean;
}): PaidLoginDecision {
  if (
    !input.membershipActive ||
    input.tenantStatus === "suspended" ||
    input.tenantStatus === "canceled" ||
    !input.entitlementAllows
  ) {
    return {
      allow: false,
      httpStatus: 403,
      error: PAID_WORKSPACE_CLOSED_MESSAGE,
    };
  }
  return {
    allow: true,
    kind: input.priorSuccessfulLogin ? "returning" : "first",
  };
}

export type WebhookScreen =
  | { proceed: true }
  | {
      proceed: false;
      httpStatus: number;
      body: { status: "failed" | "ignored"; reason: string };
    };

let webhookVerifier: Stripe | null = null;

function localWebhookVerifier(): Stripe {
  // HMAC only. This client is never used to create a charge or retrieve an account.
  webhookVerifier ??= new Stripe("sk_test_paid_lifecycle_webhook_verify_only", {
    apiVersion: STRIPE_API_VERSION as any,
  });
  return webhookVerifier;
}

/**
 * Verify the Stripe signature before any provisioning call.
 * A live-mode event is ignored with HTTP 200 so Stripe does not retry it into this server.
 * A missing webhook secret is left to the existing processor, which already fails closed.
 */
export function screenPaidLifecycleWebhook(input: {
  rawBody: Buffer | string;
  signature: string | string[] | undefined;
  webhookSecret?: string | undefined;
}): WebhookScreen {
  const secret = (
    input.webhookSecret ?? process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET
  )?.trim();
  if (!secret) return { proceed: true };
  if (typeof input.signature !== "string" || input.signature.length === 0) {
    return {
      proceed: false,
      httpStatus: 400,
      body: { status: "failed", reason: "invalid_signature" },
    };
  }
  try {
    const event = localWebhookVerifier().webhooks.constructEvent(
      input.rawBody,
      input.signature,
      secret
    );
    if (event.livemode) {
      return {
        proceed: false,
        httpStatus: 200,
        body: { status: "ignored", reason: "live_mode_refused" },
      };
    }
    return { proceed: true };
  } catch {
    return {
      proceed: false,
      httpStatus: 400,
      body: { status: "failed", reason: "invalid_signature" },
    };
  }
}
