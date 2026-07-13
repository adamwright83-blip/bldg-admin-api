import { scoreLaundryOpportunity, type LaundryProspectType } from "./scoreLaundryOpportunity";

export type GeoPoint = { lat: number; lng: number; formattedAddress: string };
export type TerritoryEvidence = {
  field: string;
  value: unknown;
  classification: "sourced_fact" | "operator_input" | "deterministic_estimate" | "ai_inference";
  sourceName: string;
  sourceUrl: string | null;
  capturedAt: string;
  confidence: "low" | "medium" | "high";
};
export type TerritoryBusinessCandidate = {
  providerId: string;
  providerName: string;
  providerUrl: string | null;
  sourceCapturedAt: string;
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
  readonly name: string;
  geocode(addressOrBusiness: string): Promise<GeoPoint>;
  searchBusinesses(input: { center: GeoPoint; radiusMiles: number; categories: string[]; limit: number }): Promise<TerritoryBusinessCandidate[]>;
}
export type LaundryTerritoryOperatorContext = {
  tenantId: string;
  serviceRadiusMiles: number;
  commercialWashFoldEnabled: boolean;
  averagePricePerPoundCents: number;
  availableWeeklyCapacityPounds: number;
  routePoints: Array<{ lat: number; lng: number }>;
  turnaroundCompatibleByDefault: boolean;
  pickupDaysCompatibleByDefault: boolean;
};
export type RankedTerritoryOpportunity = {
  candidateKey: string;
  providerName: string;
  providerAccountId: string;
  account: {
    name: string; accountType: string; address: string; latitude: number; longitude: number;
    locationCount: number; decisionMaker: { name: string | null; title: string | null };
    website: string | null; phone: string | null;
  };
  score: ReturnType<typeof scoreLaundryOpportunity>;
  primarySignal: string;
  distanceMiles: number;
  evidence: TerritoryEvidence[];
};
export type TerritoryDiscoveryResult = {
  providerName: string;
  center: GeoPoint;
  providerCandidateCount: number;
  dedupedCandidateCount: number;
  opportunities: RankedTerritoryOpportunity[];
};

