import type { GoldlineWorldEvent } from "./goldlineWorld";

/** Correction snapshots replace, never add. Revision order is independent of
 * delivery order and business time (backdated corrections are commonplace). */
export function latestEconomicSnapshots(events: readonly GoldlineWorldEvent[]) {
  const latest = new Map<string, GoldlineWorldEvent>();
  for (const event of events) {
    if (event.classification !== "outcome" || event.provenanceClass === "generated_game_fiction" ||
      !["order_paid", "order_payment_corrected"].includes(event.eventType)) continue;
    const { economicKey, revision } = event.metadata;
    if (typeof economicKey !== "string" || !Number.isInteger(revision)) continue;
    const key = `${event.tenantId}:${economicKey}`;
    const prior = latest.get(key);
    if (!prior || Number(revision) > Number(prior.metadata.revision)) latest.set(key, event);
  }
  return Array.from(latest.values());
}

export function currentEconomicRevenueCents(events: readonly GoldlineWorldEvent[], physicalEntityId?: string) {
  return latestEconomicSnapshots(events).reduce((total, event) => {
    const data = event.metadata;
    if (data.paid !== true || typeof data.paymentAt !== "string" || !Number.isFinite(Date.parse(data.paymentAt)) ||
      !Number.isInteger(data.amountCents) || Number(data.amountCents) <= 0 ||
      (physicalEntityId !== undefined && event.physicalEntityId !== physicalEntityId)) return total;
    return total + Number(data.amountCents);
  }, 0);
}
