import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { cleancloudPaidOrders, goalCycleObjectives, goalCycleOutcomes } from "../../drizzle/schema";
import { getDb } from "../db";
import { admitCleanCloudPaidObservationWith } from "../cleancloudPaidEvidence";
import { recordGoalCycleOutcome } from "./outcomeStore";

it("rejects CleanCloud economic credit backed by a different import's receipt", async () => {
  const db = (await getDb())!;
  const tenantId = `cc-outcome-${randomUUID().slice(0, 8)}`;
  const cleancloudOrderId = randomUUID(), objectiveId = randomUUID();
  const occurredAt = new Date("2026-10-07T12:00:00Z");
  await db.insert(cleancloudPaidOrders).values({ tenantId, cleancloudOrderId,
    sourceReportType: "orders_revenue", sourceFileName: "authority-proof.csv", importBatchId: 2,
    customerName: "Outcome Customer", paid: true, totalCents: 9000, paidDateUtc: occurredAt,
    buildingResolutionStatus: "not_applicable" });
  await db.insert(goalCycleObjectives).values({ id: objectiveId, tenantId, goalRunId: randomUUID(),
    cycleId: randomUUID(), decisionId: randomUUID(), canonicalOperatorId: "proof-operator",
    operatorUserId: "proof-operator", selectionKind: "candidate", selectedRef: cleancloudOrderId,
    title: "CleanCloud admission proof", description: "Disposable proof", authority: "HUMAN_EXECUTION",
    businessDate: "2026-10-07", loadoutJson: [], evidenceRefsJson: [] });
  const admit = (batch: number) => db.transaction(tx => admitCleanCloudPaidObservationWith(tx, {
    tenantId, cleancloudOrderId, sourceRef: `cleancloud-import:${batch}:${cleancloudOrderId}`, occurredAt,
  }));
  const record = (receiptId: string) => recordGoalCycleOutcome({ tenantId, objectiveId,
    outcomeKind: "cleancloud_order_paid", impactClass: "commercial_revenue", evidenceClass: "authoritative_external",
    evidenceReference: `orders:cleancloud:${cleancloudOrderId}`, sourceSystem: "cleancloud",
    monetaryValueCents: 9000, observedAt: occurredAt, metadata: { cleancloudOrderId, authorityReceiptId: receiptId } });
  try {
    const old = await admit(1);
    await expect(record(old.id)).rejects.toThrow("import admission");
    expect(await db.select().from(goalCycleOutcomes).where(eq(goalCycleOutcomes.tenantId, tenantId))).toEqual([]);
    const current = await admit(2);
    expect((await record(current.id)).outcome.monetaryValueCents).toBe(9000);
    expect((await record(current.id)).created).toBe(false);
  } finally {
    await db.delete(goalCycleOutcomes).where(eq(goalCycleOutcomes.tenantId, tenantId));
    await db.delete(goalCycleObjectives).where(eq(goalCycleObjectives.tenantId, tenantId));
    await db.delete(cleancloudPaidOrders).where(eq(cleancloudPaidOrders.tenantId, tenantId));
  }
});
