import { z } from "zod";

export const presidentCycleCandidateSchema = z.object({
  id: z.string().min(1).max(96),
  rank: z.number().int().min(1).max(10),
  title: z.string().min(1).max(240),
  problem: z.string().min(1).max(2400),
  evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
  proposedChange: z.string().min(1).max(4000),
  expectedOutcome: z.string().min(1).max(2400),
  risk: z.string().min(1).max(1600),
  roughEffort: z.string().min(1).max(800),
  dependencies: z.array(z.string().min(1).max(400)).max(12),
  whyNow: z.string().min(1).max(1600),
  success: z.string().min(1).max(2400),
  executionDomain: z.enum(["ENGINEERING","RESEARCH","ANALYSIS","DOCUMENTATION","PRODUCT","OTHER"]),
  changedAfterCritique: z.boolean().default(false),
  critiqueResponse: z.string().max(2400).default(""),
}).strict();
export type PresidentCycleCandidate = z.infer<typeof presidentCycleCandidateSchema>;

export const presidentCycleStateSchema = z.enum([
  "GATHERING_TRUTH","CHATGPT_PROPOSAL","CLAUDE_CRITIQUE","CHATGPT_SYNTHESIS",
  "AWAITING_ADAM_REVIEW","ADAM_APPROVED","EXECUTING","READY_FOR_HUMAN",
  "COMPLETED","BLOCKED"
]);
export type PresidentCycleState = z.infer<typeof presidentCycleStateSchema>;

export const presidentApprovalReceiptSchema = z.object({
  cycleId: z.string().uuid(),
  approvedCandidateIds: z.array(z.string().min(1).max(96)).min(1).max(3),
  approvedBy: z.string().min(1).max(191),
  approvedAt: z.string().datetime(),
  receiptId: z.string().uuid(),
}).strict();
export type PresidentApprovalReceipt = z.infer<typeof presidentApprovalReceiptSchema>;

export const presidentCycleSchema = z.object({
  id: z.string().uuid(),
  state: presidentCycleStateSchema,
  evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
  chatgptProposal: z.array(presidentCycleCandidateSchema).max(10),
  claudeCritique: z.string().max(20000).nullable(),
  finalCandidates: z.array(presidentCycleCandidateSchema).max(10),
  presidentRecommendedIds: z.array(z.string().min(1).max(96)).max(3),
  approval: presidentApprovalReceiptSchema.nullable(),
  blockedReason: z.string().max(4000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((cycle, ctx) => {
  if (cycle.state === "ADAM_APPROVED" && !cycle.approval) {
    ctx.addIssue({ code:"custom", message:"ADAM_APPROVED requires a durable approval receipt" });
  }
  if (cycle.approval) {
    const finalIds = new Set(cycle.finalCandidates.map(c => c.id));
    for (const id of cycle.approval.approvedCandidateIds) {
      if (!finalIds.has(id)) ctx.addIssue({ code:"custom", message:"Approval contains a candidate outside the final ten" });
    }
  }
});
export type PresidentCycle = z.infer<typeof presidentCycleSchema>;
