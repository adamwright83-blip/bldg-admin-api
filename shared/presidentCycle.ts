/**
 * President improvement-cycle contract.
 * Owned by the President autonomous-execution branch. Adam -> President only;
 * nothing here references or routes to any other seat.
 */
import { z } from "zod";

export const CYCLE_STATUSES = [
  "GATHERING_EVIDENCE",
  "DELIBERATING_PROPOSAL",
  "DELIBERATING_CRITIQUE",
  "DELIBERATING_SYNTHESIS",
  "DELIBERATION_BLOCKED",
  "PRESIDENT_RECOMMENDED",
  "AWAITING_ADAM_REVIEW",
  "ADAM_APPROVED",
  "NO_APPROVAL",
  "EXECUTING",
  "COMPLETE",
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CYCLE_TRANSITIONS: Record<CycleStatus, CycleStatus[]> = {
  GATHERING_EVIDENCE: ["DELIBERATING_PROPOSAL", "DELIBERATION_BLOCKED"],
  DELIBERATING_PROPOSAL: ["DELIBERATING_CRITIQUE", "DELIBERATION_BLOCKED"],
  DELIBERATING_CRITIQUE: ["DELIBERATING_SYNTHESIS", "DELIBERATION_BLOCKED"],
  DELIBERATING_SYNTHESIS: ["PRESIDENT_RECOMMENDED", "DELIBERATION_BLOCKED"],
  DELIBERATION_BLOCKED: [
    "DELIBERATING_PROPOSAL",
    "DELIBERATING_CRITIQUE",
    "DELIBERATING_SYNTHESIS",
  ],
  PRESIDENT_RECOMMENDED: ["AWAITING_ADAM_REVIEW"],
  // The ONLY way into ADAM_APPROVED is from AWAITING_ADAM_REVIEW.
  AWAITING_ADAM_REVIEW: ["ADAM_APPROVED", "NO_APPROVAL"],
  ADAM_APPROVED: ["EXECUTING"],
  NO_APPROVAL: [],
  EXECUTING: ["COMPLETE"],
  COMPLETE: [],
};

export const EXECUTION_DOMAINS = [
  "ENGINEERING",
  "RESEARCH",
  "ANALYSIS",
  "DOCUMENTATION",
  "PRODUCT_DESIGN",
  "BROWSER_WEB",
  "OPERATIONS",
  "GROWTH",
  "SECURITY",
  "OTHER",
] as const;
export type ExecutionDomain = (typeof EXECUTION_DOMAINS)[number];

export type EvidenceItem = {
  id: string;
  /** e.g. "git", "github", "repo-scan", "posthog", "operator". Never a peer-seat store. */
  source: string;
  kind: string;
  observedAt: string;
  summary: string;
  ref: string;
  /** "EVIDENCE" = observed fact; "JUDGMENT" = reasoned inference. */
  basis: "EVIDENCE" | "JUDGMENT";
};

const str = z.string().min(1);
export const candidateBodySchema = z.object({
  title: str,
  problem: str,
  evidenceRefs: z.array(z.string()).default([]),
  proposedChange: str,
  expectedUpside: str,
  risk: str,
  effort: str,
  dependencies: z.array(z.string()).default([]),
  whyNow: str,
  successLooksLike: str,
  executionDomain: z.enum(EXECUTION_DOMAINS),
  scope: str,
  acceptanceCriteria: z.array(str).default([]),
  validationCommands: z.array(z.string()).default([]),
  browserCheck: z
    .object({
      url: z.string(),
      expectText: z.string().optional(),
      startCommand: z.string().optional(),
    })
    .nullable()
    .default(null),
});
export type CandidateBody = z.infer<typeof candidateBodySchema>;

export const proposalOutputSchema = z.object({
  candidates: z.array(candidateBodySchema.extend({ rank: z.number().int() })),
});
export const critiqueOutputSchema = z.object({
  overall: str,
  perCandidate: z.array(
    z.object({
      rank: z.number().int(),
      verdict: z.enum(["KEEP", "DEMOTE", "PROMOTE", "DROP", "MERGE"]),
      weakAssumptions: z.array(z.string()).default([]),
      risks: z.array(z.string()).default([]),
      note: str,
    })
  ),
  omittedAlternatives: z.array(z.string()).default([]),
});
export const synthesisOutputSchema = z.object({
  candidates: z
    .array(
      candidateBodySchema.extend({
        rank: z.number().int(),
        /** Round-1 candidate id this item continues, or "NEW". */
        continuesCandidateId: str,
        responseToClaude: str,
        changedFromFirstRound: z.boolean(),
        recommendedPriority: z.enum(["HIGH", "MEDIUM", "LOW"]),
      })
    )
    .length(10),
});

export type DeliberationRound = {
  round: "PROPOSAL" | "CRITIQUE" | "SYNTHESIS";
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  attempts: number;
  prompt: string;
  responseText: string;
  parsed: unknown;
  evidenceIds: string[];
};

export type Candidate = CandidateBody & {
  /** Stable. Assigned once; never derived from evidence content. */
  candidateId: string;
  rank: number;
  continuesCandidateId?: string;
  responseToClaude?: string;
  changedFromFirstRound?: boolean;
  recommendedPriority?: "HIGH" | "MEDIUM" | "LOW";
};

export type AdamApprovalReceipt = {
  receiptId: string;
  cycleId: string;
  approvedCandidateIds: string[];
  /** Candidate ids President proposed, preserved verbatim. */
  presidentProposedIds: string[];
  substitutions: { removed: string; added: string }[];
  rejectedCandidateIds: string[];
  approvedAt: string;
  /** Authority identity supplied by the authenticated app/session, never by a model. */
  approvedBy: { identity: string; mechanism: string; sessionRef: string };
  /** sha256 over canonical payload; binds ids+cycle+time+identity. */
  digest: string;
};

export const MISSION_STATUSES = [
  "ADAM_APPROVED",
  "QUEUED",
  "PREPARING",
  "EXECUTING",
  "VALIDATING",
  "READY_FOR_REVIEW",
  "REVIEWING",
  "REPAIR_REQUIRED",
  "BLOCKED",
  "READY_FOR_HUMAN",
  "COMPLETED",
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MISSION_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  ADAM_APPROVED: ["QUEUED"],
  QUEUED: ["PREPARING", "BLOCKED"],
  PREPARING: ["EXECUTING", "BLOCKED", "REPAIR_REQUIRED"],
  EXECUTING: ["VALIDATING", "BLOCKED", "REPAIR_REQUIRED"],
  VALIDATING: ["READY_FOR_REVIEW", "REPAIR_REQUIRED", "BLOCKED"],
  READY_FOR_REVIEW: ["REVIEWING"],
  REVIEWING: ["READY_FOR_HUMAN", "COMPLETED", "REPAIR_REQUIRED", "BLOCKED", "READY_FOR_REVIEW"],
  REPAIR_REQUIRED: ["EXECUTING", "BLOCKED"],
  BLOCKED: [],
  READY_FOR_HUMAN: [],
  COMPLETED: [],
};

export type ReviewVerdict = "PASS" | "FAIL" | "BLOCKED";

export type Receipt = {
  at: string;
  kind: string;
  actorId: string;
  attempt: number;
  data: Record<string, unknown>;
};

export type Mission = {
  missionId: string;
  cycleId: string;
  candidateId: string;
  tenantId: string;
  title: string;
  objective: string;
  businessReason: string;
  evidenceRefs: string[];
  acceptanceCriteria: string[];
  domain: ExecutionDomain;
  scope: string;
  constraints: string[];
  expectedArtifact: string;
  approvedBy: AdamApprovalReceipt["approvedBy"];
  approvalReceiptId: string;
  approvedAt: string;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  requiredValidation: {
    commands: string[];
    browser: { url: string; expectText?: string; startCommand?: string } | null;
  };
  humanGate: "MERGE_REQUIRED" | "NONE";
  dependsOn: string[];
  executorActorId: string | null;
  reviewerActorId: string | null;
  attempt: number;
  maxAttempts: number;
  status: MissionStatus;
  blocker: string | null;
  lease: {
    actorId: string;
    token: string;
    attempt: number;
    expiresAt: string;
  } | null;
  transitions: { at: string; from: MissionStatus; to: MissionStatus; actorId: string }[];
  receipts: Receipt[];
  handback: MissionHandback | null;
};

export type MissionHandback = {
  prUrl?: string;
  branch?: string;
  /** Exact main commit the engineering mission was based on. */
  baseSha?: string;
  commitSha?: string;
  changedFiles?: string[];
  artifactPath?: string;
  /** Durable copy for non-code artifacts; paths may live on ephemeral worker disks. */
  artifactText?: string;
  artifactSha256?: string;
  checks: { command: string; exitCode: number; ok: boolean }[];
  browserEvidence?: { screenshotPath?: string; consoleErrors: string[]; ok: boolean };
  reviewVerdict?: ReviewVerdict;
  reviewReasons?: string[];
  evidenceIds: string[];
};

export type Cycle = {
  cycleId: string;
  tenantId: string;
  version: number;
  status: CycleStatus;
  startedAt: string;
  evidence: EvidenceItem[];
  rounds: DeliberationRound[];
  /** True only for execution-path fixtures. Live deliberation sets false. */
  deliberationIsFixture: boolean;
  firstRoundCandidates: Candidate[];
  finalCandidates: Candidate[];
  presidentProposedIds: string[];
  presidentRationale: string;
  approval: AdamApprovalReceipt | null;
  statusLog: { at: string; from: CycleStatus | null; to: CycleStatus; note: string }[];
  notifications: { at: string; channel: string; message: string; link: string }[];
  missions: Mission[];
  morningReport: MorningReport | null;
  blockedReason: string | null;
};

export type MorningReport = {
  generatedAt: string;
  audience: "ADAM";
  cycleId: string;
  approvalReceiptId: string;
  approvedCandidateIds: string[];
  unapprovedMissionsExecuted: 0;
  remainingCandidateIds: string[];
  missions: {
    missionId: string;
    candidateId: string;
    title: string;
    status: MissionStatus;
    levels: {
      implemented: boolean;
      independentlyReviewed: boolean;
      prReady: boolean;
      merged: false;
      deployed: false;
      outcomeObserved: false;
    };
    prUrl?: string;
    changedFiles?: string[];
    checks?: MissionHandback["checks"];
    reviewVerdict?: ReviewVerdict;
    blocker: string | null;
    nextHumanAction: string;
  }[];
  outcomesNotYetObservable: string;
};
