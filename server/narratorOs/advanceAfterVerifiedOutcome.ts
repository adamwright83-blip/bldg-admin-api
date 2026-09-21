import { orchestrateSelectedBeatReaction } from "./selectedBeatOrchestration";
import { playerPresentationPayload } from "./playerPresentation";
import {
  deriveNarrativePresentationPlan,
  type NarrativePresentationPlan,
} from "./presentationPlan";
import type { PlayerPresentationPayload } from "./playerPresentation";
import type { NarratorStore, OperatorScope } from "./store";
import { isVerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";
import type { VerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";

/**
 * Downstream of a legitimately verified Goldline receipt.
 *
 * Uses the receipt as eligibility input, calls the existing Slice G
 * selected-beat orchestration, and if that commit succeeds derives a
 * presentation plan. It does not mint receipts, authorize a producer,
 * invent verification, write presentation receipts, or touch business
 * truth. A Narrator failure is returned to the caller and is not a
 * business rollback.
 *
 * Production producers stay empty. This function is dormant until a
 * trustworthy producer is wired by an explicit later change.
 */
export type AdvanceNarratorAfterVerifiedOutcomeResult = {
  readonly advanced: boolean;
  readonly narrationFailed: boolean;
  readonly failureReason: string | null;
  readonly presentation: NarrativePresentationPlan | null;
  readonly playerPayload: PlayerPresentationPayload | null;
};

function idle(reason: string | null): AdvanceNarratorAfterVerifiedOutcomeResult {
  return Object.freeze({
    advanced: false,
    narrationFailed: false,
    failureReason: reason,
    presentation: null,
    playerPayload: null,
  });
}

function failed(reason: string): AdvanceNarratorAfterVerifiedOutcomeResult {
  return Object.freeze({
    advanced: false,
    narrationFailed: true,
    failureReason: reason,
    presentation: null,
    playerPayload: null,
  });
}

export async function advanceNarratorAfterVerifiedOutcome(input: {
  store: NarratorStore;
  scope: OperatorScope;
  verifiedGoldline: readonly VerifiedGoldlineReceipt[];
  nowMs: number;
  nowIso?: string;
}): Promise<AdvanceNarratorAfterVerifiedOutcomeResult> {
  if (input.verifiedGoldline.length === 0) {
    return idle("no_verified_goldline_receipt");
  }
  const legitimate = input.verifiedGoldline.filter(isVerifiedGoldlineReceipt);
  if (legitimate.length !== input.verifiedGoldline.length) {
    return idle("unverified_goldline_receipt");
  }
  if (
    legitimate.some(
      receipt =>
        receipt.tenantId !== input.scope.tenantId ||
        receipt.operatorUserId !== input.scope.operatorUserId
    )
  ) {
    return idle("receipt_scope_mismatch");
  }

  let beforeIds: Set<string>;
  try {
    const before = await input.store.load(input.scope);
    if (!before) return failed("narrator_operator_not_initialized");
    beforeIds = new Set(before.ledger.map(entry => entry.id));
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }

  try {
    const orchestration = await orchestrateSelectedBeatReaction({
      store: input.store,
      scope: input.scope,
      verifiedGoldline: legitimate,
      nowMs: input.nowMs,
      nowIso: input.nowIso,
    });
    if (!orchestration.committed) {
      return idle(orchestration.reason);
    }
    const fired = orchestration.snapshot.ledger.find(
      entry =>
        entry.kind === "FIRED_AUTHORED_BEAT" && !beforeIds.has(entry.id)
    );
    if (!fired) return idle("committed_without_new_fired_beat");
    const presentation = deriveNarrativePresentationPlan(
      orchestration.snapshot,
      fired.id
    );
    return Object.freeze({
      advanced: true,
      narrationFailed: false,
      failureReason: null,
      presentation,
      playerPayload: playerPresentationPayload(presentation),
    });
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
