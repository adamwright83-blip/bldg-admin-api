/**
 * Mitch v1 — Game Production Operating System Contracts
 *
 * Mitch is EVP of Games. Goldline is the playable operating system / game world.
 *
 * FOUNDATIONAL RULES:
 * 1. IMPLEMENTED ≠ VERIFIED ≠ CREATIVE-ACCEPTED ≠ RELEASED
 *    Never collapse those states.
 *    A merged PR is not automatically a finished game.
 *    A successful build is not automatically a verified game.
 *    A verified game is not automatically creatively accepted.
 *    Creative acceptance is not automatically a production release.
 *
 * 2. CRITICAL REUSE RULE:
 *    Mitch production state must attach to the existing canonical Kingdom/game identity.
 *    Do not create a parallel game/Kingdom record that becomes a second source of truth.
 *    Mitch owns production state about the game; existing Kingdom/game systems remain
 *    authoritative about what the game is.
 *
 * 3. BUILD IDENTITY RULE:
 *    Current available build and last verified build are tracked separately.
 *    Never advance the verified pointer merely because a newer build exists.
 *    Do not invent semantic version strings (e.g. K2-0.8.14).
 *    A build identity must come from something real: exact commit SHA, immutable preview
 *    identity, or concrete artifact ID.
 *
 * 4. EVIDENCE INTEGRITY RULE:
 *    Mitch must never manufacture real-world business evidence or pretend that
 *    business work occurred.
 *
 * 5. HUMAN BOUNDARY INTEGRITY:
 *    Human creative blockers stop automatic production instead of producing invented decisions.
 *    No Mitch workflow autonomously merges to main.
 *    No Mitch workflow autonomously releases customer-wide.
 */
import { z } from "zod";

// --- Lifecycle States ---
export const MITCH_LIFECYCLE_STATES = [
  "concept",
  "business_bound",
  "mechanics_defined",
  "companion_bound",
  "assets_ready",
  "implementing",
  "exact_build_available",
  "qa_in_progress",
  "fix_needed",
  "playable_candidate",
  "creatively_accepted",
  "released",
] as const;

export type MitchLifecycleState = (typeof MITCH_LIFECYCLE_STATES)[number];

// --- Work Order States ---
export const MITCH_WORK_ORDER_STATUSES = [
  "pending",
  "claimed",
  "executing",
  "implementation_returned",
  "awaiting_qa",
  "failed",
  "canceled",
  "completed",
] as const;

export type MitchWorkOrderStatus = (typeof MITCH_WORK_ORDER_STATUSES)[number];

// --- Execution Run Statuses ---
export const MITCH_EXECUTION_RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "timed_out",
] as const;

export type MitchExecutionRunStatus = (typeof MITCH_EXECUTION_RUN_STATUSES)[number];

// --- Milestone Statuses ---
export const MITCH_MILESTONE_STATUSES = [
  "pending",
  "in_progress",
  "implemented",
  "verified",
  "creatively_accepted",
  "blocked",
] as const;

export type MitchMilestoneStatus = (typeof MITCH_MILESTONE_STATUSES)[number];

// --- QA Statuses ---
export const MITCH_QA_STATUSES = ["passed", "failed"] as const;
export type MitchQaStatus = (typeof MITCH_QA_STATUSES)[number];

// --- Issue Statuses ---
export const MITCH_ISSUE_STATUSES = [
  "open",
  "fix_submitted",
  "retesting",
  "closed",
] as const;
export type MitchIssueStatus = (typeof MITCH_ISSUE_STATUSES)[number];

// --- Creative Acceptance States ---
export const MITCH_CREATIVE_ACCEPTANCE_STATES = [
  "pending",
  "accepted",
  "rejected",
  "blocked_human_decision",
] as const;
export type MitchCreativeAcceptanceState =
  (typeof MITCH_CREATIVE_ACCEPTANCE_STATES)[number];

// --- Release States ---
export const MITCH_RELEASE_STATES = [
  "unreleased",
  "candidate",
  "released",
] as const;
export type MitchReleaseState = (typeof MITCH_RELEASE_STATES)[number];

// --- Build Identity Validation ---
/**
 * Invariant: Build IDs must be real references (git commit SHA, preview URL/ID, or artifact ID).
 * Reject synthesized semver strings like "K2-0.8.14" or "v1.0.0".
 */
