import type {
  DramaturgyDecision,
  NarrativeBeatId,
  NarrativeEligibilityResult,
} from "../../shared/narratorOs/contracts";
import { decideDramaturgyWithCatalog } from "./dramaturgySelect";

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
 * Callers cannot replace it. Production decisions read this value only.
 */
export const AUTHORED_DRAMATURGY_TIE_BREAKS: readonly AuthoredDramaturgyTieBreak[] =
  Object.freeze([]);

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
  return decideDramaturgyWithCatalog(
    input.eligibility,
    AUTHORED_DRAMATURGY_TIE_BREAKS
  );
}
