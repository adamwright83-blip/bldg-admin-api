/* LEGACY DAYFORGE COMPATIBILITY: billing plan keys below are JOYSTICK commercial offers. Historical DayForge names are not current architecture. */
/**
 * Advertised JOYSTICK checkout contract.
 * Monthly is 7900 USD cents ($79), interval month, with no trial: a card at signup, charged at checkout.
 * Annual is 46800 USD cents ($468/year), interval year. That amount is not 49000. Annual keeps the seven-day
 * trial it was published with; it used to share the monthly trial constant and was not part of the $79 change.
 * The Stripe price and product ids come from the plan row (synced from the environment), never from this module.
 * This module stores no Stripe account id and creates no charges.
 */

export const JOYSTICK_MONTHLY_PLAN_KEY = "joystick-growth-standard";
export const JOYSTICK_ANNUAL_PLAN_KEY = "joystick-growth-annual";
/** Monthly has no trial. Adding one back changes the advertised offer, not just this number. */
export const JOYSTICK_MONTHLY_TRIAL_DAYS = 0;
/** Annual's trial, unchanged from before the monthly offer moved to $79 with no trial. */
export const JOYSTICK_ANNUAL_TRIAL_DAYS = 7;
export const JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS = 7900;
/** $468 per year. Do not replace this with $490 (49000), 12 × $49 (58800) or 12 × $79 (94800). */
export const JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS = 46800;

export type JoystickCheckoutCloseCode =
  | "trial_days"
  | "stale_price"
  | "price_mismatch"
  | "price_unverified";

export type AdvertisedOffer = {
  planKey: string;
  unitAmountCents: number;
  currency: "usd";
  interval: "month" | "year";
  trialDays: typeof JOYSTICK_MONTHLY_TRIAL_DAYS | typeof JOYSTICK_ANNUAL_TRIAL_DAYS;
};

export type StripePriceFacts = {
  id?: string | null;
  active?: boolean | null;
  unit_amount?: number | null;
  currency?: string | null;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
};

export type PriceCheck =
  | { ok: true }
  | { ok: false; code: JoystickCheckoutCloseCode; reason: string };

const MONTHLY_OFFER: AdvertisedOffer = {
  planKey: JOYSTICK_MONTHLY_PLAN_KEY,
  unitAmountCents: JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
  currency: "usd",
  interval: "month",
  trialDays: JOYSTICK_MONTHLY_TRIAL_DAYS,
};

const ANNUAL_OFFER: AdvertisedOffer = {
  planKey: JOYSTICK_ANNUAL_PLAN_KEY,
  unitAmountCents: JOYSTICK_ANNUAL_UNIT_AMOUNT_CENTS,
  currency: "usd",
  interval: "year",
  trialDays: JOYSTICK_ANNUAL_TRIAL_DAYS,
};

export function advertisedOfferForPlan(planKey: string): AdvertisedOffer | null {
  if (planKey === JOYSTICK_MONTHLY_PLAN_KEY) return MONTHLY_OFFER;
  if (planKey === JOYSTICK_ANNUAL_PLAN_KEY) return ANNUAL_OFFER;
  return null;
}

export function isAdvertisedJoystickPlan(planKey: string): boolean {
  return advertisedOfferForPlan(planKey) !== null;
}

export function publicCheckoutClosedMessage(code: JoystickCheckoutCloseCode): string {
  switch (code) {
    case "trial_days":
      return "Checkout is closed until the plan's trial matches the advertised offer";
    case "stale_price":
      return "Checkout is closed because the configured Stripe price is stale";
    case "price_mismatch":
      return "Checkout is closed until the configured Stripe price matches the advertised offer";
    case "price_unverified":
      return "Checkout is closed until the configured Stripe price can be verified";
  }
}

export class JoystickCheckoutClosedError extends Error {
  readonly code: JoystickCheckoutCloseCode;
  readonly detail: string;

  constructor(code: JoystickCheckoutCloseCode, detail: string) {
    super(publicCheckoutClosedMessage(code));
    this.name = "JoystickCheckoutClosedError";
    this.code = code;
    this.detail = detail;
  }
}

export function advertisedTrialRefusal(
  planKey: string,
  trialDays: number
): PriceCheck | null {
  const offer = advertisedOfferForPlan(planKey);
  if (!offer || trialDays === offer.trialDays) return null;
  return {
    ok: false,
    code: "trial_days",
    reason: `Plan '${planKey}' has trialDays = ${trialDays}, expected ${offer.trialDays}`,
  };
}

