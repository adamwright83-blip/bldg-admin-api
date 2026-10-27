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
 * The ranch grows from the business, not from paperwork: one plot per visited building (never per report) whose
 * address has a non-cancelled order PLACED on or after the earliest recorded drop there. Matched on the exact
 * recorded address; the order's placement date is its creation date, never its pickup date (a pickup booked for
 * next week can belong to an order placed last month). This is "a customer ordered after your visit", never "your
 * hanger caused it".
 */
export function plotsFromOrders(
  records: Pick<OutreachRecord, "id" | "address" | "performedOn" | "status">[],
  orders: { address: string; placedOn: string }[]
): number {
  const byAddress = new Map<string, string[]>();
  for (const o of orders) {
    const k = addressKey(o.address);
    const list = byAddress.get(k) ?? [];
    list.push(o.placedOn.slice(0, 10));
    byAddress.set(k, list);
  }
  const firstDrop = new Map<string, string>();
  for (const r of records) {
    if (r.status === "rejected") continue;
    const k = addressKey(r.address);
    const prev = firstDrop.get(k);
    if (!prev || r.performedOn < prev) firstDrop.set(k, r.performedOn);
  }
  let n = 0;
  for (const [k, drop] of firstDrop) {
    const dates = byAddress.get(k) ?? [];
    if (dates.some(d => d >= drop)) n++;
  }
  return Math.min(6, n);
}

/** a timestamp as a Los Angeles calendar date, the way drop dates are recorded */
export function laDate(at: Date | string | null | undefined): string {
  const d = at instanceof Date ? at : new Date(at ?? NaN);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
