/**
 * Continuity rule for every experience/presentation decision point (repair plan W6 §9.6).
 *
 *   1. An explicit operator choice wins.
 *   2. An experience with recorded progress is never switched mid-campaign.
 *   3. A new selection happens only at a new-campaign boundary.
 *
 * Pure. No runtime experience-selection decision point exists yet (D21); the
 * per-mission presentation point already replays its assignment for the same
 * occasion. Any experience selector (W8) must call this before drawing.
 */
export type DaphneExperienceInProgress = {
  experienceId: string;
  /** Recorded outcomes in the current campaign, e.g. Day 1 Ten Doors 3 of 5. */
  recordedProgress: number;
  campaignComplete: boolean;
};

export type DaphneExperienceContinuity =
  | { action: "keep_explicit_choice"; experienceId: string; sourceRef: string }
  | { action: "keep_in_progress"; experienceId: string; reason: "recorded_progress" | "campaign_not_finished" }
  | { action: "select"; reason: "new_campaign_boundary" | "nothing_in_progress" };

export function resolveDaphneExperienceContinuity(input: {
  explicitChoice: { experienceId: string; sourceRef: string } | null;
  inProgress: DaphneExperienceInProgress | null;
  /** True only when the operator starts a new campaign (e.g. the next Kingdom). */
  atNewCampaignBoundary: boolean;
}): DaphneExperienceContinuity {
  if (input.explicitChoice)
    return { action: "keep_explicit_choice", experienceId: input.explicitChoice.experienceId, sourceRef: input.explicitChoice.sourceRef };
  const current = input.inProgress;
  if (!current) return { action: "select", reason: "nothing_in_progress" };
  if (!current.campaignComplete && current.recordedProgress > 0)
    return { action: "keep_in_progress", experienceId: current.experienceId, reason: "recorded_progress" };
  if (!input.atNewCampaignBoundary)
    return { action: "keep_in_progress", experienceId: current.experienceId, reason: "campaign_not_finished" };
  return { action: "select", reason: "new_campaign_boundary" };
}
