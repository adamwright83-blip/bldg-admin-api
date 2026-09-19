import type { RecordEvidenceInput } from "./service";

/**
 * Business progress derived from canonical persisted paid-order truth
 * (cleancloud_paid_orders, which is the CleanCloud-imported paid-order history
 * feeding unified customer truth). No orders are duplicated, no revenue is
 * fabricated, and no parallel economic ledger exists: this only READS rows and
 * emits at most one evidence record per qualifying order.
 *
 *   occurredAt   = the order's paid date (when the business event happened)
 *   recognizedAt = when Goldline imported the row (when it first learned of it)
 */

export type PaidOrderRow = {
  orderId: string;
  customerKey: string;
  buildingSlug: string | null;
  paidAt: Date;
  /** When Goldline first held this row (createdAt of the import). */
  recognizedAt: Date;
};

export type PaidOrderProgressOptions = {
  /** Orders imported long after they were paid are historical backfill, never fresh progress. */
  maxRecognitionLagDays: number;
  /** A gap this long between paid orders makes the next one a dormant-customer return. */
  dormantAfterDays: number;
  /** Building slugs the operator is actively targeting; a first paid order there is a strong result. */
  targetBuildingSlugs: readonly string[];
};

export const PAID_ORDER_PROGRESS_DEFAULTS: PaidOrderProgressOptions = {
  maxRecognitionLagDays: 14,
  dormantAfterDays: 90,
  targetBuildingSlugs: [],
};

const DAY = 86_400_000;

export type DerivedProgress = Pick<RecordEvidenceInput, "category" | "kind" | "sourceType" | "sourceId" | "provenance" | "occurredAt" | "recognizedAt">;

export function derivePaidOrderProgress(
  rows: readonly PaidOrderRow[],
  options: Partial<PaidOrderProgressOptions> = {}
): DerivedProgress[] {
  const opts = { ...PAID_ORDER_PROGRESS_DEFAULTS, ...options };
  const byCustomer = new Map<string, PaidOrderRow[]>();
  for (const row of rows) {
    byCustomer.set(row.customerKey, [...(byCustomer.get(row.customerKey) ?? []), row]);
  }
  const out: DerivedProgress[] = [];
  const targets = new Set(opts.targetBuildingSlugs);
  for (const orders of byCustomer.values()) {
    orders.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
    orders.forEach((order, index) => {
      const lagDays = (order.recognizedAt.getTime() - order.paidAt.getTime()) / DAY;
      if (lagDays > opts.maxRecognitionLagDays) return; // historical backfill: not fresh business movement
      if (lagDays < 0) return; // impossible timestamp: refuse rather than guess
      const previous = index > 0 ? orders[index - 1] : null;
      let kind: string | null = null;
      if (!previous) {
        kind =
          order.buildingSlug && targets.has(order.buildingSlug)
            ? "first_paid_order_target_building"
            : "new_paying_customer";
      } else if ((order.paidAt.getTime() - previous.paidAt.getTime()) / DAY >= opts.dormantAfterDays) {
        kind = "dormant_customer_reorder";
      }
      if (!kind) return;
      out.push({
        category: "business_progress",
        kind,
        sourceType: "cleancloud_paid_order",
        sourceId: order.orderId,
        provenance: "cleancloud_import",
        occurredAt: order.paidAt,
        recognizedAt: order.recognizedAt,
      });
    });
  }
  return out;
}
