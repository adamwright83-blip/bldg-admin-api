import type { NormalizedPlaceCandidate } from "../procurement/googlePlacesDiscoveryConnector";

export const TOWER_FORGE_STATES = [
  "captured",
  "extracting",
  "entity_resolving",
  "needs_review",
  "geography_verifying",
  "prospect_created",
  "researching",
  "research_partial",
  "concepting",
  "rendering",
  "generation_unconfigured",
  "generation_failed",
  "review_ready",
  "approved",
  "rejected",
  "published",
] as const;
export type TowerForgeState = (typeof TOWER_FORGE_STATES)[number];

const TRANSITIONS: Record<TowerForgeState, readonly TowerForgeState[]> = {
  captured: ["extracting", "entity_resolving", "rejected"],
  extracting: ["entity_resolving", "needs_review"],
  entity_resolving: ["needs_review", "geography_verifying", "prospect_created"],
  needs_review: ["entity_resolving", "geography_verifying", "rejected"],
  geography_verifying: ["needs_review", "prospect_created"],
  prospect_created: ["researching"],
  researching: ["research_partial", "concepting"],
  research_partial: ["researching", "concepting", "needs_review"],
  concepting: ["rendering", "generation_unconfigured", "generation_failed", "needs_review"],
  rendering: ["review_ready", "generation_failed", "generation_unconfigured"],
  generation_unconfigured: ["rendering", "concepting"],
  generation_failed: ["rendering", "concepting"],
  review_ready: ["approved", "rejected", "rendering"],
  approved: ["published"],
  rejected: [],
  published: [],
};

export function canTransitionTowerForge(from: TowerForgeState, to: TowerForgeState) {
  return from === to || TRANSITIONS[from].includes(to);
}

export type PlaceResolution =
  | { status: "matched"; candidate: NormalizedPlaceCandidate; confidence: "high"; reasons: string[] }
  | { status: "needs_review"; candidates: NormalizedPlaceCandidate[]; reasons: string[] }
  | { status: "not_found" | "provider_unconfigured" | "provider_error"; reasons: string[] };

function words(value: string | null | undefined) {
  return new Set((value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean));
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  return Array.from(left).filter(value => right.has(value)).length / Math.max(left.size, right.size);
}

export function selectPlaceCandidate(input: {
  propertyName?: string | null;
  addressClue?: string | null;
  candidates: NormalizedPlaceCandidate[];
}): PlaceResolution {
  if (!input.candidates.length) return { status: "not_found", reasons: ["Places returned no candidates"] };
  const ranked = input.candidates.map(candidate => {
    const nameScore = overlap(words(input.propertyName), words(candidate.businessName));
    const addressScore = overlap(words(input.addressClue), words(candidate.address));
    const score = nameScore * 0.45 + addressScore * 0.55;
    return { candidate, score, nameScore, addressScore };
  }).sort((a, b) => b.score - a.score || a.candidate.placeId.localeCompare(b.candidate.placeId));
  const first = ranked[0]!;
  const second = ranked[1];
  const clearLead = !second || first.score - second.score >= 0.18;
  if (first.score >= 0.72 && clearLead)
    return {
      status: "matched",
      candidate: first.candidate,
      confidence: "high",
      reasons: [`name=${first.nameScore.toFixed(2)}`, `address=${first.addressScore.toFixed(2)}`],
    };
  return {
    status: "needs_review",
    candidates: ranked.slice(0, 5).map(item => item.candidate),
    reasons: ["No single Places candidate cleared the high-confidence identity threshold"],
  };
}

export type PropertyEvidence = {
  id: string;
  factType: string;
  value: string;
  provenance: "operator_observed" | "operator_reported" | "provider_verified" | "official_property_source";
  sourceReference: string;
};

export type TowerWeaponConcept = {
  title: string;
  sourceCharacteristic: string;
  sourceEvidenceIds: string[];
  conceptSummary: string;
  silhouette: string;
  buildingIntegration: string;
  attackMechanic: string;
  animationSequence: string;
  cityScaleReadability: string;
  comedyValue: string;
  distinctiveness: string;
  similarityRisk: "low" | "medium" | "high";
  rationale: string;
  rank: number;
};

const GENERIC_CHARACTERISTICS = new Set(["luxury", "modern", "apartment", "building", "residences"]);

export function generateWeaponCandidates(input: {
  evidence: PropertyEvidence[];
  excludedThemes: string[];
  existingThemes: string[];
}): TowerWeaponConcept[] {
  const exclusions = input.excludedThemes.map(value => value.toLowerCase());
  const existing = input.existingThemes.map(value => value.toLowerCase());
  const eligible = input.evidence.filter(item =>
    ["official_property_source", "provider_verified", "operator_observed"].includes(item.provenance) &&
    !exclusions.some(term => item.value.toLowerCase().includes(term))
  );
  const ranked = [...eligible].sort((a, b) => {
    const aGeneric = GENERIC_CHARACTERISTICS.has(a.value.toLowerCase()) ? 1 : 0;
    const bGeneric = GENERIC_CHARACTERISTICS.has(b.value.toLowerCase()) ? 1 : 0;
    return aGeneric - bGeneric || a.id.localeCompare(b.id);
  }).slice(0, 5);
  return ranked.map((item, index) => {
    const token = item.value.trim();
    const similarityRisk = existing.some(theme => theme.includes(token.toLowerCase()) || token.toLowerCase().includes(theme)) ? "high" : "low";
    return {
      title: `${token} Engine`,
      sourceCharacteristic: token,
      sourceEvidenceIds: [item.id],
      conceptSummary: `Transforms the documented ${token} characteristic into a readable tower mechanic.`,
      silhouette: `A single oversized ${token} form breaks the roofline.`,
      buildingIntegration: `The mechanism grows from the existing architecture rather than floating beside it.`,
      attackMechanic: `The ${token} mechanism stores real order-powered charge and releases one legible strike.`,
      animationSequence: "charge → architectural movement → release → visible recovery",
      cityScaleReadability: `One bold ${token} silhouette remains recognizable without a label.`,
      comedyValue: `The real feature is exaggerated with affectionate, physical absurdity.`,
      distinctiveness: similarityRisk === "high" ? "Requires operator review against an existing theme." : "Distinct from registered tower themes.",
      similarityRisk,
      rationale: `Grounded in ${item.sourceReference}; no undocumented amenity was added.`,
      rank: index + 1,
    };
  });
}
