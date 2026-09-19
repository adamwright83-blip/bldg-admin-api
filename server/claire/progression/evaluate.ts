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
  /**
   * No-backlog watermark: business progress recognized at or before this instant has already been
   * considered for entitlement minting. Null until the operator first becomes eligible.
   */
  entitlementWatermark: string | null;
};

export const EMPTY_GRANT: ProgressionGrant = {
  rapportBand: 0,
  rapportPolicyVersion: null,
  personalRung: 0,
  rungPolicyVersion: null,
  entitlementWatermark: null,
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
  /**
   * Recognized, qualifying business-progress evidence (occurred on/after the program epoch), oldest
   * recognition first. Whether any of it MINTS an entitlement is decided by the no-backlog rule in
   * service.ts, never by mere existence here.
   */
  qualifyingProgress: ProgressionEvidence[];
};

/** Historical pre-epoch business results are preserved as evidence but are baseline, not progress. */
export function isQualifyingProgress(item: ProgressionEvidence, policy: ProgressionPolicy): boolean {
  return item.category === "business_progress" && Date.parse(item.occurredAt) >= Date.parse(policy.progressEpoch);
}

function dayOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function countProgressionEvidence(
  evidence: readonly ProgressionEvidence[],
  asOf: Date,
  policy: ProgressionPolicy = PROGRESSION_POLICY
): ProgressionCounts {
  const recognized = evidence.filter(item => Date.parse(item.recognizedAt) <= asOf.getTime());
  const growth = recognized.filter(item => item.category === "growth_action");
  const progress = recognized.filter(item => isQualifyingProgress(item, policy));
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
  const counts = countProgressionEvidence(input.evidence, input.asOf, policy);

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
    entitlementWatermark: prior.entitlementWatermark,
  };

  const qualifyingProgress = input.evidence
    .filter(item => isQualifyingProgress(item, policy) && Date.parse(item.recognizedAt) <= input.asOf.getTime())
    .sort((a, b) => Date.parse(a.recognizedAt) - Date.parse(b.recognizedAt) || Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  return {
    counts,
    computedRapportBand,
    computedRung,
    grant,
    qualifyingProgress,
  };
}
