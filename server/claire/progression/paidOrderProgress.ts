import type { CustomerOrderTruthRecord } from "../../geography/customerOrderTruth";
import { PROGRESSION_POLICY } from "./policy";
import type { RecordEvidenceInput } from "./service";

/**
 * Business progress derived from the CANONICAL customer/order truth (PR #175's
 * `customerOrderTruth` + `customerIdentity`), not from any raw table:
 *
 *  - native Laundry Butler orders AND CleanCloud paid orders, already merged;
 *  - CleanCloud's two report representations of one order already deduplicated
 *    (`preferCleanCloudOrders`);
 *  - customers are the canonical identity groups (phone/email/bldg user/CleanCloud id/verified
 *    address). A customer NAME is never identity evidence: rows the canonical layer could not
 *    identify stay orphans and can never assert "new customer" or "dormant return".
 *
 * No orders are duplicated, no revenue is fabricated, no parallel ledger exists. One underlying
 * order is at most ONE evidence identity (sourceType + sourceId); its kind is the strongest
 * classification that applies.
 *
 *   occurredAt   = when the order occurred (canonical order time)
 *   recognizedAt = native orders: when created; imported orders: when progression first saw them
 */

export type PaidOrderProgressOptions = {
  /** A gap this long between paid orders makes the next one a dormant-customer return. */
  dormantAfterDays: number;
  /** Building slugs the operator is actively targeting. One first-paid-order milestone per building. */
  targetBuildingSlugs: readonly string[];
  /** Only events occurring on/after this instant are emitted (default: the policy's progress epoch). */
  emitFrom: Date;
  /** First-seen time stamped on imported orders. */
  now: Date;
};

const DAY = 86_400_000;

export type DerivedProgress = Pick<RecordEvidenceInput, "category" | "kind" | "sourceType" | "sourceId" | "provenance" | "occurredAt" | "recognizedAt">;

const isPaid = (record: CustomerOrderTruthRecord) => record.paid && !record.cancelled;
const byTime = (a: CustomerOrderTruthRecord, b: CustomerOrderTruthRecord) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id || a.sourceOrderId.localeCompare(b.sourceOrderId);
const orderRef = (record: CustomerOrderTruthRecord) => `${record.source}:${record.sourceOrderId}`;

export function deriveProgressFromOrderTruth(
  groups: ReadonlyMap<string, readonly CustomerOrderTruthRecord[]>,
  options: Partial<PaidOrderProgressOptions> & { now: Date }
): DerivedProgress[] {
  const opts: PaidOrderProgressOptions = {
    dormantAfterDays: 90,
    targetBuildingSlugs: [],
    emitFrom: new Date(PROGRESSION_POLICY.progressEpoch),
    ...options,
  };
  const kindByOrder = new Map<string, { kind: string; record: CustomerOrderTruthRecord }>();
  const consider = (record: CustomerOrderTruthRecord, kind: string) => {
    const strength = ["first_paid_order_target_building", "new_paying_customer", "dormant_customer_reorder"];
    const current = kindByOrder.get(orderRef(record));
    if (!current || strength.indexOf(kind) < strength.indexOf(current.kind)) kindByOrder.set(orderRef(record), { kind, record });
  };

  // One milestone per target building: the earliest paid order there, whoever placed it.
  const targets = new Set(opts.targetBuildingSlugs);
  const allPaid = [...groups.values()].flat().filter(isPaid).sort(byTime);
  const seenBuildings = new Set<string>();
  for (const record of allPaid) {
    if (record.buildingSlug && targets.has(record.buildingSlug) && !seenBuildings.has(record.buildingSlug)) {
      seenBuildings.add(record.buildingSlug);
      consider(record, "first_paid_order_target_building");
    }
  }

  // Customer-based progress only for canonically identified customers.
  for (const [key, records] of groups) {
    if (key.startsWith("unidentified:") || key.startsWith("orphan:")) continue;
    const paid = records.filter(isPaid).sort(byTime);
    paid.forEach((record, index) => {
      const previous = index > 0 ? paid[index - 1] : null;
      if (!previous) consider(record, "new_paying_customer");
      else if ((record.createdAt.getTime() - previous.createdAt.getTime()) / DAY >= opts.dormantAfterDays) {
        consider(record, "dormant_customer_reorder");
      }
    });
  }

  const out: DerivedProgress[] = [];
  for (const { kind, record } of kindByOrder.values()) {
    if (record.createdAt.getTime() < opts.emitFrom.getTime()) continue; // pre-epoch baseline: canonical orders remain the record
    const recognizedAt = record.source === "laundry_butler" ? record.createdAt : opts.now;
    out.push({
      category: "business_progress",
      kind,
      sourceType: "customer_order_truth",
      sourceId: orderRef(record),
      provenance: record.source === "cleancloud" ? "cleancloud_import" : "laundry_butler_order",
      occurredAt: record.createdAt,
      recognizedAt: recognizedAt.getTime() < record.createdAt.getTime() ? record.createdAt : recognizedAt,
    });
  }
  return out.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}
