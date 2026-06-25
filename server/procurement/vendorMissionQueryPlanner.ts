// Slice 77a. Deterministic v0 mission-text query planner.
//
// This is intentionally NOT an LLM call -- it is a keyword-based fallback
// that turns mission text into Google Places search-query variants. It
// will only recognize the specific phrasings checked for below; it does
// not generalize to arbitrary phrasing the way a real language model
// would. It exists so discovery is driven by *something* derived from
// the operator's actual words rather than category+ZIP alone, and so it
// can serve as the safe fallback once a real bounded LLM-based planner
// is added in a later slice.
//
// This module never sends outreach, never contacts a vendor, and never
// marks any provider-acceptance/booking/payment/dispatch truth. It only
// produces search-query text for a read-only Google Places lookup.

import { CANONICAL_SERVICE_CATEGORIES, getCanonicalServiceDefinition, type CanonicalServiceCategory } from "./canonicalServiceTaxonomyPolicy";

export const SERVICE_MODES = ["mobile_required", "building_service_required", "storefront_ok", "unknown"] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

export const MAX_QUERY_VARIANTS = 6;

const MOBILE_TERMS = [
  "mobile", "comes to you", "come to you", "at-home", "at home",
  "house call", "house calls", "on-site", "onsite",
];

const BUILDING_TERMS = [
  "high-rise", "high rise", "apartment building", "their building", "their buildings",
  "service residents at", "building service", "luxury building", "luxury residents",
];

const STOREFRONT_TERMS = [
  "drive to", "storefront", "salon", "shop", "residents can go to",
  "nearby appointment", "walk-in", "walk in",
];

export type MissionQueryPlanInput = {
  missionText?: string | null;
  category: string;
  geographyLabel: string;
  ratingThreshold?: number | null;
  targetQuantity: number;
};

export type MissionQueryPlan = {
  primaryIntent: string;
  serviceCategory: string;
  locationText: string;
  searchQueries: string[];
  requiredTerms: string[];
  preferredTerms: string[];
  excludedTerms: string[];
  serviceMode: ServiceMode;
  confidence: "low" | "medium" | "high";
  notes: string[];
};

function containsAny(text: string, terms: string[]): string | null {
  const lower = text.toLowerCase();
  return terms.find(term => lower.includes(term)) ?? null;
}

function categoryLabel(category: string): string {
  const isCanonical = (CANONICAL_SERVICE_CATEGORIES as readonly string[]).includes(category);
  return isCanonical ? getCanonicalServiceDefinition(category as CanonicalServiceCategory).label : category;
}

function locationTextFrom(geographyLabel: string): string {
  // Extract the leading ZIP/location token (e.g. "90027" from
  // "90027 (5 mi radius)"). Falls back to the full label if no
  // parenthetical suffix is present. Never guesses a neighborhood name
  // not present in the input -- that would be fabricating geography.
  const match = /^([^(]+)/.exec(geographyLabel.trim());
  return (match ? match[1] : geographyLabel).trim() || geographyLabel;
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

export function planMissionQuery(input: MissionQueryPlanInput): MissionQueryPlan {
  const text = input.missionText?.trim() ?? "";
  const label = categoryLabel(input.category);
  const locationText = locationTextFrom(input.geographyLabel);
  const notes: string[] = [];

  let serviceMode: ServiceMode = "unknown";
  const mobileHit = text ? containsAny(text, MOBILE_TERMS) : null;
  const buildingHit = text ? containsAny(text, BUILDING_TERMS) : null;
  const storefrontHit = text ? containsAny(text, STOREFRONT_TERMS) : null;

  if (mobileHit) {
    serviceMode = "mobile_required";
    notes.push(`Detected mobile/at-home service term "${mobileHit}" in mission text.`);
  } else if (buildingHit) {
    serviceMode = "building_service_required";
    notes.push(`Detected building-service term "${buildingHit}" in mission text.`);
  } else if (storefrontHit) {
    serviceMode = "storefront_ok";
    notes.push(`Detected storefront/drive-to term "${storefrontHit}" in mission text.`);
  } else if (text) {
    notes.push("No service-mode terms detected in mission text -- using category and geography only.");
  } else {
    notes.push("No mission text provided -- using category and geography only.");
  }

  const variants: string[] = [];
  if (serviceMode === "mobile_required" || serviceMode === "building_service_required") {
    variants.push(
      `mobile ${label} near ${locationText}`,
      `${label} that comes to you near ${locationText}`,
      `mobile ${label.toLowerCase()} service ${locationText}`,
    );
    if (serviceMode === "building_service_required") {
      variants.push(`${label} for apartment buildings near ${locationText}`);
    }
  } else if (serviceMode === "storefront_ok") {
    variants.push(
      `${label} near ${locationText}`,
      `${label} salon near ${locationText}`,
    );
  }
  // Always include a plain category+location query as a coverage floor.
  variants.push(`${label} near ${locationText}`);

  const searchQueries = dedupeCaseInsensitive(variants).slice(0, MAX_QUERY_VARIANTS);

  const requiredTerms = serviceMode === "mobile_required" ? ["mobile"] : [];
  const preferredTerms = serviceMode === "building_service_required" ? ["mobile", "building"]
    : serviceMode === "storefront_ok" ? ["salon", "storefront"] : [];

  const confidence: MissionQueryPlan["confidence"] = mobileHit || buildingHit || storefrontHit
    ? "high" : text ? "medium" : "low";

  return {
    primaryIntent: `${serviceMode}:${input.category}`,
    serviceCategory: input.category,
    locationText,
    searchQueries,
    requiredTerms,
    preferredTerms,
    excludedTerms: [],
    serviceMode,
    confidence,
    notes,
  };
}
