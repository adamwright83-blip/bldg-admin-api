/**
 * Mission/strategic working memory.
 *
 * The frame records what the operator declared. It is not WeeklyIntent, Daily
 * Command, Mission Director, Day Line, or Narrator state, and it is not a write.
 */

import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { StrategicWorkMemory, WorkingMemorySnapshot } from "../contracts/workingMemory";

function frame(status: StrategicWorkMemory["status"], contentLabel: string | null, openedAtMs: number): StrategicWorkMemory {
  return { durability: "cognitive_only", status, contentLabel, openedAtMs };
}

/**
 * Undefined means this turn does not touch the frame.
 * A failed or unknown classifier, an unfinished fragment, and an unrelated turn
 * all leave the previous frame where it is.
 */
export function nextStrategicFrame(input: {
  perceived: PerceivedTurn;
  memory: WorkingMemorySnapshot;
  nowMs: number;
}): StrategicWorkMemory | undefined {
  const { perceived, memory, nowMs } = input;
  if (perceived.completeness === "incomplete" || perceived.openFragment) return undefined;
  if (perceived.classifierStatus !== "classified") return undefined;

  const previous = memory.activeWorkFrame;

  if (perceived.explicitMissionWriteRequest || perceived.workDeclarationKind === "strategic_work") {
    if (perceived.strategicShape === "content" && perceived.declaredContentLabel) {
      return frame("content_held", perceived.declaredContentLabel, previous?.openedAtMs ?? nowMs);
    }
    // "Make that today's mission" can point at content already held.
    // Restating "I have a mission" after content arrived does not erase it.
    if (previous?.contentLabel && (perceived.explicitMissionWriteRequest || previous.status === "content_held")) {
      return frame("content_held", previous.contentLabel, previous.openedAtMs);
    }
    return frame("unresolved", null, nowMs);
  }

  // A later intention can fill or refine an already-open frame. It cannot open one,
  // and a Day Line request is a different act.
  if (
    previous &&
    perceived.operatorIntentAttested &&
    perceived.declaredContentLabel &&
    perceived.workDeclarationKind !== "explicit_day_line" &&
    perceived.workDeclarationKind !== "explicit_action" &&
    perceived.workDeclarationKind !== "context_narration"
  ) {
    const replacingHeld = previous.status === "content_held" && perceived.workDeclarationKind === "ordinary_work";
    if (replacingHeld) return undefined;
    return frame("content_held", perceived.declaredContentLabel, previous.openedAtMs);
  }

  return undefined;
}
