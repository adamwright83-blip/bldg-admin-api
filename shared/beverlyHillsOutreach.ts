import { z } from "zod";
/** A single creative across every building. Never contains a building-specific tracking code. */
export const BEVERLY_HANGER_ID = "laundry-farm-standard-hanger-v1";
export const outreachSubmission = z.object({
  requestId: z.string().uuid(),
  prospectId: z.string().min(1).max(191),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  permission: z.string().trim().min(12).max(1000),
  count: z.number().int().min(1).max(2000),
  evidenceUrl: z
    .url()
    .refine(v => v.startsWith("https://"), "Use an HTTPS evidence link"),
  notes: z.string().trim().min(12).max(2000),
});
export type OutreachSubmission = z.infer<typeof outreachSubmission>;
export type OutreachRecord = {
  id: string;
  prospectId: string;
  address: string;
  performedOn: string;
  count: number;
  permission: string;
  evidenceUrl: string;
  notes: string;
  operatorId: string;
  status: "submitted" | "verified" | "rejected";
  reviewerId: string | null;
  reviewNote: string | null;
};
export function apartmentProspect(p: {
  kind: string | null;
  address: string | null;
}): boolean {
  return Boolean(
    p.address &&
      /apartment|multifamily|residential|property.management/i.test(
        p.kind ?? ""
      )
  );
}
export function addressKey(value: string) {
  return value.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
}
export function restoredPlots(
  records: Pick<OutreachRecord, "id" | "status">[]
) {
  return Math.min(
    6,
    new Set(records.filter(r => r.status === "verified").map(r => r.id)).size
  );
}
export function validateReview(
  record: Pick<OutreachRecord, "operatorId" | "status">,
  reviewer: string
) {
  if (record.status !== "submitted")
    throw new Error("This report has already been reviewed.");
  if (record.operatorId === reviewer)
    throw new Error(
      "A different administrator must review the supporting evidence."
    );
}

/**
 * The ranch grows from the business, not from paperwork: one plot for each recorded drop (not rejected) whose building
 * has a non-cancelled order with a pickup on or after the drop date. Matched on the exact recorded address. This is
 * "a customer ordered after your visit", never "your hanger caused it".
 */
export function plotsFromOrders(
  records: Pick<OutreachRecord, "id" | "address" | "performedOn" | "status">[],
  orders: { address: string; pickupDate: string }[]
): number {
  const byAddress = new Map<string, string[]>();
  for (const o of orders) {
    const k = addressKey(o.address);
    const list = byAddress.get(k) ?? [];
    list.push(o.pickupDate);
    byAddress.set(k, list);
  }
  let n = 0;
  for (const r of records) {
    if (r.status === "rejected") continue;
    const dates = byAddress.get(addressKey(r.address)) ?? [];
    if (dates.some(d => d.slice(0, 10) >= r.performedOn)) n++;
  }
  return Math.min(6, n);
}
