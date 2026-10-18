import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { cleancloudPaidOrders } from "../../drizzle/schema";
import { getDb } from "../db";
import { admitCleanCloudPaidObservationWith } from "../integrations/cleancloud/cleancloudPaidEvidence";
import { loadCustomerOrderTruth } from "./customerOrderTruth";

/**
 * A CleanCloud paid row is a paid order for the customer only on a receipt
 * that observed its payment, in its own tenant. The import batch stamped on
 * the row is the latest write, not the payment: a re-sync that changed no
 * money moved this row to import 2 and admitted nothing, so import 1's
 * receipt still backs it.
 */
it("withholds unadmitted CleanCloud paid progression and fences admission to tenant and payment", async () => {
  const db = (await getDb())!;
  const tenantId = `cc-proof-${randomUUID().slice(0, 8)}`;
  const cleancloudOrderId = randomUUID();
  const occurredAt = new Date("2026-10-07T12:00:00Z");
  await db.insert(cleancloudPaidOrders).values({ tenantId, cleancloudOrderId,
    sourceReportType: "orders_revenue", sourceFileName: "authority-proof.csv", importBatchId: 2,
    customerName: "Evidence Customer", customerPhone: "3105550199", paid: true,
    totalCents: 4200, paidDateUtc: occurredAt, buildingResolutionStatus: "not_applicable" });
  try {
    expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({ paid: false, totalCents: null });
    const admit = (owner: string, batch: number, at: Date = occurredAt) => db.transaction(tx => admitCleanCloudPaidObservationWith(tx, {
      tenantId: owner, cleancloudOrderId, sourceRef: `cleancloud-import:${batch}:${cleancloudOrderId}`, occurredAt: at,
    }));
    await admit(`${tenantId}-other`, 1);
    // A receipt that observed a different payment is not this order's payment.
    await admit(tenantId, 3, new Date("2026-10-08T12:00:00Z"));
    expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({ paid: false, totalCents: null });
    await admit(tenantId, 1);
    expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({ paid: true, totalCents: 4200 });
    expect(await loadCustomerOrderTruth(`${tenantId}-other`)).toEqual([]);
  } finally {
    await db.delete(cleancloudPaidOrders).where(eq(cleancloudPaidOrders.tenantId, tenantId));
  }
});
