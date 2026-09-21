import type {
  DramaturgyDecision,
  DramaturgyReasonCode,
  EligibilityOutcome,
  NarrativeBeatId,
  NarrativeEligibilityResult,
} from "../../shared/narratorOs/contracts";
import type { AuthoredDramaturgyTieBreak } from "./dramaturgy";

/**
 * Shared exact-set matcher. Not a production Narrator export.
 * `server/narratorOs/index.ts` must not re-export this module.
 * Production `decideDramaturgy` calls it with the frozen authored catalog only.
 */

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

function freezeDecision(fields: DramaturgyDecision): DramaturgyDecision {
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

export function decideDramaturgyWithCatalog(
  eligibility: NarrativeEligibilityResult,
  rules: readonly AuthoredDramaturgyTieBreak[]
): DramaturgyDecision {
  const suppliedEligible = uniqueIds(eligibility.eligibleBeatIds);
  const suppliedWithheld = uniqueIds(eligibility.withheldBeatIds);
  const eligibilityOutcome = eligibility.outcome;

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
