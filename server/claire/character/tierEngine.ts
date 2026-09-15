import type {
  ClaireDisclosureTier,
  ClaireRelationshipEvent,
  ClaireRelationshipPolicy,
} from "./types";

/**
 * Pure, deterministic, testable-without-a-database relationship/tier
 * engine (Slices 5-7). Takes the full ordered event history and the
 * character's relationship policy and derives:
 *   - the four relationship dimensions (server-owned, model can never write these)
 *   - the disclosure tier
 *   - an auditable transition (fromTier/toTier/reasons/supportingEventIds)
 *
 * Deliberately recomputes from scratch each time rather than incrementally
 * mutating a cache in place, so a state can always be reproduced and
 * audited from the raw event log alone.
 */

export type ClaireDerivedDimensions = {
  professionalRespect: number;
  reliability: number;
  disclosureSafety: number;
  familiarity: number;
  qualifyingInteractionCount: number;
  distinctInteractionDays: number;
};

const DIMENSION_MIN = 0;
const DIMENSION_MAX = 100;

function clamp(value: number): number {
  return Math.max(DIMENSION_MIN, Math.min(DIMENSION_MAX, value));
}

function sortByOccurredAt(
  events: ClaireRelationshipEvent[]
): ClaireRelationshipEvent[] {
  return [...events].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );
}

/** Dimensions move independently — this is intentional, not a bug to "simplify" into one score. */
export function deriveClaireRelationshipDimensions(
  events: ClaireRelationshipEvent[]
): ClaireDerivedDimensions {
  const sorted = sortByOccurredAt(events);
  let professionalRespect = 0;
  let reliability = 0;
  let disclosureSafety = 0;
  let familiarity = 0;

  for (const event of sorted) {
    switch (event.eventType) {
      case "call_completed":
        break;
      case "operator_follow_through":
        professionalRespect += 3;
        reliability += 2;
        break;
      case "operator_avoidance":
        reliability -= 2;
        break;
      case "operator_owned_mistake":
        professionalRespect += 4;
        break;
      case "operator_respected_boundary":
        disclosureSafety += 5;
        break;
      case "operator_ignored_boundary":
        disclosureSafety -= 8;
        break;
      case "shared_hard_win":
        professionalRespect += 5;
        familiarity += 3;
        break;
      case "shared_failure":
        familiarity += 2;
        break;
      case "claire_admitted_error":
        familiarity += 1;
        break;
      case "claire_disclosure":
        break;
      case "operator_handled_disclosure_well":
        disclosureSafety += 6;
        break;
      case "operator_handled_disclosure_poorly":
        disclosureSafety -= 10;
        break;
    }
    if (event.eventType !== "call_completed") familiarity += 0.5;
  }

  const qualifying = sorted.filter(event => event.eventType !== "call_completed");
  const distinctDays = new Set(
    qualifying.map(event => event.occurredAt.slice(0, 10))
  );

  return {
    professionalRespect: clamp(Math.round(professionalRespect)),
    reliability: clamp(Math.round(reliability)),
    disclosureSafety: clamp(Math.round(disclosureSafety)),
    familiarity: clamp(Math.round(familiarity)),
    qualifyingInteractionCount: qualifying.length,
    distinctInteractionDays: distinctDays.size,
  };
}

/**
 * A boundary/disclosure-safety violation is "unresolved" if no later event
 * of the corresponding resolving type occurs after it. Fail-closed: an
 * unresolved violation blocks tier advancement (never retreats an already
 * granted tier — Pass 1 does not implement tier demotion).
 */
function hasUnresolvedIgnoredBoundary(
  sorted: ClaireRelationshipEvent[]
): boolean {
  let lastIgnoredIndex = -1;
  let lastRespectedIndex = -1;
  sorted.forEach((event, index) => {
    if (event.eventType === "operator_ignored_boundary") lastIgnoredIndex = index;
    if (event.eventType === "operator_respected_boundary") lastRespectedIndex = index;
  });
  return lastIgnoredIndex > lastRespectedIndex;
}

function hasUnresolvedDisclosureSafetyViolation(
  sorted: ClaireRelationshipEvent[]
): boolean {
  let lastViolationIndex = -1;
  let lastHandledWellIndex = -1;
  sorted.forEach((event, index) => {
    if (event.eventType === "operator_handled_disclosure_poorly") lastViolationIndex = index;
    if (event.eventType === "operator_handled_disclosure_well") lastHandledWellIndex = index;
  });
  return lastViolationIndex > lastHandledWellIndex;
}

