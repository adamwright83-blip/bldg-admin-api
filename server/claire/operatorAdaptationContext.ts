/**
 * Stage 3A — Claire Operator Context shadow integration.
 *
 * This module deliberately projects only adaptation metadata. It is never
 * business truth, factual evidence, a claim receipt, or a prompt payload.
 */

import { DIAGNOSIS_FORBIDDEN_PATTERNS } from "../../shared/behavioralInterventionMapping";
import {
  buildOperatorContextPacket,
  type OperatorContextPacket,
  type OperatorExplicitPreference,
  type OperatorContextUncertaintyReason,
} from "../agents/persistentOperator/operatorContext";
import {
  resolveCanonicalOperatorIdentity,
} from "../agents/persistentOperator/identity";
import type { LearningKind, DeltaType } from "../agents/persistentOperator/learningStore";

export type ClaireOperatorLearnedSignal = {
  learningKind: LearningKind;
  targetKey: string;
  confidence: "high" | "medium" | "low";
  deltaType: DeltaType;
  sourceDeltaId: string;
  evidenceReference: string;
};

export type ClaireOperatorAdaptationMetadata = {
  generatedAt: string;
  mappedUserCount: number;
  evidenceRefCount: number;
  explicitPreferenceCount: number;
  learnedSignalCount: number;
  uncertaintyCount: number;
  evidenceWindowTruncated: boolean;
};

export type ClaireOperatorAdaptationContext = {
  tenantId: string;
  canonicalOperatorId: string;
  generatedAt: string;
  explicitPreferences: OperatorExplicitPreference[];
  learnedSignals: ClaireOperatorLearnedSignal[];
  uncertaintyReasons: OperatorContextUncertaintyReason[];
  evidenceWindowTruncated: boolean;
  metadata: ClaireOperatorAdaptationMetadata;
};

export type ClaireOperatorContextShadowEventKind =
  | "operator_context_shadow_started"
  | "operator_context_shadow_completed"
  | "operator_context_shadow_failed"
  | "operator_context_shadow_skipped";

export type ClaireOperatorContextShadowFailureReason =
  | "adaptation_context_load_failed"
  | "projection_validation_failed";

export type ClaireOperatorContextShadowTelemetryEvent = {
  event: ClaireOperatorContextShadowEventKind;
  tenantId: string;
  canonicalOperatorId?: string | null;
  operatorUserId?: string | null;
  durationMs?: number;
  skipReason?: "missing_identity" | "identity_unresolved";
  failureReason?: ClaireOperatorContextShadowFailureReason;
  metadata?: {
    explicitPreferenceCount: number;
    learnedSignalCount: number;
    learnedSignalKinds: LearningKind[];
    uncertaintyReasons: OperatorContextUncertaintyReason[];
    evidenceWindowTruncated: boolean;
    mappedUserCount: number;
    evidenceRefCount: number;
  };
};

function tenantFlagEnabled(raw: string | undefined, tenantId?: string): boolean {
  const value = raw?.trim();
  if (!value || value === "false" || value === "0") return false;
  if (value === "true" || value === "1" || value === "*") return true;
  if (!tenantId) return false;
  return value.split(",").map(item => item.trim()).filter(Boolean).includes(tenantId);
}

export function isClaireOperatorContextShadowEnabled(tenantId?: string): boolean {
  return tenantFlagEnabled(process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED, tenantId);
}

export function isClaireOperatorContextAdaptationEnabled(tenantId?: string): boolean {
  return tenantFlagEnabled(process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED, tenantId);
}

export function assertNoForbiddenAdaptationPatterns(
  context: ClaireOperatorAdaptationContext
): void {
  const values: string[] = [
    ...context.explicitPreferences.flatMap(pref => [
      pref.kind,
      pref.targetKey,
      pref.preference,
    ]),
    ...context.learnedSignals.flatMap(signal => [
      signal.learningKind,
      signal.targetKey,
      signal.deltaType,
    ]),
  ];
  for (const value of values) {
    for (const forbidden of DIAGNOSIS_FORBIDDEN_PATTERNS) {
      forbidden.lastIndex = 0;
      if (forbidden.test(value)) {
        throw new Error("operator adaptation projection rejected forbidden diagnostic or causal phrasing");
      }
    }
  }
}

