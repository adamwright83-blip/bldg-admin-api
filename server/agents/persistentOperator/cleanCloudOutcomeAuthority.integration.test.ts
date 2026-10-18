import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { cleancloudPaidOrders, goalCycleObjectives, goalCycleOutcomes } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { admitCleanCloudPaidObservationWith } from "../../integrations/cleancloud/cleancloudPaidEvidence";
import { recordGoalCycleOutcome } from "./outcomeStore";

/**
 * CleanCloud economic credit is backed only by the receipt for the order's
 * current economic revision: the newest receipt for the order, carrying the
 * row's own payment time. A re-sync that changed no money moves the row to a
 * new import batch and admits nothing, so the earlier import's receipt is
 * still the current one; once a newer receipt exists, the older one no longer
 * backs anything; a receipt for another payment time never does.
 */
it("credits CleanCloud economics only on the receipt for the order's current economic revision", async () => {
  const db = (await getDb())!;
  const tenantId = `cc-outcome-${randomUUID().slice(0, 8)}`;
  const cleancloudOrderId = randomUUID();
  const occurredAt = new Date("2026-10-07T12:00:00Z");
  await db.insert(cleancloudPaidOrders).values({ tenantId, cleancloudOrderId,
    sourceReportType: "orders_revenue", sourceFileName: "authority-proof.csv", importBatchId: 2,
    customerName: "Outcome Customer", paid: true, totalCents: 9000, paidDateUtc: occurredAt,
    buildingResolutionStatus: "not_applicable" });
  const objective = async () => {
    const id = randomUUID();
    await db.insert(goalCycleObjectives).values({ id, tenantId, goalRunId: randomUUID(),
      cycleId: randomUUID(), decisionId: randomUUID(), canonicalOperatorId: "proof-operator",
      operatorUserId: "proof-operator", selectionKind: "candidate", selectedRef: cleancloudOrderId,
      title: "CleanCloud admission proof", description: "Disposable proof", authority: "HUMAN_EXECUTION",
      businessDate: "2026-10-07", loadoutJson: [], evidenceRefsJson: [] });
    return id;
  };
  const admit = (batch: number, at: Date = occurredAt) => db.transaction(tx => admitCleanCloudPaidObservationWith(tx, {
    tenantId, cleancloudOrderId, sourceRef: `cleancloud-import:${batch}:${cleancloudOrderId}`, occurredAt: at,
  }));
  const record = (objectiveId: string, receiptId: string) => recordGoalCycleOutcome({ tenantId, objectiveId,
    outcomeKind: "cleancloud_order_paid", impactClass: "commercial_revenue", evidenceClass: "authoritative_external",
    evidenceReference: `orders:cleancloud:${cleancloudOrderId}`, sourceSystem: "cleancloud",
    monetaryValueCents: 9000, observedAt: occurredAt, metadata: { cleancloudOrderId, authorityReceiptId: receiptId } });
  try {
    // Import 1 observed the payment; import 2 re-observed the row and changed no money.
    const observed = await admit(1);
    const afterResync = await objective();
    expect((await record(afterResync, observed.id)).outcome.monetaryValueCents).toBe(9000);

    // A newer receipt supersedes it: the older one no longer backs economic credit.
    const corrected = await admit(3);
    const afterCorrection = await objective();
    await expect(record(afterCorrection, observed.id)).rejects.toThrow("import admission");
    expect(await db.select().from(goalCycleOutcomes).where(eq(goalCycleOutcomes.objectiveId, afterCorrection))).toEqual([]);
    expect((await record(afterCorrection, corrected.id)).outcome.monetaryValueCents).toBe(9000);
    expect((await record(afterCorrection, corrected.id)).created).toBe(false);

    // A receipt that observed a different payment time never backs this order.
    const otherPayment = await admit(4, new Date("2026-10-08T12:00:00Z"));
    await expect(record(await objective(), otherPayment.id)).rejects.toThrow("import admission");
  } finally {
    await db.delete(goalCycleOutcomes).where(eq(goalCycleOutcomes.tenantId, tenantId));
    await db.delete(goalCycleObjectives).where(eq(goalCycleObjectives.tenantId, tenantId));
    await db.delete(cleancloudPaidOrders).where(eq(cleancloudPaidOrders.tenantId, tenantId));
  }
});
