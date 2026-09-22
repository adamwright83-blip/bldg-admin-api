/**
 * Executive attention.
 *
 * Decides which working-memory slots may influence this turn, which compartments to
 * consult, which must NOT be consulted, and which mentions need resolving before
 * scoped retrieval can even be planned.
 *
 * Attention informs retrieval. It does not speak, mutate, or choose an answer.
 */

import type { AttentionPlan } from "../contracts/attention";
import type { ChangeClass, GateRuling, TaskSet } from "../contracts/control";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";
import type { CompartmentId } from "../contracts/retrieval";
import { outputAllowed, suppressedSlots } from "./workingMemoryGate";
import { dayLineCandidate } from "./dayLineAuthority";
import { explicitPendingReturn, heldPending } from "./pendingBinding";

function holding(memory: WorkingMemorySnapshot): boolean {
  return Boolean(heldPending(memory));
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

export function planAttention(input: {
  perceived: PerceivedTurn;
  memory: WorkingMemorySnapshot;
  change: ChangeClass;
  taskSets: TaskSet[];
  rulings: GateRuling[];
}): AttentionPlan {
  const { perceived, memory, change, taskSets, rulings } = input;
  const rationale: string[] = [];
  const retrieve: CompartmentId[] = ["workingMemory"];
  const doNotRetrieve: CompartmentId[] = [];
  const kinds = new Set(taskSets.map(set => set.kind));

  // ── Pending disposition ───────────────────────────────────────────────────
  const holdingPending = holding(memory);
  let pendingDisposition: AttentionPlan["pendingDisposition"] = "none";
  const pendingBind = holdingPending ? pendingReply(perceived.assembledText) : null;
  if (explicitPendingReturn(perceived, memory)) {
    pendingDisposition = "none";
    rationale.push("the operator returned to a dormant pending item; it is not confirmed or rejected");
  } else if (holdingPending) {
    if (change === "task_switch" || change === "set_shift" || change === "query_requery") {
      pendingDisposition = "supersede";
      rationale.push("the operator moved to a different task; pending is set aside, not applied");
    } else if (pendingBind === "no" || (perceived.refusal && !perceived.correction && pendingBind !== "revise")) {
      pendingDisposition = "reject";
      rationale.push("pending binds a refusal");
    } else if (pendingBind === "revise" || change === "local_correction") {
      pendingDisposition = "revise";
      rationale.push("pending binds a revision");
    } else if (
      pendingBind === "yes" ||
      (perceived.acknowledgement && !perceived.hasBusinessQuestion && !perceived.priorQueryReference)
    ) {
      pendingDisposition = "confirm";
      rationale.push("pending binds an acknowledgement");
    } else if (
      perceived.priorQueryReference ||
      perceived.businessIntent !== "none" ||
      perceived.personalProbe ||
      perceived.narrativeProbe
    ) {
      pendingDisposition = "supersede";
      rationale.push("a genuine new topic supersedes the pending item");
    } else {
      rationale.push("holding pending but this utterance does not bind it");
    }
  }

  // ── Lanes ─────────────────────────────────────────────────────────────────
  const lanes: AttentionPlan["lanes"] = [];
  if (perceived.callControl === "end") lanes.push("call_control");
  if (perceived.personalProbe) lanes.push("personal");
  if (perceived.narrativeProbe) lanes.push("narrative");
  if (
    pendingDisposition === "confirm" ||
    pendingDisposition === "revise" ||
    pendingDisposition === "reject" ||
    dayLineCandidate(perceived)
  ) {
    lanes.push("action");
  }
  const businessLane =
    kinds.has("business_query") || kinds.has("account_judgment") || kinds.has("broad_planning");
  if (businessLane) lanes.push("business");
  if (!lanes.length) lanes.push("conversation");

  // ── Compartments ──────────────────────────────────────────────────────────
  if (businessLane) retrieve.push("businessMemory");

  if (perceived.personalProbe || perceived.narrativeProbe) retrieve.push("selfMemory");
  else doNotRetrieve.push("selfMemory");

  // History is consulted for judgment and for continuing a thread — not routinely.
  const needsHistory =
    kinds.has("account_judgment") ||
    (perceived.priorQueryReference && outputAllowed(rulings, "ordered_query"));
  if (needsHistory) retrieve.push("episodicMemory");
  else doNotRetrieve.push("episodicMemory");

  /**
   * The global board is for an unscoped briefing only. A question that names a person
   * or account is scoped, and a scoped question must not be answered with the board —
   * this is the structural form of the Dana guarantee.
   *
   * "Today" / "tonight" is the board's native window, not a named subject. A future
   * weekday ("about Tuesday") is scoped by SCOPED_OBJECT upstream and never reaches
   * here as a briefing. Recency of a prior future intention is a Working-Memory
   * output-gate problem, not a reason to hide today's board.
   */
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

  const priorClaim: AttentionPlan["priorClaim"] =
    perceived.businessIntent === "correctness_challenge"
      ? "correctness"
      : perceived.businessIntent === "provenance_question"
        ? "provenance"
        : "none";
  if (priorClaim !== "none" && !retrieve.includes("businessMemory")) retrieve.push("businessMemory");

  // A continuation only continues if the gate actually allows that slot to speak.
  const continueOrderedQuery =
    Boolean(memory.orderedQuery) &&
    outputAllowed(rulings, "ordered_query") &&
    (perceived.priorQueryReference ||
      perceived.businessIntent === "query_refinement" ||
      perceived.exclusions.length > 0);
  if (continueOrderedQuery && !retrieve.includes("businessMemory")) retrieve.push("businessMemory");

  // Mentions that must be resolved before Pass B can be scoped.
  const entitiesToResolve = outputAllowed(rulings, "focus_entity")
    ? perceived.entities.filter(entity => entity.kind === "entity_mention").map(entity => entity.raw)
    : [];

  return {
    lanes: Array.from(new Set(lanes)),
    retrieve: Array.from(new Set(retrieve)),
    doNotRetrieve: Array.from(new Set(doNotRetrieve.filter(id => !retrieve.includes(id)))),
    activeTaskSets: taskSets,
    suppressedContext: suppressedSlots(rulings),
    entitiesToResolve,
    boardEligible,
    pendingDisposition,
    priorClaim,
    continueOrderedQuery,
    rationale,
  };
}
