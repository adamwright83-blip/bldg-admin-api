/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DAYFORGE_COACHING_FALLBACK_CATEGORIES,
  DAYFORGE_COACHING_FALLBACK_CODES,
  LegacyDayforgeCoachingPolicyError,
  buildDeterministicDayforgeCoachingFallback,
  groundDayforgeModelCoachingOutput,
  type LegacyDayforgeCoachingFallbackCategory,
  type LegacyDayforgeCoachingFallbackCode,
  type LegacyDayforgeCoachingGroundingEvidence,
  type PreparedDayforgeCoachingArtifact,
} from "./legacyDayforgeCoachingPolicy";
import type {
  LegacyDayforgeCoachingArtifact,
  LegacyDayforgeCoachingArtifactRepository,
  FindReusableDayforgeCoachingArtifactInput,
  PersistDayforgeCoachingArtifactInput,
} from "./legacyDayforgeCoachingArtifactTypes";

const requestSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  missionId: z.number().int().positive(),
  missionStepId: z.number().int().positive().nullable(),
  accountId: z.number().int().positive(),
  requestId: z.string().uuid(),
  requestedBy: z.string().trim().min(1).max(128),
  provider: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(191).nullable(),
  promptVersion: z.string().trim().min(1).max(64),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  fallbackCategory: z.enum(DAYFORGE_COACHING_FALLBACK_CATEGORIES),
  latencyMs: z.number().int().nonnegative().max(3_600_000).nullable(),
  inputTokens: z.number().int().nonnegative().max(10_000_000).nullable(),
  outputTokens: z.number().int().nonnegative().max(10_000_000).nullable(),
  estimatedCostMicros: z.number().int().nonnegative().max(2_147_483_647).nullable(),
}).strict();

const providerFailureSchema = z.object({
  kind: z.literal("failure"),
  fallbackCode: z.enum(DAYFORGE_COACHING_FALLBACK_CODES).refine(
    code => code.startsWith("provider_"),
    "Provider failures require a provider fallback code",
  ),
  failureCode: z.string().trim().regex(/^[a-z0-9_]{1,96}$/).nullable(),
}).strict();

export type LegacyDayforgeCoachingProviderResult =
  | {
      kind: "output";
      rawOutput: unknown;
      evidence: LegacyDayforgeCoachingGroundingEvidence[];
    }
  | {
      kind: "failure";
      fallbackCode: Extract<LegacyDayforgeCoachingFallbackCode, `provider_${string}`>;
      /** Controlled code only. Never pass provider error text or response bodies. */
      failureCode: string | null;
    };

export type SaveDayforgeCoachingArtifactInput = {
  tenantId: string;
  missionId: number;
  missionStepId: number | null;
  accountId: number;
  requestId: string;
  requestedBy: string;
  provider: string;
  modelId: string | null;
  promptVersion: string;
  contextHash: string;
  fallbackCategory: LegacyDayforgeCoachingFallbackCategory;
  providerResult: LegacyDayforgeCoachingProviderResult;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostMicros?: number | null;
};

export type LegacyDayforgeCoachingArtifactService = {
  findReusable(
    input: FindReusableDayforgeCoachingArtifactInput,
  ): Promise<LegacyDayforgeCoachingArtifact | null>;
  save(input: SaveDayforgeCoachingArtifactInput): Promise<LegacyDayforgeCoachingArtifact>;
};

function controlledPolicyFailureCode(code: LegacyDayforgeCoachingPolicyError["code"]): string {
  return `policy_${code}`.slice(0, 96);
}

function prepareArtifact(input: {
  providerResult: LegacyDayforgeCoachingProviderResult;
  fallbackCategory: LegacyDayforgeCoachingFallbackCategory;
  generatedAt: Date;
}): PreparedDayforgeCoachingArtifact {
  if (input.providerResult.kind === "failure") {
    const failure = providerFailureSchema.parse(input.providerResult);
    return buildDeterministicDayforgeCoachingFallback({
      category: input.fallbackCategory,
      fallbackCode: failure.fallbackCode,
      failureCode: failure.failureCode,
      generatedAt: input.generatedAt,
    });
  }

  try {
    return groundDayforgeModelCoachingOutput({
      rawOutput: input.providerResult.rawOutput,
      evidence: input.providerResult.evidence,
      generatedAt: input.generatedAt,
    });
  } catch (error) {
    if (!(error instanceof LegacyDayforgeCoachingPolicyError)) {
      throw error;
    }
    return buildDeterministicDayforgeCoachingFallback({
      category: input.fallbackCategory,
      fallbackCode: error.code,
      failureCode: controlledPolicyFailureCode(error.code),
      generatedAt: input.generatedAt,
    });
  }
}

export function legacyDayforgeCoachingContextHash(value: unknown): string {
  const seen = new Set<object>();
  const canonicalize = (candidate: unknown): string => {
    if (candidate === null) return "null";
    if (typeof candidate === "string" || typeof candidate === "boolean") {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new Error("Coaching context numbers must be finite");
      return JSON.stringify(candidate);
    }
    if (candidate instanceof Date) return JSON.stringify(candidate.toISOString());
    if (Array.isArray(candidate)) return `[${candidate.map(canonicalize).join(",")}]`;
    if (typeof candidate !== "object" || candidate === undefined) {
      throw new Error("Coaching context must contain only JSON-compatible values");
    }
    if (seen.has(candidate)) throw new Error("Coaching context cannot contain cycles");
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    const encoded = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",");
    seen.delete(candidate);
    return `{${encoded}}`;
  };
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function createDayforgeCoachingArtifactService(dependencies: {
  repository: LegacyDayforgeCoachingArtifactRepository;
  now?: () => Date;
}): LegacyDayforgeCoachingArtifactService {
  const now = dependencies.now ?? (() => new Date());
  return {
    async findReusable(input) {
      const parsed = requestSchema
        .omit({
          requestId: true,
          requestedBy: true,
          fallbackCategory: true,
          latencyMs: true,
          inputTokens: true,
          outputTokens: true,
          estimatedCostMicros: true,
        })
        .parse(input);
      return dependencies.repository.findReusable(parsed);
    },
    async save(input) {
      const parsed = requestSchema.parse({
        tenantId: input.tenantId,
        missionId: input.missionId,
        missionStepId: input.missionStepId,
        accountId: input.accountId,
        requestId: input.requestId,
        requestedBy: input.requestedBy,
        provider: input.provider,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        contextHash: input.contextHash,
        fallbackCategory: input.fallbackCategory,
        latencyMs: input.latencyMs ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        estimatedCostMicros: input.estimatedCostMicros ?? null,
      });
      const generatedAt = now();
      const prepared = prepareArtifact({
        providerResult: input.providerResult,
        fallbackCategory: parsed.fallbackCategory,
        generatedAt,
      });
      const persistence: PersistDayforgeCoachingArtifactInput = {
        ...parsed,
        ...prepared,
        generatedAt,
      };
      return dependencies.repository.persist(persistence);
    },
  };
}
