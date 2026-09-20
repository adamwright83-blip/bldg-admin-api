/**
 * Executive attention: which compartments to consult, which not to, whether
 * pending binds this turn. Informs retrieval. Does not speak or mutate.
 */

import type { AttentionPlan } from "../contracts/attention";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";
import type { CompartmentId } from "../contracts/retrieval";

function holding(memory: WorkingMemorySnapshot): boolean {
  return Boolean(memory.pendingProposal || memory.pendingBriefing || memory.pendingAccountFollowUp);
}

/** Bindings for a pending item only — never a reading of a new unrelated utterance. */
function pendingReply(text: string): "yes" | "no" | "revise" | null {
  const trimmed = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (/^(?:no|nope|nah)$/.test(trimmed)) return "no";
  if (/^(?:yes|yeah|yep|yup|ok|okay|sure|please|do it)$/.test(trimmed)) return "yes";
  if (/^(?:no|nope),?\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/.test(trimmed)) {
    return "revise";
  }
  if (/\b(?:change|move|switch|make(?:\s+it)?)\b[\s\S]{0,80}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/.test(trimmed)) {
    return "revise";
  }
  return null;
}

/**
 * Pending may bind yes/no/revise. A new business/personal question supersedes.
 * Pending never supplies the meaning of an unrelated utterance.
 */
export function planAttention(perceived: PerceivedTurn, memory: WorkingMemorySnapshot): AttentionPlan {
  const rationale: string[] = [];
  const retrieve: CompartmentId[] = ["workingMemory"];
  const doNotRetrieve: CompartmentId[] = [];

  const holdingPending = holding(memory);
  let pendingDisposition: AttentionPlan["pendingDisposition"] = "none";
  const pendingBind = holdingPending ? pendingReply(perceived.assembledText) : null;
  if (holdingPending) {
    const genuineNewTopic =
      perceived.priorQueryReference ||
      perceived.businessIntent === "broad_briefing" ||
      perceived.businessIntent === "list_query" ||
      perceived.businessIntent === "judgment_question" ||
      perceived.businessIntent === "correctness_challenge" ||
      perceived.businessIntent === "provenance_question" ||
      perceived.personalProbe ||
      perceived.narrativeProbe ||
      (perceived.hasBusinessQuestion && /\?/.test(perceived.assembledText));
    if (genuineNewTopic && pendingBind === null) {
      pendingDisposition = "supersede";
      rationale.push("new utterance is not about the pending item");
    } else if (pendingBind === "no" || (perceived.refusal && !perceived.correction && pendingBind !== "revise")) {
      pendingDisposition = "reject";
      rationale.push("pending binds a refusal");
    } else if (pendingBind === "revise" || (perceived.correction && perceived.correctionTarget === "pending_item")) {
      pendingDisposition = "revise";
      rationale.push("pending binds a revision");
    } else if (
      pendingBind === "yes" ||
      (perceived.acknowledgement && !perceived.hasBusinessQuestion && !perceived.priorQueryReference)
    ) {
      pendingDisposition = "confirm";
      rationale.push("pending binds an acknowledgement");
    } else {
      rationale.push("holding pending but utterance does not bind it");
    }
  }

  const lanes: AttentionPlan["lanes"] = [];
  if (perceived.callControl === "end") lanes.push("call_control");
  if (perceived.personalProbe) lanes.push("personal");
  if (perceived.narrativeProbe) lanes.push("narrative");

  const actionLane =
    pendingDisposition === "confirm" ||
    pendingDisposition === "revise" ||
    pendingDisposition === "reject" ||
    perceived.explicitActionRequest ||
    perceived.operatorWorkCommitment;
  if (actionLane) lanes.push("action");

  const businessLane =
    perceived.hasBusinessQuestion ||
    perceived.priorQueryReference ||
    perceived.businessIntent !== "none" ||
    pendingDisposition === "supersede";
  if (businessLane) lanes.push("business");

  if (lanes.length === 0) lanes.push("conversation");

  if (businessLane) retrieve.push("businessMemory");
  if (perceived.personalProbe || perceived.narrativeProbe) retrieve.push("selfMemory");
  else doNotRetrieve.push("selfMemory");

  const needsHistory =
    perceived.businessIntent === "judgment_question" || perceived.priorQueryReference || Boolean(memory.orderedQuery);
  if (needsHistory) retrieve.push("episodicMemory");
  else doNotRetrieve.push("episodicMemory");

  const boardEligible =
    perceived.broadBriefingRequest &&
    perceived.entities.filter(entity => entity.kind !== "temporal").length === 0 &&
    !perceived.operatorWorkCommitment &&
    !perceived.explicitActionRequest &&
    !perceived.correction &&
    !perceived.refusal &&
    pendingDisposition !== "confirm";

  if (boardEligible) {
    retrieve.push("goals");
    rationale.push("unscoped briefing may consult goal/board inputs");
  } else {
    doNotRetrieve.push("goals");
    rationale.push("scoped or non-briefing turn must not retrieve the global board");
  }

  const priorClaim: AttentionPlan["priorClaim"] = perceived.businessIntent === "correctness_challenge"
    ? "correctness"
    : perceived.businessIntent === "provenance_question"
      ? "provenance"
      : "none";

  const continueOrderedQuery =
    Boolean(memory.orderedQuery) &&
    (perceived.priorQueryReference || perceived.businessIntent === "query_refinement" || perceived.exclusions.length > 0);

  if (!retrieve.includes("businessMemory") && (priorClaim !== "none" || continueOrderedQuery)) {
    retrieve.push("businessMemory");
  }

  return {
    lanes: Array.from(new Set(lanes)),
    retrieve: Array.from(new Set(retrieve)),
    doNotRetrieve: Array.from(new Set(doNotRetrieve.filter(id => !retrieve.includes(id)))),
    boardEligible,
    pendingDisposition,
    priorClaim,
    continueOrderedQuery,
    rationale,
  };
}
