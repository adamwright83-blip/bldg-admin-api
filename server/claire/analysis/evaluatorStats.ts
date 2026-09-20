/**
 * Post-call evaluator accounting. QA/monitoring only: nothing on the live Claire path reads
 * this, and an evaluator failure never affects a live response. A failed evaluation is a
 * failed evaluation — never "the conversation passed".
 *
 * Counters are process-local (reset on deploy) and every failure is also emitted as a
 * structured log line, which is the durable record. Per-session failure is additionally
 * persisted by the caller as `analysisStatus: "failed"`.
 */
import type { EvaluatorFailureCategory } from "./conversationEvaluator";

export type EvaluatorFailureReason = EvaluatorFailureCategory | "unclassified";

type Stats = { attempts: number; successes: number; failures: number; byReason: Record<string, number>; lastFailureAt: string | null; lastFailureReason: string | null };

const stats: Stats = { attempts: 0, successes: 0, failures: 0, byReason: {}, lastFailureAt: null, lastFailureReason: null };

export function recordEvaluatorAttempt(): void {
  stats.attempts += 1;
}

export function recordEvaluatorSuccess(): void {
  stats.successes += 1;
}

export function recordEvaluatorFailure(sessionId: string, reason: EvaluatorFailureReason, detail: string): void {
  stats.failures += 1;
  stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
  stats.lastFailureAt = new Date().toISOString();
  stats.lastFailureReason = reason;
  console.error("[ClaireAnalysis] evaluator failed", { event: "claire_evaluator_failure", sessionId, reason, detail, ...evaluatorStats() });
}

export function evaluatorStats() {
  const { attempts, successes, failures } = stats;
  return {
    attempts,
    successes,
    failures,
    failureRate: attempts ? failures / attempts : 0,
    byReason: { ...stats.byReason },
    lastFailureAt: stats.lastFailureAt,
    lastFailureReason: stats.lastFailureReason,
  };
}

/** Tests only. */
export function resetEvaluatorStatsForTests(): void {
  stats.attempts = 0;
  stats.successes = 0;
  stats.failures = 0;
  stats.byReason = {};
  stats.lastFailureAt = null;
  stats.lastFailureReason = null;
}
