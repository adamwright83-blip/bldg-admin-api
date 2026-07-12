import type {
  CommercialMissionConfidence,
  CommercialOpportunity,
} from "@shared/commercialMission";
import {
  scoreLaundryOpportunity,
  type LaundryProspectType,
} from "./scoreLaundryOpportunity";

export type GeoPoint = {
  lat: number;
  lng: number;
  formattedAddress: string;
};

export type TerritoryBusinessCandidate = {
  providerId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  categories: string[];
  website?: string | null;
  phone?: string | null;
  locationCount?: number | null;
  roomCount?: number | null;
  recentlyOpened?: boolean;
  growthSignal?: string | null;
  decisionMakerName?: string | null;
  decisionMakerTitle?: string | null;
};

export interface TerritoryBusinessProvider {
  geocode(addressOrBusiness: string): Promise<GeoPoint>;
  searchBusinesses(input: {
    center: GeoPoint;
    radiusMiles: number;
    categories: string[];
    limit: number;
  }): Promise<TerritoryBusinessCandidate[]>;
}

export type LaundryTerritoryOperatorContext = {
  tenantId: string;
  serviceRadiusMiles: number;
  commercialWashFoldEnabled: boolean;
  averagePricePerPoundCents: number;
  availableWeeklyCapacityPounds: number;
  routePoints?: Array<{ lat: number; lng: number }>;
  turnaroundCompatibleByDefault: boolean;
  pickupDaysCompatibleByDefault: boolean;
};

export type TerritoryDiscoveryResult = {
  center: GeoPoint;
  providerCandidateCount: number;
  dedupedCandidateCount: number;
  opportunities: CommercialOpportunity[];
  evidenceByOpportunityId: Record<
    number,
    {
      providerId: string;
      address: string;
      website: string | null;
      phone: string | null;
      distanceMiles: number;
      estimatedWeeklyPounds: number;
      grade: CommercialMissionConfidence;
      reasons: string[];
      risks: string[];
      decisionMakerName: string | null;
      decisionMakerTitle: string | null;
    }
  >;
};

