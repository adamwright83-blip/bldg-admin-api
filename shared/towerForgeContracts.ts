import type { PropertyEvidence } from "./propertyEvidence";

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
