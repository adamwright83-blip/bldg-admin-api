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
