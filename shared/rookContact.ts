/**
 * Rook CONTACT ontology.
 *
 * companion.rook is durable ownership (goldline_domain_progression.companionRookOwnedAt).
 * capability.rook.contact is a separate durable grant. Owning Rook does not grant it.
 * rook.outreach_drafting is the implementation capability under CONTACT, not the grant.
 *
 * clockhead_finale.rook_joined_the_party resolves level.colosseum and owns
 * companion.rook. It does not grant CONTACT and does not complete Brass Republic.
 *
 * Kingdom 2 / the Last Valet campaign is not decided here. This grant does not
 * complete that kingdom, a mission, or a challenge.
 */
export const ROOK_CONTACT_CAPABILITY_ID = "capability.rook.contact" as const;

export const ROOK_OUTREACH_DRAFTING_CAPABILITY_ID = "rook.outreach_drafting" as const;

/** Authored consequence that grants capability.rook.contact. Nothing else does. */
export const WAYWARD_ROOK_CONTACT_CONSEQUENCE =
  "wayward.rook_contact_demonstrated" as const;

export type WaywardRookContactConsequence = typeof WAYWARD_ROOK_CONTACT_CONSEQUENCE;

/** Session fact. Not a copy of sales_call_attempts status. */
export const ROOK_CONTACT_SESSION_STATUSES = [
  "prepared",
  "authorized",
  "dialing_operator",
  "ended",
  "failed",
] as const;

export type RookContactSessionStatus = (typeof ROOK_CONTACT_SESSION_STATUSES)[number];

export type RookContactEvidenceRef = {
  source: "commercial_account" | "commercial_account_contact";
  id: string;
};
