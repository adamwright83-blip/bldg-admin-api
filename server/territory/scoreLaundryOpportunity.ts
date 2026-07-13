import type { CommercialMissionConfidence } from "@shared/commercialMission";

export type LaundryProspectType =
  | "property_management" | "hotel" | "gym" | "salon_spa"
  | "medical_office" | "restaurant" | "other";

export type LaundryOpportunityInput = {
  accountName: string;
  demand: {
    prospectType: LaundryProspectType;
    locationCount: number;
    roomCount?: number | null;
    estimatedWeeklyPounds?: number | null;
    likelyOrdersPerMonth?: number | null;
    hasRecurringTextileDemand: boolean;
    signalStrength: number;
  };
  operatorFit: {
    commercialWashFoldEnabled: boolean;
    serviceRadiusMiles: number;
    distanceMiles: number;
    availableWeeklyCapacityPounds: number;
    estimatedWeeklyPounds: number;
    routePassesNearby: boolean;
    turnaroundCompatible: boolean;
    pickupDaysCompatible: boolean;
  };
  salesFit: {
    decisionMakerIdentified: boolean;
    contactMethodAvailable: boolean;
    existingProviderKnown: boolean;
    recentGrowthSignal: boolean;
    priorSimilarMissionWinRate?: number | null;
  };
  averagePricePerPoundCents: number;
};

export type LaundryOpportunityScore = {
  score: number;
  grade: CommercialMissionConfidence;
  demandScore: number;
  operatorFitScore: number;
  salesFitScore: number;
  estimatedAnnualValueCents: number;
  estimatedWeeklyPounds: number;
  reasons: string[];
  risks: string[];
};

const TYPE_DEMAND_POINTS: Record<LaundryProspectType, number> = {
  property_management: 18, hotel: 20, gym: 14, salon_spa: 12,
  medical_office: 10, restaurant: 8, other: 5,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function inferWeeklyPounds(input: LaundryOpportunityInput["demand"]): number {
  if (input.estimatedWeeklyPounds && input.estimatedWeeklyPounds > 0) return Math.round(input.estimatedWeeklyPounds);
  const locations = Math.max(1, input.locationCount);
  if (input.prospectType === "hotel") return Math.max(160, (input.roomCount ?? 30) * 6);
  const poundsByType: Record<Exclude<LaundryProspectType, "hotel">, number> = {
    property_management: 45, gym: 110, salon_spa: 70,
    medical_office: 55, restaurant: 80, other: 40,
  };
  return Math.round(locations * poundsByType[input.prospectType]);
}

export function scoreLaundryOpportunity(input: LaundryOpportunityInput): LaundryOpportunityScore {
  const weeklyPounds = inferWeeklyPounds(input.demand);
  const reasons: string[] = [];
  const risks: string[] = [];
  let demandScore = TYPE_DEMAND_POINTS[input.demand.prospectType]
    + clamp(input.demand.locationCount - 1, 0, 8)
    + (input.demand.hasRecurringTextileDemand ? 8 : 0)
    + clamp(Math.round(input.demand.signalStrength / 10), 0, 10);
  demandScore = clamp(demandScore, 0, 40);
  if (input.demand.hasRecurringTextileDemand) reasons.push("Recurring textile demand is likely");
  if (input.demand.locationCount > 1) reasons.push(`${input.demand.locationCount} locations can be served under one account`);
  if (input.demand.signalStrength >= 70) reasons.push("A recent public signal makes the timing stronger");

  let operatorFitScore = input.operatorFit.commercialWashFoldEnabled ? 7 : 0;
  if (input.operatorFit.distanceMiles <= input.operatorFit.serviceRadiusMiles) {
    operatorFitScore += 6;
    reasons.push(`${input.operatorFit.distanceMiles.toFixed(1)} miles from the store`);
  } else risks.push("Outside the configured service radius");
  if (input.operatorFit.routePassesNearby) {
    operatorFitScore += 6;
    reasons.push("Near an existing pickup route");
  }
  if (input.operatorFit.turnaroundCompatible) operatorFitScore += 4;
  else risks.push("Requested turnaround may not fit the operation");
  if (input.operatorFit.pickupDaysCompatible) operatorFitScore += 4;
  else risks.push("Preferred pickup days conflict with current routes");
  const capacityRatio = weeklyPounds > 0 ? input.operatorFit.availableWeeklyCapacityPounds / weeklyPounds : 0;
  if (capacityRatio >= 1.25) {
    operatorFitScore += 8;
    reasons.push("Available weekly capacity can absorb the estimated volume");
  } else if (capacityRatio >= 1) {
    operatorFitScore += 5;
    reasons.push("Available capacity appears sufficient");
  } else risks.push("Estimated volume exceeds currently available weekly capacity");
  operatorFitScore = clamp(operatorFitScore, 0, 35);

  let salesFitScore = 0;
  if (input.salesFit.decisionMakerIdentified) {
    salesFitScore += 8;
    reasons.push("Decision-maker identified");
  } else risks.push("Decision-maker not yet identified");
  if (input.salesFit.contactMethodAvailable) salesFitScore += 5;
  else risks.push("No direct contact method found");
  if (input.salesFit.recentGrowthSignal) salesFitScore += 7;
  if (input.salesFit.existingProviderKnown) salesFitScore += 2;
  else risks.push("Current laundry provider is unknown");
  if (input.salesFit.priorSimilarMissionWinRate != null) {
    salesFitScore += clamp(Math.round(input.salesFit.priorSimilarMissionWinRate * 5), 0, 5);
  }
  salesFitScore = clamp(salesFitScore, 0, 25);

  const score = clamp(Math.round(demandScore + operatorFitScore + salesFitScore), 0, 100);
  const ordersPerMonth = Math.max(4, input.demand.likelyOrdersPerMonth ?? 4);
  const poundsPerOrder = (weeklyPounds / 4) * (4 / ordersPerMonth);
  const annualValue = Math.round(poundsPerOrder * ordersPerMonth * input.averagePricePerPoundCents) * 12;
  return {
    score,
    grade: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
    demandScore,
    operatorFitScore,
    salesFitScore,
    estimatedAnnualValueCents: annualValue,
    estimatedWeeklyPounds: weeklyPounds,
    reasons: reasons.slice(0, 8),
    risks: risks.slice(0, 6),
  };
}
