import { createHash } from "node:crypto";
import { recordDaphneEpistemicClaim } from "./epistemicStore";
import type { DaphneObservationRecord } from "./observationStore";
import type { DaphneTaskMode } from "./stateModel";

export type DaphneContext = {
  asOf: string;
  taskFamily: string | null;
  taskMode: DaphneTaskMode;
  stakes: "low" | "normal" | "high" | "unknown";
  urgency: "low" | "normal" | "high" | "unknown";
  channel: string | null;
  timeWindow: string | null;
  agentId: string | null;
  currentGoal: string | null;
  audience: string | null;
  businessContext: string | null;
  recentInterventionExposure: number | null;
  regimeKey: string;
  previousRegimeKey: string | null;
  possibleRegimeChange: boolean;
  changeEvidenceCount: number;
  sourceObservationIds: string[];
};

type ContextFields = {
  taskFamily?: unknown;
  taskMode?: unknown;
  stakes?: unknown;
  urgency?: unknown;
  channel?: unknown;
  timeWindow?: unknown;
  currentGoal?: unknown;
  audience?: unknown;
  businessContext?: unknown;
  recentInterventionExposure?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function structuredContext(observation: DaphneObservationRecord): ContextFields {
  return (observation.context ?? {}) as ContextFields;
}

function regimeMaterial(input: {
  taskFamily: string | null;
  taskMode: DaphneTaskMode;
  stakes: string;
  channel: string | null;
  currentGoal: string | null;
}): string {
  return [
    input.taskFamily ?? "unknown",
    input.taskMode,
    input.stakes,
    input.channel ?? "unknown",
    input.currentGoal ?? "unknown",
  ].join("|");
}

export function daphneRegimeKey(input: {
  taskFamily: string | null;
  taskMode: DaphneTaskMode;
  stakes: string;
  channel: string | null;
  currentGoal: string | null;
}): string {
  return `regime_${createHash("sha256")
    .update(regimeMaterial(input))
    .digest("hex")
    .slice(0, 16)}`;
}

function contextFromObservation(observation: DaphneObservationRecord) {
  const ctx = structuredContext(observation);
  const taskMode = choice(
    ctx.taskMode,
    ["execution", "planning", "learning", "exploration", "unknown"] as const,
    "unknown"
  );
  const stakes = choice(
    ctx.stakes,
    ["low", "normal", "high", "unknown"] as const,
    "unknown"
  );
  const value = {
    taskFamily: text(ctx.taskFamily),
    taskMode,
    stakes,
    urgency: choice(
      ctx.urgency,
      ["low", "normal", "high", "unknown"] as const,
      "unknown"
    ),
    channel: text(ctx.channel),
    timeWindow: text(ctx.timeWindow),
    agentId: observation.agentId,
    currentGoal: text(ctx.currentGoal),
    audience: text(ctx.audience),
    businessContext: text(ctx.businessContext),
    recentInterventionExposure: number(ctx.recentInterventionExposure),
  };
  return {
    ...value,
    regimeKey: daphneRegimeKey(value),
  };
}

/**
 * Detects only a possible regime change. It does not emit a fake probability
 * and never rewrites Person. minConsecutiveEvidence is an engineering
 * anti-flap guard, not a scientific significance threshold.
 */
export function deriveDaphneContext(input: {
  observations: DaphneObservationRecord[];
  asOf: Date;
  previousRegimeKey?: string | null;
  minConsecutiveEvidence?: number;
  ttlMinutes?: number;
}): DaphneContext {
  const ttlMinutes = Math.max(5, Math.min(input.ttlMinutes ?? 120, 24 * 60));
  const relevant = input.observations
    .filter(item => Date.parse(item.occurredAt) <= input.asOf.getTime() &&
      Date.parse(item.occurredAt) > input.asOf.getTime() - ttlMinutes * 60_000 &&
      ["attested", "verified"].includes(item.verificationStatus))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const latest = relevant[0];

  const empty = {
    taskFamily: null,
    taskMode: "unknown" as const,
    stakes: "unknown" as const,
    urgency: "unknown" as const,
    channel: null,
    timeWindow: null,
    agentId: null,
    currentGoal: null,
    audience: null,
    businessContext: null,
    recentInterventionExposure: null,
  };
  const current = latest ? contextFromObservation(latest) : {
    ...empty,
    regimeKey: daphneRegimeKey(empty),
  };

  const min = Math.max(1, Math.min(input.minConsecutiveEvidence ?? 2, 10));
  let changeEvidenceCount = 0;
  for (const observation of relevant) {
    const candidate = contextFromObservation(observation);
    if (candidate.regimeKey !== current.regimeKey) break;
    changeEvidenceCount += 1;
  }

  const previousRegimeKey = input.previousRegimeKey?.trim() || null;
  const possibleRegimeChange =
    Boolean(previousRegimeKey) &&
    previousRegimeKey !== current.regimeKey &&
    changeEvidenceCount >= min;

  return {
    asOf: input.asOf.toISOString(),
    ...current,
    previousRegimeKey,
    possibleRegimeChange,
    changeEvidenceCount,
    sourceObservationIds: relevant.map(item => item.id),
  };
}

export async function persistDaphneContext(input: {
  tenantId: string;
  canonicalOperatorId: string;
  context: DaphneContext;
  modelVersion: string;
}): Promise<void> {
  if (!input.context.sourceObservationIds.length) return;
  await recordDaphneEpistemicClaim({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    agentId: input.context.agentId,
    claimType: "statistical_regularity",
    claimKey: "context:current_regime",
    claim: {
      taskFamily: input.context.taskFamily,
      taskMode: input.context.taskMode,
      stakes: input.context.stakes,
      urgency: input.context.urgency,
      channel: input.context.channel,
      currentGoal: input.context.currentGoal,
      regimeKey: input.context.regimeKey,
      previousRegimeKey: input.context.previousRegimeKey,
      possibleRegimeChange: input.context.possibleRegimeChange,
    },
    sourceObservationIds: input.context.sourceObservationIds,
    contextApplicability: {
      contextKeys: [input.context.regimeKey],
      distinctContextCount: 1,
    },
    uncertainty: {
      change: input.context.possibleRegimeChange ? 1 : 0,
      epistemic: input.context.sourceObservationIds.length ? 0 : 1,
    },
    epistemicStatus: input.context.possibleRegimeChange
      ? "possible_regime_change"
      : "context_specific",
    causalEvidenceStatus: "none",
    modelVersion: input.modelVersion,
    idempotencyKey: `context:${input.context.asOf}`,
  });
}
