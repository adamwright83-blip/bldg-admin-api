import { z } from "zod";

export const MITCH_PRODUCER_ACTORS = ["mitch", "claude", "chatgpt", "adam"] as const;
export type MitchProducerActor = (typeof MITCH_PRODUCER_ACTORS)[number];

export const MITCH_PRODUCER_MESSAGE_KINDS = [
  "implementation_request",
  "implementation_handback",
  "design_review_request",
  "design_review_response",
  "human_decision_request",
  "human_decision_response",
] as const;
export type MitchProducerMessageKind = (typeof MITCH_PRODUCER_MESSAGE_KINDS)[number];

export const mitchProducerMessageSchema = z.object({
  marker: z.string().min(1),
  from: z.enum(MITCH_PRODUCER_ACTORS),
  to: z.enum(MITCH_PRODUCER_ACTORS),
  kind: z.enum(MITCH_PRODUCER_MESSAGE_KINDS),
  workOrderId: z.string().uuid().nullable().default(null),
  milestoneId: z.string().uuid().nullable().default(null),
  buildId: z.string().nullable().default(null),
  body: z.string().min(1),
  externalCommentId: z.number().int().positive().nullable().default(null),
  externalUrl: z.string().url().nullable().default(null),
  createdAt: z.string(),
});
export type MitchProducerMessage = z.infer<typeof mitchProducerMessageSchema>;

export const mitchProducerHandbackPayloadSchema = z.object({
  branch: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i),
  exactBuildId: z.string().min(7).optional(),
  whatChanged: z.string().min(1),
  testsActuallyRun: z.array(z.string().min(1)).min(1),
  testsNotRun: z.array(z.string()).default([]),
  previewLaunchInstructions: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).default({}),
  knownLimitations: z.string().default(""),
});
export type MitchProducerHandbackPayload = z.infer<typeof mitchProducerHandbackPayloadSchema>;

export const mitchProducerDesignReviewSchema = z.object({
  verdict: z.enum(["fix_needed", "no_blocking_issue", "human_play_required"]),
  observedBehavior: z.string().min(1),
  evidenceArtifact: z.string().min(1),
  recommendedNextProof: z.string().min(1),
  gameActuallyExercised: z.boolean().default(false),
  acceptancePassed: z.boolean().default(false),
});
export type MitchProducerDesignReview = z.infer<typeof mitchProducerDesignReviewSchema>;

export function workOrderDispatchMarker(workOrderId: string): string {
  return `mitch-work-order:${workOrderId}`;
}

export function handbackMarker(workOrderId: string): string {
  return `mitch-handback:${workOrderId}`;
}

export function designReviewRequestMarker(milestoneId: string, buildId: string): string {
  return `mitch-design-review-request:${milestoneId}:${buildId}`;
}

export function designReviewResponseMarker(milestoneId: string, buildId: string): string {
  return `mitch-design-review-response:${milestoneId}:${buildId}`;
}
