/**
 * Real-world setbacks become campaign turns. Arcade loss is never a
 * business setback. The fictional line cannot invent the real reason.
 */

export const AUTHORITATIVE_SETBACKS = [
  "no_answer",
  "manager_unavailable",
  "building_closed",
  "proposal_unresolved",
  "customer_declined",
  "prospect_lost",
  "pickup_blocked",
  "payment_unresolved",
] as const;
export type AuthoritativeSetback = (typeof AUTHORITATIVE_SETBACKS)[number];

export function campaignSetbackPresentation(input: {
  setback: AuthoritativeSetback;
  evidenceReference: string;
}): { fiction: string; evidenceReference: string; mutatesBusiness: false } {
  const fiction: Record<AuthoritativeSetback, string> = {
    no_answer: "The door goes cold. The signal waits.",
    manager_unavailable: "The gatekeeper is elsewhere. The line holds.",
    building_closed: "The facade is sealed. Return when the building is actually open.",
    proposal_unresolved: "The standard was sent. The crown is not restored yet.",
    customer_declined: "The lantern dimmed because they declined — not because the game said so.",
    prospect_lost: "The hunt lost this door in the real pipeline.",
    pickup_blocked: "The first knot will not open until the pickup is actually possible.",
    payment_unresolved: "Gold stays knotted until the real payment clears.",
  };
  return {
    fiction: fiction[input.setback],
    evidenceReference: input.evidenceReference,
    mutatesBusiness: false,
  };
}

export function arcadeLossIsGameOnly(): { mutatesBusiness: false; treatment: string } {
  return {
    mutatesBusiness: false,
    treatment: "Redeploy. Nothing in the save file of the business changed.",
  };
}
