import type {
  DramaturgyDecision,
  DramaturgyReasonCode,
  EligibilityOutcome,
  NarrativeBeatId,
  NarrativeEligibilityResult,
} from "../../shared/narratorOs/contracts";

/**
 * An explicit deterministic rule for one exact set of simultaneously
 * surfaceable beats. Order inside `surfaceableBeatIds` is not priority.
 * The selected beat is `selectBeatId` alone.
 */
export type AuthoredDramaturgyTieBreak = {
  readonly ruleId: string;
  readonly surfaceableBeatIds: readonly NarrativeBeatId[];
  readonly selectBeatId: NarrativeBeatId;
  readonly authoredSourceRef: string;
};

/**
 * Authored dramaturgy tie-breaks.
 *
 * Authority searched, and not encoded as runtime priority:
 * - GOLDLINE_CANON.md v1.1 Act I build order (M01 shell, then M02, M03,
 *   M04) is an authoring sequence. It is not a rule for choosing among
 *   beats that are surfaceable at the same time.
 * - GOLDLINE_NARRATOR_CANON_PACKAGE.md v1.2-proposed. M02's "M01 resolved
 *   OR parallel live stop" line is a WORKING spawn note on an INCOMPLETE
 *   beat, not a selection rule. C-06 `defaultSurface: false` withholds
 *   that beat. "Later dramaturgy may surface" does not name a deterministic
 *   choice among collisions and does not promote C-06.
 *
 * No current collision has an explicit deterministic selection rule.
 * This catalog stays empty until locked canon states one.
 */
export const AUTHORED_DRAMATURGY_TIE_BREAKS: readonly AuthoredDramaturgyTieBreak[] =
  Object.freeze([]);

export type DramaturgyInput = {
  readonly eligibility: NarrativeEligibilityResult;
  /**
   * Production callers omit this and get `AUTHORED_DRAMATURGY_TIE_BREAKS`.
   * A supplied catalog is still exact-set matching only. It cannot rank
   * by position.
   */
  readonly tieBreaks?: readonly AuthoredDramaturgyTieBreak[];
};

