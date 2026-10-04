import { z } from "zod";

export const PRESIDENT_PROGRAM_STATES = [
  "SELECTED",
  "PREFLIGHT",
  "READY",
  "RUNNING",
  "AWAITING_REVIEW",
  "REVISION_REQUIRED",
  "VERIFIED_INTERNAL",
  "MEASURING",
  "LEARNING",
  "COMPLETED",
  "BLOCKED_FOUNDER",
  "BLOCKED_CAPABILITY",
  "STOPPED",
] as const;
export type PresidentProgramState = (typeof PRESIDENT_PROGRAM_STATES)[number];

export const PRESIDENT_STEP_STATES = [
  "PENDING",
  "CLAIMED",
  "RUNNING",
  "HANDBACK",
  "REVIEW_PENDING",
  "REVISION_REQUIRED",
  "VERIFIED",
  "FAILED",
  "DEAD_LETTER",
  "BLOCKED",
  "CANCELED",
] as const;
export type PresidentStepState = (typeof PRESIDENT_STEP_STATES)[number];

export const PRESIDENT_STEP_TYPES = [
  "RESEARCH",
  "DESIGN",
  "CODE",
  "TEST",
  "INTERNAL_DEPLOY",
  "MEASURE",
  "DOCUMENT",
  "RECRUIT",
  "OTHER",
] as const;
export type PresidentStepType = (typeof PRESIDENT_STEP_TYPES)[number];

export const PRESIDENT_AUTHORITY_CLASSES = [
  "AUTO_READ_ONLY",
  "AUTO_SANDBOX",
  "STANDING_AUTHORIZATION",
  "FOUNDER_APPROVAL",
  "HUMAN_PHYSICAL",
  "HUMAN_REMOTE",
  "FORBIDDEN",
] as const;
export type PresidentAuthorityClass = (typeof PRESIDENT_AUTHORITY_CLASSES)[number];

export const PRESIDENT_CONSEQUENTIAL_DOMAINS = [
  "NONE",
  "PRODUCTION_DATA",
  "BILLING",
  "CUSTOMER_IMPACT",
  "CREDENTIALS",
  "DNS",
  "LEGAL",
  "SPEND",
  "COMMERCIAL_RELEASE",
] as const;
export type PresidentConsequentialDomain =
  (typeof PRESIDENT_CONSEQUENTIAL_DOMAINS)[number];

