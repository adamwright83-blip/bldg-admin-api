export const DEFAULT_FIELD_CHECKLIST = [
  {
    itemKey: "clean_polo",
    label: "Clean polo",
    detail: "Presentable and ready to represent the laundromat.",
    required: true,
    position: 0,
  },
  {
    itemKey: "quote_sheet",
    label: "Quote sheet",
    detail: "Approved pricing and service outline are available.",
    required: true,
    position: 1,
  },
  {
    itemKey: "collateral",
    label: "Leave-behind",
    detail: "Approved collateral is ready for the decision-maker.",
    required: true,
    position: 2,
  },
  {
    itemKey: "business_cards",
    label: "Business cards",
    detail: "Bring operator contact cards when configured.",
    required: false,
    position: 3,
  },
] as const;

export const FIELD_OUTCOME_REASONS = [
  "quote_requested",
  "pilot_requested",
  "follow_up_requested",
  "no_interest",
  "current_provider_locked_in",
  "pricing_objection",
  "operational_incompatibility",
  "other",
] as const;

export type FieldOutcomeReason = (typeof FIELD_OUTCOME_REASONS)[number];

/**
 * What actually happened at the real visit. `no_contact` and `no_decision`
 * are complete, legitimate visit observations, but neither is permission to
 * manufacture a future commitment or terminal business result.
 */
export const FIELD_VISIT_OUTCOMES = [
  "no_contact",
  "no_decision",
  "follow_up",
  "won",
  "lost",
] as const;
export type FieldVisitOutcome = (typeof FIELD_VISIT_OUTCOMES)[number];

/**
 * The second mission transition after `arrived -> visit_completed`, when one
 * is legitimately warranted. Null means the visit stays truthfully completed
 * and unresolved.
 */
export function missionStatusForFieldVisitOutcome(
  outcome: FieldVisitOutcome
): "follow_up" | "won" | "lost" | null {
  return outcome === "follow_up" || outcome === "won" || outcome === "lost"
    ? outcome
    : null;
}

export function navigationUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
