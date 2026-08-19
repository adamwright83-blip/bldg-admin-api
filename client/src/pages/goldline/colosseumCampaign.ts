import {
  projectLeadHuntTargets,
  validateLeadHuntDefinition,
  type LeadHuntDefinition,
} from "../../../../shared/leadHunt";
import type { Day1TenDoorsMissionView } from "./Day1FieldMission";

/**
 * The current rescue boss is one concrete LEAD HUNT: five real Greystar
 * Koreatown properties. The next category (for example dry cleaners) can use
 * this exact grammar once its real target ids are sourced/operator-declared.
 * Nothing here can fabricate the next hunt's businesses.
 */
export const COLOSSEUM_LEAD_HUNT = validateLeadHuntDefinition({
  id: "greystar-koreatown-five",
  title: "THE GREYSTAR HUNT",
  targetCategory: "luxury_high_rise",
  targetIds: [
    "rise-koreatown",
    "avana-on-wilshire",
    "the-pearl-on-wilshire",
    "wilshire-vermont",
    "the-chadwick",
  ],
  requiredRealWorldAction: "pitch_in_person",
  completionCount: 5,
  villainTargetId: "the-chadwick",
  revealTreatment: "colosseum_target_located",
  fictionalReward: "boss_breach",
} satisfies LeadHuntDefinition);

export const COLOSSEUM_TARGET_IDS = COLOSSEUM_LEAD_HUNT.targetIds;
export const COLOSSEUM_VILLAIN_TARGET_ID =
  COLOSSEUM_LEAD_HUNT.villainTargetId;

const COLOSSEUM_TARGET_SET = new Set<string>(COLOSSEUM_TARGET_IDS);

export function projectColosseumMission(
  mission: Day1TenDoorsMissionView
): Day1TenDoorsMissionView {
  const { targets } = projectLeadHuntTargets(
    COLOSSEUM_LEAD_HUNT,
    mission.targets
  );
  const outcomes = Object.fromEntries(
    Object.entries(mission.outcomes).filter(([targetId]) =>
      COLOSSEUM_TARGET_SET.has(targetId)
    )
  );
  const visitedCount = Object.keys(outcomes).length;
  const currentTarget = targets.find(target => !(target.id in outcomes)) ?? null;
  let pitched = 0;
  let couldntReach = 0;
  for (const outcome of Object.values(outcomes)) {
    if (outcome === "pitched") pitched += 1;
    else couldntReach += 1;
  }

  return {
    ...mission,
    targets,
    outcomes,
    currentTarget,
    progressLabel:
      currentTarget == null
        ? null
        : `TARGET ${visitedCount + 1} OF ${targets.length}`,
    visitedCount,
    totalCount: targets.length,
    isComplete:
      targets.length >= COLOSSEUM_LEAD_HUNT.completionCount &&
      visitedCount >= COLOSSEUM_LEAD_HUNT.completionCount,
    outcomeCounts: { pitched, couldntReach },
  };
}
