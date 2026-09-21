/**
 * Working-memory gating.
 *
 * Two separate questions, deliberately not conflated:
 *
 *   INPUT GATE  — may what just arrived WRITE this slot?
 *   OUTPUT GATE — may this slot INFLUENCE this turn?
 *
 * The separation is the point. A pending Dana proposal can remain remembered — so
 * Claire can still talk about it — while being barred from touching "what were my last
 * five sales?". Deleting it instead would lose information we still need; letting it
 * through is how salient-but-irrelevant memory hijacks a turn.
 *
 * Executive Function owns these rulings. No compartment gates itself.
 */

import type {
  ChangeClass,
  GateRuling,
  TaskSet,
  TaskSetKind,
  WorkingMemorySlot,
} from "../contracts/control";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";

/** Explicit abandonment of the current subject. */
const ABANDON = /\b(?:forget|drop|never\s+mind|nevermind|scratch)\s+(?:that|it|about\s+\w+|\w+)\b/i;

/** A change of the dimension under which the problem is considered. */
const SET_SHIFT =
  /\b(?:instead\s+of|rather\s+than|don'?t\s+look\s+at|stop\s+looking\s+at)\b|\bcompare\b[\s\S]{0,40}\binstead\b/i;

/**
 * Classify how this turn differs from the last.
 *
 * Order matters: a prior-claim challenge is about the ANSWER, an abandonment is about
 * the TASK, and a correction inside a live task is neither.
 */
export function classifyChange(perceived: PerceivedTurn, memory: WorkingMemorySnapshot): ChangeClass {
  if (perceived.businessIntent === "correctness_challenge" || perceived.correctionTarget === "prior_claim") {
    return "prior_claim_challenge";
  }
  if (SET_SHIFT.test(perceived.assembledText)) return "set_shift";
  if (ABANDON.test(perceived.assembledText)) return "task_switch";
  if (perceived.personalProbe && perceived.businessIntent === "none") return "task_switch";

  const holdingPending = Boolean(memory.pendingProposal || memory.pendingBriefing || memory.pendingAccountFollowUp);

  /**
   * A refusal binds the pending item; it is never a task switch. "Actually don't do
   * that" ends the proposal and must not resurrect it as a new topic — V1's interpreter
   * reads a bare "do" as a business question, which would otherwise look like one.
   */
  if (perceived.refusal && holdingPending) return "continuation";

  if (perceived.correction && perceived.correctionTarget === "pending_item" && holdingPending) {
    return "local_correction";
  }
  if (perceived.correction && perceived.correctionTarget === "prior_query") return "local_correction";

  /**
   * A genuine new question while something is pending is a switch. "Genuine" is
   * deliberately strict: a bare verb tripping `hasBusinessQuestion` is not a new topic,
   * so a real interrogative, a list request, or a judgment is required.
   */
  const newQuestion =
    perceived.businessIntent === "list_query" ||
    perceived.businessIntent === "judgment_question" ||
    perceived.businessIntent === "broad_briefing" ||
    perceived.businessIntent === "query_refinement" ||
    (perceived.businessIntent === "fact_question" && /\?/.test(perceived.assembledText));
  if (holdingPending && newQuestion && !perceived.acknowledgement) return "task_switch";

  return "continuation";
}

/** Which cognitive frames this turn is operating under. Several may coexist. */
export function activeTaskSets(perceived: PerceivedTurn, memory: WorkingMemorySnapshot, nowMs: number): TaskSet[] {
  const sets: TaskSet[] = [];
  const add = (kind: TaskSetKind, subject: string | null): void => {
    if (!sets.some(entry => entry.kind === kind)) sets.push({ kind, subject, openedAtMs: nowMs });
  };

  const mention = perceived.entities.find(entity => entity.kind === "entity_mention")?.raw ?? null;

  if (perceived.callControl === "end") add("call_closure", null);
  if (perceived.personalProbe || perceived.narrativeProbe) add("personal_disclosure", null);

  const holdingPending = Boolean(memory.pendingProposal || memory.pendingBriefing || memory.pendingAccountFollowUp);
  if (holdingPending && (perceived.acknowledgement || perceived.refusal || perceived.correction)) {
    add("pending_confirmation", memory.pendingProposal?.identity ?? memory.pendingBriefing?.identity ?? null);
  }
  if (perceived.explicitActionRequest || perceived.operatorWorkCommitment) add("action_proposal", mention);
  if (perceived.businessIntent === "judgment_question") add("account_judgment", mention);
  if (perceived.broadBriefingRequest) add("broad_planning", null);
  if (
    perceived.businessIntent === "fact_question" ||
    perceived.businessIntent === "list_query" ||
    perceived.businessIntent === "query_refinement" ||
    perceived.businessIntent === "correctness_challenge" ||
    perceived.businessIntent === "provenance_question" ||
    (perceived.priorQueryReference && !perceived.personalProbe)
  ) {
    add("business_query", mention);
  }

  if (!sets.length) add("conversation", null);
  return sets;
}

/**
 * Rule every slot for this turn.
 *
 * Each ruling records WHY, because a suppressed slot that should have spoken — or a
 * slot that spoke when it should have been suppressed — is otherwise invisible.
 */
export function gateWorkingMemory(input: {
  perceived: PerceivedTurn;
  memory: WorkingMemorySnapshot;
  change: ChangeClass;
  taskSets: TaskSet[];
}): GateRuling[] {
  const { perceived, memory, change, taskSets } = input;
  const rulings: GateRuling[] = [];
  const kinds = new Set(taskSets.map(set => set.kind));

  const rule = (
    slot: WorkingMemorySlot,
    inputDecision: GateRuling["input"],
    output: GateRuling["output"],
    why: string
  ): void => {
    rulings.push({ slot, input: inputDecision, output, why });
  };

  // ── Task set ──────────────────────────────────────────────────────────────
  if (change === "task_switch" || change === "set_shift") {
    rule("task_set", "replace", "allow", `${change}: the previous frame stops controlling cognition`);
  } else {
    rule("task_set", "maintain", "allow", "the active frame continues");
  }

  // ── Pending proposal ──────────────────────────────────────────────────────
  const holdingPending = Boolean(memory.pendingProposal || memory.pendingBriefing || memory.pendingAccountFollowUp);
  if (!holdingPending) {
    rule("pending_proposal", "maintain", "suppress", "nothing pending");
  } else if (perceived.refusal) {
    // "No." and "Actually don't do that." both end it, and it must not come back.
    rule("pending_proposal", "clear", "allow", "operator refused the pending item");
  } else if (change === "local_correction") {
    rule("pending_proposal", "update", "allow", "a parameter of the pending item changes");
  } else if (perceived.acknowledgement && !perceived.hasBusinessQuestion) {
    rule("pending_proposal", "update", "allow", "operator confirmed the pending item");
  } else if (change === "task_switch" || change === "set_shift") {
    // Remembered, but barred from this turn: it is not what was asked about.
    rule("pending_proposal", "dormant", "suppress", "operator moved to a different task");
  } else {
    rule("pending_proposal", "maintain", "suppress", "pending does not interpret an unrelated utterance");
  }

  // ── Ordered query thread ──────────────────────────────────────────────────
  const continuing =
    perceived.priorQueryReference ||
    perceived.businessIntent === "query_refinement" ||
    perceived.exclusions.length > 0;
  if (!memory.orderedQuery) {
    rule("ordered_query", "maintain", "suppress", "no ordered result in play");
  } else if (change === "task_switch" || change === "set_shift") {
    rule("ordered_query", "replace", "suppress", "a new query thread replaces the old one, resetting exclusions");
  } else if (continuing) {
    rule("ordered_query", "update", "allow", "the operator is continuing this result");
  } else {
    rule("ordered_query", "maintain", "suppress", "a new question does not continue the old result");
  }

  // ── Focus entity ──────────────────────────────────────────────────────────
  const mentions = perceived.entities.filter(entity => entity.kind === "entity_mention");
  if (mentions.length) {
    rule("focus_entity", "replace", "allow", "the operator named someone or something");
  } else if (change === "task_switch" || change === "set_shift") {
    rule("focus_entity", "clear", "suppress", "the previous subject was abandoned");
  } else if (kinds.has("broad_planning") && perceived.temporalReferences.length) {
    rule("focus_entity", "dormant", "suppress", "explicit temporal scope is not the previous subject's recency");
  } else if (kinds.has("business_query") || kinds.has("account_judgment")) {
    rule("focus_entity", "maintain", "allow", "the current subject still applies");
  } else {
    rule("focus_entity", "maintain", "suppress", "not relevant to this turn");
  }

  // ── Prior claim ───────────────────────────────────────────────────────────
  if (!memory.priorClaims.length) {
    rule("prior_claim", "maintain", "suppress", "no claim on record");
  } else if (change === "prior_claim_challenge" || perceived.businessIntent === "provenance_question") {
    rule("prior_claim", "maintain", "allow", "the operator is challenging or sourcing a prior claim");
  } else {
    rule("prior_claim", "maintain", "suppress", "no claim is under challenge");
  }

  // ── Unresolved reference ──────────────────────────────────────────────────
  rule(
    "unresolved_reference",
    perceived.ambiguities.length ? "update" : "maintain",
    perceived.ambiguities.length ? "allow" : "suppress",
    perceived.ambiguities.length ? "this turn left something unresolved" : "nothing unresolved"
  );

  // ── Pending clarification ─────────────────────────────────────────────────
  rule("pending_clarification", "maintain", "suppress", "no clarification outstanding");

  // ── Evidence scope ────────────────────────────────────────────────────────
  rule(
    "evidence_scope",
    change === "set_shift" ? "replace" : "maintain",
    "allow",
    change === "set_shift" ? "the dimension of the question changed" : "scope carries forward"
  );

  return rulings;
}

/** Slots this turn is not allowed to be influenced by. */
export function suppressedSlots(rulings: readonly GateRuling[]): WorkingMemorySlot[] {
  return rulings.filter(ruling => ruling.output === "suppress").map(ruling => ruling.slot);
}

export function outputAllowed(rulings: readonly GateRuling[], slot: WorkingMemorySlot): boolean {
  return rulings.some(ruling => ruling.slot === slot && ruling.output === "allow");
}

export function inputRuling(rulings: readonly GateRuling[], slot: WorkingMemorySlot): GateRuling["input"] {
  return rulings.find(ruling => ruling.slot === slot)?.input ?? "maintain";
}
