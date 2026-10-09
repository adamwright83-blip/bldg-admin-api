import type { PropertyEvidence } from "./propertyEvidence";
import type { TowerWeaponConcept } from "./towerForgeContracts";

export function buildTowerGenerationPrompt(input: {
  propertyName: string;
  evidence: PropertyEvidence[];
  concept: TowerWeaponConcept;
  excludedThemes: string[];
}) {
  return [
    "GOLDLINE CANONICAL TOWER ART · PROMPT V1",
    `Real property identity: ${input.propertyName}`,
    `Verified/observed source characteristics: ${input.evidence.map(item => item.value).join("; ")}`,
    `Selected fictional weapon concept: ${input.concept.title} — ${input.concept.conceptSummary}`,
    `Silhouette: ${input.concept.silhouette}`,
    `Integration: ${input.concept.buildingIntegration}`,
    "Create transparent-background authored game art. Keep the physical building and fictional weapon visually separable. Strong city-scale silhouette, readable roofline, no text label required.",
    "The weapon is game fiction inspired by evidence. Do not add or depict undocumented real amenities as factual property features.",
    `Prohibited themes: ${input.excludedThemes.length ? input.excludedThemes.join(", ") : "none configured"}`,
    "Do not imitate OPUS golf-club/ball or Century Park East signature art. Portrait 2:3 composition, grounded at bottom center.",
  ].join("\n");
}

