import type { DayPlanStop } from "../driver/goldlineDayPlanModel";

/** Coordinates measured from the approved 941 × 1672 DAY LINE artwork. */
export type ApprovedDaylinePlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
  pinLeft: number;
  pinTop: number;
};

type ApprovedKind = "pickup" | "dropoff" | "sales" | "growth" | "marketing";

const APPROVED_PLACEMENTS: Record<ApprovedKind, ApprovedDaylinePlacement> = {
  pickup: {
    left: 198,
    top: 256,
    width: 275,
    height: 119,
    pinLeft: 102,
    pinTop: 300,
  },
  dropoff: {
    left: 631,
    top: 402,
    width: 268,
    height: 118,
    pinLeft: 543,
    pinTop: 449,
  },
  sales: {
    left: 559,
    top: 677,
    width: 301,
    height: 130,
    pinLeft: 324,
    pinTop: 701,
  },
  growth: {
    left: 629,
    top: 961,
    width: 238,
    height: 108,
    pinLeft: 515,
    pinTop: 1030,
  },
  marketing: {
    left: 559,
    top: 1238,
    width: 334,
    height: 83,
    pinLeft: 500,
    pinTop: 1263,
  },
};

function isApprovedKind(kind: DayPlanStop["kind"]): kind is ApprovedKind {
  return Object.prototype.hasOwnProperty.call(APPROVED_PLACEMENTS, kind);
}

/**
 * One slot per supplied stop, in the supplied order. The approved composition
 * applies when every known landmark occurs once. Other days need separate
 * readable slots instead of stacking several actions at the same landmark.
 * Coordinates never infer an action kind or modify the business projection.
 */
export function approvedDaylinePlacements(
  stops: readonly Pick<DayPlanStop, "id" | "kind">[]
): ApprovedDaylinePlacement[] {
  if (!stops.length) return [];

  const useApprovedComposition =
    stops.length <= 5 &&
    new Set(stops.map(stop => stop.kind)).size === stops.length &&
    stops.every(stop => isApprovedKind(stop.kind));

  if (useApprovedComposition) {
    return stops.map(stop => ({
      ...APPROVED_PLACEMENTS[stop.kind as ApprovedKind],
    }));
  }

  const top = 256;
  const bottom = 1320;
  const height = 110;
  const minimumSpacing = 128;
  const spacing =
    stops.length <= 1
      ? minimumSpacing
      : Math.max(minimumSpacing, (bottom - top - height) / (stops.length - 1));

  // Eight slots fit in the reference scene. Longer days continue below it;
  // the caller can render those slots in its continuation without clipping.
  return stops.map((_, index) => ({
    left: 559,
    top: top + index * spacing,
    width: 334,
    height,
    pinLeft: 468,
    pinTop: top + index * spacing + 44,
  }));
}
