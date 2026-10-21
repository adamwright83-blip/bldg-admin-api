/**
 * Business Memory — distance to the macro goal as evidence.
 *
 * The reader lives in `server/claire/gameMaster/goalProgress.ts` (shared with the
 * scheduled-call briefing without importing the brain). This module stamps it:
 * `goal_progress`, current business truth, operator visible.
 */

import type { EvidenceItem } from "../contracts/evidence";
import type { GoalProgress } from "../../gameMaster/goalProgress";

export * from "../../gameMaster/goalProgress";

export function evidenceFromGoalProgress(input: { progress: GoalProgress; observedAtIso: string }): EvidenceItem {
  return {
    id: `goal_progress:${input.progress.goalId}`,
    type: "goal_progress",
    source: "macroGoalStore+macroGoalRuns+activeCustomerMetric",
    provenance: { reader: "readGoalProgress" },
    observedAt: input.observedAtIso,
    asOf: input.observedAtIso,
    freshness: null,
    coverage: {
      complete: input.progress.currentValue !== null,
      gaps: input.progress.currentNote ? [input.progress.currentNote] : [],
    },
    authoritativeFor: ["current_business_truth"],
    payload: input.progress,
    operatorVisible: true,
  };
}
