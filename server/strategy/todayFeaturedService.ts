/**
 * Today's Featured Operation Service (Slice 5)
 * Enforces Guardrail G7: One source of "what matters today".
 * Claire, Lantern City, and Day Line all read the same StrategyEngine output.
 */

import { buildStrategySnapshot, getLatestStrategySnapshot } from "./snapshotBuilder";
import type { ProvenanceRecord, StrategySnapshot } from "./snapshotTypes";

export type FeaturedOperation = {
  operationId: string;
  businessName: string;
  worldName: string;
  territoryId: string;
  briefing: string;
  snapshotId: string;
  provenance: ProvenanceRecord;
};

/**
 * Derives the single featured operation from the strategy snapshot.
 */
export function deriveFeaturedOperationFromSnapshot(snapshot: StrategySnapshot): FeaturedOperation {
  const { payload } = snapshot;

  // 1. If an active path is chosen (Slice 6+), it is always the featured operation
  if (payload.activePath.playId && payload.activePath.playName) {
    return {
      operationId: payload.activePath.playId,
      businessName: payload.activePath.playName,
      worldName: payload.activePath.worldName ?? payload.activePath.playName,
      territoryId: "downtown",
      briefing: payload.activePath.evidenceSummary ?? "Active strategic path chosen by operator.",
      snapshotId: snapshot.id,
      provenance: {
        source: "strategy.activePath",
        queryOrDefinition: `ActivePlay(${payload.activePath.playId})`,
        computedAt: snapshot.generatedAt,
      },
    };
  }

  // 2. If today has commitments, the highest-priority growth commitment leads
  const primaryCommitment = payload.commitments.today[0];
  if (primaryCommitment) {
    return {
      operationId: primaryCommitment.id,
      businessName: primaryCommitment.title,
      worldName: `Operation ${primaryCommitment.title.split(" ").slice(0, 3).join(" ")}`,
      territoryId: "downtown",
      briefing: `Today's featured field move: ${primaryCommitment.title}.`,
      snapshotId: snapshot.id,
      provenance: {
        source: "strategy.commitments.today",
        queryOrDefinition: `DayDirectorCommitment(${primaryCommitment.id})`,
        computedAt: snapshot.generatedAt,
      },
    };
  }

  // 3. If active campaigns exist, feature the primary campaign
  const primaryCampaign = payload.campaigns[0];
  if (primaryCampaign) {
    return {
      operationId: primaryCampaign.campaignId,
      businessName: primaryCampaign.title,
      worldName: "Corridor of the Lanterns",
      territoryId: "downtown",
      briefing: primaryCampaign.objective ?? primaryCampaign.title,
      snapshotId: snapshot.id,
      provenance: {
        source: "strategy.campaigns",
        queryOrDefinition: `GrowthCampaign(${primaryCampaign.campaignId})`,
        computedAt: snapshot.generatedAt,
      },
    };
  }

  // 4. Default strategic exploration
  return {
    operationId: `explore_${snapshot.id.slice(0, 12)}`,
    businessName: "Territory Reconnaissance",
    worldName: "The Unlit Frontier",
    territoryId: "downtown",
    briefing: "Explore territory customer density and identify property managers.",
    snapshotId: snapshot.id,
    provenance: {
      source: "strategy.snapshot.default",
      queryOrDefinition: "Default territory exploration",
      computedAt: snapshot.generatedAt,
    },
  };
}

/**
 * Returns the single authoritative featured operation for today.
 */
export async function getTodayFeaturedOperation(tenantId: string): Promise<FeaturedOperation> {
  let snapshot = await getLatestStrategySnapshot(tenantId);
  if (!snapshot) {
    snapshot = await buildStrategySnapshot(tenantId);
  }
  return deriveFeaturedOperationFromSnapshot(snapshot);
}
