/**
 * Read-only, deterministic Day Line art composition.
 *
 * The day projection owns ordering and completion. This module may only alter
 * presentation of existing items; it must never manufacture a business event.
 */
import type { DayPlanStop, DayPlanStopKind } from "../driver/goldlineDayPlanModel";

export type ActionSlotArt = "pickup" | "dropoff" | "sales" | "growth" | "marketing" | "generic";
export type ActionSlotVisualState =
  | "planned" | "now" | "blocked" | "verified_complete" | "ready_to_open" | "opened" | "unknown";

/**
 * Intentionally no string matching on titles, contacts, or customer names:
 * "Post Zeely Ad" is not proof of an Instagram marketing challenge.
 * A future typed marketing classification may be added at the projection seam.
 */
export function artForDayPlanKind(kind: DayPlanStopKind): ActionSlotArt {
  switch (kind) {
    case "pickup": return "pickup";
    case "dropoff": return "dropoff";
    case "sales": return "sales";
    case "growth": return "growth";
    default: return "generic";
  }
}

/** Scale only the illustration, never its text or hit target. */
export function actionSlotArtScale(index: number, count: number): number {
  if (count <= 1) return 1;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError("Action Slot index must exist in the displayed day");
  }
  const minimum = count <= 3 ? 0.9 : 0.8;
  return minimum + (1 - minimum) * index / (count - 1);
}

/** Day order remains unchanged: these are visual anchors, not a second sort. */
export function actionSlotAnchors(count: number): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => ({
    x: index % 2 === 0 ? 34 : 63,
    y: (index + 0.5) * 176,
  }));
}

/** SVG path and dots follow the actual count, with a flowing glowing route. */
export function goldenTrailGeometry(count: number) {
  const anchors = actionSlotAnchors(count);
  const height = Math.max(176, count * 176);
  if (anchors.length === 0) return { height, path: "", anchors };
  let path = `M ${anchors[0].x} ${anchors[0].y}`;
  for (let i = 1; i < anchors.length; i++) {
    const before = anchors[i - 1];
    const after = anchors[i];
    const middleY = (before.y + after.y) / 2;
    path += ` C ${before.x} ${middleY}, ${after.x} ${middleY}, ${after.x} ${after.y}`;
  }
  return { height, path, anchors };
}

export function climbAvatarPosition(completed: number, count: number) {
  const fraction = count > 0 ? Math.min(1, Math.max(0, completed / count)) : 0;
  return {
    fraction,
    /** Separate climb from the schedule: 0 = ground, 1 = summit. */
    bottomPercent: 7 + 83 * fraction,
    /** Perspective reduction, always facing up the climb. */
    scale: 1 - 0.48 * fraction,
  };
}

export function visualStateForStop(
  stop: Pick<DayPlanStop, "id" | "status" | "attentionState">,
  activeId: string | null,
  isOpened: boolean,
): ActionSlotVisualState {
  if (stop.status === "completed") return isOpened ? "opened" : "ready_to_open";
  if (stop.status === "cancelled" || stop.status === "blocked") return "blocked";
  if (stop.attentionState === "needs_details") return "unknown";
  if (stop.id === activeId) return "now";
  return "planned";
}

/**
 * Drives animation only on independently verified completion changes.
 * Opening the artwork or tapping the map does not change this count.
 */
export function shouldPlayClimb(
  previousCompleted: number,
  currentCompleted: number,
  driving: boolean,
  reducedMotion: boolean,
): boolean {
  return !driving && !reducedMotion && currentCompleted > previousCompleted;
}

/** A presentation read, never an operational or fulfillment write. */
export function completedFromProjection(stops: readonly Pick<DayPlanStop, "status">[]): number {
  return stops.filter(stop => stop.status === "completed").length;
}
