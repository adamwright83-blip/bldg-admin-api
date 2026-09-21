import type { NarratorSnapshot } from "./store";
import {
  isGoldlineTargetRef,
  isVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";

/**
 * M03 After No. ARMED is per-target readiness derived from trusted evidence.
 * It is not a beat id, not FIRED_AUTHORED_BEAT, not gold, and not a new-user seed.
 *
 * GOLDLINE_CANON.md: a spoken no is terminal unless that person later reopens
 * contact. Silence / authored no-show may support an appropriately timed return.
 * Occurrence identity is the evidence cycle, not a permanent per-target consume.
 */
export const M03_BEAT_ID = "M03";

export const M03_SPOKEN_NO_OUTCOME_ID = "spoken_no";
export const M03_REOPEN_OUTCOME_ID = "contact_reopened_after_no";

export const M03_RETRY_ARM_OUTCOME_IDS = [
  "silence_eligible_for_retry",
  "no_show",
] as const;

export const M03_RETURN_OUTCOME_IDS = [
  "legitimate_second_site_visit",
  "timed_retry_after_silence",
  "reinspect_previously_deployed_item",
] as const;

export const M03_OCCURRENCE_PREFIX = "beat:M03:target:";
const M03_OCCURRENCE_ARM_MARK = ":arm:";

export type M03QualifyingCycle = {
  readonly targetId: string;
  readonly armReceiptId: string;
  readonly returnReceiptId: string;
  readonly armOccurredAtMs: number;
  readonly returnOccurredAtMs: number;
};

export type TemporalSameTargetPair = {
  readonly targetId: string;
  readonly prior: VerifiedGoldlineReceipt;
  readonly subsequent: VerifiedGoldlineReceipt;
};

export function m03OccurrenceIdempotencyKey(
  targetId: string,
  armReceiptId: string
): string {
  return `${M03_OCCURRENCE_PREFIX}${targetId}${M03_OCCURRENCE_ARM_MARK}${armReceiptId}`;
}

export function parseM03OccurrenceKey(
  idempotencyKey: string
): { targetId: string; armReceiptId: string } | null {
  if (!idempotencyKey.startsWith(M03_OCCURRENCE_PREFIX)) return null;
  const rest = idempotencyKey.slice(M03_OCCURRENCE_PREFIX.length);
  const markAt = rest.indexOf(M03_OCCURRENCE_ARM_MARK);
  if (markAt <= 0) return null;
  const targetId = rest.slice(0, markAt);
  const armReceiptId = rest.slice(markAt + M03_OCCURRENCE_ARM_MARK.length);
  if (!targetId || !armReceiptId) return null;
  return { targetId, armReceiptId };
}

function scopedReceipt(
  receipt: VerifiedGoldlineReceipt,
  snapshot: NarratorSnapshot
): boolean {
  return (
    isVerifiedGoldlineReceipt(receipt) &&
    receipt.tenantId === snapshot.tenantId &&
    receipt.operatorUserId === snapshot.operatorUserId
  );
}

function opaqueTargetId(receipt: VerifiedGoldlineReceipt): string | null {
  if (!isGoldlineTargetRef(receipt.targetRef)) return null;
  return receipt.targetRef.id;
}

function outcomeSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}

/**
 * Trusted same-target sequence: prior outcome on T occurred before subsequent
 * outcome on T. Ordering comes only from receipt.occurredAtMs.
 */
export function temporalSameTargetPairs(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot,
  priorOutcomeIds: readonly string[],
  subsequentOutcomeIds: readonly string[]
): readonly TemporalSameTargetPair[] {
  const priorIds = outcomeSet(priorOutcomeIds);
  const subsequentIds = outcomeSet(subsequentOutcomeIds);
  const scoped = receipts.filter(receipt => scopedReceipt(receipt, snapshot));
  const pairs: TemporalSameTargetPair[] = [];
  for (const prior of scoped) {
    const targetId = opaqueTargetId(prior);
    if (!targetId || !priorIds.has(prior.outcomeId)) continue;
    for (const subsequent of scoped) {
      if (!subsequentIds.has(subsequent.outcomeId)) continue;
      if (opaqueTargetId(subsequent) !== targetId) continue;
      if (!(prior.occurredAtMs < subsequent.occurredAtMs)) continue;
      pairs.push({ targetId, prior, subsequent });
    }
  }
  return pairs;
}

export function hasTemporalSameTargetSequence(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot,
  priorOutcomeIds: readonly string[],
  subsequentOutcomeIds: readonly string[]
): boolean {
  return (
    temporalSameTargetPairs(
      receipts,
      snapshot,
      priorOutcomeIds,
      subsequentOutcomeIds
    ).length > 0
  );
}

type M03TargetReplay = {
  readonly targetId: string;
  readonly currentlyArmed: boolean;
  readonly cycles: readonly M03QualifyingCycle[];
};

function compareByOccurredAtMs(
  a: VerifiedGoldlineReceipt,
  b: VerifiedGoldlineReceipt
): number {
  if (a.occurredAtMs !== b.occurredAtMs) {
    return a.occurredAtMs - b.occurredAtMs;
  }
  return a.receiptId.localeCompare(b.receiptId);
}

/**
 * Smallest per-target M03 event-sequence evaluator.
 *
 * Temporal state, not historical-pair search:
 * - eligible silence / no-show → live retry readiness
 * - spoken no → terminal; clears prior retry readiness
 * - trusted reopen after the latest spoken no → live retry readiness again
 * - RETURN while readiness is live → qualifying cycle
 * - a fired M03 occurrence consumes that arm/reopen receipt
 *
 * Chronology is receipt.occurredAtMs only. Array order is not evidence.
 */