function hasMeaningfulSharedEvent(sorted: ClaireRelationshipEvent[]): boolean {
  return sorted.some(
    event => event.eventType === "shared_hard_win" || event.eventType === "shared_failure"
  );
}

/** A disclosure only counts as "handled well" if it happened after a claire_disclosure. */
function hasPriorDisclosureHandledWell(
  sorted: ClaireRelationshipEvent[]
): { satisfied: boolean; supportingEventIds: number[] } {
  let lastDisclosureIndex = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].eventType === "claire_disclosure") lastDisclosureIndex = index;
    if (
      sorted[index].eventType === "operator_handled_disclosure_well" &&
      lastDisclosureIndex !== -1 &&
      lastDisclosureIndex < index
    ) {
      return {
        satisfied: true,
        supportingEventIds: [sorted[lastDisclosureIndex].id, sorted[index].id],
      };
    }
  }
  return { satisfied: false, supportingEventIds: [] };
}

export type ClaireTierComputation = {
  tier: ClaireDisclosureTier;
  reasons: string[];
  supportingEventIds: number[];
};

/**
 * Computes the tier a fresh state should sit at given the full event
 * history. Never trusts a previously-stored tier — recomputes from zero
 * every time so a corrupted/missing cache always fails closed to a correct
 * (possibly lower) tier rather than an over-generous stale one.
 */
export function computeClaireDisclosureTier(
  events: ClaireRelationshipEvent[],
  policy: ClaireRelationshipPolicy
): ClaireTierComputation {
  const sorted = sortByOccurredAt(events);
  const dimensions = deriveClaireRelationshipDimensions(sorted);
  const reasons: string[] = [];
  const supportingEventIds: number[] = [];
  let tier: ClaireDisclosureTier = 0;

  const boundaryUnresolved = hasUnresolvedIgnoredBoundary(sorted);

  // Tier 0 -> 1
  if (
    dimensions.qualifyingInteractionCount >= policy.tier0to1.minQualifyingInteractions &&
    dimensions.distinctInteractionDays >= policy.tier0to1.minDistinctDays &&
    !boundaryUnresolved
  ) {
    tier = 1;
    reasons.push(
      `${policy.tier0to1.minQualifyingInteractions} qualifying interactions reached`,
      `${policy.tier0to1.minDistinctDays} distinct interaction days reached`
    );
  } else {
    return { tier: 0, reasons: [], supportingEventIds: [] };
  }

  // Tier 1 -> 2
  const sharedEvent = hasMeaningfulSharedEvent(sorted);
  if (
    dimensions.qualifyingInteractionCount >= policy.tier1to2.minQualifyingInteractions &&
    dimensions.distinctInteractionDays >= policy.tier1to2.minDistinctDays &&
    dimensions.reliability > 0 &&
    (!policy.tier1to2.requireMeaningfulSharedEvent || sharedEvent) &&
    !boundaryUnresolved
  ) {
    tier = 2;
    reasons.push(
      `${policy.tier1to2.minQualifyingInteractions} qualifying interactions reached`,
      `${policy.tier1to2.minDistinctDays} distinct interaction days reached`,
      "reliability requirement satisfied"
    );
    if (sharedEvent) {
      reasons.push("meaningful shared event present");
      const evt = sorted.find(
        event => event.eventType === "shared_hard_win" || event.eventType === "shared_failure"
      );
      if (evt) supportingEventIds.push(evt.id);
    }
  } else {
    return { tier, reasons, supportingEventIds };
  }

  // Tier 2 -> 3
  const disclosureUnresolved = hasUnresolvedDisclosureSafetyViolation(sorted);
  const priorDisclosureHandledWell = hasPriorDisclosureHandledWell(sorted);
  if (
    dimensions.qualifyingInteractionCount >= policy.tier2to3.minQualifyingInteractions &&
    dimensions.distinctInteractionDays >= policy.tier2to3.minDistinctDays &&
    dimensions.reliability > 0 &&
    dimensions.disclosureSafety > 0 &&
    !disclosureUnresolved &&
    (!policy.tier2to3.requirePriorDisclosureHandledWell || priorDisclosureHandledWell.satisfied)
  ) {
    tier = 3;
    reasons.push(
      `${policy.tier2to3.minQualifyingInteractions} qualifying interactions reached`,
      `${policy.tier2to3.minDistinctDays} distinct interaction days reached`,
      "disclosure safety requirement satisfied",
      "prior Claire disclosure handled well"
    );
    supportingEventIds.push(...priorDisclosureHandledWell.supportingEventIds);
  }

  return { tier, reasons, supportingEventIds: Array.from(new Set(supportingEventIds)) };
}
