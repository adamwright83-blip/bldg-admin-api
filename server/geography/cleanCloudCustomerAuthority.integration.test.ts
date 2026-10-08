import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { cleancloudPaidOrders } from "../../drizzle/schema";
import { getDb } from "../db";
import { admitCleanCloudPaidObservationWith } from "../cleancloudPaidEvidence";
import { loadCustomerOrderTruth } from "./customerOrderTruth";

it("withholds unadmitted CleanCloud paid progression and fences admission to tenant and import", async () => {
  const db = (await getDb())!;
  const tenantId = `cc-proof-${randomUUID().slice(0, 8)}`;
  const cleancloudOrderId = randomUUID();
  const occurredAt = new Date("2026-10-07T12:00:00Z");
  await db.insert(cleancloudPaidOrders).values({ tenantId, cleancloudOrderId,
    sourceReportType: "orders_revenue", sourceFileName: "authority-proof.csv", importBatchId: 1,
    customerName: "Evidence Customer", customerPhone: "3105550199", paid: true,
    totalCents: 4200, paidDateUtc: occurredAt, buildingResolutionStatus: "not_applicable" });
  try {
    expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({ paid: false, totalCents: null });
    const admit = (owner: string, batch: number) => db.transaction(tx => admitCleanCloudPaidObservationWith(tx, {
      tenantId: owner, cleancloudOrderId, sourceRef: `cleancloud-import:${batch}:${cleancloudOrderId}`, occurredAt,
    }));
    await admit(`${tenantId}-other`, 1);
    await admit(tenantId, 2);
    expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({ paid: false, totalCents: null });
    await admit(tenantId, 1);
    expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({ paid: true, totalCents: 4200 });
    expect(await loadCustomerOrderTruth(`${tenantId}-other`)).toEqual([]);
  } finally {
    await db.delete(cleancloudPaidOrders).where(eq(cleancloudPaidOrders.tenantId, tenantId));
  }
});
