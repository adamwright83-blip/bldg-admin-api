import { getDay1TenDoorsMissionReadOnly } from "../openChannel/day1TenDoorsService";

export const CLAIRE_CAMPAIGN_NAME = "Colosseum";
export const CLAIRE_CAMPAIGN_REAL_WORLD_EXTENSION = "Greystar property prospecting visits";
export const CLAIRE_CAMPAIGN_GOAL_RELATION = "customer acquisition pipeline";
export const CLAIRE_CAMPAIGN_TARGET_LIMIT = 10;

/**
 * A bounded, read-only summary of the real Day-1 field-sales campaign
 * (the "Colosseum" game layer is a fictional projection over this same
 * authoritative data — see docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md).
 * This is the authoritative source for "does open campaign work already
 * exist" — never a phrase-matching guess. Failure here must never block
 * Claire's core generation, so callers get null rather than a thrown error.
 */
export type ClaireCampaignSummary = {
  campaignName: typeof CLAIRE_CAMPAIGN_NAME;
  active: boolean;
  completedCount: number;
  remainingCount: number;
  totalCount: number;
  realWorldExtension: typeof CLAIRE_CAMPAIGN_REAL_WORLD_EXTENSION;
  remainingTargets: Array<{ name: string; address: string | null }>;
  relationToGoal: typeof CLAIRE_CAMPAIGN_GOAL_RELATION;
};

export async function getClaireCampaignSummary(input: {
  tenantId: string;
  actorId: string;
}): Promise<ClaireCampaignSummary | null> {
  try {
    const mission = await getDay1TenDoorsMissionReadOnly({
      tenantId: input.tenantId,
      driverId: input.actorId,
    });
    const labels = {
      campaignName: CLAIRE_CAMPAIGN_NAME,
      realWorldExtension: CLAIRE_CAMPAIGN_REAL_WORLD_EXTENSION,
      relationToGoal: CLAIRE_CAMPAIGN_GOAL_RELATION,
    } as const;
    if (!mission) return {
      ...labels, active: false, completedCount: 0, remainingCount: 0,
      totalCount: 0, remainingTargets: [],
    };
    return {
      ...labels,
      active: !mission.isComplete,
      completedCount: mission.visitedCount,
      remainingCount: Math.max(0, mission.totalCount - mission.visitedCount),
      totalCount: mission.totalCount,
      remainingTargets: mission.targets
        .filter(target => !(target.id in mission.outcomes))
        .slice(0, CLAIRE_CAMPAIGN_TARGET_LIMIT)
        .map(target => ({ name: target.name, address: target.address || null })),
    };
  } catch (error) {
    console.warn("[Claire] campaign summary unavailable", error);
    return null;
  }
}
