import {
  CLAIRE_DISCLOSURE_POLICY_IDS,
  PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS,
  type ClaireDisclosurePolicy,
  type ClaireDisclosurePolicyId,
} from "../../shared/narratorOs/contracts";

/**
 * Immutable Claire disclosure-policy catalog.
 *
 * These records are not beats, ledger events, knowledge mutations, or
 * world-truth writes. Looking them up must not teach Claire or PLAYER,
 * append the ledger, mutate narrative state, or fire a beat.
 * Permission is not occurrence. Not wired to Claire speech.
 */
const POLICIES: readonly ClaireDisclosurePolicy[] = Object.freeze([
  Object.freeze({
    id: "CL-CORE",
    canonStatus: "LOCKED",
    governedScopeRef: "core_facts",
    fromStart: true,
    progressGated: false,
    askOnly: true,
    permanentlyPrivate: false,
    authoredSourceRef: "GOLDLINE_CANON.md§6 disclosure; package CL-CORE",
  }),
  Object.freeze({
    id: "CL-T1",
    canonStatus: "LOCKED",
    governedScopeRef: "tiered_biography",
    fromStart: false,
    progressGated: true,
    askOnly: true,
    permanentlyPrivate: false,
    authoredSourceRef: "GOLDLINE_CANON.md§6 disclosure; package CL-T1-T3",
  }),
  Object.freeze({
    id: "CL-T2",
    canonStatus: "LOCKED",
    governedScopeRef: "tiered_biography",
    fromStart: false,
    progressGated: true,
    askOnly: true,
    permanentlyPrivate: false,
    authoredSourceRef: "GOLDLINE_CANON.md§6 disclosure; package CL-T1-T3",
  }),
  Object.freeze({
    id: "CL-T3",
    canonStatus: "LOCKED",
    governedScopeRef: "central_wound",
    fromStart: false,
    progressGated: true,
    askOnly: true,
    permanentlyPrivate: false,
    authoredSourceRef: "GOLDLINE_CANON.md§6 disclosure; package CL-T1-T3",
  }),
  Object.freeze({
    id: "CL-WARM-1",
    canonStatus: "LOCKED",
    governedScopeRef: "warmth_1",
    fromStart: false,
    progressGated: true,
    askOnly: true,
    permanentlyPrivate: false,
    authoredSourceRef: "GOLDLINE_CANON.md§6 disclosure; package CL-WARM-1",
  }),
  Object.freeze({
    id: "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE",
    canonStatus: "LOCKED",
    governedScopeRef: "AI Claire adapted father last exchange",
    fromStart: false,
    progressGated: false,
    askOnly: true,
    permanentlyPrivate: true,
    authoredSourceRef: "GOLDLINE_CANON.md§6 disclosure",
  }),
  Object.freeze({
    id: "CL-PRIV-EX-LAST-EXCHANGE",
    canonStatus: "LOCKED",
    governedScopeRef: "ex last exchange",
    fromStart: false,
    progressGated: false,
    askOnly: true,
    permanentlyPrivate: true,
    authoredSourceRef: "GOLDLINE_CANON.md§6 disclosure",
  }),
]);

export const CLAIRE_DISCLOSURE_POLICIES: readonly ClaireDisclosurePolicy[] =
  POLICIES;

for (const id of PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS) {
  const policy = POLICIES.find(entry => entry.id === id);
  if (!policy || policy.permanentlyPrivate !== true) {
    throw new Error(`Permanently private disclosure policy missing: ${id}`);
  }
}

export function getClaireDisclosurePolicy(
  id: ClaireDisclosurePolicyId
): ClaireDisclosurePolicy {
  const found = POLICIES.find(policy => policy.id === id);
  if (!found) {
    throw new Error(`Unknown Claire disclosure policy: ${id}`);
  }
  return found;
}

export function listClaireDisclosurePolicies(): readonly ClaireDisclosurePolicy[] {
  return CLAIRE_DISCLOSURE_POLICIES;
}

export function isClaireDisclosurePolicyId(
  id: string
): id is ClaireDisclosurePolicyId {
  return (CLAIRE_DISCLOSURE_POLICY_IDS as readonly string[]).includes(id);
}

export function disclosurePolicyIsNotABeat(id: string): boolean {
  return isClaireDisclosurePolicyId(id);
}

export type ClaireDisclosureProgressAttempt = Readonly<{
  asked?: boolean;
  fromStartSatisfied?: boolean;
  progressSatisfied?: boolean;
  highestTierReached?: boolean;
  rapportUnlocked?: boolean;
  verifiedBusinessProgress?: boolean;
}>;

/**
 * Permanently private policies are a hard close. No progress attempt can
 * convert them into ordinary disclosure eligibility. Catalog-only: not wired
 * to Claire speech, not a beat, and not a knowledge/ledger mutation.
 */
export function disclosurePolicyMayBecomeOrdinarilyEligible(
  policy: ClaireDisclosurePolicy,
  _progressAttempt?: ClaireDisclosureProgressAttempt
): boolean {
  if (policy.permanentlyPrivate) return false;
  return !(
    PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS as readonly string[]
  ).includes(policy.id);
}
