/**
 * Laundry Butler — **first vendor receipt line mapper** (reference implementation).
 *
 * Converts LB order intake (`upchargesJson`, `drycleanItemsJson`, weight, minimum rules)
 * into display lines. Output shape matches **`BldgReceiptLine`** when mapped into
 * **`BldgReceiptViewModel`** in the **resident** app.
 *
 * This is **not** a system-wide or multi-vendor mapper registry — only LB rules.
 * Other vendors get their own mappers in the resident **mapper registry**.
 */
import { WF_RATE_PER_LB_CENTS } from "./pricing";

export type ReceiptLine = {
  item: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

type UpchargeLike = {
  label: string;
  unit_price_cents: number;
  qty: number;
  total_cents: number;
};

type DryCleanLike = {
  label: string;
  unit_price_cents: number;
  qty: number;
  total_cents: number;
};

function fmtMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

function fmtUnit(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * LB-only: line items that sum to pre-discount subtotal (matches `order.subtotal` after intake).
 */
export function buildReceiptLines(order: {
  serviceType: "wash_fold" | "dry_cleaning";
  weightLbs: string | null;
  upchargesJson: unknown;
  drycleanItemsJson: unknown;
  subtotal: string | null;
}): ReceiptLine[] {
  const lines: ReceiptLine[] = [];

  if (order.serviceType === "dry_cleaning") {
    const raw = order.drycleanItemsJson;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const v of Object.values(raw as Record<string, DryCleanLike>)) {
        if (!v?.label || typeof v.qty !== "number") continue;
        lines.push({
          item: v.label,
          quantity: String(v.qty),
          unitPrice: fmtUnit(v.unit_price_cents),
          amount: fmtMoney(v.total_cents),
        });
      }
    }
    return lines;
  }

  /* wash_fold */
  const w = order.weightLbs ? parseFloat(String(order.weightLbs)) : 0;
  const upcharges = order.upchargesJson;
  let runningCents = 0;

  if (w > 0) {
    const baseCents = Math.round(w * WF_RATE_PER_LB_CENTS);
    runningCents += baseCents;
    lines.push({
      item: "Wash & Fold",
      quantity: w % 1 === 0 ? String(w) : w.toFixed(2),
      unitPrice: fmtUnit(WF_RATE_PER_LB_CENTS),
      amount: fmtMoney(baseCents),
    });
  }

  if (upcharges && typeof upcharges === "object" && !Array.isArray(upcharges)) {
    for (const v of Object.values(upcharges as Record<string, UpchargeLike>)) {
      if (!v?.label || typeof v.qty !== "number") continue;
      runningCents += v.total_cents;
      const unit =
        v.qty > 0 ? Math.round(v.total_cents / v.qty) : v.unit_price_cents;
      lines.push({
        item: v.label,
        quantity: String(v.qty),
        unitPrice: fmtUnit(unit),
        amount: fmtMoney(v.total_cents),
      });
    }
  }

  const subtotalCents = Math.round(parseFloat(order.subtotal || "0") * 100);
  if (subtotalCents > runningCents && lines.length > 0) {
    lines.push({
      item: "Order minimum / adjustment",
      quantity: "1",
      unitPrice: fmtMoney(subtotalCents - runningCents),
      amount: fmtMoney(subtotalCents - runningCents),
    });
  } else if (subtotalCents > 0 && lines.length === 0) {
    lines.push({
      item: "Wash & Fold",
      quantity: "1",
      unitPrice: fmtMoney(subtotalCents),
      amount: fmtMoney(subtotalCents),
    });
  }

  return lines;
}
