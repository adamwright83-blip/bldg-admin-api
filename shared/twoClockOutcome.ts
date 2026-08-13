/**
 * Two clocks, structurally kept apart.
 *
 * FICTIONAL PERFORMANCE — a timer result, a clean/poor execution grade, a
 * game-only score. Presentation state. It never reaches business truth.
 *
 * AUTHORITATIVE ACTION RESOLUTION — comes only from the existing evidence/
 * attestation paths already wired through `GoldlineActionServices`
 * (recordCall, recordVisitOutcome, completeFollowUp, recover). This module
 * does not add a new resolution path; it exists to make the SEPARATION
 * between the two an explicit, testable type boundary rather than a
 * convention someone could quietly violate.
 *
 * The structural guarantee: `FictionalPerformanceResult` and
 * `AuthoritativeActionResolution` are disjoint types with no shared field
 * and no conversion function between them anywhere in this file or its
 * callers. A caller cannot pass a `FictionalPerformanceResult` to any real
 * business-mutation call because the business-mutation calls
 * (`GoldlineActionServices`) simply do not accept that type — see
 * client/src/game/actions/actionServices.ts, untouched by this module.
 */

/** Presentation-only. A losing/expiring timer can produce this and nothing else. */
export type FictionalPerformanceResult = {
  outcome: "success" | "failure" | "in_progress";
  /** True only when a gameplay countdown reached zero — never a real deadline. */
  timerExpired: boolean;
  /** Optional game-only score; never persisted as business evidence. */
  score: number | null;
};

/**
 * What actually happened in reality, per the existing authoritative
 * evidence paths. This is a read-only summary type for display — the
 * resolution itself always happens through the existing
 * `GoldlineActionServices` write methods, never through this module.
 */
export type AuthoritativeActionResolution = {
  resolved: boolean;
  /** e.g. "won" | "lost" | "follow_up" | "recorded" — sourced from real service responses. */
  resolutionKind: string | null;
  /** Real count of legitimately-evidenced units (e.g. attested visits) — never inferred from fiction. */
  evidencedCount: number;
};

/**
 * Explicit two-clock combinator used by presentation code that needs to
 * decide what to SHOW, never what to DO. It can only ever be a passthrough
 * of the authoritative side — the fictional side has no path into the
 * return value's business-relevant fields.
 *
 * Given: containment timer expires (fictional failure) with 0 authoritative
 * evidence -> real work remains unresolved, count stays 0.
 * Given: 25 legitimate attestations exist but fictional performance is poor
 * -> authoritative resolution still reflects the real 25.
 */
export function presentedResolution(input: {
  fictional: FictionalPerformanceResult;
  authoritative: AuthoritativeActionResolution;
}): AuthoritativeActionResolution {
  // The fictional result is intentionally unread past this point — its
  // presence in the input is only so a caller can show "the game also
  // ended" alongside the real result, never to influence it.
  void input.fictional;
  return input.authoritative;
}
