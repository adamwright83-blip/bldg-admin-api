/**
 * Stronghold restoration — the persistent world payoff (§36/§37/§39).
 *
 * SOURCE OF TRUTH. The canonical business fact is the order's status
 * transition to `collected`, performed by `attemptOrderPickupCollection`
 * (server/db.ts). The `operations_events` audit row written afterward by
 * the router is NOT part of that same transaction — the conditional UPDATE
 * commits first, and the event is ensured second. A crash, a rollback of
 * the event write, or a backfill gap between those two steps leaves a
 * genuinely collected order with no audit event.
 *
 * So this projection treats collected-order state as PRIMARY and audit
 * events as SUPPORTING, and unions them by order id. A real collected
 * order restores the Stronghold whether or not its event exists. The
 * reverse — an event with no collected order — is treated as audit noise
 * and never restores anything, because the order is the truth.
 *
 * No new table. No new ledger. No migration. This is a pure read over
 * authoritative data the client already receives.
 *
 * "Mark of the Line" is presentation derived from this evidence. It is not
 * a currency, it is not stored, and it cannot be spent.
 */

/** Minimal shape of an authoritative order row. */
export type CollectedEvidenceOrder = {
  readonly id: number;
  readonly status: string;
};

/** Minimal shape of a supporting audit row. */
export type PickupAuditEvent = {
  readonly orderId: number | null;
  readonly sourceEventType: string;
};

/**
 * Statuses that prove the pickup genuinely happened. `collected` is the
 * transition itself; the later stages are downstream of it and cannot be
 * reached without it, so an order already in processing/ready/delivered is
 * still proof that a real collection occurred.
 */
const COLLECTED_OR_BEYOND = new Set([
  "collected",
  "processing",
  "ready",
  "delivered",
]);

export function isCollectedTruth(order: CollectedEvidenceOrder): boolean {
  return COLLECTED_OR_BEYOND.has(order.status);
}

export type StrongholdRestorationInput = {
  /** PRIMARY truth: authoritative order rows. */
  readonly orders: readonly CollectedEvidenceOrder[];
  /** SUPPORTING evidence only. Never sufficient on its own. */
  readonly auditEvents?: readonly PickupAuditEvent[];
  /**
   * The order this expedition is bound to. Drives the honest BEFORE/AFTER
   * delta: this is false before the canonical mutation and true after it,
   * regardless of how much history already exists.
   */
  readonly expeditionOrderId?: number | null;
};

export type StrongholdRestoration = {
  /** Distinct orders with genuine collected truth. */
  readonly restoredCount: number;
  /** 0..1 restoration of the dormant Line conduit. */
  readonly conduitCharge: number;
  /** Lantern segments lit along the Stronghold threshold. */
  readonly lanternsLit: number;
  /** True only once this expedition's own order is genuinely collected. */
  readonly expeditionOrderCollected: boolean;
  /** Mark of the Line — presentation, derived, never stored. */
  readonly marksPresented: number;
  /**
   * Orders proven collected with no supporting audit event. Surfaced so a
   * genuine gap is visible rather than silently changing the payoff.
   */
  readonly collectedWithoutAuditEvent: number;
};

export const STRONGHOLD_LANTERN_COUNT = 6;

/**
 * Restoration curve. Deliberately shallow so the FIRST genuine collection
 * produces an unmistakable visible change (§36's "one obvious physical
 * state changes"), while long real histories still read as more restored.
 */
export function projectStrongholdRestoration(
  input: StrongholdRestorationInput
): StrongholdRestoration {
  const collectedIds = new Set<number>();
  for (const order of input.orders) {
    if (isCollectedTruth(order)) collectedIds.add(order.id);
  }

  // Audit events corroborate but never create truth. An event whose order
  // is not collected is ignored entirely.
  const auditedIds = new Set<number>();
  for (const event of input.auditEvents ?? []) {
    if (event.sourceEventType !== "pickup_completed") continue;
    if (event.orderId == null) continue;
    if (collectedIds.has(event.orderId)) auditedIds.add(event.orderId);
  }

  const restoredCount = collectedIds.size;
  const conduitCharge = Math.min(1, restoredCount / STRONGHOLD_LANTERN_COUNT);

  return {
    restoredCount,
    conduitCharge,
    lanternsLit: Math.min(STRONGHOLD_LANTERN_COUNT, restoredCount),
    expeditionOrderCollected:
      input.expeditionOrderId != null && collectedIds.has(input.expeditionOrderId),
    marksPresented: restoredCount,
    collectedWithoutAuditEvent: restoredCount - auditedIds.size,
  };
}

/**
 * The visible delta between two restoration readings. The fixture proves
 * the payoff with THIS, not with a global `restoredCount > 0` boolean that
 * could already have been true before the test acted.
 */
export type RestorationDelta = {
  readonly lanternsGained: number;
  readonly conduitGained: number;
  readonly expeditionOrderNewlyCollected: boolean;
  readonly changed: boolean;
};

export function restorationDelta(
  before: StrongholdRestoration,
  after: StrongholdRestoration
): RestorationDelta {
  const lanternsGained = after.lanternsLit - before.lanternsLit;
  const conduitGained = after.conduitCharge - before.conduitCharge;
  const expeditionOrderNewlyCollected =
    !before.expeditionOrderCollected && after.expeditionOrderCollected;
  return {
    lanternsGained,
    conduitGained,
    expeditionOrderNewlyCollected,
    changed:
      lanternsGained > 0 || conduitGained > 0 || expeditionOrderNewlyCollected,
  };
}
