/**
 * Stage 3A — Claire Operator Context Shadow Integration.
 *
 * Dedicated, typed, deliberately bounded projection of OperatorContextPacket for Claire.
 *
 * NON-NEGOTIABLE TRUTH BOUNDARIES:
 * 1. This adapter contains ADAPTATION CONTEXT ONLY.
 * 2. It does NOT have, and must NEVER receive, authority for current_business_truth
 *    or commercial fact verification.
 * 3. It is NOT business evidence, claim receipts, or fact inventory proof.
 * 4. It must NEVER enter Claire prompts, LLM invocations, or business answer paths.
 * 5. Shadow execution must be strictly non-destructive: failure falls open,
 *    telemetry is structural only, and user-facing output is 100% identical to baseline.
 */

import { DIAGNOSIS_FORBIDDEN_PATTERNS } from "../../shared/behavioralInterventionMapping";
import {
  buildOperatorContextPacket,
  type OperatorContextPacket,
  type OperatorExplicitPreference,
  type OperatorContextUncertaintyReason,
} from "../persistentOperator/operatorContext";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "../persistentOperator/identity";
import type { LearningKind, DeltaType } from "../persistentOperator/learningStore";

/**
 * Filtered structured learned signal for Claire adaptation.
 * Contains only auditable operational metadata.
 * Excludes explanatory prose and conversational interpretation.
 */
export type ClaireOperatorLearnedSignal = {
  learningKind: LearningKind;
  targetKey: string;
  confidence: "high" | "medium" | "low";
  deltaType: DeltaType;
  sourceDeltaId: string;
  evidenceReference: string;
};

/**
 * Structural metadata for auditing and inspection of the packet.
 */
export type ClaireOperatorAdaptationMetadata = {
  generatedAt: string;
  mappedUserCount: number;
  evidenceRefCount: number;
  explicitPreferenceCount: number;
  learnedSignalCount: number;
  uncertaintyCount: number;
  evidenceWindowTruncated: boolean;
};

/**
 * Stage 3A Claire Operator Adaptation Context.
 * Deliberately selected and bounded fields only.
 */
export type ClaireOperatorAdaptationContext = {
  canonicalOperatorId: string;
  tenantId: string;
  generatedAt: string;

  /**
   * Explicit preferences declared by the operator with operator_declared provenance.
   * Never inferred from behavior.
   */
  explicitPreferences: OperatorExplicitPreference[];

  /**
   * Structured operational signals from goal cycle learned deltas.
   * Explanatory prose is strictly excluded.
   */
  learnedSignals: ClaireOperatorLearnedSignal[];

  /**
   * Active uncertainty reasons from packet construction.
   */
  uncertaintyReasons: OperatorContextUncertaintyReason[];

  /**
   * Indicates whether the Behavioral Ledger read reached the query limit.
   */
  evidenceWindowTruncated: boolean;

  /**
   * Structural counts and metadata for auditing and inspection.
   */
  metadata: ClaireOperatorAdaptationMetadata;
};

/**
 * Telemetry event kinds for shadow execution.
 */
export type ClaireOperatorContextShadowEventKind =
  | "operator_context_shadow_started"
  | "operator_context_shadow_completed"
  | "operator_context_shadow_failed"
  | "operator_context_shadow_skipped";

/**
 * Safe structural telemetry event.
 * Never logs private text, preference values, prompt content, or raw ledger rows.
 */
export type ClaireOperatorContextShadowTelemetryEvent = {
  event: ClaireOperatorContextShadowEventKind;
  tenantId: string;
  canonicalOperatorId?: string | null;
  operatorUserId?: string | null;
  durationMs?: number;
  skipReason?: "flag_disabled" | "missing_identity" | "identity_unresolved";
  failureReason?: string;
  metadata?: {
    durationMs: number;
    explicitPreferenceCount: number;
    learnedSignalCount: number;
    learnedSignalKinds: string[];
    uncertaintyReasons: string[];
    evidenceWindowTruncated: boolean;
    mappedUserCount: number;
    evidenceRefCount: number;
  };
};

/**
 * Check whether Claire operator context shadow mode is enabled.
 * Default is FALSE unless explicitly enabled via CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED.
 */
export function isClaireOperatorContextShadowEnabled(tenantId?: string): boolean {
  const envVal = process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED?.trim();
  if (!envVal || envVal === "false" || envVal === "0") return false;
  if (envVal === "true" || envVal === "1" || envVal === "*") return true;
  if (tenantId) {
    const allowed = envVal.split(",").map(t => t.trim()).filter(Boolean);
    return allowed.includes(tenantId);
  }
  return false;
}

/**
 * Safety validator ensuring no diagnostic, psychological, or motive phrases
 * contaminate the adaptation context.
 */
export function assertNoForbiddenAdaptationPatterns(
  context: ClaireOperatorAdaptationContext
): void {
  const serialized = JSON.stringify(context);
  for (const forbidden of DIAGNOSIS_FORBIDDEN_PATTERNS) {
    if (forbidden.test(serialized)) {
      throw new Error(
        `Claire adaptation context emitted forbidden diagnostic or causal phrasing matching ${forbidden.toString()}`
      );
    }
  }
}

/**
 * Maps a full Stage 1 OperatorContextPacket into the strictly bounded
 * ClaireOperatorAdaptationContext projection.
 */
