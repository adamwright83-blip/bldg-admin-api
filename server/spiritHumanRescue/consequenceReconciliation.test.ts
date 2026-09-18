import { describe, expect, it } from "vitest";
import { emptySendRecord, SPIRIT_HUMAN_VILLAGERS, type SpiritHumanRescueMission } from "../../shared/spiritHumanRescue";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import { findPaidReorderEvidence } from "./consequenceReconciliation";

function aggregate(phone = "3105550101"): AdminCustomerAggregateDbRow {
  return {
    phone,
    firstName: "Priya",
    lastName: "Rao",
    email: null,
    unit: "2A",
    address: "100 Main St",
    buildingSlug: null,
    totalOrders: 3,
    lifetimeSpend: 120,
    paidOrderCount: 3,
    firstOrderAt: new Date("2026-01-01T00:00:00.000Z"),
    lastOrderAt: new Date("2026-09-20T00:00:00.000Z"),
    lastOrderId: 3,
    ordersLast30Days: 1,
    ordersLast90Days: 1,
  };
}

function mission(tenantId: string, snapshotCustomerId: string): SpiritHumanRescueMission {
  const send = {
    ...emptySendRecord("shr_test"),
    status: "sent" as const,
    acceptedAt: "2026-09-18T00:00:00.000Z",
    providerMessageId: "SM1",
    evidenceName: "provider_accepted" as const,
  };
  return {
    missionId: "shr_test",
    tenantId,
    operatorUserId: "op",
    kind: "spirit_human_rescue",
    lifecycle: "completed",
    villager: SPIRIT_HUMAN_VILLAGERS[0]!,
    spiritHuman: {
      snapshotCustomerId,
      firstName: "Priya",
      lastOrderAt: "2026-07-01T00:00:00.000Z",
      daysSinceLastOrder: 79,
    },
    draft: "hello",
    send,
    consequences: [],
    opsTaskId: null,
    deferredAt: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  };
}

describe("Spirit Human paid-order consequence reconciliation", () => {
  it("accepts only a paid ledger event for the same stable phone identity after provider acceptance", () => {
    const tenantId = "tenant-a";
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId(tenantId, row);
    const result = findPaidReorderEvidence({
      tenantId,
      mission: mission(tenantId, snapshot),
      aggregates: [row],
      paidEvents: [
        {
          source: "laundry_butler",
          eventKey: "order:2",
          occurredAt: new Date("2026-09-17T23:00:00.000Z"),
          businessDate: "2026-09-17",
          cents: 2000,
          serviceType: "wash_fold",
          customerName: "Priya Rao",
          identity: { phone: "310-555-0101", email: null, bldgUserId: null },
        },
        {
          source: "laundry_butler",
          eventKey: "order:3",
          occurredAt: new Date("2026-09-20T00:00:00.000Z"),
          businessDate: "2026-09-19",
          cents: 2400,
          serviceType: "wash_fold",
          customerName: "Priya Rao",
          identity: { phone: "+1 310 555 0101", email: null, bldgUserId: null },
        },
      ],
    });
    expect(result?.eventKey).toBe("order:3");
  });

  it("does not infer a reorder from a different phone or a pre-send order", () => {
    const tenantId = "tenant-a";
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId(tenantId, row);
    const result = findPaidReorderEvidence({
      tenantId,
      mission: mission(tenantId, snapshot),
      aggregates: [row],
      paidEvents: [
        {
          source: "cleancloud",
          eventKey: "cleancloud:9",
          occurredAt: new Date("2026-09-21T00:00:00.000Z"),
          businessDate: "2026-09-20",
          cents: 3000,
          serviceType: "wash_fold",
          customerName: "Other",
          identity: { phone: "3105559999", email: null, cleancloudCustomerId: "cc9" },
        },
      ],
    });
    expect(result).toBeNull();
  });
});
