/**
 * Read-only, deterministic Day Line art composition.
 *
 * The day projection owns ordering and completion. This module may only alter
 * presentation of existing items; it must never manufacture a business event.
 */
import type { DayPlanStop, DayPlanStopKind } from "../driver/goldlineDayPlanModel";

export type ActionSlotArt = "pickup" | "dropoff" | "sales" | "growth" | "marketing" | "generic";
export type ActionSlotVisualState =
  | "planned" | "up_next" | "now" | "blocked" | "verified_complete" | "ready_to_open" | "opened" | "unknown";

/**
 * Intentionally no string matching on titles, contacts, or customer names:
 * "Post Zeely Ad" is not proof of an Instagram marketing challenge.
 * Marketing requires the explicit typed classification at the projection seam.
 */
export function artForDayPlanKind(kind: DayPlanStopKind): ActionSlotArt {
  switch (kind) {
    case "pickup": return "pickup";
    case "dropoff": return "dropoff";
    case "sales": return "sales";
    case "growth": return "growth";
    case "marketing": return "marketing";
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

export interface CheckpointDefinition {
  index: number;
  x: number;
  y: number;
  scale: number;
  label: string;
  landmarkName: string;
}

export const FIVE_DAY_CHECKPOINTS: CheckpointDefinition[] = [
  { index: 0, x: 14, y: 84, scale: 1.15, label: "START", landmarkName: "Foreground Steps" },
  { index: 1, x: 48, y: 73, scale: 0.95, label: "DAY 1", landmarkName: "Ancient Puzzle Terrace" },
  { index: 2, x: 58, y: 58, scale: 0.80, label: "DAY 2", landmarkName: "Emerald Leaf Terrace" },
  { index: 3, x: 46, y: 44, scale: 0.65, label: "DAY 3", landmarkName: "Slide & Cascades Bridge" },
  { index: 4, x: 32, y: 31, scale: 0.50, label: "DAY 4", landmarkName: "Treasure Ledges" },
  { index: 5, x: 62, y: 16.5, scale: 0.38, label: "DAY 5", landmarkName: "Citadel of Kingdoms Gate" },
];

export interface RoutePositionResult {
  fraction: number;
  overallFraction: number;
  x: number;
  y: number;
  bottomPercent: number;
  scale: number;
  currentDaySection: number;
  sectionFraction: number;
  isCastleUnlocked: boolean;
}

export function calculateFiveDayRoutePosition(
  completedToday: number,
  totalToday: number,
  dayNumber: number = 1,
  completedPriorDays: number = 0
): RoutePositionResult {
  const boundedDay = Math.min(5, Math.max(1, dayNumber));
  const dayFraction = totalToday > 0 ? Math.min(1, Math.max(0, completedToday / totalToday)) : 0;
  const overallFraction = Math.min(1, (completedPriorDays + dayFraction) / 5);

  const startPt = FIVE_DAY_CHECKPOINTS[boundedDay - 1];
  const endPt = FIVE_DAY_CHECKPOINTS[boundedDay];

  const x = startPt.x + (endPt.x - startPt.x) * dayFraction;
  const y = startPt.y + (endPt.y - startPt.y) * dayFraction;
  const scale = startPt.scale + (endPt.scale - startPt.scale) * dayFraction;

  return {
    fraction: dayFraction,
    overallFraction,
    x,
    y,
    bottomPercent: 7 + 83 * dayFraction,
    scale,
    currentDaySection: boundedDay,
    sectionFraction: dayFraction,
    isCastleUnlocked: completedPriorDays >= 4 && dayFraction >= 1,
  };
}

export function climbAvatarPosition(
  completed: number,
  count: number,
  dayNumber: number = 1,
  completedPriorDays: number = 0
) {
  const fraction = count > 0 ? Math.min(1, Math.max(0, completed / count)) : 0;
  const route = calculateFiveDayRoutePosition(completed, count, dayNumber, completedPriorDays);
  return {
    fraction,
    /** Separate climb from the schedule: 0 = ground, 1 = summit. */
    bottomPercent: 7 + 83 * fraction,
    /** Perspective reduction, always facing up the climb. */
    scale: 1 - 0.48 * fraction,
    x: route.x,
    y: route.y,
    routeScale: route.scale,
    daySection: route.currentDaySection,
    isCastleUnlocked: route.isCastleUnlocked,
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
  // An uncompleted itinerary item is NEXT, not proof the operator is there now.
  if (stop.id === activeId) return "up_next";
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

/**
 * Consecutive objectives of one kind inhabit ONE illustrated landmark.
 * Keep every source id/order and a separate clickable target per objective:
 * five sales calls must not produce five identical waterslide PNGs.
 */
export function groupConsecutiveActionSlots<T extends { id: string; kind: DayPlanStopKind }>(
  stops: readonly T[],
): Array<{ kind: ActionSlotArt; key: string; items: Array<{ stop: T; index: number }> }> {
  const groups: Array<{ kind: ActionSlotArt; key: string; items: Array<{ stop: T; index: number }> }> = [];
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    const kind = artForDayPlanKind(stop.kind);
    const previous = groups[groups.length - 1];
    if (previous && previous.kind === kind) {
      previous.items.push({ stop, index });
    } else {
      groups.push({ kind, key: stop.id, items: [{ stop, index }] });
    }
  }
  return groups;
}

/** Explicit action status is not implied by a scheduled time or screen opening. */
export function presentationLabelForUpcoming(isNext: boolean): "NEXT" | "PLANNED" {
  return isNext ? "NEXT" : "PLANNED";
}
