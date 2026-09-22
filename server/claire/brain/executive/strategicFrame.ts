/**
 * Mission/strategic working memory.
 *
 * The frame records a closed semantic category and a synthetic trace. It is not
 * WeeklyIntent, Daily Command, Mission Director, Day Line, or Narrator state,
 * and it is not a copy of what the operator said. The trace is not a ledger
 * turn id and does not look up the utterance.
 *
 * Remembered is not active. Whether this turn is controlled by the frame is a
 * separate question from whether the frame still exists.
 */

import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { StrategicWorkKind, StrategicWorkMemory, WorkingMemorySnapshot } from "../contracts/workingMemory";

const PUBLISH = /\b(?:publish(?:ing)?|post(?:ing)?)\b/i;
const CONTACT = /\b(?:call(?:ing)?|email(?:ing)?|meet(?:ing)?)\b/i;
const FIELD = /\b(?:pick(?:ing)?\s*up|drop(?:ping)?\s*off|deliver(?:ing)?|go\s+to)\b/i;

/** Points at a mission already being held. Not a new work-frame classifier. */
const STRATEGIC_RETURN =
  /\b(?:what\s+about|back\s+to|return\s+to|that|the|my|today'?s)\s+(?:mission|objective)\b|\b(?:mission|objective)\s+i\s+(?:told|mentioned|said)\b/i;

export type StrategicRelation = "declare" | "continue" | "return" | "dormant";

/** Synthetic shadow trace. Not a conversation-ledger turn id. */
function sourceTraceRef(memory: WorkingMemorySnapshot, nowMs: number): string {
  return `trace:${memory.currentCallContext.conversationKey}#${nowMs}`;
}

/** Map an utterance onto a closed category. The utterance itself is not stored. */
export function boundedStrategicKind(text: string): StrategicWorkKind {
  if (PUBLISH.test(text)) return "publish";
  if (CONTACT.test(text)) return "contact";
  if (FIELD.test(text)) return "field_movement";
  return "unspecified";
}

function held(memory: WorkingMemorySnapshot): StrategicWorkMemory | null {
  return memory.activeWorkFrame;
}

/**
 * Does this turn operate the strategic frame, or only leave it remembered?
 * Ordinary work, a sales question, and attention repair alone are dormant.
 */
export function strategicRelation(perceived: PerceivedTurn, memory: WorkingMemorySnapshot): StrategicRelation {
  if (perceived.classifierStatus !== "classified") return "dormant";
  if (perceived.workDeclarationKind === "strategic_work") return "declare";
  if (perceived.completeness === "incomplete" || perceived.openFragment) return "dormant";

  const previous = held(memory);
  if (!previous) return "dormant";
  if (
    perceived.workDeclarationKind === "ordinary_work" ||
    perceived.workDeclarationKind === "explicit_day_line" ||
    perceived.workDeclarationKind === "explicit_action" ||
    perceived.workDeclarationKind === "context_narration" ||
    perceived.externalCapability
  ) {
    return "dormant";
  }
  if (STRATEGIC_RETURN.test(perceived.assembledText)) return "return";
  if (perceived.operatorIntentAttested && perceived.workDeclarationKind === "none") {
    const nextKind = boundedStrategicKind(perceived.assembledText);
    if (previous.status === "unresolved") return "continue";
    if (nextKind !== "unspecified" && (previous.kind === null || previous.kind === "unspecified" || previous.kind === nextKind)) {
      return "continue";
    }
  }
  return "dormant";
}

export function strategicFrameControlsTurn(perceived: PerceivedTurn, memory: WorkingMemorySnapshot): boolean {
  return strategicRelation(perceived, memory) !== "dormant";
}

function frame(
  status: StrategicWorkMemory["status"],
  kind: StrategicWorkKind | null,
  source: string | null,
  openedAtMs: number
): StrategicWorkMemory {
  return { durability: "cognitive_only", status, kind, sourceTraceRef: source, openedAtMs };
}

/**
 * Undefined means this turn does not touch the frame.
 * A dormant turn leaves the previous frame where it is: not deleted, not overwritten.
 */
export function nextStrategicFrame(input: {
  perceived: PerceivedTurn;
  memory: WorkingMemorySnapshot;
  nowMs: number;
}): StrategicWorkMemory | undefined {
  const { perceived, memory, nowMs } = input;
  const relation = strategicRelation(perceived, memory);
  if (relation === "dormant") return undefined;

  const previous = held(memory);
  const ref = sourceTraceRef(memory, nowMs);

  if (relation === "return") {
    return previous ?? undefined;
  }

  if (relation === "continue" && previous) {
    const kind = boundedStrategicKind(perceived.assembledText);
    const resolved = kind === "unspecified" ? (previous.kind ?? "unspecified") : kind;
    return frame("content_held", resolved, ref, previous.openedAtMs);
  }

  const kind = perceived.strategicShape === "content" ? boundedStrategicKind(perceived.assembledText) : null;
  if (kind && kind !== "unspecified") {
    return frame("content_held", kind, ref, previous?.openedAtMs ?? nowMs);
  }
  if (previous?.status === "content_held" && (perceived.explicitMissionWriteRequest || previous.kind)) {
    return previous;
  }
  if (perceived.strategicShape === "content") {
    return frame("content_held", "unspecified", ref, previous?.openedAtMs ?? nowMs);
  }
  return frame("unresolved", null, ref, previous?.status === "unresolved" ? previous.openedAtMs : nowMs);
}
