/**
 * Travel truth for campaign composition. Never a fake duration presented
 * as certain. Unconfigured and test adapters return explicit provider state.
 */

export type TravelProviderState = "configured" | "unconfigured" | "unavailable" | "test_stub";

export type TravelLegEstimate = {
  fromObjectiveId: string;
  toObjectiveId: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  providerState: TravelProviderState;
  source: "google_distance_matrix" | "none" | "test_stub";
};

export type CampaignTravelTruth = {
  providerState: TravelProviderState;
  legs: TravelLegEstimate[];
  fingerprint: string;
};

export function travelFingerprint(truth: Pick<CampaignTravelTruth, "providerState" | "legs">): string {
  if (truth.providerState === "unconfigured" || truth.providerState === "unavailable") {
    return `travel:${truth.providerState}`;
  }
  const legs = truth.legs
    .map(leg => `${leg.fromObjectiveId}>${leg.toObjectiveId}:${leg.durationSeconds ?? "na"}`)
    .sort()
    .join(",");
  return `travel:${truth.providerState}:${legs || "none"}`;
}

export function emptyTravelTruth(state: TravelProviderState = "unconfigured"): CampaignTravelTruth {
  return {
    providerState: state,
    legs: [],
    fingerprint: travelFingerprint({ providerState: state, legs: [] }),
  };
}

/** Deterministic test adapter — never bills, never claims Google certainty. */
export function stubCampaignTravel(legs: TravelLegEstimate[]): CampaignTravelTruth {
  const truth: CampaignTravelTruth = {
    providerState: "test_stub",
    legs: legs.map(leg => ({ ...leg, providerState: "test_stub", source: "test_stub" })),
    fingerprint: "",
  };
  return { ...truth, fingerprint: travelFingerprint(truth) };
}
