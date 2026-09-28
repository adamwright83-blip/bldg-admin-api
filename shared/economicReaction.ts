/**
 * Narrator eligibility for one authored economic reaction.
 * The cents are copied from a verified event. This module does not calculate
 * revenue and does not celebrate a mismatch.
 */
export const THE_CURRENT = "the_current" as const;

export type EconomicReaction = {
  reactionId: typeof THE_CURRENT;
  deltaCents: number;
};

export function selectTheCurrent(input: {
  event: {
    eventType: string;
    deltaCents: number;
    periodFrom: string;
    periodTo: string;
  } | null;
  reconciliation: {
    status: string;
    rangeFrom: string;
    rangeTo: string;
  } | null;
}): EconomicReaction | null {
  if (!input.event || !input.reconciliation) return null;
  if (input.event.eventType !== "economic.mom_revenue_gain_verified") return null;
  if (input.reconciliation.status !== "reconciled") return null;
  if (
    input.reconciliation.rangeFrom !== input.event.periodFrom ||
    input.reconciliation.rangeTo !== input.event.periodTo
  ) {
    return null;
  }
  if (!Number.isInteger(input.event.deltaCents) || input.event.deltaCents <= 0) return null;
  return { reactionId: THE_CURRENT, deltaCents: input.event.deltaCents };
}

export function formatVerifiedDelta(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}$${dollars}.${fraction} VS LAST MONTH`;
}
