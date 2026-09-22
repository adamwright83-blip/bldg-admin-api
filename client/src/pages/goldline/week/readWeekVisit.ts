import type { WeekPresentationOverlay } from "./weekPresentationOverlay";
import type { WeeklyIntent } from "./weeklyIntentContract";

/**
 * What the operator may visit.
 * UNPLANNED and IN_PROGRESS carry no days and no private hypotheses.
 * LOCKED carries the agreement plus an optional presentation overlay.
 */
export type WeekVisit =
  | { phase: "UNPLANNED" }
  | { phase: "IN_PROGRESS" }
  | {
      phase: "LOCKED";
      intent: WeeklyIntent;
      overlay?: WeekPresentationOverlay;
    };

/**
 * Project A integration seam.
 *
 * Production Week has nothing to render until a locked WeeklyIntent is
 * supplied. Replace this function's body with a read of that locked record.
 * Do not plan, lock, rank, infer a week, or read internal hypotheses here.
 * Do not redirect launch to Week when a lock exists.
 */
export function readWeekVisit(): WeekVisit {
  return { phase: "UNPLANNED" };
}
