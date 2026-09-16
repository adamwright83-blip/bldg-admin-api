/**
 * StrategyEngine Decision Policy (Slice 6)
 * Deterministic, explainable ranking for strategy plays.
 * Models initiation cost (effort), geographic bundling, capacity bounds, and neutral unknown economics.
 */

import type { StrategySnapshot } from "./snapshotTypes";

export const POLICY_VERSION = "2026.09.1";

export type PlayCandidateInput = {
  templateKey: string;
  businessName: string;
  worldName: string;
  hypothesis: string;
  primaryMetric: string;
  geography: string;
  stopsCount: number;
  isClustered: boolean;
  estimatedInitiationCost: number;
  estimatedSpendCents: number;
  spendCategory: string;
  confidence: "high" | "medium" | "low";
  llmProposedRank?: number; // Must be IGNORED by policy
};

export type ScoreBreakdown = {
  policyVersion: string;
  opportunityAdvancement: number;
  urgencyAndSpeed: number;
  repeatPotential: number;
  capacityFeasibility: number;
  initiationEffortPenalty: number;
  geographicClusteringBonus: number;
  unknownEconomicsScore: number; // Always 0 (neutral per G12)
  avoidancePenalty: number;
  totalScore: number;
};

/**
 * Deterministic scoring function for growth plays.
 */
export function scoreStrategyPlay(
  play: PlayCandidateInput,
  snapshot: StrategySnapshot
): ScoreBreakdown {
  const { payload } = snapshot;

  // 1. Opportunity Advancement
  // Plays targeting verified gaps in pipeline score higher
  let opportunityAdvancement = 20;
  if (play.templateKey === "property_activation" && payload.activation.some(a => a.approvalStatus === "approved")) {
    opportunityAdvancement = 45; // High priority: turn approved access into residents
  } else if (play.templateKey === "property_expansion" && payload.accounts.some(a => a.state === "Contested")) {
    opportunityAdvancement = 35;
  } else if (play.templateKey === "dormant_recovery" && payload.customers.dormantCount > 0) {
    opportunityAdvancement = 30;
  } else if (play.templateKey === "first_to_second_order" && payload.repeatPipeline.summary.totalRecent > 0) {
    opportunityAdvancement = 40;
  }

  // 2. Urgency and Speed to First Paid Order
  let urgencyAndSpeed = 15;
  if (play.primaryMetric === payload.goal.metricType) {
    urgencyAndSpeed += 10; // Matches operator's active goal
  }

  // 3. Repeat Business Potential
  let repeatPotential = 15;
  if (play.templateKey === "property_expansion" || play.templateKey === "property_activation") {
    repeatPotential = 25; // Building resident clusters produce high repeat density
  } else if (play.templateKey === "first_to_second_order") {
    repeatPotential = 30;
  }

  // 4. Capacity Feasibility Check
  // Estimate required capacity (e.g. 50 lbs per stop)
  const estimatedPoundsNeeded = play.stopsCount * 50;
  const availablePounds = payload.capacity.availablePounds;
  let capacityFeasibility = 20;
  if (estimatedPoundsNeeded > availablePounds) {
    capacityFeasibility = -50; // Infeasible: cannot service what we cannot fulfill
  }

  // 5. Initiation Effort Model
  // Initiation cost is dominated by leaving house (50) + small marginal cost per stop (8)
  const baseInitiationEffort = 50;
  const marginalStopEffort = play.stopsCount * 8;
  const totalEffort = baseInitiationEffort + marginalStopEffort;
  // Convert effort to penalty (higher effort = greater penalty)
  const initiationEffortPenalty = -Math.round(totalEffort * 0.3);

  // 6. Geographic Clustering Bonus
  // Plays whose stops cluster geographically or align with existing routes buy full day on one initiation
  let geographicClusteringBonus = 0;
  if (play.isClustered) {
    geographicClusteringBonus = 25;
  }

  // 7. Unknown Economics (Guardrail G12)
  // Unknown economics stay unknown and score NEUTRAL (0). Never invent margin or LTV.
  const unknownEconomicsScore = 0;

  // 8. Avoidance Signal
  // Check if commitments in this category have been deferred repeatedly
  let avoidancePenalty = 0;
  const deferredRecently = payload.commitments.history14Days.missed > 3;
  if (deferredRecently && play.templateKey === "door_tag_acquisition") {
    avoidancePenalty = -15;
  }

  // Total deterministic calculation (LLM proposals strictly excluded)
  const totalScore = Math.max(
    0,
    opportunityAdvancement +
      urgencyAndSpeed +
      repeatPotential +
      capacityFeasibility +
      initiationEffortPenalty +
      geographicClusteringBonus +
      unknownEconomicsScore +
      avoidancePenalty
  );

  return {
    policyVersion: POLICY_VERSION,
    opportunityAdvancement,
    urgencyAndSpeed,
    repeatPotential,
    capacityFeasibility,
    initiationEffortPenalty,
    geographicClusteringBonus,
    unknownEconomicsScore,
    avoidancePenalty,
    totalScore,
  };
}
