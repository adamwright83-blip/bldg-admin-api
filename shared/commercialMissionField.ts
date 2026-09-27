export const DEFAULT_FIELD_CHECKLIST = [
  {
    itemKey: "clean_polo",
    label: "Clean polo",
    detail: "Presentable and ready to represent the laundromat.",
    required: true,
    position: 0,
  },
  {
    itemKey: "quote_sheet",
    label: "Quote sheet",
    detail: "Approved pricing and service outline are available.",
    required: true,
    position: 1,
  },
  {
    itemKey: "collateral",
    label: "Leave-behind",
    detail: "Approved collateral is ready for the decision-maker.",
    required: true,
    position: 2,
  },
  {
    itemKey: "business_cards",
    label: "Business cards",
    detail: "Bring operator contact cards when configured.",
    required: false,
    position: 3,
  },
] as const;

export const FIELD_OUTCOME_REASONS = [
  "quote_requested",
  "pilot_requested",
  "follow_up_requested",
  "no_interest",
  "current_provider_locked_in",
  "pricing_objection",
  "operational_incompatibility",
  "other",
] as const;

export type FieldOutcomeReason = (typeof FIELD_OUTCOME_REASONS)[number];

/**
 * What actually happened at the real visit. `no_contact` and `no_decision`
 * are complete, legitimate visit observations, but neither is permission to
 * manufacture a future commitment or terminal business result.
 */
export const FIELD_VISIT_OUTCOMES = [
  "no_contact",
  "no_decision",
  "follow_up",
  "won",
  "lost",
] as const;
export type FieldVisitOutcome = (typeof FIELD_VISIT_OUTCOMES)[number];


export const COMMERCIAL_MISSION_LOCATION_CHECK_IN_RADIUS_METERS = 125;
export const COMMERCIAL_MISSION_LOCATION_MAX_ACCURACY_METERS = 100;

export type CommercialMissionLocationCheckInDecision =
  | { accepted: true; distanceMeters: number }
  | {
      accepted: false;
      distanceMeters: number | null;
      reason: "missing_property_coordinates" | "poor_accuracy" | "outside_property_radius";
    };

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function commercialMissionDistanceMeters(input: {
  fromLatitude: number;
  fromLongitude: number;
  toLatitude: number;
  toLongitude: number;
}): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = degreesToRadians(input.toLatitude - input.fromLatitude);
  const dLng = degreesToRadians(input.toLongitude - input.fromLongitude);
  const fromLat = degreesToRadians(input.fromLatitude);
  const toLat = degreesToRadians(input.toLatitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Authority gate for a commercial field location check-in.
 *
 * Unlike convenience arrival hints, reported GPS uncertainty never widens
 * the authoritative property radius. A noisy reading must use manual
 * check-in, which remains operator-attested and cannot prove physical
 * presence.
 */
export function evaluateCommercialMissionLocationCheckIn(input: {
  propertyLatitude: number | null;
  propertyLongitude: number | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}): CommercialMissionLocationCheckInDecision {
  if (
    input.propertyLatitude == null ||
    input.propertyLongitude == null ||
    !Number.isFinite(input.propertyLatitude) ||
    !Number.isFinite(input.propertyLongitude)
  ) {
    return {
      accepted: false,
      distanceMeters: null,
      reason: "missing_property_coordinates",
    };
  }
  if (
    !Number.isFinite(input.accuracyMeters) ||
    input.accuracyMeters < 0 ||
    input.accuracyMeters > COMMERCIAL_MISSION_LOCATION_MAX_ACCURACY_METERS
  ) {
    return {
      accepted: false,
      distanceMeters: null,
      reason: "poor_accuracy",
    };
  }
  const distanceMeters = commercialMissionDistanceMeters({
    fromLatitude: input.latitude,
    fromLongitude: input.longitude,
    toLatitude: input.propertyLatitude,
    toLongitude: input.propertyLongitude,
  });
  if (distanceMeters > COMMERCIAL_MISSION_LOCATION_CHECK_IN_RADIUS_METERS) {
    return {
      accepted: false,
      distanceMeters,
      reason: "outside_property_radius",
    };
  }
  return { accepted: true, distanceMeters };
}

export const PARKING_LOT_CLERK_EVENT_NAME =
  "parking_lot_clerk_observation" as const;
export const PARKING_LOT_CLERK_PROVENANCE = "operator_reported" as const;

export type ParkingLotClerkObservation = {
  missionId: number;
  text: string;
  provenance: typeof PARKING_LOT_CLERK_PROVENANCE;
  reportedBy: string;
  reportedAt: string;
};

export function shouldPromptParkingLotClerk(input: {
  hasVisitOutcome: boolean;
  hasObservation: boolean;
}): boolean {
  return input.hasVisitOutcome && !input.hasObservation;
}

/**
 * The second mission transition after `arrived -> visit_completed`, when one
 * is legitimately warranted. Null means the visit stays truthfully completed
 * and unresolved.
 */
export function missionStatusForFieldVisitOutcome(
  outcome: FieldVisitOutcome
): "follow_up" | "won" | "lost" | null {
  return outcome === "follow_up" || outcome === "won" || outcome === "lost"
    ? outcome
    : null;
}

export function navigationUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
