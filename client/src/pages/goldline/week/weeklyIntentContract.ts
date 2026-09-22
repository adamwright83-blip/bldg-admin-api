/**
 * Frozen WeeklyIntent shape for the mobile Week brochure.
 *
 * Project A owns planning, locking, and assignment. This module is the render
 * contract Project C draws. It is not a second planner. When Project A lands,
 * swap the data source in `readWeekVisit` — do not redesign this shape and do
 * not add fiction fields here.
 */

export type WeeklyIntentSource = "locked" | "draft" | "unconfirmed";

export type WeeklyPrimaryPosture = "mission" | "stand_down";

export type WeeklyIntentPrimary = {
  title: string;
  /** Existing mission route, or null when nothing is authorized to open. */
  ref: string | null;
  posture: WeeklyPrimaryPosture;
};

export type WeeklyFixedConstraint = {
  text: string;
};

export type ReadinessKind =
  | "physical"
  | "document"
  | "information"
  | "approval"
  | "location";

export type ReadinessStatus = "open" | "ready" | "blocked";

export type MissionReadinessRequirement = {
  text: string;
  kind: ReadinessKind;
  neededForDate: string;
  completeByDate: string;
  status: ReadinessStatus;
};

export type WeeklyIntentDay = {
  businessDate: string;
  primary: WeeklyIntentPrimary | null;
  fixedConstraints: WeeklyFixedConstraint[];
  readiness: MissionReadinessRequirement[];
};

export type WeeklyIntent = {
  weekStart: string;
  revision: number;
  source: WeeklyIntentSource;
  lockedAt: string | null;
  days: WeeklyIntentDay[];
};

/** A locked agreement is the only intent the brochure may render. */
export function isLockedWeeklyIntent(intent: WeeklyIntent): boolean {
  return (
    intent.source === "locked" &&
    typeof intent.lockedAt === "string" &&
    intent.lockedAt.length > 0
  );
}
