/**
 * Executive skeleton. Produces exactly one ExecutiveDecision per completed turn.
 * No mutations. No live speech. Model is not consulted in this phase.
 */

import type { ExecutiveDecision, InhibitedCandidate } from "../contracts/executiveDecision";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { ResponseSegment } from "../contracts/responsePlan";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";
import { planAttention } from "./attention";
import { mintActionGrant, mintCallControlGrant } from "./grants";
import { assertGovernedDecision } from "./governor";

function conversational(text: string): ResponseSegment {
  return { type: "ConversationalSegment", text };
}

export function decideTurn(perceived: PerceivedTurn, memory: WorkingMemorySnapshot): ExecutiveDecision {
  const inhibited: InhibitedCandidate[] = [];
  const attention = planAttention(perceived, memory);

  if (perceived.completeness === "incomplete") {
    inhibited.push({ kind: "half_turn", detail: "Perception has not released a complete thought" });
  }
  if (perceived.mayProposeWorkHint && !perceived.explicitActionRequest && !perceived.operatorWorkCommitment) {
    inhibited.push({
      kind: "parser_text_as_action_authority",
      detail: "mayProposeWorkHint is not authority",
    });
  }
  if (attention.pendingDisposition === "none" && (memory.pendingBriefing || memory.pendingProposal)) {
    inhibited.push({
      kind: "pending_as_intent",
      detail: "holding pending must not reinterpret this utterance",
    });
  }
  if (!attention.boardEligible) {
    inhibited.push({
      kind: "global_goal_contaminates_scope",
      detail: "global board/goals not retrieved for this turn",
    });
  }

  const segments: ResponseSegment[] = [];
  const actionGrants: ExecutiveDecision["actionGrants"] = [];
  let callControl: ExecutiveDecision["callControl"] = { endCall: false };

  if (perceived.completeness === "incomplete") {
    segments.push(conversational(""));
  } else {
    if (attention.pendingDisposition === "reject") {
      segments.push(conversational("Understood. I won't."));
    } else if (attention.pendingDisposition === "supersede") {
      segments.push(conversational(""));
    } else if (attention.lanes.includes("business") && perceived.businessIntent === "judgment_question") {
      segments.push(conversational(""));
    } else if (attention.lanes.includes("conversation") || attention.lanes.includes("business")) {
      segments.push(conversational(""));
    }

    if (
      (perceived.explicitActionRequest || perceived.operatorWorkCommitment) &&
      !perceived.refusal &&
      attention.pendingDisposition !== "reject"
    ) {
      const grant = mintActionGrant({
        actionClass: "propose_day_line",
        scope: {},
        authorityBasis: perceived.explicitActionRequest ? "current_turn_explicit_request" : "current_turn_operator_commitment",
        sourceTurnAssembledText: perceived.assembledText,
        expiresAtMs: Date.now() + 15 * 60_000,
        constraints: { mutationAllowed: false, shadowOnly: true },
      });
      actionGrants.push(grant);
      segments.push({ type: "ActionProposalSegment", text: "", grant });
    }

    if (attention.pendingDisposition === "confirm") {
      const grant = mintActionGrant({
        actionClass: "commit_briefing",
        scope: { identity: memory.pendingBriefing?.identity ?? memory.pendingProposal?.identity },
        authorityBasis: "pending_lifecycle",
        sourceTurnAssembledText: perceived.assembledText,
        expiresAtMs: Date.now() + 15 * 60_000,
        constraints: { mutationAllowed: false, shadowOnly: true },
      });
      actionGrants.push(grant);
    }

    if (perceived.callControl === "end") {
      const grant = mintCallControlGrant({
        endCall: true,
        basis: "operator_leave_taking",
        sourceTurnAssembledText: perceived.assembledText,
      });
      callControl = { endCall: true, grant };
      segments.push({ type: "CallControlSegment", text: "", endCall: true, grant });
    }
  }

  const responsePlan = { perceivedTurn: perceived, attention, segments };
  const decision: ExecutiveDecision = {
    perceivedTurn: perceived,
    attention,
    retrievals: [],
    evidence: [],
    conclusions: [],
    inhibitedCandidates: inhibited,
    responsePlan,
    responseSegments: segments,
    actionGrants,
    callControl,
    productionAuthority: false,
  };
  assertGovernedDecision(decision);
  return decision;
}