export const TERRITORY_SEARCH_CATEGORIES = [
  "hotel", "property management company", "apartment complex", "gym",
  "salon", "spa", "medical office", "restaurant",
];
const radians = (value: number) => (value * Math.PI) / 180;
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = radians(b.lat - a.lat); const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function dedupeTerritoryCandidates(candidates: TerritoryBusinessCandidate[]): TerritoryBusinessCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = candidate.providerId ? `${candidate.providerName}:${candidate.providerId}` : `${normalize(candidate.name)}|${normalize(candidate.formattedAddress)}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}
function prospectType(categories: string[]): LaundryProspectType {
  const value = categories.map(normalize).join(" ");
  if (value.includes("property management") || value.includes("apartment")) return "property_management";
  if (value.includes("hotel") || value.includes("motel") || value.includes("lodging")) return "hotel";
  if (value.includes("gym") || value.includes("fitness")) return "gym";
  if (value.includes("salon") || value.includes("spa")) return "salon_spa";
  if (value.includes("medical") || value.includes("clinic") || value.includes("doctor")) return "medical_office";
  if (value.includes("restaurant") || value.includes("catering")) return "restaurant";
  return "other";
}
function estimatedWeeklyPounds(candidate: TerritoryBusinessCandidate, type: LaundryProspectType): number {
  const locations = Math.max(1, candidate.locationCount ?? 1);
  if (type === "hotel") return Math.max(160, (candidate.roomCount ?? 30) * 6);
  return locations * ({ property_management: 45, gym: 110, salon_spa: 70, medical_office: 55, restaurant: 80, other: 40 }[type]);
}
function nearRoute(candidate: TerritoryBusinessCandidate, points: Array<{ lat: number; lng: number }>) {
  return points.some(point => distanceMiles(candidate, point) <= 0.75);
}

export async function discoverLaundryTerritory(input: {
  addressOrBusiness: string;
  provider: TerritoryBusinessProvider;
  operator: LaundryTerritoryOperatorContext;
  limit?: number;
}): Promise<TerritoryDiscoveryResult> {
  const center = await input.provider.geocode(input.addressOrBusiness);
  const candidates = await input.provider.searchBusinesses({ center, radiusMiles: input.operator.serviceRadiusMiles, categories: TERRITORY_SEARCH_CATEGORIES, limit: Math.max(20, input.limit ?? 20) });
  const deduped = dedupeTerritoryCandidates(candidates);
  const opportunities = deduped.map(candidate => {
    const type = prospectType(candidate.categories);
    const distance = distanceMiles(center, candidate);
    const weeklyPounds = estimatedWeeklyPounds(candidate, type);
    const locationCount = Math.max(1, candidate.locationCount ?? 1);
    const signalStrength = Math.min(100, 30 + (candidate.recentlyOpened ? 35 : 0) + (candidate.growthSignal ? 25 : 0) + (locationCount > 1 ? 10 : 0));
    const score = scoreLaundryOpportunity({
      accountName: candidate.name,
      demand: { prospectType: type, locationCount, roomCount: candidate.roomCount, estimatedWeeklyPounds: weeklyPounds, likelyOrdersPerMonth: type === "hotel" || type === "gym" ? 8 : 4, hasRecurringTextileDemand: type !== "other", signalStrength },
      operatorFit: { commercialWashFoldEnabled: input.operator.commercialWashFoldEnabled, serviceRadiusMiles: input.operator.serviceRadiusMiles, distanceMiles: distance, availableWeeklyCapacityPounds: input.operator.availableWeeklyCapacityPounds, estimatedWeeklyPounds: weeklyPounds, routePassesNearby: nearRoute(candidate, input.operator.routePoints), turnaroundCompatible: input.operator.turnaroundCompatibleByDefault, pickupDaysCompatible: input.operator.pickupDaysCompatibleByDefault },
      salesFit: { decisionMakerIdentified: Boolean(candidate.decisionMakerName), contactMethodAvailable: Boolean(candidate.phone || candidate.website), existingProviderKnown: false, recentGrowthSignal: Boolean(candidate.recentlyOpened || candidate.growthSignal) },
      averagePricePerPoundCents: input.operator.averagePricePerPoundCents,
    });
    const primarySignal = candidate.growthSignal ?? (candidate.recentlyOpened ? "Newly opened in the service area" : locationCount > 1 ? `${locationCount} locations detected` : "Commercial laundry demand detected nearby");
    const capturedAt = candidate.sourceCapturedAt;
    const evidence: TerritoryEvidence[] = [
      { field: "business_identity", value: { name: candidate.name, address: candidate.formattedAddress, categories: candidate.categories }, classification: "sourced_fact", sourceName: candidate.providerName, sourceUrl: candidate.providerUrl, capturedAt, confidence: "high" },
      { field: "operator_capacity", value: { availableWeeklyCapacityPounds: input.operator.availableWeeklyCapacityPounds, averagePricePerPoundCents: input.operator.averagePricePerPoundCents }, classification: "operator_input", sourceName: "DayForge tenant configuration", sourceUrl: null, capturedAt: new Date().toISOString(), confidence: "high" },
      { field: "estimated_laundry_demand", value: { weeklyPounds, estimatedAnnualValueCents: score.estimatedAnnualValueCents }, classification: "deterministic_estimate", sourceName: "DayForge laundry scoring v1", sourceUrl: null, capturedAt: new Date().toISOString(), confidence: score.grade },
    ];
    return {
      candidateKey: `${candidate.providerName}:${candidate.providerId}`,
      providerName: candidate.providerName,
      providerAccountId: candidate.providerId,
      account: { name: candidate.name, accountType: type, address: candidate.formattedAddress, latitude: candidate.lat, longitude: candidate.lng, locationCount, decisionMaker: { name: candidate.decisionMakerName ?? null, title: candidate.decisionMakerTitle ?? null }, website: candidate.website ?? null, phone: candidate.phone ?? null },
      score, primarySignal, distanceMiles: Math.round(distance * 10) / 10, evidence,
    } satisfies RankedTerritoryOpportunity;
  }).sort((a, b) => b.score.score - a.score.score || b.score.estimatedAnnualValueCents - a.score.estimatedAnnualValueCents);
  return { providerName: input.provider.name, center, providerCandidateCount: candidates.length, dedupedCandidateCount: deduped.length, opportunities: opportunities.slice(0, input.limit ?? 20) };
}