const FAKE_SEMVER_REGEX = /^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const FAKE_CUSTOM_TAG_REGEX = /^[A-Z0-9]+-\d+\.\d+\.\d+/;
const REAL_GIT_SHA_REGEX = /^[0-9a-f]{7,40}$/i;
const REAL_PREVIEW_URL_REGEX = /^https?:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+$/;
const REAL_ARTIFACT_ID_REGEX = /^(artifact|build|preview)-[a-zA-Z0-9_-]{8,}$/;

export function isValidBuildIdentity(buildId: string): boolean {
  if (!buildId || typeof buildId !== "string") return false;
  const trimmed = buildId.trim();
  if (trimmed.length < 7) return false;
  // Disallow manufactured semver strings
  if (FAKE_SEMVER_REGEX.test(trimmed)) return false;
  if (FAKE_CUSTOM_TAG_REGEX.test(trimmed)) return false;

  // Must match real commit SHA, real preview URL, or real artifact ID
  return (
    REAL_GIT_SHA_REGEX.test(trimmed) ||
    REAL_PREVIEW_URL_REGEX.test(trimmed) ||
    REAL_ARTIFACT_ID_REGEX.test(trimmed)
  );
}

export function assertValidBuildIdentity(buildId: string): void {
  if (!isValidBuildIdentity(buildId)) {
    throw new Error(
      `Invalid build identity "${buildId}". Build identities must refer to real commit SHAs, preview URLs, or artifact IDs. Synthetic version strings like K2-0.8.14 are forbidden.`
    );
  }
}

// --- Zod Schemas ---

export const mitchGameProductionStateSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  gameId: z.string().min(1), // Canonical existing Kingdom or game ID, e.g. "kingdom.boreslay"
  storedRowId: z.string().nullable().default(null),
  title: z.string().min(1),
  lifecycleState: z.enum(MITCH_LIFECYCLE_STATES),
  realBusinessBinding: z.string().nullable(),
  coreMechanic: z.string().nullable(),
  companionDependency: z.string().nullable(),
  requiredAssets: z.array(z.string()).default([]),
  blockingDependencies: z.array(z.string()).default([]),
  currentAvailableBuildId: z.string().nullable(),
  lastVerifiedBuildId: z.string().nullable(),
  creativeAcceptanceState: z.enum(MITCH_CREATIVE_ACCEPTANCE_STATES).default("pending"),
  creativeAcceptanceNote: z.string().nullable().default(null),
  creativeAcceptanceDecidedAt: z.string().nullable().default(null),
  releaseState: z.enum(MITCH_RELEASE_STATES).default("unreleased"),
  releasedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MitchGameProductionState = z.infer<typeof mitchGameProductionStateSchema>;

export const mitchMilestoneSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  milestoneKey: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  title: z.string().min(1),
  desiredPlayerVisibleResult: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  status: z.enum(MITCH_MILESTONE_STATUSES).default("pending"),
  currentAvailableBuildId: z.string().nullable().default(null),
  lastVerifiedBuildId: z.string().nullable().default(null),
  blockedReason: z.string().nullable().default(null),
  isHumanCreativeBlocker: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MitchMilestone = z.infer<typeof mitchMilestoneSchema>;

export const mitchWorkOrderContractSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  milestoneId: z.string().uuid(),
  milestoneKey: z.string().min(1),
  title: z.string().min(1),
  desiredPlayerVisibleResult: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  canonConstraints: z.array(z.string()).default([]),
  relevantDependencies: z.array(z.string()).default([]),
  realBusinessEvidenceConstraints: z.array(z.string()).default([]),
  baseBranch: z.string().min(1),
  baseSha: z.string().regex(/^[0-9a-f]{7,40}$/i, "baseSha must be a real git commit SHA"),
  requiredArtifact: z.string().min(1),
  requiredTests: z.array(z.string().min(1)).min(1),
  requiredEvidence: z.array(z.string()).default([]),
  status: z.enum(MITCH_WORK_ORDER_STATUSES).default("pending"),
  claimedBy: z.string().nullable().default(null),
  claimedAt: z.string().nullable().default(null),
  leaseExpiresAt: z.string().nullable().default(null),
  attemptCount: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  lastError: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MitchWorkOrder = z.infer<typeof mitchWorkOrderContractSchema>;

