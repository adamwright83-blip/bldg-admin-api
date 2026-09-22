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
import { dayLineCandidate } from "./dayLineAuthority";
import { explicitPendingReturn, heldPending, isBareRefusal } from "./pendingBinding";

/** Explicit abandonment of the current subject. */
const ABANDON = /\b(?:forget|drop|never\s+mind|nevermind|scratch)\s+(?:that|it|about\s+\w+|\w+)\b/i;

/** A change of the dimension under which the problem is considered. */
const SET_SHIFT =
  /(?:^|[.!?]\s+)(?:instead|rather)\b|\b(?:instead\s+of|rather\s+than|don'?t\s+look\s+at|stop\s+looking\s+at)\b|\bcompare\b[\s\S]{0,40}\binstead\b/i;

/**
 * Acknowledgements / refusals / discourse particles that can precede an explicit
 * set-shift without being the shift themselves. Repeated so "Yeah, but instead"
 * still exposes `instead` at the clause boundary.
 */
const LEADING_DISCOURSE =
  /^(?:(?:no|nope|nah|yes|yeah|yep|yup|ok(?:ay)?|alright|all\s+right|sure|right|well|so|but|and|actually|wait|hold\s+on|um+|uh+|please|look|listen)[,.!?]?\s+)+/i;

function afterLeadingDiscourse(text: string): string {
  return text.trim().replace(LEADING_DISCOURSE, "").trim();
}

function isExplicitSetShift(text: string): boolean {
  if (SET_SHIFT.test(text)) return true;
  const rest = afterLeadingDiscourse(text);
  return Boolean(rest) && rest !== text.trim() && SET_SHIFT.test(rest);
}

function closesPriorOrderedQuery(change: ChangeClass): boolean {
  return change === "task_switch" || change === "set_shift" || change === "query_requery";
}

/**
 * Classify how this turn differs from the last.
 *
 * Order matters: a prior-claim challenge is about the ANSWER, an abandonment is about
 * the TASK, and a correction inside a live task is neither.
 */
function substantiveNewTopic(perceived: PerceivedTurn): boolean {
  return (
    perceived.attentionRepair !== "none" ||
    perceived.openFragment ||
    perceived.operatorIntentAttested ||
    perceived.workDeclarationKind === "ordinary_work" ||
    perceived.workDeclarationKind === "strategic_work" ||
    perceived.workDeclarationKind === "context_narration" ||
    perceived.workDeclarationKind === "explicit_day_line" ||
    perceived.workDeclarationKind === "explicit_action"
  );
}

export function classifyChange(perceived: PerceivedTurn, memory: WorkingMemorySnapshot): ChangeClass {
  if (perceived.businessIntent === "correctness_challenge" || perceived.correctionTarget === "prior_claim") {
    return "prior_claim_challenge";
  }
  if (isExplicitSetShift(perceived.assembledText)) return "set_shift";
  if (ABANDON.test(perceived.assembledText)) return "task_switch";
  if (perceived.personalProbe && perceived.businessIntent === "none") return "task_switch";
  if (perceived.businessIntent === "query_requery") return "query_requery";

  const holdingPending = Boolean(heldPending(memory));

  // Coming back to a dormant item is not a new task and not a yes/no.
  if (explicitPendingReturn(perceived, memory)) return "continuation";

  /**
   * A new subject while something is pending is a switch. The pending item goes
   * dormant; it is not rejected and it does not interpret the new speech.
   * Attention repair and a leading "No" plus new speech are this case, not a refusal.
   */
  if (holdingPending && substantiveNewTopic(perceived)) return "task_switch";

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
   * A genuine NEW question while something is pending is a switch. Refining the
   * current ordered result is not: that is continuation of the query thread, and
   * whether pending work is set aside is a separate slot ruling.
   */
  const newQuestion =
    perceived.businessIntent === "list_query" ||
    perceived.businessIntent === "judgment_question" ||
    perceived.businessIntent === "broad_briefing" ||
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

  const holdingPending = Boolean(heldPending(memory));
  if (
    holdingPending &&
    (perceived.acknowledgement || perceived.refusal || perceived.correction) &&
    perceived.attentionRepair === "none" &&
    !substantiveNewTopic(perceived)
  ) {
    add("pending_confirmation", memory.pendingProposal?.identity ?? memory.pendingBriefing?.identity ?? null);
  }
  if (dayLineCandidate(perceived)) add("action_proposal", mention);
  if (
    perceived.classifierStatus === "classified" &&
    (perceived.workDeclarationKind === "strategic_work" || memory.activeWorkFrame)
  ) {
    add("strategic_work", null);
  }
  if (perceived.businessIntent === "judgment_question") add("account_judgment", mention);
  if (perceived.broadBriefingRequest) add("broad_planning", null);
  if (
    perceived.businessIntent === "fact_question" ||
    perceived.businessIntent === "list_query" ||
    perceived.businessIntent === "query_refinement" ||
    perceived.businessIntent === "query_requery" ||
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

  // Pending-work output and ordered-query output are independent slots.
  // Explicit abandonment / set-shift / parameter-changing re-query still
  // outrank continuation: they close the old result even when the new
  // wording mentions the previous set.
  const continuing =
    perceived.businessIntent === "query_refinement" ||
    perceived.exclusions.length > 0 ||
    (perceived.priorQueryReference && perceived.businessIntent !== "query_requery");

  // ── Pending proposal ──────────────────────────────────────────────────────
  const holdingPending = Boolean(heldPending(memory));
  if (!holdingPending) {
    rule("pending_proposal", "maintain", "suppress", "nothing pending");
  } else if (explicitPendingReturn(perceived, memory)) {
    rule("pending_proposal", "maintain", "allow", "the operator returned to the dormant item");
  } else if ((perceived.refusal || isBareRefusal(perceived.assembledText)) && !substantiveNewTopic(perceived)) {
    // "No." and "Actually don't do that." both end it, and it must not come back.
    rule("pending_proposal", "clear", "allow", "operator refused the pending item");
  } else if (change === "local_correction") {
    rule("pending_proposal", "update", "allow", "a parameter of the pending item changes");
  } else if (perceived.acknowledgement && !perceived.hasBusinessQuestion) {
    rule("pending_proposal", "update", "allow", "operator confirmed the pending item");
  } else if (closesPriorOrderedQuery(change)) {
    // Remembered, but barred from this turn: it is not what was asked about.
    rule("pending_proposal", "dormant", "suppress", "operator moved to a different task");
  } else if (continuing && memory.orderedQuery) {
    rule("pending_proposal", "dormant", "suppress", "continuing a query is not about the pending item");
  } else {
    rule("pending_proposal", "maintain", "suppress", "pending does not interpret an unrelated utterance");
  }

  // ── Ordered query thread ──────────────────────────────────────────────────
  if (!memory.orderedQuery) {
    rule("ordered_query", "maintain", "suppress", "no ordered result in play");
  } else if (change === "query_requery") {
    rule("ordered_query", "clear", "suppress", "parameter change invalidates the previous result immediately");
  } else if (closesPriorOrderedQuery(change)) {
    rule("ordered_query", "replace", "suppress", "the previous result cannot answer this turn; retrieval must start again");
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
    change === "set_shift" || change === "query_requery" ? "replace" : "maintain",
    "allow",
    change === "set_shift" || change === "query_requery"
      ? "the dimension of the question changed"
      : "scope carries forward"
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
