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

export const M03_ARM_OUTCOME_IDS = [
  M03_SPOKEN_NO_OUTCOME_ID,
  ...M03_RETRY_ARM_OUTCOME_IDS,
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

/**
 * Targets that have a trusted no / eligible silence / authored no-show.
 * Derived readiness only. Spoken no remains terminal for RETURN until reopen.
 */
export function derivedM03ArmedTargetIds(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly string[] {
  const arm = outcomeSet(M03_ARM_OUTCOME_IDS);
  const ids = new Set<string>();
  for (const receipt of receipts) {
    if (!scopedReceipt(receipt, snapshot)) continue;
    if (!arm.has(receipt.outcomeId)) continue;
    const targetId = opaqueTargetId(receipt);
    if (targetId) ids.add(targetId);
  }
  return [...ids].sort();
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
 * M03-legal cycles:
 * - silence / no-show then a later same-target RETURN
 * - spoken_no then a later same-target reopen then a later RETURN
 * Spoken no + RETURN without reopen does not qualify.
 */
export function m03QualifyingCycles(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly M03QualifyingCycle[] {
  const scoped = receipts.filter(receipt => scopedReceipt(receipt, snapshot));
  const retryArm = outcomeSet(M03_RETRY_ARM_OUTCOME_IDS);
  const returns = outcomeSet(M03_RETURN_OUTCOME_IDS);
  const cycles: M03QualifyingCycle[] = [];
  const seen = new Set<string>();

  const push = (cycle: M03QualifyingCycle) => {
    const key = m03OccurrenceIdempotencyKey(cycle.targetId, cycle.armReceiptId);
    if (seen.has(key)) return;
    seen.add(key);
    cycles.push(cycle);
  };

  for (const arm of scoped) {
    const targetId = opaqueTargetId(arm);
    if (!targetId || !retryArm.has(arm.outcomeId)) continue;
    for (const ret of scoped) {
      if (!returns.has(ret.outcomeId)) continue;
      if (opaqueTargetId(ret) !== targetId) continue;
      if (!(arm.occurredAtMs < ret.occurredAtMs)) continue;
      push({
        targetId,
        armReceiptId: arm.receiptId,
        returnReceiptId: ret.receiptId,
        armOccurredAtMs: arm.occurredAtMs,
        returnOccurredAtMs: ret.occurredAtMs,
      });
    }
  }

  for (const spokenNo of scoped) {
    if (spokenNo.outcomeId !== M03_SPOKEN_NO_OUTCOME_ID) continue;
    const targetId = opaqueTargetId(spokenNo);
    if (!targetId) continue;
    for (const reopen of scoped) {
      if (reopen.outcomeId !== M03_REOPEN_OUTCOME_ID) continue;
      if (opaqueTargetId(reopen) !== targetId) continue;
      if (!(spokenNo.occurredAtMs < reopen.occurredAtMs)) continue;
      for (const ret of scoped) {
        if (!returns.has(ret.outcomeId)) continue;
        if (opaqueTargetId(ret) !== targetId) continue;
        if (!(reopen.occurredAtMs < ret.occurredAtMs)) continue;
        push({
          targetId,
          armReceiptId: reopen.receiptId,
          returnReceiptId: ret.receiptId,
          armOccurredAtMs: reopen.occurredAtMs,
          returnOccurredAtMs: ret.occurredAtMs,
        });
      }
    }
  }

  return sortCycles(cycles);
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