export const mitchExecutionHandbackSchema = z.object({
  branch: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i, "commitSha must be a real git commit SHA"),
  exactBuildId: z.string().refine(isValidBuildIdentity, {
    message: "exactBuildId must refer to a real commit, preview identity, or artifact ID",
  }),
  whatChanged: z.string().min(1),
  testsActuallyRun: z.array(z.string().min(1)).min(1),
  testsNotRun: z.array(z.string()).default([]),
  previewLaunchInstructions: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).default({}),
  knownLimitations: z.string().default(""),
});
export type MitchExecutionHandback = z.infer<typeof mitchExecutionHandbackSchema>;

export const mitchExecutionRunSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  workOrderId: z.string().uuid(),
  executorId: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  status: z.enum(MITCH_EXECUTION_RUN_STATUSES),
  returnedBranch: z.string().nullable().default(null),
  returnedCommitSha: z.string().nullable().default(null),
  exactBuildId: z.string().nullable().default(null),
  whatChanged: z.string().nullable().default(null),
  testsActuallyRun: z.array(z.string()).default([]),
  testsNotRun: z.array(z.string()).default([]),
  previewLaunchInstructions: z.string().nullable().default(null),
  evidence: z.record(z.string(), z.unknown()).default({}),
  knownLimitations: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type MitchExecutionRun = z.infer<typeof mitchExecutionRunSchema>;

export const mitchBuildSchema = z.object({
  id: z.string().refine(isValidBuildIdentity, {
    message: "Build id must be a valid commit SHA, preview identity, or artifact ID",
  }),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  workOrderId: z.string().uuid(),
  executionRunId: z.string().uuid(),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i),
  branch: z.string().min(1),
  buildArtifactType: z.enum(["git_commit", "preview_url", "bundle_artifact"]),
  buildArtifactId: z.string().min(1),
  sourceCompiled: z.boolean(),
  unitTestsPassed: z.boolean(),
  isVerified: z.boolean().default(false),
  verifiedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type MitchBuild = z.infer<typeof mitchBuildSchema>;

export const mitchQaResultSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  milestoneId: z.string().uuid(),
  buildId: z.string().refine(isValidBuildIdentity, {
    message: "buildId must refer to the exact build tested",
  }),
  testerId: z.string().min(1),
  scenario: z.string().min(1),
  expectedBehavior: z.string().min(1),
  observedBehavior: z.string().min(1),
  gameActuallyExercised: z.boolean(),
  acceptancePassed: z.boolean(),
  status: z.enum(MITCH_QA_STATUSES),
  evidenceArtifact: z.string().min(1),
  issueId: z.string().uuid().nullable().default(null),
  previousFailedQaRunId: z.string().uuid().nullable().default(null),
  isRetest: z.boolean().default(false),
  completedAt: z.string(),
  createdAt: z.string(),
});
export type MitchQaRun = z.infer<typeof mitchQaResultSchema>;

export const mitchIssueSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  milestoneId: z.string().uuid(),
  originatingQaRunId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(MITCH_ISSUE_STATUSES).default("open"),
  fixWorkOrderId: z.string().uuid().nullable().default(null),
  fixBuildId: z.string().nullable().default(null),
  closingQaRunId: z.string().uuid().nullable().default(null),
  closedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MitchIssue = z.infer<typeof mitchIssueSchema>;

export const mitchAuditEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  eventType: z.string().min(1),
  actorId: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export type MitchAuditEvent = z.infer<typeof mitchAuditEventSchema>;

// --- Production Reasoning Read Model ---
export type MitchProductionInspection = {
  gameId: string;
  title: string;
  lifecycleState: MitchLifecycleState;
  currentAvailableBuildId: string | null;
  lastVerifiedBuildId: string | null;
  activeWorkOrder: MitchWorkOrder | null;
  incompleteMilestone: MitchMilestone | null;
  openIssues: MitchIssue[];
  blockers: {
    isBlocked: boolean;
    reason: string | null;
    isHumanCreativeBlocker: boolean;
  };
  nextBoundedOutcome: {
    readyToDispatch: boolean;
    description: string;
    milestoneKey: string | null;
    recommendedAction:
      | "dispatch_implementation"
      | "perform_gameplay_qa"
      | "dispatch_fix"
      | "retest_fix"
      | "stop_human_creative_decision"
      | "ready_for_creative_acceptance"
      | "game_complete";
  };
};