export function toClaireOperatorAdaptationContext(
  packet: OperatorContextPacket
): ClaireOperatorAdaptationContext {
  // 1. Only allow operator-declared explicit preferences (never inferred)
  const explicitPreferences = packet.card.explicitPreferences.filter(
    pref => pref.provenance === "operator_declared"
  );

  // 2. Structured learned signals only — exclude raw before/after JSON blobs and any prose
  const learnedSignals: ClaireOperatorLearnedSignal[] = packet.learnedSignals.map(signal => ({
    learningKind: signal.learningKind,
    targetKey: signal.targetKey,
    confidence: signal.confidence,
    deltaType: signal.deltaType,
    sourceDeltaId: signal.sourceDeltaId,
    evidenceReference: signal.evidenceReference,
  }));

  // 3. Extract distinct uncertainty reasons
  const uncertaintyReasons = Array.from(
    new Set(packet.uncertainty.map(u => u.reason))
  );

  const evidenceWindowTruncated = packet.uncertainty.some(
    u => u.reason === "evidence_window_truncated"
  );

  const metadata: ClaireOperatorAdaptationMetadata = {
    generatedAt: packet.generatedAt,
    mappedUserCount: packet.mappedUserIds.length,
    evidenceRefCount: packet.evidenceRefs.length,
    explicitPreferenceCount: explicitPreferences.length,
    learnedSignalCount: learnedSignals.length,
    uncertaintyCount: packet.uncertainty.length,
    evidenceWindowTruncated,
  };

  const context: ClaireOperatorAdaptationContext = {
    canonicalOperatorId: packet.canonicalOperatorId,
    tenantId: packet.tenantId,
    generatedAt: packet.generatedAt,
    explicitPreferences,
    learnedSignals,
    uncertaintyReasons,
    evidenceWindowTruncated,
    metadata,
  };

  // Run psychology / diagnosis firewall check
  assertNoForbiddenAdaptationPatterns(context);

  return context;
}

/**
 * Default loader for Claire operator adaptation context.
 * Resolves canonical operator identity and builds the bounded adaptation packet.
 */
export async function loadClaireOperatorAdaptationContext(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<ClaireOperatorAdaptationContext | null> {
  const tenantId = input.tenantId?.trim();
  const operatorUserId = input.operatorUserId?.trim();
  if (!tenantId || !operatorUserId) return null;

  const source =
    /^\d+$/.test(operatorUserId)
      ? { type: "user_id" as const, value: Number(operatorUserId) }
      : { type: "open_id" as const, value: operatorUserId };

  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId,
    source,
    subsystem: "claire_shadow",
  });

  if (!resolution.ok) {
    return null;
  }

  const packet = await buildOperatorContextPacket({
    tenantId,
    identity: resolution.identity,
  });

  return toClaireOperatorAdaptationContext(packet);
}

/**
 * Default telemetry emitter for shadow execution.
 * Structural counts and labels only.
 */
export function defaultEmitClaireOperatorContextShadowTelemetry(
  event: ClaireOperatorContextShadowTelemetryEvent
): void {
  // Counts and structural metadata only — no operator speech, no preference text, no raw ledger rows.
  console.info("[Claire] operator context shadow", event);
}

export type RunClaireOperatorContextShadowInput = {
  tenantId: string;
  operatorUserId: string;
  deps?: {
    loadOperatorAdaptationContext?: (input: {
      tenantId: string;
      operatorUserId: string;
    }) => Promise<ClaireOperatorAdaptationContext | null>;
    onOperatorContextShadowTelemetry?: (
      event: ClaireOperatorContextShadowTelemetryEvent
    ) => void;
  };
};

/**
 * Executes the Stage 3A shadow read within the lifetime of a Claire turn.
 * Awaited deterministically, timed explicitly, and isolated from prompt/LLM/Brain V3.
 * Always fails open and never throws to the caller.
 */
export async function runClaireOperatorContextShadow(
  input: RunClaireOperatorContextShadowInput
): Promise<ClaireOperatorAdaptationContext | null> {
  const startMs = Date.now();
  const emit =
    input.deps?.onOperatorContextShadowTelemetry ??
    defaultEmitClaireOperatorContextShadowTelemetry;

  const tenantId = input.tenantId?.trim();
  const operatorUserId = input.operatorUserId?.trim();

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
      durationMs: Date.now() - startMs,
    });
    return null;
  }

  try {
    const loader =
      input.deps?.loadOperatorAdaptationContext ??
      loadClaireOperatorAdaptationContext;

    const adaptationContext = await loader({ tenantId, operatorUserId });

    const durationMs = Date.now() - startMs;

    if (!adaptationContext) {
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
      canonicalOperatorId: adaptationContext.canonicalOperatorId,
      operatorUserId,
      durationMs,
      metadata: {
        durationMs,
        explicitPreferenceCount: adaptationContext.explicitPreferences.length,
        learnedSignalCount: adaptationContext.learnedSignals.length,
        learnedSignalKinds: Array.from(
          new Set(adaptationContext.learnedSignals.map(s => s.learningKind))
        ),
        uncertaintyReasons: adaptationContext.uncertaintyReasons,
        evidenceWindowTruncated: adaptationContext.evidenceWindowTruncated,
        mappedUserCount: adaptationContext.metadata.mappedUserCount,
        evidenceRefCount: adaptationContext.metadata.evidenceRefCount,
      },
    });

    // Returned for shadow inspection or testing, but discarded by the turn
    return adaptationContext;
  } catch (error) {
    const durationMs = Date.now() - startMs;
    emit({
      event: "operator_context_shadow_failed",
      tenantId,
      operatorUserId,
      durationMs,
      failureReason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
