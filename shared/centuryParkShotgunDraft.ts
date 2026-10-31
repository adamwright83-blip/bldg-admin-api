import type { ShotgunSubmission } from "./centuryParkShotgun";

export type ShotgunCustomerSnapshot = {
  identityId: string;
  name: string;
  daysSinceLastOrder: number | null;
  paidOrders: number;
  lifetimeCents: number;
  lastOrderDate: string | null;
  lastOrderSummary: string | null;
};

/** Only server-recorded facts; no account-credit, service-area, capacity or appointment promise. */
export function shotgunDraft(
  customer: ShotgunCustomerSnapshot,
  choice: Pick<ShotgunSubmission, "openingId" | "hypothesis">,
  brand: string
) {
  const first = customer.name.trim().split(/\s+/)[0] || "there";
  const intro = `Hi ${first}, it's Adam from ${brand}.`;
  const openings: Partial<Record<ShotgunSubmission["openingId"], string>> = {
    plain: `${intro} It's been a while since your last pickup.`,
  };
  if (customer.lastOrderSummary)
    openings.last = `${intro} I was looking at your last order (${customer.lastOrderSummary}) and realised it's been a while.`;
  if (customer.paidOrders >= 4)
    openings.regular = `${intro} You've placed ${customer.paidOrders} orders with us, and I noticed it's been a while.`;
  if (customer.lastOrderDate)
    openings.date = `${intro} Your last recorded order was ${customer.lastOrderDate.slice(0, 10)}.`;
  if (customer.lifetimeCents >= 10000)
    openings.value = `${intro} You've trusted us with a lot of laundry over time and I'd hate to lose that.`;
  const middle = {
    forgot:
      "No pressure at all; I just wanted to make it easy to pick back up.",
    seasonal:
      "If the pile is building up again, we'd be happy to hear from you.",
    price:
      "If the price stopped making sense, tell me straight and I'll see what I can do.",
    bad_experience: "If something went sideways last time, I'd like to know.",
    moved:
      "If you've moved, no worries; let me know and we can check whether we serve your new address.",
  }[choice.hypothesis];
  const opening = openings[choice.openingId];
  if (!opening)
    throw new Error("That opening is not supported by this customer's record.");
  return `${opening} ${middle} If you'd like another pickup, reply and we can check a time.`;
}
