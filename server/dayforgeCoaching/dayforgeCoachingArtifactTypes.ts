import { createHash } from "node:crypto";
import type {
  DayforgeCoachingClaim,
  DayforgeCoachingOutput,
  DayforgeEvidenceReference,
} from "@shared/dayforgeCoaching";
import type { DayforgeCoachingFallbackCode } from "./dayforgeCoachingPolicy";

export type PersistDayforgeCoachingArtifactInput = {
  tenantId: string;
  missionId: number;
  missionStepId: number | null;
  accountId: number;
  requestId: string;
  requestedBy: string;
  generationStatus: "generated" | "fallback";
  provider: string;
  modelId: string | null;
  promptVersion: string;
  contextHash: string;
  generatedAt: Date;
  structuredOutput: DayforgeCoachingOutput;
  evidenceReferences: DayforgeEvidenceReference[];
  fallbackCode: DayforgeCoachingFallbackCode | null;
  failureCode: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
};

export type FindReusableDayforgeCoachingArtifactInput = Pick<
  PersistDayforgeCoachingArtifactInput,
  | "tenantId"
  | "missionId"
  | "missionStepId"
  | "accountId"
  | "provider"
  | "modelId"
  | "promptVersion"
  | "contextHash"
>;

export function dayforgeCoachingArtifactCacheKey(
  input: FindReusableDayforgeCoachingArtifactInput,
): string {
  const scopeKey = input.missionStepId === null ? "mission" : `step:${input.missionStepId}`;
  const digest = createHash("sha256").update([
    input.tenantId,
    input.missionId,
    scopeKey,
    input.accountId,
    input.provider,
    input.modelId ?? "",
    input.promptVersion,
    input.contextHash,
  ].join("\u001f")).digest("hex");
  return `dfcoach:${digest}`;
}

export type DayforgeCoachingArtifact = {
  id: string;
  tenantId: string;
  missionId: number;
  missionStepId: number | null;
  scopeKey: string;
  accountId: number;
  generationStatus: "pending" | "generated" | "fallback" | "failed";
  provider: string;
  modelId: string | null;
  promptVersion: string;
  contextHash: string;
  cacheKey: string | null;
  requestId: string;
  version: number;
  generatedAt: string | null;
  structuredOutput: DayforgeCoachingOutput | null;
  evidenceReferences: DayforgeEvidenceReference[];
  claims: DayforgeCoachingClaim[];
  failureCode: string | null;
  fallbackCode: string | null;
  requestedBy: string;
  supersededAt: string | null;
  active: boolean;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
  createdAt: string;
  updatedAt: string;
};

export interface DayforgeCoachingArtifactRepository {
  persist(input: PersistDayforgeCoachingArtifactInput): Promise<DayforgeCoachingArtifact>;
  findReusable(
    input: FindReusableDayforgeCoachingArtifactInput,
  ): Promise<DayforgeCoachingArtifact | null>;
}