export function toClaireOperatorAdaptationContext(
  packet: OperatorContextPacket
): ClaireOperatorAdaptationContext {
  const explicitPreferences = packet.card.explicitPreferences.filter(
    pref => pref.provenance === "operator_declared"
  );
  const learnedSignals: ClaireOperatorLearnedSignal[] = packet.learnedSignals.map(signal => ({
    learningKind: signal.learningKind,
    targetKey: signal.targetKey,
    confidence: signal.confidence,
    deltaType: signal.deltaType,
    sourceDeltaId: signal.sourceDeltaId,
    evidenceReference: signal.evidenceReference,
  }));
  const uncertaintyReasons = Array.from(
    new Set(packet.uncertainty.map(item => item.reason))
  );
  const evidenceWindowTruncated = uncertaintyReasons.includes("evidence_window_truncated");

  const context: ClaireOperatorAdaptationContext = {
    tenantId: packet.tenantId,
    canonicalOperatorId: packet.canonicalOperatorId,
    generatedAt: packet.generatedAt,
    explicitPreferences,
    learnedSignals,
    uncertaintyReasons,
    evidenceWindowTruncated,
    metadata: {
      generatedAt: packet.generatedAt,
      mappedUserCount: packet.mappedUserIds.length,
      evidenceRefCount: packet.evidenceRefs.length,
      explicitPreferenceCount: explicitPreferences.length,
      learnedSignalCount: learnedSignals.length,
      uncertaintyCount: packet.uncertainty.length,
      evidenceWindowTruncated,
    },
  };
  assertNoForbiddenAdaptationPatterns(context);
  return context;
}

export async function loadClaireOperatorAdaptationContext(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<ClaireOperatorAdaptationContext | null> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId || !operatorUserId) return null;

  const source =
    /^\d+$/.test(operatorUserId)
      ? { type: "user_id" as const, value: Number(operatorUserId) }
      : { type: "open_id" as const, value: operatorUserId };

  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId,
    source,
    subsystem: "claire_operator_context_shadow",
  });
  if (!resolution.ok) return null;

  const packet = await buildOperatorContextPacket({
    tenantId,
    identity: resolution.identity,
  });
  return toClaireOperatorAdaptationContext(packet);
}

export function defaultEmitClaireOperatorContextShadowTelemetry(
  event: ClaireOperatorContextShadowTelemetryEvent
): void {
  // Structural-only by contract. No operator utterances, preference values,
  // raw evidence rows, prompts, or exception text are permitted here.
  console.info("[Claire] operator context shadow", event);
}

export async function runClaireOperatorContextShadow(input: {
  tenantId: string;
  operatorUserId: string;
  deps?: {
    loadOperatorAdaptationContext?: (args: {
      tenantId: string;
      operatorUserId: string;
    }) => Promise<ClaireOperatorAdaptationContext | null>;
    onTelemetry?: (event: ClaireOperatorContextShadowTelemetryEvent) => void;
    nowMs?: () => number;
  };
}): Promise<ClaireOperatorAdaptationContext | null> {
  const clock = input.deps?.nowMs ?? Date.now;
  const startedAt = clock();
  const emit = input.deps?.onTelemetry ?? defaultEmitClaireOperatorContextShadowTelemetry;
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();

  emit({
    event: "operator_context_shadow_started",
    tenantId: tenantId || "unknown",
    operatorUserId: operatorUserId || null,
  });

  if (!tenantId || !operatorUserId) {
    emit({
      event: "operator_context_shadow_skipped",
      tenantId: tenantId || "unknown",
      operatorUserId: operatorUserId || null,
      skipReason: "missing_identity",
      durationMs: Math.max(0, clock() - startedAt),
    });
    return null;
  }

  try {
    const loader = input.deps?.loadOperatorAdaptationContext ?? loadClaireOperatorAdaptationContext;
    const context = await loader({ tenantId, operatorUserId });
    const durationMs = Math.max(0, clock() - startedAt);

    if (!context) {
      emit({
        event: "operator_context_shadow_skipped",
        tenantId,
        operatorUserId,
        skipReason: "identity_unresolved",
        durationMs,
      });
      return null;
    }

    emit({
      event: "operator_context_shadow_completed",
      tenantId,
      canonicalOperatorId: context.canonicalOperatorId,
      operatorUserId,
      durationMs,
      metadata: {
        explicitPreferenceCount: context.metadata.explicitPreferenceCount,
        learnedSignalCount: context.metadata.learnedSignalCount,
        learnedSignalKinds: Array.from(new Set(context.learnedSignals.map(item => item.learningKind))),
        uncertaintyReasons: context.uncertaintyReasons,
        evidenceWindowTruncated: context.evidenceWindowTruncated,
        mappedUserCount: context.metadata.mappedUserCount,
        evidenceRefCount: context.metadata.evidenceRefCount,
      },
    });
    return context;
  } catch {
    emit({
      event: "operator_context_shadow_failed",
      tenantId,
      operatorUserId,
      durationMs: Math.max(0, clock() - startedAt),
      failureReason: "adaptation_context_load_failed",
    });
    return null;
  }
}