function replayM03Targets(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly M03TargetReplay[] {
  const consumed = consumedM03ArmReceiptIds(snapshot);
  const retryArm = outcomeSet(M03_RETRY_ARM_OUTCOME_IDS);
  const returns = outcomeSet(M03_RETURN_OUTCOME_IDS);
  const byTarget = new Map<string, VerifiedGoldlineReceipt[]>();
  for (const receipt of receipts) {
    if (!scopedReceipt(receipt, snapshot)) continue;
    const targetId = opaqueTargetId(receipt);
    if (!targetId) continue;
    const list = byTarget.get(targetId);
    if (list) list.push(receipt);
    else byTarget.set(targetId, [receipt]);
  }

  const replays: M03TargetReplay[] = [];
  for (const [targetId, list] of byTarget) {
    const events = [...list].sort(compareByOccurredAtMs);
    let liveArm: VerifiedGoldlineReceipt | null = null;
    let lastSpokenNoMs: number | null = null;
    const cycles: M03QualifyingCycle[] = [];
    const seen = new Set<string>();

    for (const event of events) {
      if (event.outcomeId === M03_SPOKEN_NO_OUTCOME_ID) {
        lastSpokenNoMs = event.occurredAtMs;
        liveArm = null;
        continue;
      }
      if (retryArm.has(event.outcomeId)) {
        liveArm = event;
        continue;
      }
      if (event.outcomeId === M03_REOPEN_OUTCOME_ID) {
        if (lastSpokenNoMs !== null && lastSpokenNoMs < event.occurredAtMs) {
          liveArm = event;
        }
        continue;
      }
      if (!returns.has(event.outcomeId) || !liveArm) continue;
      if (!(liveArm.occurredAtMs < event.occurredAtMs)) continue;
      const key = m03OccurrenceIdempotencyKey(targetId, liveArm.receiptId);
      if (seen.has(key)) continue;
      seen.add(key);
      cycles.push({
        targetId,
        armReceiptId: liveArm.receiptId,
        returnReceiptId: event.receiptId,
        armOccurredAtMs: liveArm.occurredAtMs,
        returnOccurredAtMs: event.occurredAtMs,
      });
    }

    replays.push({
      targetId,
      currentlyArmed: Boolean(liveArm && !consumed.has(liveArm.receiptId)),
      cycles,
    });
  }
  return replays;
}

/**
 * Targets that currently have live, unconsumed M03 retry readiness.
 *
 * - silence_eligible_for_retry / authored eligible no_show → ARMED
 * - spoken_no alone → NOT ARMED (terminal; clears prior readiness)
 * - spoken_no then a later trusted same-target contact_reopened_after_no → ARMED
 * - a newer spoken_no clears that readiness until a later reopen
 * - a fired M03 occurrence consumes that arm/reopen cycle; it is not ARMED
 *
 * Chronology is receipt.occurredAtMs only. Array order, receiptId lexical
 * order, free-form sourceReference, and caller ordering are not evidence.
 */
export function derivedM03ArmedTargetIds(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly string[] {
  return replayM03Targets(receipts, snapshot)
    .filter(replay => replay.currentlyArmed)
    .map(replay => replay.targetId)
    .sort();
}

export function consumedM03ArmReceiptIds(
  snapshot: NarratorSnapshot
): Set<string> {
  const consumed = new Set<string>();
  for (const entry of snapshot.ledger) {
    if (entry.kind !== "FIRED_AUTHORED_BEAT") continue;
    if (entry.beatId !== M03_BEAT_ID) continue;
    const parsed = parseM03OccurrenceKey(entry.idempotencyKey);
    if (parsed) consumed.add(parsed.armReceiptId);
  }
  return consumed;
}

function sortCycles(cycles: M03QualifyingCycle[]): M03QualifyingCycle[] {
  return [...cycles].sort((a, b) => {
    if (a.armOccurredAtMs !== b.armOccurredAtMs) {
      return a.armOccurredAtMs - b.armOccurredAtMs;
    }
    if (a.returnOccurredAtMs !== b.returnOccurredAtMs) {
      return a.returnOccurredAtMs - b.returnOccurredAtMs;
    }
    if (a.armReceiptId !== b.armReceiptId) {
      return a.armReceiptId.localeCompare(b.armReceiptId);
    }
    return a.targetId.localeCompare(b.targetId);
  });
}

/**
 * M03-legal cycles from live temporal state:
 * RETURN qualifies only if the applicable silence/no-show/reopen is still
 * live at RETURN time. An intervening later spoken_no closes that readiness.
 */
export function m03QualifyingCycles(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly M03QualifyingCycle[] {
  return sortCycles(
    replayM03Targets(receipts, snapshot).flatMap(replay => replay.cycles)
  );
}

export function unconsumedM03QualifyingCycles(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly M03QualifyingCycle[] {
  const consumed = consumedM03ArmReceiptIds(snapshot);
  return m03QualifyingCycles(receipts, snapshot).filter(
    cycle => !consumed.has(cycle.armReceiptId)
  );
}

export function unconsumedM03FireTargetIds(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly string[] {
  return [
    ...new Set(
      unconsumedM03QualifyingCycles(receipts, snapshot).map(
        cycle => cycle.targetId
      )
    ),
  ].sort();
}

export function nextM03OccurrenceIdempotencyKey(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): string | null {
  const cycle = unconsumedM03QualifyingCycles(receipts, snapshot)[0];
  return cycle
    ? m03OccurrenceIdempotencyKey(cycle.targetId, cycle.armReceiptId)
    : null;
}
