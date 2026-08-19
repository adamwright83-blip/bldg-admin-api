import type { Day1Target } from "./day1TenDoors";

/**
 * LEAD HUNT is intentionally tiny. It is the authored contract needed to run
 * the same Colosseum loop against another real prospect category without
 * building a generalized mission platform.
 *
 * Targets are always supplied from real sourced/operator-declared business
 * truth. This grammar cannot invent a company, location, outcome or revenue.
 */
export type LeadHuntDefinition = {
  id: string;
  title: string;
  targetCategory: string;
  targetIds: readonly string[];
  requiredRealWorldAction: "pitch_in_person";
  completionCount: number;
  villainTargetId: string;
  revealTreatment: "colosseum_target_located";
  fictionalReward: "boss_breach";
};

export type LeadHuntTargetProjection = {
  definition: LeadHuntDefinition;
  targets: Day1Target[];
};

export function validateLeadHuntDefinition(
  definition: LeadHuntDefinition
): LeadHuntDefinition {
  if (!definition.id.trim()) throw new Error("Lead Hunt id is required");
  if (!definition.title.trim()) throw new Error("Lead Hunt title is required");
  if (!definition.targetCategory.trim())
    throw new Error("Lead Hunt target category is required");
  if (definition.targetIds.length === 0)
    throw new Error("Lead Hunt requires real target ids");
  if (new Set(definition.targetIds).size !== definition.targetIds.length)
    throw new Error("Lead Hunt target ids must be unique");
  if (
    definition.completionCount < 1 ||
    definition.completionCount > definition.targetIds.length
  ) {
    throw new Error("Lead Hunt completion count must fit its real target set");
  }
  if (!definition.targetIds.includes(definition.villainTargetId)) {
    throw new Error("Lead Hunt villain target must be one of its real targets");
  }
  return definition;
}

/**
 * Selects only real targets that already exist in authoritative mission data.
 * Missing ids stay missing; the function never fabricates a placeholder.
 */
export function projectLeadHuntTargets(
  definition: LeadHuntDefinition,
  availableTargets: readonly Day1Target[]
): LeadHuntTargetProjection {
  validateLeadHuntDefinition(definition);
  const byId = new Map(availableTargets.map(target => [target.id, target]));
  const targets = definition.targetIds
    .map(id => byId.get(id))
    .filter((target): target is Day1Target => target != null);
  return { definition, targets };
}
