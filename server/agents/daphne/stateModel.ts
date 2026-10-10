import {
  recordDaphneEpistemicClaim,
  type DaphneUncertaintyVector,
} from "./epistemicStore";
import type { DaphneObservationRecord } from "./observationStore";

export const DAPHNE_TASK_MODES = [
  "execution",
  "planning",
  "learning",
  "exploration",
  "unknown",
] as const;
export type DaphneTaskMode = (typeof DAPHNE_TASK_MODES)[number];

export const DAPHNE_RECEPTIVITY_STATES = [
  "available",
  "low_receptivity_to_interruption",
  "unknown",
] as const;
export type DaphneReceptivityState =
  (typeof DAPHNE_RECEPTIVITY_STATES)[number];

export type DaphneFastState = {
  asOf: string;
  validUntil: string;
  currentGoal: string | null;
  taskMode: DaphneTaskMode;
  urgency: "low" | "normal" | "high" | "unknown";
  receptivity: DaphneReceptivityState;
  interactionLoad: "low" | "normal" | "high" | "unknown";
  attentionRequirement: "low" | "normal" | "high" | "unknown";
  sourceObservationIds: string[];
  uncertainty: DaphneUncertaintyVector;
};

export type DaphneStateContextPayload = {
  currentGoal?: unknown;
  taskMode?: unknown;
  urgency?: unknown;
  receptivity?: unknown;
  interactionLoad?: unknown;
  attentionRequirement?: unknown;
};

const FORBIDDEN_STATE_KEYS = new Set([
  "adhd",
  "depression",
  "bipolar",
  "anxiety_disorder",
  "mental_health_diagnosis",
  "clinical_stress",
]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstAllowed<T extends string>(
  values: unknown[],
  allowed: readonly T[],
  fallback: T
): T {
  for (const value of values) {
    if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  }
  return fallback;
}

export function assertOperationalStatePayload(
  payload: Record<string, unknown> | null
): void {
  if (!payload) return;
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_STATE_KEYS.has(key.toLowerCase())) {
      throw new Error(
        `Daphne fast State cannot encode unsupported clinical construct: ${key}`
      );
    }
  }
}

/**
 * Builds only operationally observable/declared fast state. This function does
 * not analyze prose or diagnose hidden affect. It reads structured context
 * fields from recent observations and expires them on a short horizon.
 */
export function deriveDaphneFastState(input: {
  observations: DaphneObservationRecord[];
  asOf: Date;
  ttlMinutes?: number;
}): DaphneFastState {
  const ttlMinutes = Math.max(5, Math.min(input.ttlMinutes ?? 120, 24 * 60));
  const relevant = input.observations
    .filter(item => Date.parse(item.occurredAt) <= input.asOf.getTime() &&
      Date.parse(item.occurredAt) > input.asOf.getTime() - ttlMinutes * 60_000 &&
      ["verified", "attested"].includes(item.verificationStatus))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  for (const item of relevant) assertOperationalStatePayload(item.context);

  const contexts = relevant.map(item => item.context ?? {});
  const currentGoal =
    contexts.map(ctx => stringValue(ctx.currentGoal)).find(Boolean) ?? null;
  const taskMode = firstAllowed(
    contexts.map(ctx => ctx.taskMode),
    DAPHNE_TASK_MODES,
    "unknown"
  );
  const urgency = firstAllowed(
    contexts.map(ctx => ctx.urgency),
    ["low", "normal", "high", "unknown"] as const,
    "unknown"
  );
  const receptivity = firstAllowed(
    contexts.map(ctx => ctx.receptivity),
    DAPHNE_RECEPTIVITY_STATES,
    "unknown"
  );
  const interactionLoad = firstAllowed(
    contexts.map(ctx => ctx.interactionLoad),
    ["low", "normal", "high", "unknown"] as const,
    "unknown"
  );
  const attentionRequirement = firstAllowed(
    contexts.map(ctx => ctx.attentionRequirement),
    ["low", "normal", "high", "unknown"] as const,
    "unknown"
  );

  const knownFields = [
    currentGoal,
    taskMode === "unknown" ? null : taskMode,
    urgency === "unknown" ? null : urgency,
    receptivity === "unknown" ? null : receptivity,
    interactionLoad === "unknown" ? null : interactionLoad,
    attentionRequirement === "unknown" ? null : attentionRequirement,
  ].filter(Boolean).length;

  return {
    asOf: input.asOf.toISOString(),
    validUntil: new Date(input.asOf.getTime() + ttlMinutes * 60_000).toISOString(),
    currentGoal,
    taskMode,
    urgency,
    receptivity,
    interactionLoad,
    attentionRequirement,
    sourceObservationIds: relevant.map(item => item.id),
    uncertainty: {
      epistemic: Number((1 - knownFields / 6).toFixed(3)),
      aleatoric: null,
      change: null,
      measurement: relevant.length ? 0 : 1,
      decisionCost: null,
    },
  };
}

export function isDaphneFastStateExpired(
  state: DaphneFastState,
  now: Date
): boolean {
  return Date.parse(state.validUntil) <= now.getTime();
}

export async function persistDaphneFastState(input: {
  tenantId: string;
  canonicalOperatorId: string;
  state: DaphneFastState;
  modelVersion: string;
}): Promise<void> {
  if (!input.state.sourceObservationIds.length) return;
  await recordDaphneEpistemicClaim({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    claimType: "latent_state_estimate",
    claimKey: "state:fast_operational",
    claim: {
      currentGoal: input.state.currentGoal,
      taskMode: input.state.taskMode,
      urgency: input.state.urgency,
      receptivity: input.state.receptivity,
      interactionLoad: input.state.interactionLoad,
      attentionRequirement: input.state.attentionRequirement,
    },
    sourceObservationIds: input.state.sourceObservationIds,
    uncertainty: input.state.uncertainty,
    epistemicStatus: "active",
    causalEvidenceStatus: "none",
    validFrom: input.state.asOf,
    validUntil: input.state.validUntil,
    modelVersion: input.modelVersion,
    idempotencyKey: `fast-state:${input.state.asOf}`,
  });
}
