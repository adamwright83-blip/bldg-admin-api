import type { PersonalLedgerEntry } from "./store";

/**
 * Admin/debug telemetry over approved-decline fallbacks. A high fallback rate
 * while valid canon was eligible is a DEFECT signal, not normal behavior.
 */

/** Policy declines are expected; these failure causes mean an eligible reveal was lost. */
export const GENERATION_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "generation_failed",
  "ungrounded_specificity",
  "ineligible_canon_leak",
  "ungrounded_number",
  "empty_answer",
  "reservation_failed",
]);

export type FallbackBucket = { asked: number; fallbacks: number; rate: number };
export type DeclineTelemetry = {
  totalAsked: number;
  totalFallbacks: number;
  overallRate: number;
  byRung: Record<string, FallbackBucket>;
  byTopic: Record<string, FallbackBucket>;
  byFailureCause: Record<string, number>;
  /** Fallbacks where a valid fragment was eligible AND an entitlement was unused: the defect signal. */
  eligibleButLost: number;
  eligibleButLostRate: number;
  recent: Array<Pick<PersonalLedgerEntry, "operatorUserId" | "conversationId" | "rapportBandAtTime" | "rungAtTime" | "topic" | "fragmentId" | "failureReason" | "declineId" | "hadUnusedEntitlement" | "failurePhase" | "occurredAt">>;
};

const bucket = (): FallbackBucket => ({ asked: 0, fallbacks: 0, rate: 0 });

export function summarizeDeclineTelemetry(rows: readonly PersonalLedgerEntry[]): DeclineTelemetry {
  const byRung: Record<string, FallbackBucket> = {};
  const byTopic: Record<string, FallbackBucket> = {};
  const byFailureCause: Record<string, number> = {};
  let totalAsked = 0;
  let totalFallbacks = 0;
  let eligibleButLost = 0;
  const recent: DeclineTelemetry["recent"] = [];

  for (const row of rows) {
    const rungKey = `rung_${row.rungAtTime}`;
    const topicKey = row.topic ?? "unknown";
    if (row.kind === "asked") {
      totalAsked += 1;
      (byRung[rungKey] ??= bucket()).asked += 1;
      (byTopic[topicKey] ??= bucket()).asked += 1;
    } else if (row.kind === "decline_fallback") {
      totalFallbacks += 1;
      (byRung[rungKey] ??= bucket()).fallbacks += 1;
      (byTopic[topicKey] ??= bucket()).fallbacks += 1;
      const cause = row.failureReason ?? "unspecified";
      byFailureCause[cause] = (byFailureCause[cause] ?? 0) + 1;
      if (row.fragmentId && row.hadUnusedEntitlement && GENERATION_FAILURE_REASONS.has(cause)) eligibleButLost += 1;
      recent.push({
        operatorUserId: row.operatorUserId, conversationId: row.conversationId, rapportBandAtTime: row.rapportBandAtTime,
        rungAtTime: row.rungAtTime, topic: row.topic, fragmentId: row.fragmentId, failureReason: row.failureReason,
        declineId: row.declineId, hadUnusedEntitlement: row.hadUnusedEntitlement, failurePhase: row.failurePhase, occurredAt: row.occurredAt,
      });
    }
  }
  for (const b of [...Object.values(byRung), ...Object.values(byTopic)]) b.rate = b.asked ? b.fallbacks / b.asked : 0;
  return {
    totalAsked, totalFallbacks,
    overallRate: totalAsked ? totalFallbacks / totalAsked : 0,
    byRung, byTopic, byFailureCause, eligibleButLost,
    eligibleButLostRate: totalFallbacks ? eligibleButLost / totalFallbacks : 0,
    recent: recent.slice(-50),
  };
}
