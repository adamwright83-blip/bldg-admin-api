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

/**
 * Historical client literal for the Wayward CONTACT beat.
 * Posting it is not server-authoritative proof and does not grant
 * capability.rook.contact. Wayward progress is same-device localStorage.
 */
export const WAYWARD_ROOK_CONTACT_CONSEQUENCE =
  "wayward.rook_contact_demonstrated" as const;

export type WaywardRookContactConsequence = typeof WAYWARD_ROOK_CONTACT_CONSEQUENCE;

/** Preview row. Production reads do not treat this as capability authority. */
export const ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE =
  "isolated_preview.rook_contact" as const;

/**
 * Execution-test fixture row. Not a client token. Production reads ignore it.
 */
export const ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE =
  "execution_fixture.rook_contact" as const;

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
