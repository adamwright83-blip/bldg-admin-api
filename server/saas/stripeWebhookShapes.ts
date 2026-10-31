/**
 * Reading the Stripe billing objects JOYSTICK depends on, whichever API version rendered them.
 *
 * Two versions meet in the billing webhook. Event payloads arrive in the webhook endpoint's API version (the JOYSTICK
 * sandbox endpoint is on 2026-09-30); objects the handler retrieves come back in the client's pinned version
 * (2025-03-31.basil, server/saas/saasBilling.ts). From basil onward, per the installed SDK types (stripe 20.3.1,
 * ApiVersion 2026-01-28.clover):
 * - an Invoice has no top-level `subscription`. It is `invoice.parent.subscription_details.subscription`
 *   (string or expanded Subscription), and each subscription line carries
 *   `lines.data[].parent.subscription_item_details.subscription`;
 * - a Subscription has no top-level `current_period_end`. Each item carries its own
 *   `items.data[].current_period_end`.
 * Older payloads still carry the top-level fields, so both shapes are read. Nothing here calls Stripe.
 */

function field(source: unknown, key: string): unknown {
  return source !== null && typeof source === "object"
    ? (source as Record<string, unknown>)[key]
    : undefined;
}

function expandableId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const id = field(value, "id");
  return typeof id === "string" && id.trim() ? id : null;
}

function isUnixSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The subscription an invoice belongs to, or null for an invoice that has none (a one-off invoice). */
export function invoiceSubscriptionId(invoice: unknown): string | null {
  const fromParent = expandableId(
    field(field(field(invoice, "parent"), "subscription_details"), "subscription")
  );
  if (fromParent) return fromParent;
  // Payloads rendered before 2025-03-31.basil.
  const topLevel = expandableId(field(invoice, "subscription"));
  if (topLevel) return topLevel;
  const lines = field(field(invoice, "lines"), "data");
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    const parent = field(line, "parent");
    const id =
      expandableId(field(field(parent, "subscription_item_details"), "subscription")) ??
      expandableId(field(field(parent, "invoice_item_details"), "subscription"));
    if (id) return id;
  }
  return null;
}

/**
 * When the subscription's current paid period ends, in Unix seconds. With one price (JOYSTICK's case) that is the
 * single item's period end; with several items the latest one, the end of what the customer has paid for.
 */
export function subscriptionCurrentPeriodEnd(subscription: unknown): number | null {
  // Payloads rendered before 2025-03-31.basil.
  const topLevel = field(subscription, "current_period_end");
  if (isUnixSeconds(topLevel)) return topLevel;
  const items = field(field(subscription, "items"), "data");
  if (!Array.isArray(items)) return null;
  const ends = items
    .map(item => field(item, "current_period_end"))
    .filter(isUnixSeconds);
  return ends.length > 0 ? Math.max(...ends) : null;
}

/**
 * The subscription is set to end later but is still running: `cancel_at_period_end`, or a scheduled `cancel_at`.
 * Both are read because which one a portal cancellation sets can depend on the API version and billing mode; the
 * stored flag means "access continues until Stripe ends the subscription", and customer.subscription.deleted is
 * what ends it.
 */
export function subscriptionScheduledToCancel(subscription: unknown): boolean {
  return (
    field(subscription, "cancel_at_period_end") === true ||
    isUnixSeconds(field(subscription, "cancel_at"))
  );
}