export function checkAdvertisedStripePrice(input: {
  planKey: string;
  trialDays: number;
  configuredPriceId: string;
  price: StripePriceFacts | null;
}): PriceCheck {
  const offer = advertisedOfferForPlan(input.planKey);
  if (!offer) {
    return {
      ok: false,
      code: "price_mismatch",
      reason: `Plan '${input.planKey}' is not an advertised JOYSTICK checkout offer`,
    };
  }
  const trial = advertisedTrialRefusal(input.planKey, input.trialDays);
  if (trial) return trial;
  if (!input.price) {
    return {
      ok: false,
      code: "price_unverified",
      reason:
        "JOYSTICK checkout is closed until the configured Stripe price can be verified",
    };
  }
  if (input.price.active !== true) {
    return {
      ok: false,
      code: "stale_price",
      reason: `Stripe price ${input.configuredPriceId} is not an active price`,
    };
  }
  if (input.price.id && input.price.id !== input.configuredPriceId) {
    return {
      ok: false,
      code: "stale_price",
      reason: `Stripe price ${input.price.id} does not match configured price ${input.configuredPriceId}`,
    };
  }
  const interval = input.price.recurring?.interval ?? null;
  const intervalCount = input.price.recurring?.interval_count;
  if (
    input.price.unit_amount !== offer.unitAmountCents ||
    input.price.currency !== offer.currency ||
    interval !== offer.interval ||
    intervalCount !== 1
  ) {
    return {
      ok: false,
      code: "price_mismatch",
      reason: `Stripe price ${input.configuredPriceId} mismatch: amount=${input.price.unit_amount} (expected ${offer.unitAmountCents}), currency=${input.price.currency} (expected ${offer.currency}), interval=${interval} (expected ${offer.interval}), interval_count=${intervalCount ?? "missing"} (expected 1)`,
    };
  }
  return { ok: true };
}

/**
 * The environment may write an advertised plan only with that plan's advertised trial: 0 days for monthly,
 * 7 for annual. A disagreeing value is not synced, and checkout stays closed on the row already stored.
 */
export function advertisedPlanEnvSyncAllowed(
  planKey: string,
  trialDays: number
): boolean {
  const offer = advertisedOfferForPlan(planKey);
  if (!offer) return true;
  return trialDays === offer.trialDays;
}

/**
 * The trial a new Checkout subscription gets: the advertised one for an advertised plan, the plan row's otherwise.
 * Zero means Checkout sends no trial_period_days at all and the first invoice is charged at checkout.
 */
export function checkoutTrialPeriodDays(plan: {
  planKey: string;
  trialDays: number;
}): number {
  const offer = advertisedOfferForPlan(plan.planKey);
  const days = offer ? offer.trialDays : plan.trialDays;
  return Number.isInteger(days) && days > 0 ? days : 0;
}

/**
 * Annual billing is optional. A plan row and JOYSTICK_STRIPE_ANNUAL_PRICE_ID
 * must name the same Stripe price when both are present.
 */
export function resolveConfiguredAnnualPriceId(input: {
  planPriceId?: string | null;
  envPriceId?: string | null;
}):
  | { status: "absent" }
  | { status: "configured"; priceId: string }
  | { status: "conflict"; reason: string } {
  const planPriceId = input.planPriceId?.trim() || "";
  const envPriceId = input.envPriceId?.trim() || "";
  if (!planPriceId && !envPriceId) return { status: "absent" };
  if (planPriceId && envPriceId && planPriceId !== envPriceId) {
    return {
      status: "conflict",
      reason:
        "Annual Stripe price is configured on the plan row and JOYSTICK_STRIPE_ANNUAL_PRICE_ID with different price ids",
    };
  }
  return { status: "configured", priceId: planPriceId || envPriceId };
}

export function recognizedSubscriptionRevenueCents(input: {
  amountPaidCents?: number | null;
  amountRefundedCents?: number | null;
  postPaymentCreditNoteCents?: number | null;
}): number {
  const paid = nonNegativeInt(input.amountPaidCents);
  const refunded = nonNegativeInt(input.amountRefundedCents);
  const credits = nonNegativeInt(input.postPaymentCreditNoteCents);
  return Math.max(0, paid - refunded - credits);
}

const REFUND_EVENT_TYPES = new Set([
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "charge.refund.updated",
  "credit_note.created",
]);

export function isRefundBillingEvent(eventType: string): boolean {
  return REFUND_EVENT_TYPES.has(eventType);
}

export function revenueCentsForBillingEvent(event: {
  type: string;
  data?: { object?: object | null };
}): number {
  if (isRefundBillingEvent(event.type)) return 0;
  if (event.type !== "invoice.paid") return 0;
  const source = event.data?.object ?? null;
  return recognizedSubscriptionRevenueCents({
    amountPaidCents: invoiceNumber(source, "amount_paid"),
    amountRefundedCents: invoiceNumber(source, "amount_refunded"),
    postPaymentCreditNoteCents: invoiceNumber(source, "post_payment_credit_notes_amount"),
  });
}

export function assertPortalCustomerForTenant(input: {
  tenantId: string;
  tenantCustomerId: string;
  requestedCustomerId?: string | null;
}): void {
  if (!input.tenantId.trim() || !input.tenantCustomerId.trim()) {
    throw new Error("Cross-tenant billing portal access is not allowed");
  }
  if (
    input.requestedCustomerId &&
    input.requestedCustomerId !== input.tenantCustomerId
  ) {
    throw new Error("Cross-tenant billing portal access is not allowed");
  }
}

function nonNegativeInt(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function invoiceNumber(source: object | null, key: string): number {
  if (!source) return 0;
  const value: unknown = Reflect.get(source, key);
  return typeof value === "number" ? value : 0;
}
