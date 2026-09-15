import { getOrCreateDay1TenDoorsMission } from "../openChannel/day1TenDoorsService";

/**
 * A bounded, read-only summary of the real Day-1 field-sales campaign
 * (the "Colosseum" game layer is a fictional projection over this same
 * authoritative data — see docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md).
 * This is the authoritative source for "does open campaign work already
 * exist" — never a phrase-matching guess. Failure here must never block
 * Claire's core generation, so callers get null rather than a thrown error.
 */
export type ClaireCampaignSummary = {
  active: boolean;
  completedCount: number;
  remainingCount: number;
};

export async function getClaireCampaignSummary(input: {
  tenantId: string;
  actorId: string;
}): Promise<ClaireCampaignSummary | null> {
  try {
    const mission = await getOrCreateDay1TenDoorsMission({
      tenantId: input.tenantId,
      driverId: input.actorId,
    });
    return {
      active: !mission.isComplete,
      completedCount: mission.visitedCount,
      remainingCount: Math.max(0, mission.totalCount - mission.visitedCount),
    };
  } catch (error) {
    console.warn("[Claire] campaign summary unavailable", error);
    return null;
  }
}
