/**
 * Approach corridors are cinematic travel toward an authoritative destination.
 * Walking never creates the destination, a sale, a visit, or campaign completion.
 */

export type ApproachDestinationType =
  | "campaign_host"
  | "chapter"
  | "mission"
  | "guardian"
  | "stronghold";

export type ApproachRoute = {
  approachId: string;
  destinationType: ApproachDestinationType;
  destinationId: string;
  corridorSequence: string[];
  authoritativeReason: string;
  sourceRef: string;
  finalHost: string;
  completionState: "open" | "arrived" | "abandoned";
};

export function resolveApproachRoute(input: {
  campaignHost?: string | null;
  chapterId?: string | null;
  objectiveId?: string | null;
  missionId?: number | null;
  guardianReady?: boolean;
}): ApproachRoute | null {
  const destinationId =
    input.chapterId ??
    input.campaignHost ??
    input.objectiveId ??
    (input.missionId != null ? String(input.missionId) : null);
  if (!destinationId) return null;
  const destinationType: ApproachDestinationType = input.guardianReady
    ? "guardian"
    : input.campaignHost
      ? "campaign_host"
      : input.missionId != null
        ? "mission"
        : "chapter";
  return {
    approachId: `approach:${destinationId}`,
    destinationType,
    destinationId,
    corridorSequence: ["corridor_01", "corridor_02"],
    authoritativeReason: "authoritative_campaign_or_mission_destination",
    sourceRef: input.objectiveId ?? input.chapterId ?? destinationId,
    finalHost: input.campaignHost ?? "operations",
    completionState: "open",
  };
}

export function nextApproachCorridor(
  route: ApproachRoute | null,
  currentCorridorId: string
): string | null {
  if (!route) return null;
  const index = route.corridorSequence.indexOf(currentCorridorId);
  if (index < 0) return route.corridorSequence[0] ?? null;
  return route.corridorSequence[index + 1] ?? null;
}

export function approachReachedDestination(input: {
  route: ApproachRoute | null;
  currentCorridorId: string;
  atExitBand: boolean;
}): boolean {
  if (!input.route || !input.atExitBand) return false;
  const last = input.route.corridorSequence[input.route.corridorSequence.length - 1];
  return last === input.currentCorridorId;
}

export function endOfAuthoredApproachCopy(input: {
  route: ApproachRoute | null;
  atExitBand: boolean;
  currentCorridorId: string;
}): string | null {
  if (!input.atExitBand) return null;
  if (approachReachedDestination(input)) {
    return "Arriving at the destination.";
  }
  if (!input.route) {
    return "Nothing required ahead. Optional play stays available.";
  }
  return null;
}

/** Optional gameplay must never be treated as a business mutation. */
export const OPTIONAL_PLAY_CANNOT = [
  "add_customers",
  "create_orders",
  "create_revenue",
  "mark_visits_complete",
  "resolve_campaign_business_objectives",
  "alter_payment_state",
] as const;
