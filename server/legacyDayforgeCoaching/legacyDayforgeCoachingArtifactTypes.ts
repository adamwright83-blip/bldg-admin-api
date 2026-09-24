/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { createHash } from "node:crypto";
import type {
  LegacyDayforgeCoachingClaim,
  LegacyDayforgeCoachingOutput,
  LegacyDayforgeEvidenceReference,
} from "@shared/legacyLegacyDayforgeCoaching";
import type { LegacyDayforgeCoachingFallbackCode } from "./legacyLegacyDayforgeCoachingPolicy";

export type PersistLegacyDayforgeCoachingArtifactInput = {
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
  structuredOutput: LegacyDayforgeCoachingOutput;
  evidenceReferences: LegacyDayforgeEvidenceReference[];
  fallbackCode: LegacyDayforgeCoachingFallbackCode | null;
  failureCode: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
};

export type FindReusableLegacyDayforgeCoachingArtifactInput = Pick<
  PersistLegacyDayforgeCoachingArtifactInput,
  | "tenantId"
  | "missionId"
  | "missionStepId"
  | "accountId"
  | "provider"
  | "modelId"
  | "promptVersion"
  | "contextHash"
>;

export function legacyLegacyDayforgeCoachingArtifactCacheKey(
  input: FindReusableLegacyDayforgeCoachingArtifactInput,
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

export type LegacyDayforgeCoachingArtifact = {
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
  structuredOutput: LegacyDayforgeCoachingOutput | null;
  evidenceReferences: LegacyDayforgeEvidenceReference[];
  claims: LegacyDayforgeCoachingClaim[];
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

export interface LegacyDayforgeCoachingArtifactRepository {
  persist(input: PersistLegacyDayforgeCoachingArtifactInput): Promise<LegacyDayforgeCoachingArtifact>;
  findReusable(
    input: FindReusableLegacyDayforgeCoachingArtifactInput,
  ): Promise<LegacyDayforgeCoachingArtifact | null>;
}
