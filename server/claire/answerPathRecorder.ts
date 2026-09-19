/**
 * Claire Intelligence Repair Part 2, Slice A: persistence for the per-turn
 * answer-path trace.
 *
 * Kept apart from `answerPathTelemetry.ts` (pure types and marking) so the
 * turn logic can be traced in tests without a database, and so this file is
 * the only place that knows about persistence, flags, and console output.
 *
 * Contract: fire-and-forget, fail-open, flag-gated. Slice A changes no answer,
 * and a telemetry failure must never change or delay one.
 */

import { appendClaireAnswerPathLog } from "./character/generationLog";
import { claireRepair2FlagName, isClaireRepair2Enabled } from "./repair2Flags";
import type { ClaireTurnTrace } from "./answerPathTelemetry";

/** The shape written to `answerPathDetailJson`. Counts and labels only. */
export function claireTurnTraceDetail(trace: ClaireTurnTrace) {
  return {
    flag: claireRepair2FlagName("a_routing_telemetry"),
    encyclopedia: trace.encyclopedia,
    memorySearched: trace.memorySearched,
    blend: trace.blend,
    // Slice C+D: whether this turn's classification required Claire's own
    // synthesis, and which deterministic sources fed it as evidence.
    synthesisRequired: trace.synthesisRequired,
    evidenceSources: trace.evidenceSources,
    promptSizes: trace.promptSizes,
    latency: trace.latency,
    spokenChars: trace.spokenChars,
  };
}

export function persistClaireTurnTrace(
  trace: ClaireTurnTrace,
  outcome: { turnKind: string; spokenText: string }
): void {
  trace.turnKind = outcome.turnKind;
  trace.spokenChars = outcome.spokenText.length;
  trace.latency.answerReadyMs = Date.now() - trace.startedAtMs;
  const promptChars = trace.promptSizes.reduce((total, size) => total + size.totalChars, 0) || null;

  // Counts and labels only — no prompt text, no operator speech.
  console.info("[Claire] answer path", {
    event: "claire_answer_path",
    tenantId: trace.tenantId,
    surface: trace.surface,
    turnKind: trace.turnKind,
    answerPath: trace.path ?? "unattributed",
    businessReader: trace.businessReader,
    rendererProse: trace.rendererProse,
    fallbackReason: trace.fallbackReason,
    modelRequested: trace.modelRequested,
    promptChars,
    latency: trace.latency,
    encyclopediaTools: trace.encyclopedia?.toolsPlanned ?? null,
    encyclopediaSpoke: trace.encyclopedia?.spoke ?? null,
    blendedQuestion: Boolean(trace.blend?.factClause && trace.blend?.judgmentClause),
    synthesisRequired: trace.synthesisRequired,
    evidenceSources: trace.evidenceSources,
  });

  if (!isClaireRepair2Enabled("a_routing_telemetry", trace.tenantId)) return;
  if (!trace.path) return;

  void appendClaireAnswerPathLog({
    tenantId: trace.tenantId,
    operatorUserId: trace.operatorUserId,
    answerPath: trace.path,
    businessReader: trace.businessReader,
    rendererProse: trace.rendererProse,
    surface: trace.surface,
    turnKind: trace.turnKind,
    modelRequested: trace.modelRequested,
    modelServed: trace.modelServed,
    promptChars,
    fallbackReason: trace.fallbackReason,
    spokenText: outcome.spokenText,
    detail: claireTurnTraceDetail(trace),
  }).catch(error => {
    console.warn("[Claire] answer-path telemetry persistence failed", {
      answerPath: trace.path,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}
