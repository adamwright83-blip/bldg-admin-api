/**
 * THE ONLY MINTING SITE for Brain V2 authority grants.
 * Adapters, the renderer, and V1 must not duplicate these factories.
 */

import {
  CALL_CONTROL_GRANT_BRAND,
  EXECUTIVE_ACTION_GRANT_BRAND,
  NARRATIVE_REVEAL_GRANT_BRAND,
  PERSONAL_DISCLOSURE_GRANT_BRAND,
  type ActionGrantDraft,
  type CallControlGrant,
  type CallControlGrantDraft,
  type ExecutiveActionGrant,
  type NarrativeRevealGrant,
  type NarrativeRevealGrantDraft,
  type PersonalDisclosureGrant,
  type PersonalDisclosureGrantDraft,
} from "../contracts/grants";

export function isExecutiveActionGrant(value: unknown): value is ExecutiveActionGrant {
  return Boolean(value && typeof value === "object" && (value as ExecutiveActionGrant)[EXECUTIVE_ACTION_GRANT_BRAND] === true);
}

export function isCallControlGrant(value: unknown): value is CallControlGrant {
  return Boolean(value && typeof value === "object" && (value as CallControlGrant)[CALL_CONTROL_GRANT_BRAND] === true);
}

export function isPersonalDisclosureGrant(value: unknown): value is PersonalDisclosureGrant {
  return Boolean(
    value && typeof value === "object" && (value as PersonalDisclosureGrant)[PERSONAL_DISCLOSURE_GRANT_BRAND] === true
  );
}

export function isNarrativeRevealGrant(value: unknown): value is NarrativeRevealGrant {
  return Boolean(value && typeof value === "object" && (value as NarrativeRevealGrant)[NARRATIVE_REVEAL_GRANT_BRAND] === true);
}

export function mintActionGrant(draft: ActionGrantDraft): ExecutiveActionGrant {
  if (draft.constraints.shadowOnly === false && draft.constraints.mutationAllowed) {
    throw new Error("Brain V2 cannot mint a live mutation grant while productionAuthority is false");
  }
  return Object.freeze({
    [EXECUTIVE_ACTION_GRANT_BRAND]: true as const,
    ...draft,
  });
}

export function mintCallControlGrant(draft: CallControlGrantDraft): CallControlGrant {
  return Object.freeze({
    [CALL_CONTROL_GRANT_BRAND]: true as const,
    ...draft,
  });
}

export function mintPersonalDisclosureGrant(draft: PersonalDisclosureGrantDraft): PersonalDisclosureGrant {
  return Object.freeze({
    [PERSONAL_DISCLOSURE_GRANT_BRAND]: true as const,
    ...draft,
  });
}

export function mintNarrativeRevealGrant(draft: NarrativeRevealGrantDraft): NarrativeRevealGrant {
  return Object.freeze({
    [NARRATIVE_REVEAL_GRANT_BRAND]: true as const,
    ...draft,
  });
}
