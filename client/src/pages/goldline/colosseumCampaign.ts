import type { Day1TenDoorsMissionView } from "./Day1TenDoors";

/**
 * Fast, authored six-site campaign for the Colosseum opening act.
 * These are six real targets already present in the Day 1 authoritative mission.
 * The campaign never invents a visit: progress is derived only from Day 1 outcomes.
 */
export const COLOSSEUM_TARGET_IDS = [
  "rise-koreatown",
  "avana-on-wilshire",
  "the-pearl-on-wilshire",
  "wilshire-vermont",
  "the-chadwick",
  "the-charlie-weho",
] as const;

export const COLOSSEUM_VILLAIN_TARGET_ID = "the-charlie-weho";

const COLOSSEUM_TARGET_SET = new Set<string>(COLOSSEUM_TARGET_IDS);

export function projectColosseumMission(
  mission: Day1TenDoorsMissionView
): Day1TenDoorsMissionView {
  const targets = mission.targets.filter(target => COLOSSEUM_TARGET_SET.has(target.id));
  const outcomes = Object.fromEntries(
    Object.entries(mission.outcomes).filter(([targetId]) =>
      COLOSSEUM_TARGET_SET.has(targetId)
    )
  );
  const visitedCount = Object.keys(outcomes).length;
  const currentTarget =
    targets.find(target => !(target.id in outcomes)) ?? null;
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
    isComplete: targets.length > 0 && visitedCount >= targets.length,
    outcomeCounts: { pitched, couldntReach },
  };
}
