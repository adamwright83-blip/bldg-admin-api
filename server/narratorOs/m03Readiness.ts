import type { NarratorSnapshot } from "./store";
import {
  isGoldlineTargetRef,
  isVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";

/**
 * M03 After No. ARMED is per-target readiness derived from trusted evidence.
 * It is not a beat id, not FIRED_AUTHORED_BEAT, not gold, and not a new-user seed.
 */
export const M03_BEAT_ID = "M03";

export const M03_ARM_OUTCOME_IDS = [
  "spoken_no",
  "silence_eligible_for_retry",
  "no_show",
] as const;

export const M03_RETURN_OUTCOME_IDS = [
  "legitimate_second_site_visit",
  "timed_retry_after_silence",
  "reinspect_previously_deployed_item",
] as const;

export const M03_OCCURRENCE_PREFIX = "beat:M03:target:";

export function m03OccurrenceIdempotencyKey(targetId: string): string {
  return `${M03_OCCURRENCE_PREFIX}${targetId}`;
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
 * Targets that have a trusted no / eligible silence / authored no-show.
 * Derived. Does not write ledger or narrative state.
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

export function consumedM03TargetIds(snapshot: NarratorSnapshot): Set<string> {
  const consumed = new Set<string>();
  for (const entry of snapshot.ledger) {
    if (entry.kind !== "FIRED_AUTHORED_BEAT") continue;
    if (entry.beatId !== M03_BEAT_ID) continue;
    if (!entry.idempotencyKey.startsWith(M03_OCCURRENCE_PREFIX)) continue;
    const targetId = entry.idempotencyKey.slice(M03_OCCURRENCE_PREFIX.length);
    if (targetId) consumed.add(targetId);
  }
  return consumed;
}

/**
 * Targets that are ARMED and have a verified M03-family RETURN on the same
 * opaque target, and have not already produced a FIRED M03 occurrence.
 */
export function unconsumedM03FireTargetIds(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): readonly string[] {
  const arm = outcomeSet(M03_ARM_OUTCOME_IDS);
  const ret = outcomeSet(M03_RETURN_OUTCOME_IDS);
  const armed = new Set<string>();
  const returned = new Set<string>();
  for (const receipt of receipts) {
    if (!scopedReceipt(receipt, snapshot)) continue;
    const targetId = opaqueTargetId(receipt);
    if (!targetId) continue;
    if (arm.has(receipt.outcomeId)) armed.add(targetId);
    if (ret.has(receipt.outcomeId)) returned.add(targetId);
  }
  const consumed = consumedM03TargetIds(snapshot);
  return [...armed].filter(id => returned.has(id) && !consumed.has(id)).sort();
}

export function nextM03OccurrenceIdempotencyKey(
  receipts: readonly VerifiedGoldlineReceipt[],
  snapshot: NarratorSnapshot
): string | null {
  const targets = unconsumedM03FireTargetIds(receipts, snapshot);
  const targetId = targets[0];
  return targetId ? m03OccurrenceIdempotencyKey(targetId) : null;
}