function uniqueIds(ids: readonly NarrativeBeatId[]): NarrativeBeatId[] {
  const seen = new Set<string>();
  const out: NarrativeBeatId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sameIdSet(
  left: readonly NarrativeBeatId[],
  right: readonly NarrativeBeatId[]
): boolean {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

type TieBreakMatch =
  | { status: "none" }
  | { status: "one"; rule: AuthoredDramaturgyTieBreak }
  | { status: "conflict" };

function matchTieBreak(
  surfaceable: readonly NarrativeBeatId[],
  rules: readonly AuthoredDramaturgyTieBreak[]
): TieBreakMatch {
  if (surfaceable.length < 2) return { status: "none" };
  const matches = rules.filter(
    rule =>
      rule.surfaceableBeatIds.length >= 2 &&
      sameIdSet(rule.surfaceableBeatIds, surfaceable) &&
      surfaceable.includes(rule.selectBeatId)
  );
  if (matches.length === 0) return { status: "none" };
  const selected = new Set(matches.map(rule => rule.selectBeatId));
  if (selected.size !== 1) return { status: "conflict" };
  return { status: "one", rule: matches[0]! };
}

function freezeDecision(
  fields: Omit<DramaturgyDecision, never>
): DramaturgyDecision {
  return Object.freeze({
    ...fields,
    candidateBeatIds: Object.freeze([...fields.candidateBeatIds]),
    surfaceableBeatIds: Object.freeze([...fields.surfaceableBeatIds]),
    withheldBeatIds: Object.freeze([...fields.withheldBeatIds]),
    refusedPromotionBeatIds: Object.freeze([...fields.refusedPromotionBeatIds]),
  });
}

function silence(input: {
  outcome: "SILENCE_NO_ELIGIBLE" | "SILENCE_WITHHELD";
  eligibilityOutcome: EligibilityOutcome;
  candidateBeatIds: readonly NarrativeBeatId[];
  withheldBeatIds: readonly NarrativeBeatId[];
  refusedPromotionBeatIds: readonly NarrativeBeatId[];
  reasonCode: DramaturgyReasonCode;
}): DramaturgyDecision {
  return freezeDecision({
    outcome: input.outcome,
    selectedBeatId: null,
    candidateBeatIds: input.candidateBeatIds,
    eligibilityOutcome: input.eligibilityOutcome,
    surfaceableBeatIds: [],
    withheldBeatIds: input.withheldBeatIds,
    refusedPromotionBeatIds: input.refusedPromotionBeatIds,
    reasonCode: input.reasonCode,
    authoredTieBreakRequired: false,
    authoredTieBreakExisted: false,
    authoredTieBreakRuleId: null,
  });
}

/**
 * Choose among beats eligibility already marked surfaceable.
 *
 * Read-only. No store, no clock, no randomness, no model call.
 * Does not re-check prerequisites, canon status, offscreen permission,
 * withheld metadata, or Goldline receipt trust. Those stay in eligibility.
 * A returned decision is not an eligibility authorization.
 */
export function decideDramaturgy(input: DramaturgyInput): DramaturgyDecision {
  const rules = input.tieBreaks ?? AUTHORED_DRAMATURGY_TIE_BREAKS;
  const suppliedEligible = uniqueIds(input.eligibility.eligibleBeatIds);
  const suppliedWithheld = uniqueIds(input.eligibility.withheldBeatIds);
  const eligibilityOutcome = input.eligibility.outcome;

  if (eligibilityOutcome === "ELIGIBLE_WITHHELD") {
    return silence({
      outcome: "SILENCE_WITHHELD",
      eligibilityOutcome,
      candidateBeatIds: suppliedWithheld,
      withheldBeatIds: suppliedWithheld,
      refusedPromotionBeatIds: suppliedEligible,
      reasonCode: "only_withheld_candidates",
    });
  }

  if (eligibilityOutcome !== "ELIGIBLE" || suppliedEligible.length === 0) {
    return silence({
      outcome: "SILENCE_NO_ELIGIBLE",
      eligibilityOutcome:
        eligibilityOutcome === "ELIGIBLE" ? "ELIGIBLE" : eligibilityOutcome,
      candidateBeatIds: [],
      withheldBeatIds: [],
      refusedPromotionBeatIds: uniqueIds([
        ...suppliedEligible,
        ...suppliedWithheld,
      ]),
      reasonCode: "no_surfaceable_eligible_beat",
    });
  }

  const surfaceable = suppliedEligible;
  const withheld = suppliedWithheld.filter(id => !surfaceable.includes(id));
  const candidateBeatIds = uniqueIds([...surfaceable, ...withheld]);

  if (surfaceable.length === 1) {
    return freezeDecision({
      outcome: "SELECT",
      selectedBeatId: surfaceable[0]!,
      candidateBeatIds,
      eligibilityOutcome,
      surfaceableBeatIds: surfaceable,
      withheldBeatIds: withheld,
      refusedPromotionBeatIds: [],
      reasonCode: "single_surfaceable_eligible_beat",
      authoredTieBreakRequired: false,
      authoredTieBreakExisted: false,
      authoredTieBreakRuleId: null,
    });
  }

  const match = matchTieBreak(surfaceable, rules);
  if (match.status === "one") {
    return freezeDecision({
      outcome: "SELECT",
      selectedBeatId: match.rule.selectBeatId,
      candidateBeatIds,
      eligibilityOutcome,
      surfaceableBeatIds: surfaceable,
      withheldBeatIds: withheld,
      refusedPromotionBeatIds: [],
      reasonCode: "authored_tie_break_applied",
      authoredTieBreakRequired: true,
      authoredTieBreakExisted: true,
      authoredTieBreakRuleId: match.rule.ruleId,
    });
  }

  return freezeDecision({
    outcome: "AMBIGUOUS_REQUIRES_AUTHORED_RULE",
    selectedBeatId: null,
    candidateBeatIds,
    eligibilityOutcome,
    surfaceableBeatIds: surfaceable,
    withheldBeatIds: withheld,
    refusedPromotionBeatIds: [],
    reasonCode:
      match.status === "conflict"
        ? "authored_tie_breaks_disagree"
        : "multiple_surfaceable_no_authored_tie_break",
    authoredTieBreakRequired: true,
    authoredTieBreakExisted: match.status === "conflict",
    authoredTieBreakRuleId: null,
  });
}
