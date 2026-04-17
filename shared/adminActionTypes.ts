/**
 * Canonical values for admin_action_log.actionType.
 * The DB column is freeform varchar(64); this file is the source of truth for
 * allowed values — every call site must use a constant from this list.
 */
export const ADMIN_ACTION_TYPES = [
  "send_reminder",
  "building_penetration",
  "referral_request",
  "market_hole_outreach",
] as const;

export type AdminActionType = (typeof ADMIN_ACTION_TYPES)[number];
