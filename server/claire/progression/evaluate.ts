import {
  PROGRESSION_POLICY,
  type PersonalAccessRung,
  type ProgressionPolicy,
  type RapportBand,
} from "./policy";
import type { ProgressionEvidence } from "./evidence";

/**
 * Pure, deterministic progression evaluator. Used identically by production
 * and the non-production simulator. No I/O, no clock reads (asOf is passed in).
 *
 * Laws enforced here:
 *  - Only growth actions drive rapport. Only growth + business progress drive the rung.
 *  - occurredAt governs chronology (distinct action days); recognizedAt governs
 *    whether an event may count yet (recognizedAt <= asOf).
 *  - Grants are monotonic and record the policy version that granted them.
 *  - Nothing here ever lowers anything, and no business loss is representable.
 */

export type ProgressionGrant = {
  rapportBand: RapportBand;
  rapportPolicyVersion: string | null;
  personalRung: PersonalAccessRung;
  rungPolicyVersion: string | null;
};

export const EMPTY_GRANT: ProgressionGrant = {
  rapportBand: 0,
  rapportPolicyVersion: null,
  personalRung: 0,
  rungPolicyVersion: null,
};

export type ProgressionCounts = {
  growthActions: number;
  growthActionDays: number;
  progressEvents: number;
  strongResults: number;
};

export type ProgressionEvaluation = {
  counts: ProgressionCounts;
  computedRapportBand: RapportBand;
  computedRung: PersonalAccessRung;
  /** Monotonic: never below the prior grant. */
  grant: ProgressionGrant;
  /** Ids of business-progress evidence eligible to mint one entitlement each (only when rung >= 1). */
  entitlementEligibleEvidenceIds: string[];
};

function dayOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function countProgressionEvidence(
  evidence: readonly ProgressionEvidence[],
  asOf: Date
): ProgressionCounts {
  const recognized = evidence.filter(item => Date.parse(item.recognizedAt) <= asOf.getTime());
  const growth = recognized.filter(item => item.category === "growth_action");
  const progress = recognized.filter(item => item.category === "business_progress");
  return {
    growthActions: growth.length,
    growthActionDays: new Set(growth.map(item => dayOf(item.occurredAt))).size,
    progressEvents: progress.length,
    strongResults: progress.filter(item => item.strength === "strong").length,
  };
}

export function evaluateProgression(input: {
  evidence: readonly ProgressionEvidence[];
  /** Existing disclosure-safety requirement (no unresolved boundary/disclosure violation, non-negative). */
  disclosureSafetyOk: boolean;
  prior: ProgressionGrant | null;
  asOf: Date;
  policy?: ProgressionPolicy;
}): ProgressionEvaluation {
  const policy = input.policy ?? PROGRESSION_POLICY;
  const prior = input.prior ?? EMPTY_GRANT;
  const counts = countProgressionEvidence(input.evidence, input.asOf);

  let computedRapportBand: RapportBand = 0;
  for (const threshold of policy.rapport) {
    if (counts.growthActions >= threshold.minActions && counts.growthActionDays >= threshold.minActionDays) {
      computedRapportBand = threshold.band;
    }
  }

  let computedRung: PersonalAccessRung = 0;
  for (const threshold of policy.rungs) {
    const satisfied =
      counts.growthActions >= threshold.minActions &&
      counts.growthActionDays >= threshold.minActionDays &&
      counts.progressEvents >= threshold.minProgressEvents &&
      counts.strongResults >= threshold.minStrongResults &&
      (!threshold.requireDisclosureSafety || input.disclosureSafetyOk);
    // Rungs are ordered; a higher rung only counts if every lower one holds too.
    if (satisfied && threshold.rung === computedRung + 1) computedRung = threshold.rung;
  }

  const grant: ProgressionGrant = {
    rapportBand: Math.max(prior.rapportBand, computedRapportBand) as RapportBand,
    rapportPolicyVersion:
      computedRapportBand > prior.rapportBand ? policy.version : prior.rapportPolicyVersion,
    personalRung: Math.max(prior.personalRung, computedRung) as PersonalAccessRung,
    rungPolicyVersion: computedRung > prior.personalRung ? policy.version : prior.rungPolicyVersion,
  };

  const recognizedProgress = input.evidence
    .filter(item => item.category === "business_progress" && Date.parse(item.recognizedAt) <= input.asOf.getTime())
    .map(item => item.id);

  return {
    counts,
    computedRapportBand,
    computedRung,
    grant,
    entitlementEligibleEvidenceIds: grant.personalRung >= 1 ? recognizedProgress : [],
  };
}
