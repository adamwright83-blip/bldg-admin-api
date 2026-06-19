import type Stripe from "stripe";
import { marketplacePaymentsEnabled } from "./marketplaceStripeAdapter";
import type { MarketplacePaymentStore } from "./marketplacePaymentStore";

export function marketplaceStripeWebhookSecret(): string | undefined {
  return process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET || undefined;
}

type GetStripeFn = () => Stripe;

async function resolveGetStripe(injected?: GetStripeFn): Promise<GetStripeFn> {
  if (injected) return injected;
  const routers = await import("../routers");
  return routers.getStripe;
}

/**
 * Event types this ledger cares about. Recognized events are marked
 * `processed` purely as a ledger annotation — recognizing an event never
 * triggers a capture, transfer, refund, or payout. Acting on these events
 * is explicitly deferred to a future slice.
 */
const RECOGNIZED_MARKETPLACE_EVENT_TYPES = new Set([
  "payment_intent.amount_capturable_updated",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "transfer.created",
  "transfer.failed",
  "transfer.reversed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

export type WebhookIntakeResult =
  | { status: "disabled"; reason: string }
  | { status: "failed"; reason: string; stripeEventId?: string }
  | { status: "ignored"; reason: string; stripeEventId: string }
  | { status: "processed"; stripeEventId: string; eventType: string };

function extractRelatedAuthorizationId(event: Stripe.Event): string | null {
  const obj = event.data?.object as { metadata?: Record<string, string> } | undefined;
  return obj?.metadata?.marketplaceAuthorizationId ?? null;
}

/**
 * Validates, dedupes, and records a marketplace Stripe event into the
 * existing `marketplace_stripe_events` ledger. Fully inert by default:
 *
 *  - Refuses to do anything (no DB write, no Stripe import, no
 *    `constructEvent` call) unless `MARKETPLACE_PAYMENTS_ENABLED` is `true`
 *    AND `MARKETPLACE_STRIPE_WEBHOOK_SECRET` is set.
 *  - Even once enabled, never executes a capture, transfer, refund, or
 *    vendor payout — it only writes/updates ledger rows
 *    (`received` -> `processed`/`ignored`/`failed`).
 *  - Idempotent by `stripe_event_id`: a duplicate delivery is detected via
 *    the store's existing `INSERT IGNORE` dedupe and reported as `ignored`
 *    without ever being re-processed.
 */
export async function processMarketplaceStripeWebhookEvent(input: {
  rawBody: string | Buffer;
  signatureHeader: string | string[] | undefined;
  store: MarketplacePaymentStore;
  getStripe?: GetStripeFn;
}): Promise<WebhookIntakeResult> {
  if (!marketplacePaymentsEnabled()) {
    return { status: "disabled", reason: "marketplace_payments_disabled" };
  }
  const secret = marketplaceStripeWebhookSecret();
  if (!secret) {
    return { status: "disabled", reason: "missing_webhook_secret" };
  }

  const getStripe = await resolveGetStripe(input.getStripe);
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      input.rawBody,
      input.signatureHeader as string,
      secret,
    );
  } catch {
    return { status: "failed", reason: "invalid_signature" };
  }

  const { isNewEvent } = await input.store.recordStripeEvent({
    stripeEventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    payload: event,
    relatedAuthorizationId: extractRelatedAuthorizationId(event),
  });

  if (!isNewEvent) {
    return { status: "ignored", reason: "duplicate_event", stripeEventId: event.id };
  }

  const recognized = RECOGNIZED_MARKETPLACE_EVENT_TYPES.has(event.type);
  try {
    await input.store.markStripeEventProcessed(
      event.id,
      recognized ? "processed" : "ignored",
      recognized ? null : "unrecognized_event_type",
    );
  } catch (error) {
    await input.store.markStripeEventProcessed(
      event.id, "failed", error instanceof Error ? error.message : String(error),
    );
    return { status: "failed", reason: "ledger_update_failed", stripeEventId: event.id };
  }

  return recognized
    ? { status: "processed", stripeEventId: event.id, eventType: event.type }
    : { status: "ignored", reason: "unrecognized_event_type", stripeEventId: event.id };
}
