import { z } from "zod";

export const PRESIDENT_CYCLE_STATES = [
  "DELIBERATING",
  "AWAITING_ADAM_REVIEW",
  "ADAM_APPROVED",
  "EXECUTING",
  "READY_FOR_HUMAN",
  "COMPLETED",
  "BLOCKED",
] as const;
export const presidentCycleStateSchema = z.enum(PRESIDENT_CYCLE_STATES);

export const PRESIDENT_EXECUTION_DOMAINS = [
  "ENGINEERING",
  "RESEARCH",
  "ANALYSIS",
  "DOCUMENTATION",
  "OTHER",
] as const;
export const presidentExecutionDomainSchema = z.enum(PRESIDENT_EXECUTION_DOMAINS);

export const presidentCycleCandidateSchema = z
  .object({
    id: z.string().min(1).max(96),
    rank: z.number().int().min(1).max(10),
    title: z.string().min(1).max(240),
    problem: z.string().min(1).max(8000),
    evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    proposedChange: z.string().min(1).max(12000),
    expectedOutcome: z.string().min(1).max(8000),
    risk: z.string().min(1).max(8000),
    dependencies: z.array(z.string().min(1).max(500)).max(20),
    executionDomain: presidentExecutionDomainSchema,
    roughScope: z.string().min(1).max(4000),
    whyNow: z.string().min(1).max(4000),
    successCriteria: z.array(z.string().min(1).max(2000)).min(1).max(12),
    responseToCritique: z.string().max(8000).default(""),
    changedAfterCritique: z.boolean().default(false),
  })
  .strict();

export const presidentCandidateListSchema = z
  .object({
    summary: z.string().min(1).max(8000),
    candidates: z.array(presidentCycleCandidateSchema).length(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.candidates.map(candidate => candidate.id));
    const ranks = new Set(value.candidates.map(candidate => candidate.rank));
    if (ids.size !== 10)
      ctx.addIssue({ code: "custom", message: "Candidate IDs must be unique" });
    if (ranks.size !== 10 || ![...ranks].every(rank => rank >= 1 && rank <= 10))
      ctx.addIssue({ code: "custom", message: "Candidate ranks must be unique 1-10" });
  });

export const presidentClaudeCritiqueSchema = z
  .object({
    summary: z.string().min(1).max(8000),
    critiques: z
      .array(
        z
          .object({
            candidateId: z.string().min(1).max(96),
            verdict: z.enum(["KEEP", "LOWER", "RAISE", "REPLACE", "REJECT"]),
            reasoning: z.string().min(1).max(8000),
            risks: z.array(z.string().min(1).max(2000)).max(12),
            suggestedAlternative: z.string().max(8000).nullable(),
          })
          .strict()
      )
      .min(1)
      .max(20),
    missingOpportunities: z.array(z.string().min(1).max(8000)).max(10),
  })
  .strict();

export const presidentApprovalReceiptSchema = z
  .object({
    cycleId: z.string().uuid(),
    founderId: z.string().min(1).max(191),
    approvedCandidateIds: z.array(z.string().min(1).max(96)).min(1).max(3),
    approvedAt: z.string().datetime(),
    receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const PRESIDENT_MISSION_STATES = [
  "QUEUED",
  "PREPARING",
  "EXECUTING",
  "VALIDATING",
  "REVIEWING",
  "REPAIR_REQUIRED",
  "READY_FOR_HUMAN",
  "COMPLETED",
  "BLOCKED",
] as const;
export const presidentCycleMissionStateSchema = z.enum(PRESIDENT_MISSION_STATES);

export const presidentCycleMissionSchema = z
  .object({
    id: z.string().uuid(),
    cycleId: z.string().uuid(),
    candidateId: z.string().min(1).max(96),
    title: z.string().min(1).max(240),
    objective: z.string().min(1).max(12000),
    evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    acceptanceCriteria: z.array(z.string().min(1).max(2000)).min(1).max(12),
    executionDomain: presidentExecutionDomainSchema,
    state: presidentCycleMissionStateSchema,
    attemptCount: z.number().int().min(0).max(10),
    maxAttempts: z.number().int().min(1).max(10),
    executorId: z.string().max(191).nullable(),
    reviewerId: z.string().max(191).nullable(),
    baseSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
    branch: z.string().max(512).nullable(),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
    pullRequestUrl: z.string().url().nullable(),
    result: z.record(z.string(), z.unknown()).nullable(),
    review: z.record(z.string(), z.unknown()).nullable(),
    blocker: z.string().max(12000).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const presidentCycleSchema = z
  .object({
    id: z.string().uuid(),
    state: presidentCycleStateSchema,
    evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    initialCandidates: presidentCandidateListSchema.nullable(),
    claudeCritique: presidentClaudeCritiqueSchema.nullable(),
    finalCandidates: presidentCandidateListSchema.nullable(),
    proposedCandidateIds: z.array(z.string().min(1).max(96)).max(3),
    approval: presidentApprovalReceiptSchema.nullable(),
    blockReason: z.string().max(12000).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PresidentCycle = z.infer<typeof presidentCycleSchema>;
export type PresidentCycleCandidate = z.infer<typeof presidentCycleCandidateSchema>;
export type PresidentCandidateList = z.infer<typeof presidentCandidateListSchema>;
export type PresidentClaudeCritique = z.infer<typeof presidentClaudeCritiqueSchema>;
export type PresidentApprovalReceipt = z.infer<typeof presidentApprovalReceiptSchema>;
export type PresidentCycleMission = z.infer<typeof presidentCycleMissionSchema>;
