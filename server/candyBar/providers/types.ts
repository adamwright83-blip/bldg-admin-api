import {
  parseArchitectPlan,
  parseReviewCritique,
  type ArchitectPlan,
  type CandyBarProviderId,
  type CiStatusArtifact,
  type PrStatusArtifact,
  type ProviderDispatchResult,
  type ReconciledBrief,
  type RepoContextArtifact,
  type ReviewCritique,
  type CandyBarHumanGateReason,
  type CandyBarAuthorityLevel,
} from "../../../shared/candyBar";
import type { EngineeringTerminalResult } from "../../goldline/engineering/agentsClient";

export type ArchitectAdapter = {
  readonly providerId: CandyBarProviderId;
  plan(input: { prompt: string }): Promise<ProviderDispatchResult>;
};

export type ReviewerAdapter = {
  readonly providerId: CandyBarProviderId;
  review(input: { prompt: string }): Promise<ProviderDispatchResult>;
};

export type EngineerAdapter = {
  readonly providerId: CandyBarProviderId;
  implement(input: {
    prompt: string;
    sessionId?: string | null;
  }): Promise<ProviderDispatchResult>;
};

export type CreativeAdapter = {
  readonly providerId: CandyBarProviderId;
  /** V0 seam only — always unavailable. */
  treat(input: { prompt: string }): Promise<ProviderDispatchResult>;
};

export type GithubObserver = {
  readonly providerId: CandyBarProviderId;
  getMainSha(repository: string, branch?: string): Promise<string>;
  getRepoContext(input: {
    repository: string;
    baseBranch: string;
    currentGoal: string;
    goalVersion: number;
    protectedAreas: string[];
    knownParallelWork: string[];
    nonGoals: string[];
  }): Promise<RepoContextArtifact>;
  observePr(input: {
    repository: string;
    prNumber?: number | null;
    prUrl?: string | null;
  }): Promise<PrStatusArtifact>;
  observeCi(input: {
    repository: string;
    headSha: string;
  }): Promise<CiStatusArtifact>;
};

export type CandyBarProviders = {
  architect: ArchitectAdapter;
  reviewer: ReviewerAdapter;
  engineer: EngineerAdapter;
  creative: CreativeAdapter;
  github: GithubObserver;
};

export function unavailableResult(
  provider: CandyBarProviderId,
  message: string
): ProviderDispatchResult {
  return {
    ok: false,
    provider,
    code: "PROVIDER_UNAVAILABLE",
    message,
    retryable: false,
    browserAutomationUsed: false,
  };
}

export function asArchitectPlan(content: Record<string, unknown>): ArchitectPlan | null {
  return parseArchitectPlan(content);
}

export function asReviewCritique(content: Record<string, unknown>): ReviewCritique | null {
  return parseReviewCritique(content);
}

export type EngineerTerminalContent = EngineeringTerminalResult;

export function parseReconciledBrief(raw: unknown): ReconciledBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.decision !== "ACCEPT" && o.decision !== "ACCEPT_WITH_CHANGES" && o.decision !== "REJECT") {
    return null;
  }
  const level = o.authorityLevel as CandyBarAuthorityLevel;
  if (
    level !== "AUTONOMOUS_EXECUTION" &&
    level !== "AUTONOMOUS_PRODUCT_ELABORATION" &&
    level !== "PROPOSAL_AUTHORITY" &&
    level !== "HARD_HUMAN_GATE"
  ) {
    return null;
  }
  if (typeof o.humanGateRequired !== "boolean") return null;
  if (typeof o.implementationBrief !== "string" || !o.implementationBrief.trim()) return null;
  const reason = o.humanGateReason;
  return {
    decision: o.decision,
    authorityLevel: level,
    humanGateRequired: o.humanGateRequired,
    humanGateReason:
      reason === null || reason === undefined ? null : (String(reason) as CandyBarHumanGateReason),
    implementationBrief: o.implementationBrief.trim(),
    followOnCandidates: Array.isArray(o.followOnCandidates)
      ? o.followOnCandidates.map(String)
      : [],
  };
}