export const presidentAuthorityPolicySchema = z
  .object({
    policyVersion: z.string().min(1),
    internalMergeAllowed: z.boolean().default(false),
    internalDeployAllowed: z.boolean().default(false),
    maxAutonomousUsdPerDay: z.number().min(0).max(1000).default(0),
    autonomousProgramSelectionAllowed: z.boolean().default(false),
    allowedRepositories: z.array(z.string().min(1)).default([]),
    allowedEnvironments: z.array(z.string().min(1)).default([]),
    prohibitedDomains: z
      .array(z.enum(PRESIDENT_CONSEQUENTIAL_DOMAINS))
      .default([
        "BILLING",
        "PRODUCTION_DATA",
        "CUSTOMER_IMPACT",
        "CREDENTIALS",
        "DNS",
        "LEGAL",
        "COMMERCIAL_RELEASE",
      ]),
    founderId: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PresidentAuthorityPolicy = z.infer<
  typeof presidentAuthorityPolicySchema
>;

export const presidentProgramSchema = z
  .object({
    id: z.string().uuid(),
    assessmentId: z.string().min(1).nullable(),
    candidateId: z.string().min(1).nullable(),
    objectiveRecordId: z.string().uuid().nullable(),
    title: z.string().min(1).max(255),
    outcome: z.string().min(1).max(4000),
    state: z.enum(PRESIDENT_PROGRAM_STATES),
    selectedBy: z.string().min(1),
    selectedAt: z.string().datetime(),
    authorityPolicyVersion: z.string().min(1),
    maxProgramUsd: z.number().min(0).max(10000),
    spentUsd: z.number().min(0).max(10000),
    currentStepId: z.string().uuid().nullable(),
    verifiedArtifactId: z.string().nullable(),
    blockReason: z.string().nullable(),
    stopReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PresidentProgram = z.infer<typeof presidentProgramSchema>;

export const presidentProgramStepSchema = z
  .object({
    id: z.string().uuid(),
    programId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    type: z.enum(PRESIDENT_STEP_TYPES),
    title: z.string().min(1).max(255),
    outcome: z.string().min(1).max(4000),
    acceptanceCriteria: z.array(z.string().min(1)).min(1).max(30),
    nonGoals: z.array(z.string().min(1)).max(30).default([]),
    requiredEvidence: z.array(z.string().min(1)).max(30).default([]),
    authorityClass: z.enum(PRESIDENT_AUTHORITY_CLASSES),
    consequentialDomain: z.enum(PRESIDENT_CONSEQUENTIAL_DOMAINS),
    maxUsd: z.number().min(0).max(1000),
    spentUsd: z.number().min(0).max(1000).default(0),
    executorCapability: z.string().min(1),
    reviewerCapability: z.string().min(1),
    executorId: z.string().nullable(),
    reviewerId: z.string().nullable(),
    baseRef: z.string().nullable(),
    baseSha: z.string().regex(/^[0-9a-f]{7,40}$/i).nullable(),
    state: z.enum(PRESIDENT_STEP_STATES),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive().max(10),
    leaseOwner: z.string().nullable(),
    leaseExpiresAt: z.string().datetime().nullable(),
    nextAttemptAt: z.string().datetime().nullable(),
    exactArtifactId: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PresidentProgramStep = z.infer<typeof presidentProgramStepSchema>;

export const presidentPreflightSchema = z
  .object({
    programId: z.string().uuid(),
    reversible: z.boolean(),
    rollbackPlan: z.string().min(1),
    estimatedUsd: z.number().min(0).max(10000),
    licenses: z.array(z.string()).default([]),
    secretRequirements: z.array(z.string()).default([]),
    customerImpact: z.boolean(),
    productionMutation: z.boolean(),
    billingMutation: z.boolean(),
    credentialMutation: z.boolean(),
    dnsMutation: z.boolean(),
    legalCommitment: z.boolean(),
    commercialRelease: z.boolean(),
    externalSpend: z.boolean(),
    unknowns: z.array(z.string()).default([]),
    requiredFounderDecisions: z.array(z.string()).default([]),
    result: z.enum(["CLEAR", "FOUNDER_REQUIRED", "FORBIDDEN", "UNKNOWN"]),
    checkedAt: z.string().datetime(),
  })
  .strict();
export type PresidentPreflight = z.infer<typeof presidentPreflightSchema>;

export const presidentProgramPlanDraftSchema = z
  .object({
    summary: z.string().min(1).max(4000),
    preflight: z
      .object({
        reversible: z.boolean(),
        rollbackPlan: z.string().min(1),
        estimatedUsd: z.number().min(0).max(10000),
        licenses: z.array(z.string()).default([]),
        secretRequirements: z.array(z.string()).default([]),
        customerImpact: z.boolean(),
        productionMutation: z.boolean(),
        billingMutation: z.boolean(),
        credentialMutation: z.boolean(),
        dnsMutation: z.boolean(),
        legalCommitment: z.boolean(),
        commercialRelease: z.boolean(),
        externalSpend: z.boolean(),
        unknowns: z.array(z.string()).default([]),
      })
      .strict(),
    steps: z
      .array(
        z
          .object({
            type: z.enum(PRESIDENT_STEP_TYPES),
            title: z.string().min(1).max(255),
            outcome: z.string().min(1).max(4000),
            acceptanceCriteria: z.array(z.string().min(1)).min(1).max(30),
            nonGoals: z.array(z.string().min(1)).max(30).default([]),
            requiredEvidence: z.array(z.string().min(1)).max(30).default([]),
            authorityClass: z.enum(PRESIDENT_AUTHORITY_CLASSES),
            consequentialDomain: z.enum(PRESIDENT_CONSEQUENTIAL_DOMAINS),
            maxUsd: z.number().min(0).max(1000),
            executorCapability: z.string().min(1),
            reviewerCapability: z.string().min(1),
            baseRef: z.string().nullable().default(null),
            baseSha: z.string().regex(/^[0-9a-f]{7,40}$/i).nullable().default(null),
          })
          .strict()
      )
      .min(1)
      .max(20),
    measurement: z
      .object({
        question: z.string().min(1),
        evidenceRequired: z.array(z.string().min(1)).min(1),
        successCondition: z.string().min(1),
        stopCondition: z.string().min(1),
      })
      .strict(),
    founderQuestions: z
      .array(
        z
          .object({
            key: z.string().min(1).max(191),
            question: z.string().min(1).max(4000),
            options: z.array(z.string().min(1)).min(1).max(8),
            recommendedOption: z.string().nullable(),
            reason: z.string().min(1),
          })
          .strict()
      )
      .max(3)
      .default([]),
  })
  .strict();
export type PresidentProgramPlanDraft = z.infer<
  typeof presidentProgramPlanDraftSchema
>;

export const presidentExecutionHandbackSchema = z
  .object({
    eventId: z.string().uuid(),
    stepId: z.string().uuid(),
    executorId: z.string().min(1),
    exactArtifactId: z.string().min(1),
    branch: z.string().nullable(),
    commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i).nullable(),
    summary: z.string().min(1),
    changedFiles: z.array(z.string()).max(500).default([]),
    testsActuallyRun: z.array(z.string()).max(100).default([]),
    testsNotRun: z.array(z.string()).max(100).default([]),
    evidence: z.record(z.string(), z.unknown()).default({}),
    knownLimitations: z.array(z.string()).default([]),
    costUsd: z.number().min(0).max(1000).nullable(),
    reversible: z.boolean(),
    rollbackInstructions: z.string().min(1),
    completedAt: z.string().datetime(),
  })
  .strict();
export type PresidentExecutionHandback = z.infer<
  typeof presidentExecutionHandbackSchema
>;

export const presidentIndependentReviewSchema = z
  .object({
    eventId: z.string().uuid(),
    stepId: z.string().uuid(),
    reviewerId: z.string().min(1),
    exactArtifactId: z.string().min(1),
    verdict: z.enum([
      "PASS",
      "REVISE",
      "BLOCK_FOUNDER",
      "REJECT",
    ]),
    acceptanceResults: z
      .array(
        z.object({
          criterion: z.string().min(1),
          passed: z.boolean(),
          evidence: z.string().min(1),
        })
      )
      .min(1),
    observedRisks: z.array(z.string()).default([]),
    requiredRevision: z.string().nullable(),
    evidence: z.record(z.string(), z.unknown()).default({}),
    reviewedAt: z.string().datetime(),
  })
  .strict();
export type PresidentIndependentReview = z.infer<
  typeof presidentIndependentReviewSchema
>;

export const presidentFounderDecisionSchema = z
  .object({
    id: z.string().uuid(),
    programId: z.string().uuid().nullable(),
    stepId: z.string().uuid().nullable(),
    questionKey: z.string().min(1).max(191),
    question: z.string().min(1).max(4000),
    options: z.array(z.string().min(1)).min(1).max(8),
    recommendedOption: z.string().nullable(),
    reason: z.string().min(1),
    status: z.enum(["OPEN", "ANSWERED", "SUPERSEDED"]),
    answer: z.string().nullable(),
    askedAt: z.string().datetime(),
    answeredAt: z.string().datetime().nullable(),
  })
  .strict();
export type PresidentFounderDecision = z.infer<
  typeof presidentFounderDecisionSchema
>;

export const presidentAgentCapabilitySchema = z
  .object({
    capabilityKey: z.string().min(1).max(191),
    kind: z.enum(["BUILTIN", "TEMPORARY_SPECIALIST", "EXECUTIVE_SEAT"]),
    actorId: z.string().min(1).max(191),
    targetCapability: z.string().min(1).max(191),
    seatRoleKey: z.string().min(1).max(128).nullable(),
    programId: z.string().uuid().nullable(),
    skillNames: z.array(z.string().min(1)).max(20),
    authorityClasses: z
      .array(z.enum(PRESIDENT_AUTHORITY_CLASSES))
      .min(1)
      .max(7),
    consequentialDomains: z
      .array(z.enum(PRESIDENT_CONSEQUENTIAL_DOMAINS))
      .min(1)
      .max(9),
    maxUsdPerRun: z.number().min(0).max(1000),
    evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    justification: z.string().min(1).max(4000),
    status: z.enum(["ACTIVE", "REVOKED"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((capability, ctx) => {
    if (
      capability.authorityClasses.some(authority =>
        ["HUMAN_PHYSICAL", "HUMAN_REMOTE", "FORBIDDEN"].includes(authority)
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Delegated capabilities cannot perform human-only or forbidden work",
      });
    if (capability.kind === "EXECUTIVE_SEAT" && !capability.seatRoleKey)
      ctx.addIssue({
        code: "custom",
        message: "Executive capability requires a durable executive seat",
      });
    if (capability.kind === "TEMPORARY_SPECIALIST" && !capability.programId)
      ctx.addIssue({
        code: "custom",
        message: "Temporary specialist must be scoped to one President program",
      });
  });
export type PresidentAgentCapability = z.infer<
  typeof presidentAgentCapabilitySchema
>;

export const presidentNightlyBriefSchema = z
  .object({
    generatedAt: z.string().datetime(),
    summary: z.string().min(1),
    completed: z.array(z.string()).max(20),
    inProgress: z.array(z.string()).max(20),
    blocked: z.array(z.string()).max(20),
    questions: z.array(presidentFounderDecisionSchema).max(3),
    tomorrow: z.array(z.string()).max(10),
  })
  .strict();
export type PresidentNightlyBrief = z.infer<
  typeof presidentNightlyBriefSchema
>;

export const presidentExecutiveSeatSchema = z
  .object({
    id: z.string().uuid(),
    roleKey: z.string().min(1).max(128),
    title: z.string().min(1).max(191),
    mandate: z.string().min(1).max(4000),
    proposedByProgramId: z.string().uuid().nullable(),
    capabilityGap: z.string().min(1),
    skillNames: z.array(z.string().min(1)).min(1).max(12),
    provider: z.string().nullable(),
    monthlyBudgetUsd: z.number().min(0).max(100000),
    state: z.enum([
      "PROPOSED",
      "AUTHORIZED",
      "ACTIVE",
      "REJECTED",
      "RETIRED",
    ]),
    founderDecisionId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PresidentExecutiveSeat = z.infer<
  typeof presidentExecutiveSeatSchema
>;

export function assertPresidentStepAuthority(
  step: PresidentProgramStep,
  policy: PresidentAuthorityPolicy,
  founderApproved = false
): void {
  if (policy.prohibitedDomains.includes(step.consequentialDomain)) {
    if (!founderApproved)
      throw new Error(
        `President step touches prohibited domain ${step.consequentialDomain}; founder authorization is required`
      );
  }
  if (
    step.authorityClass === "FORBIDDEN" ||
    step.consequentialDomain === "COMMERCIAL_RELEASE"
  )
    throw new Error("President cannot autonomously perform commercial release or a forbidden action");
  if (
    ["FOUNDER_APPROVAL", "HUMAN_PHYSICAL", "HUMAN_REMOTE"].includes(
      step.authorityClass
    ) &&
    !founderApproved
  )
    throw new Error("President step requires founder/human authorization");
  if (step.maxUsd > policy.maxAutonomousUsdPerDay && !founderApproved)
    throw new Error("President step exceeds autonomous spend authority");
  if (
    step.type === "INTERNAL_DEPLOY" &&
    !policy.internalDeployAllowed &&
    !founderApproved
  )
    throw new Error("Internal deploy is not covered by standing authority");
}
