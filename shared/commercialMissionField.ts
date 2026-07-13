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

export function navigationUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
