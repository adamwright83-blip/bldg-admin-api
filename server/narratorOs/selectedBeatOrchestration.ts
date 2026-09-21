import type {
  DramaturgyDecision,
  DramaturgyReasonCode,
  EligibilityOutcome,
  NarrativeEligibilityResult,
} from "../../shared/narratorOs/contracts";
import { decideDramaturgy } from "./dramaturgy";
import {
  evaluateProductionEligibility,
  isEligibilityAuthorization,
  issueEligibilityAuthorizations,
  type EligibilityAuthorization,
  type EligibilityInput,
} from "./eligibility";
import { commitAuthorizedBeat } from "./ledger";
import { AUTHORED_BEATS, AUTHORED_GRAPH } from "./registry";
import type { NarratorSnapshot, NarratorStore, OperatorScope } from "./store";
import type { VerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";

/**
 * Selected-beat authored reaction and narrative memory.
 *
 * `decideDramaturgy` chooses among beats production eligibility already
 * marked surfaceable. That decision is not an authorization. This function
 * asks the existing production path for an eligibility authorization of
 * that one beat, then calls `commitAuthorizedBeat`.
 *
 * `commitAuthorizedBeat` is the only applier of the beat's authored
 * knowledge mutations, authored state mutations, and fired-beat ledger
 * entry. Those writes are the reaction and the memory. This module does
 * not add a second mutation engine, a reaction record, Claire speech, or
 * presentation delivery.
 *
 * Silence, withheld, and ambiguous dramaturgy do not commit. A SELECT
 * decision does not commit unless production eligibility issued
 * authorization for that beat alone.
 */

export type SelectedBeatOrchestrationInput = {
  readonly store: NarratorStore;
  readonly scope: OperatorScope;
  readonly verifiedGoldline: readonly VerifiedGoldlineReceipt[];
  readonly nowMs: number;
  readonly mode: "interactive" | "offscreen";
  readonly nowIso?: string;
};

export type SelectedBeatOrchestrationReason =
  | DramaturgyReasonCode
  | "selected_beat_without_eligibility_authorization"
  | "committed_authorized_beat";

export type SelectedBeatOrchestrationResult = {
  readonly committed: boolean;
  readonly reason: SelectedBeatOrchestrationReason;
  readonly decision: DramaturgyDecision;
  readonly eligibilityOutcome: EligibilityOutcome;
  readonly snapshot: NarratorSnapshot;
};

/**
 * Return the authorization only when dramaturgy selected a beat and every
 * supplied authorization is for that same beat. Several authorized beats
 * return null: this function does not pick one. It does not mint
 * authorization and it does not write.
 */
export function matchSingleSelectedBeatAuthorization(
  decision: DramaturgyDecision,
  authorizations: readonly EligibilityAuthorization[]
): EligibilityAuthorization | null {
  if (decision.outcome !== "SELECT" || decision.selectedBeatId == null) {
    return null;
  }
  const branded = authorizations.filter(isEligibilityAuthorization);
  if (branded.length === 0 || branded.length !== authorizations.length) {
    return null;
  }
  const beatIds = new Set(branded.map(authorization => authorization.beatId));
  if (beatIds.size !== 1 || !beatIds.has(decision.selectedBeatId)) {
    return null;
  }
  return branded[0]!;
}

function unfinished(input: {
  reason: SelectedBeatOrchestrationReason;
  decision: DramaturgyDecision;
  eligibility: NarrativeEligibilityResult;
  snapshot: NarratorSnapshot;
}): SelectedBeatOrchestrationResult {
  return Object.freeze({
    committed: false,
    reason: input.reason,
    decision: input.decision,
    eligibilityOutcome: input.eligibility.outcome,
    snapshot: input.snapshot,
  });
}

export async function orchestrateSelectedBeatReaction(
  input: SelectedBeatOrchestrationInput
): Promise<SelectedBeatOrchestrationResult> {
  const snapshot = await input.store.load(input.scope);
  if (!snapshot) throw new Error("Narrator operator is not initialized");

  const eligibility: EligibilityInput = {
    snapshot,
    verifiedGoldline: input.verifiedGoldline,
    nowMs: input.nowMs,
    mode: input.mode,
    registry: AUTHORED_BEATS,
    graph: AUTHORED_GRAPH,
  };
  const result = evaluateProductionEligibility(eligibility);
  const decision = decideDramaturgy({ eligibility: result });

  if (decision.outcome !== "SELECT" || decision.selectedBeatId == null) {
    return unfinished({
      reason: decision.reasonCode,
      decision,
      eligibility: result,
      snapshot,
    });
  }

  const authorization = matchSingleSelectedBeatAuthorization(
    decision,
    issueEligibilityAuthorizations(result, eligibility)
  );
  if (!authorization) {
    return unfinished({
      reason: "selected_beat_without_eligibility_authorization",
      decision,
      eligibility: result,
      snapshot,
    });
  }

  const committed = await commitAuthorizedBeat({
    store: input.store,
    scope: input.scope,
    authorization,
    eligibility,
    nowIso: input.nowIso,
  });
  return Object.freeze({
    committed: true,
    reason: "committed_authorized_beat",
    decision,
    eligibilityOutcome: result.outcome,
    snapshot: committed,
  });
}
