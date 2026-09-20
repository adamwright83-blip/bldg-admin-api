/**
 * Inhibition — the cognitive leaps Executive Function explicitly blocks.
 *
 * Every entry here is a candidate that was available and was refused. Recording them
 * is the point: a suppression that leaves no trace is indistinguishable from a bug,
 * and when the two minds disagree in shadow, the inhibition list is usually the reason.
 *
 * Inhibition never speaks and never decides an answer. It reports what was blocked.
 */

import type { AttentionPlan } from "../contracts/attention";
import type { ExecutiveControlState } from "../contracts/control";
import type { EvidenceItem } from "../contracts/evidence";
import type { InhibitedCandidate } from "../contracts/executiveDecision";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";

export function applyInhibition(input: {
  perceived: PerceivedTurn;
  memory: WorkingMemorySnapshot;
  attention: AttentionPlan;
  control: ExecutiveControlState;
  evidence: readonly EvidenceItem[];
  orderedQueryAllowed: boolean;
}): InhibitedCandidate[] {
  const { perceived, memory, attention, control, evidence, orderedQueryAllowed } = input;
  const out: InhibitedCandidate[] = [];

  // Parser found action-shaped text without authority to act on it.
  if (perceived.mayProposeWorkHint && !perceived.explicitActionRequest && !perceived.operatorWorkCommitment) {
    out.push({
      kind: "parser_text_as_action_authority",
      detail: "mayProposeWorkHint is a hint, not authority",
    });
  }

  // A pending item exists but this utterance is not about it.
  const holdingPending = Boolean(memory.pendingProposal || memory.pendingBriefing || memory.pendingAccountFollowUp);
  if (holdingPending && attention.pendingDisposition === "none") {
    out.push({
      kind: "pending_as_intent",
      detail: "a held pending item must not supply the meaning of an unrelated utterance",
    });
  }

  // Context that is remembered but barred from this turn.
  for (const slot of control.suppressedContext) {
    if (slot === "pending_proposal" && holdingPending) {
      out.push({
        kind: "pending_as_intent",
        detail: "pending context suppressed: the operator moved to a different task",
      });
    }
    if (slot === "ordered_query" && memory.orderedQuery && !orderedQueryAllowed) {
      out.push({
        kind: "pending_as_intent",
        detail: "the previous ordered result may not answer a new question",
      });
    }
  }

  // The global board is salient and almost always irrelevant to a scoped question.
  if (!attention.boardEligible) {
    out.push({
      kind: "global_goal_contaminates_scope",
      detail: "global board/goals not retrieved for this scoped turn",
    });
  }

  // History that would otherwise read as present truth.
  for (const item of evidence) {
    if (item.authoritativeFor.includes("historical_observation") && item.authoritativeFor.includes("current_business_truth")) {
      out.push({
        kind: "episodic_as_current_truth",
        detail: `evidence ${item.id} claimed both history and current truth`,
      });
    }
  }

  // An ambiguous identity must not be silently resolved to one option.
  if (control.ambiguity === "requires_clarification") {
    out.push({
      kind: "model_statement_as_evidence",
      detail: "ambiguous identity was not resolved by guessing; clarification is required",
    });
  }

  // A challenged claim answered from the old receipt rather than a fresh read.
  if (attention.priorClaim === "correctness" && !control.epistemic.priorClaimRechecked) {
    out.push({
      kind: "stale_receipt_as_fresh_proof",
      detail: "the prior claim was challenged but could not be freshly re-read",
    });
  }

  // Without proven coverage, a negative claim is not licensed.
  if (!control.epistemic.negativeClaimLicensed) {
    out.push({
      kind: "model_statement_as_evidence",
      detail: "unsupported negative claim inhibited: absence of evidence is not evidence of absence",
    });
  }

  return out;
}
