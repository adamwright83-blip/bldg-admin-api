import type {
  DramaturgyDecision,
  NarrativeBeatId,
  NarrativeEligibilityResult,
} from "../../shared/narratorOs/contracts";
import { selectAuthoredDramaturgy } from "./dramaturgySelect";

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

export { AUTHORED_DRAMATURGY_TIE_BREAKS } from "./dramaturgySelect";

export type DramaturgyInput = {
  readonly eligibility: NarrativeEligibilityResult;
};

/**
 * Choose among beats eligibility already marked surfaceable.
 *
 * Read-only. No store, no clock, no randomness, no model call.
 * The rule catalog is `AUTHORED_DRAMATURGY_TIE_BREAKS` only.
 * Does not re-check prerequisites, canon status, offscreen permission,
 * withheld metadata, or Goldline receipt trust. Those stay in eligibility.
 * A returned decision is not an eligibility authorization.
 */
export function decideDramaturgy(input: DramaturgyInput): DramaturgyDecision {
  return selectAuthoredDramaturgy(input.eligibility);
}