const SEARCH_CATEGORIES = [
  "hotel",
  "property_management",
  "apartment_complex",
  "gym",
  "salon",
  "spa",
  "medical_office",
  "restaurant",
];

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusMiles = 3958.8;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function stablePositiveId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) || 1;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeCandidates(
  candidates: TerritoryBusinessCandidate[]
): TerritoryBusinessCandidate[] {
  const seen = new Set<string>();
  const result: TerritoryBusinessCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.providerId
      ? `provider:${candidate.providerId}`
      : `${normalize(candidate.name)}|${normalize(candidate.formattedAddress)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function prospectType(categories: string[]): LaundryProspectType {
  const normalized = categories.map(normalize).join(" ");
  if (normalized.includes("property management") || normalized.includes("apartment")) {
    return "property_management";
  }
  if (normalized.includes("hotel") || normalized.includes("motel")) return "hotel";
  if (normalized.includes("gym") || normalized.includes("fitness")) return "gym";
  if (normalized.includes("salon") || normalized.includes("spa")) return "salon_spa";
  if (normalized.includes("medical") || normalized.includes("clinic")) return "medical_office";
  if (normalized.includes("restaurant") || normalized.includes("catering")) return "restaurant";
  return "other";
}

function estimateWeeklyPounds(candidate: TerritoryBusinessCandidate, type: LaundryProspectType): number {
  const locations = Math.max(1, candidate.locationCount ?? 1);
  switch (type) {
    case "hotel":
      return Math.max(160, (candidate.roomCount ?? 30) * 6);
    case "property_management":
      return locations * 45;
    case "gym":
      return locations * 110;
    case "salon_spa":
      return locations * 70;
    case "medical_office":
      return locations * 55;
    case "restaurant":
      return locations * 80;
    default:
      return locations * 40;
  }
}

function nearRoute(
  candidate: TerritoryBusinessCandidate,
  routePoints: Array<{ lat: number; lng: number }> | undefined
): boolean {
  if (!routePoints?.length) return false;
  return routePoints.some(point => distanceMiles(candidate, point) <= 0.75);
}

function signalStrength(candidate: TerritoryBusinessCandidate): number {
  let score = 30;
  if (candidate.recentlyOpened) score += 35;
  if (candidate.growthSignal) score += 25;
  if ((candidate.locationCount ?? 1) > 1) score += 10;
  return Math.min(100, score);
}

function primarySignal(candidate: TerritoryBusinessCandidate): string {
  if (candidate.growthSignal) return candidate.growthSignal;
  if (candidate.recentlyOpened) return "Newly opened in the service area";
  if ((candidate.locationCount ?? 1) > 1) {
    return `${candidate.locationCount} locations in the portfolio`;
  }
  return "Commercial laundry demand detected nearby";
}

export async function discoverLaundryTerritory(input: {
  addressOrBusiness: string;
  provider: TerritoryBusinessProvider;
  operator: LaundryTerritoryOperatorContext;
  limit?: number;
}): Promise<TerritoryDiscoveryResult> {
  const center = await input.provider.geocode(input.addressOrBusiness);
  const candidates = await input.provider.searchBusinesses({
    center,
    radiusMiles: input.operator.serviceRadiusMiles,
    categories: SEARCH_CATEGORIES,
    limit: Math.max(20, input.limit ?? 40),
  });
  const deduped = dedupeCandidates(candidates);
  const evidenceByOpportunityId: TerritoryDiscoveryResult["evidenceByOpportunityId"] = {};

  const opportunities = deduped.map(candidate => {
    const type = prospectType(candidate.categories);
    const distance = distanceMiles(center, candidate);
    const weeklyPounds = estimateWeeklyPounds(candidate, type);
    const score = scoreLaundryOpportunity({
      accountName: candidate.name,
      demand: {
        prospectType: type,
        locationCount: Math.max(1, candidate.locationCount ?? 1),
        roomCount: candidate.roomCount ?? null,
        estimatedWeeklyPounds: weeklyPounds,
        likelyOrdersPerMonth: type === "hotel" || type === "gym" ? 8 : 4,
        hasRecurringTextileDemand: type !== "other",
        signalStrength: signalStrength(candidate),
      },
      operatorFit: {
        commercialWashFoldEnabled: input.operator.commercialWashFoldEnabled,
        serviceRadiusMiles: input.operator.serviceRadiusMiles,
        distanceMiles: distance,
        availableWeeklyCapacityPounds: input.operator.availableWeeklyCapacityPounds,
        estimatedWeeklyPounds: weeklyPounds,
        routePassesNearby: nearRoute(candidate, input.operator.routePoints),
        turnaroundCompatible: input.operator.turnaroundCompatibleByDefault,
        pickupDaysCompatible: input.operator.pickupDaysCompatibleByDefault,
      },
      salesFit: {
        decisionMakerIdentified: Boolean(candidate.decisionMakerName),
        contactMethodAvailable: Boolean(candidate.phone || candidate.website),
        existingProviderKnown: false,
        recentGrowthSignal: Boolean(candidate.recentlyOpened || candidate.growthSignal),
      },
      averagePricePerPoundCents: input.operator.averagePricePerPoundCents,
    });
    const id = stablePositiveId(`${candidate.providerId}:${candidate.name}`);
    evidenceByOpportunityId[id] = {
      providerId: candidate.providerId,
      address: candidate.formattedAddress,
      website: candidate.website ?? null,
      phone: candidate.phone ?? null,
      distanceMiles: Math.round(distance * 10) / 10,
      estimatedWeeklyPounds: score.estimatedWeeklyPounds,
      grade: score.grade,
      reasons: score.reasons,
      risks: score.risks,
      decisionMakerName: candidate.decisionMakerName ?? null,
      decisionMakerTitle: candidate.decisionMakerTitle ?? null,
    };

    return {
      id,
      accountName: candidate.name,
      accountType: type.replaceAll("_", " "),
      locationCount: Math.max(1, candidate.locationCount ?? 1),
      distanceMiles: Math.round(distance * 10) / 10,
      estimatedAnnualValueCents: score.estimatedAnnualValueCents,
      score: score.score,
      grade: score.grade,
      primarySignal: primarySignal(candidate),
      reasons: score.reasons,
    } satisfies CommercialOpportunity;
  });

  opportunities.sort((a, b) => b.score - a.score || b.estimatedAnnualValueCents - a.estimatedAnnualValueCents);

  return {
    center,
    providerCandidateCount: candidates.length,
    dedupedCandidateCount: deduped.length,
    opportunities: opportunities.slice(0, input.limit ?? 20),
    evidenceByOpportunityId,
  };
}
