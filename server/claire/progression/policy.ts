/**
 * Earned Rapport + Guarded Disclosure — the ONE versioned policy module.
 *
 * Every threshold below is a provisional product-tuning value, not a
 * psychological truth. Nothing else in the codebase may hard-code these
 * numbers. Grants are monotonic (see evaluate.ts): tightening a threshold
 * later never removes a grant an operator already earned.
 */

// 2: no-backlog entitlement cursor, canonical order truth, progress epoch, narrowed live evidence kinds.
export const PROGRESSION_POLICY_VERSION = "rapport-disclosure-2026-09-19.2";

export type RapportBand = 0 | 1 | 2 | 3;
export type PersonalAccessRung = 0 | 1 | 2 | 3;

export type RapportThreshold = { band: 1 | 2 | 3; minActions: number; minActionDays: number };
export type RungThreshold = {
  rung: 1 | 2 | 3;
  minActions: number;
  minActionDays: number;
  minProgressEvents: number;
  minStrongResults: number;
  /** Rung 3 additionally requires the existing disclosure-safety requirements to hold. */
  requireDisclosureSafety: boolean;
};

export type ProgressionPolicy = {
  version: string;
  rapport: readonly RapportThreshold[];
  rungs: readonly RungThreshold[];
  /**
   * Personal exchanges Claire tolerates per conversation at each rung. This is
   * a separate control from which facts she may reveal. Never shown to the operator.
   */
  personalExchangeBudget: Record<PersonalAccessRung, number>;
  /**
   * Business results that occurred before this instant are the operator's pre-existing baseline: they
   * are preserved as evidence but never count as progress toward a rung or mint an entitlement.
   * Without this, years of existing customers would make Rung 1 effort-only. It compares occurredAt
   * (when reality happened), so a delayed import of a post-epoch event still qualifies.
   */
  progressEpoch: string;
  /** A reserved-but-uncommitted entitlement returns to "unused" after this long. */
  entitlementReservationTtlMs: number;
};

export const PROGRESSION_POLICY: ProgressionPolicy = {
  version: PROGRESSION_POLICY_VERSION,
  rapport: [
    { band: 1, minActions: 3, minActionDays: 2 },
    { band: 2, minActions: 8, minActionDays: 5 },
    { band: 3, minActions: 20, minActionDays: 10 },
  ],
  rungs: [
    { rung: 1, minActions: 5, minActionDays: 3, minProgressEvents: 1, minStrongResults: 0, requireDisclosureSafety: false },
    { rung: 2, minActions: 12, minActionDays: 6, minProgressEvents: 2, minStrongResults: 1, requireDisclosureSafety: false },
    { rung: 3, minActions: 25, minActionDays: 12, minProgressEvents: 4, minStrongResults: 2, requireDisclosureSafety: true },
  ],
  // Rung 1: one substantive answer + one natural follow-up. Rung 2: 2-3. Rung 3: 4-5.
  personalExchangeBudget: { 0: 0, 1: 2, 2: 3, 3: 5 },
  progressEpoch: "2026-09-19T00:00:00.000Z",
  entitlementReservationTtlMs: 10 * 60 * 1000,
};

/**
 * "Encouragement on every call" — what it means in Claire's voice.
 *
 * This is an operator-authored standing instruction (kind `encouragement_every_call`), not a rapport
 * reward. It earns no rapport, entitlement, rung or canon, and it never reads call volume. Claire may
 * say it at any rapport band because it carries no biography; the band only changes warmth of phrasing.
 *
 * The shape is ONE grounded sentence that ties the operator's next move to the goal, built only from
 * facts that are true in this call (a verified figure, the operator's own stated goal, verified
 * progress this week). Example of the shape: "Fifty is attainable if you count buildings." It is
 * never praise for nothing, never a pep talk, never a question, and never one of the authored
 * decline/closer lines in dialogueRegistry (those are refusals; reusing one as warmth would tell the
 * operator "no" in the voice of "good job").
 */
export const ENCOURAGEMENT_POLICY_VERSION = "encouragement-2026-10-21.1";

export const ENCOURAGEMENT_POLICY = {
  version: ENCOURAGEMENT_POLICY_VERSION,
  sentencesPerCall: 1,
  evidence: ["verified_business_figure", "operator_stated_goal", "verified_progress_this_week"],
  mustTieTo: "the operator's next move and the goal",
  /** Rapport band -> phrasing warmth. Content rules are identical at every band. */
  warmth: { 0: "plain", 1: "plain", 2: "warm", 3: "warm" } as Record<RapportBand, "plain" | "warm">,
  usesAuthoredDialogueLines: false,
  forbidden: [
    "praise with no fact behind it",
    "exclamation marks",
    "a question",
    "a promise about a later call",
    "personal biography",
    "any figure that is not in the verified fact inventory or the operator's own words",
  ],
  exampleShape: "Fifty is attainable if you count buildings.",
} as const;

export function encouragementGuidance(band: RapportBand = 0): string {
  const tone = ENCOURAGEMENT_POLICY.warmth[band] === "warm" ? "Warm, still brief." : "Plain and brief.";
  return (
    "ENCOURAGEMENT (operator standing instruction, every call): say exactly one sentence that ties the operator's next move to the goal, " +
    "using only facts already verified in this call or the operator's own words. " +
    `Shape, not wording to repeat: "${ENCOURAGEMENT_POLICY.exampleShape}" ${tone} ` +
    "No praise without a fact behind it, no exclamation marks, no question, no promise about a later call, no biography, " +
    "and never reuse a refusal or closing line from the authored dialogue for it."
  );
}
