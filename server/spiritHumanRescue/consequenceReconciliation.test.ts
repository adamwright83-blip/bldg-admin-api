import { describe, expect, it } from "vitest";
import { emptySendRecord, SPIRIT_HUMAN_VILLAGERS, type SpiritHumanRescueMission } from "../../shared/spiritHumanRescue";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import {
  findPaidReorderEvidence,
  reconcilePaidOrderConsequencesForOperator,
} from "./consequenceReconciliation";
import { MemoryRescueMissionStore } from "./rescueMissionStore";

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

function mission(input: {
  tenantId: string;
  snapshotCustomerId: string;
  send?: Partial<SpiritHumanRescueMission["send"]>;
}): SpiritHumanRescueMission {
  const send = {
    ...emptySendRecord("shr_test"),
    status: "sent" as const,
    acceptedAt: "2026-09-18T00:00:00.000Z",
    providerMessageId: "SM1",
    evidenceName: "provider_accepted" as const,
    ...input.send,
  };
  return {
    missionId: "shr_test",
    tenantId: input.tenantId,
    operatorUserId: "op",
    kind: "spirit_human_rescue",
    lifecycle: "completed",
    villager: SPIRIT_HUMAN_VILLAGERS[0]!,
    spiritHuman: {
      snapshotCustomerId: input.snapshotCustomerId,
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

function paidEvent(overrides: {
  eventKey: string;
  occurredAt: string;
  phone: string;
}) {
  return {
    source: "laundry_butler" as const,
    eventKey: overrides.eventKey,
    occurredAt: new Date(overrides.occurredAt),
    businessDate: overrides.occurredAt.slice(0, 10),
    cents: 2400,
    serviceType: "wash_fold" as const,
    customerName: "Priya Rao",
    identity: { phone: overrides.phone, email: null, bldgUserId: null },
  };
}

describe("Spirit Human paid-order consequence reconciliation", () => {
  it("accepts a post-send paid ledger event for the current matching customer identity", () => {
    const tenantId = "tenant-a";
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId(tenantId, row);
    const result = findPaidReorderEvidence({
      tenantId,
      mission: mission({ tenantId, snapshotCustomerId: snapshot }),
      aggregates: [row],
      paidEvents: [
        paidEvent({ eventKey: "order:2", occurredAt: "2026-09-17T23:00:00.000Z", phone: "310-555-0101" }),
        paidEvent({ eventKey: "order:3", occurredAt: "2026-09-20T00:00:00.000Z", phone: "+1 310 555 0101" }),
      ],
    });
    expect(result?.eventKey).toBe("order:3");
  });

  it("rejects a paid order that happened before provider acceptance", () => {
    const tenantId = "tenant-a";
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId(tenantId, row);
    const result = findPaidReorderEvidence({
      tenantId,
      mission: mission({ tenantId, snapshotCustomerId: snapshot }),
      aggregates: [row],
      paidEvents: [
        paidEvent({ eventKey: "order:2", occurredAt: "2026-09-17T23:00:00.000Z", phone: "3105550101" }),
      ],
    });
    expect(result).toBeNull();
  });

  it("rejects a paid order for a different customer phone", () => {
    const tenantId = "tenant-a";
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId(tenantId, row);
    const result = findPaidReorderEvidence({
      tenantId,
      mission: mission({ tenantId, snapshotCustomerId: snapshot }),
      aggregates: [row],
      paidEvents: [
        paidEvent({ eventKey: "cleancloud:9", occurredAt: "2026-09-21T00:00:00.000Z", phone: "3105559999" }),
      ],
    });
    expect(result).toBeNull();
  });

  it("does not infer a reorder merely because the customer is no longer dormant", () => {
    const tenantId = "tenant-a";
    const row = {
      ...aggregate(),
      lastOrderAt: new Date("2026-09-20T00:00:00.000Z"),
      daysSinceLastOrder: 0,
    };
    const snapshot = strategyCustomerSnapshotId(tenantId, row);
    const result = findPaidReorderEvidence({
      tenantId,
      mission: mission({ tenantId, snapshotCustomerId: snapshot }),
      aggregates: [row],
      paidEvents: [],
    });
    expect(result).toBeNull();
  });

  it("rejects paid-order evidence when current identity no longer matches the frozen snapshot", () => {
    const tenantId = "tenant-a";
    const frozen = aggregate("3105550101");
    const snapshot = strategyCustomerSnapshotId(tenantId, frozen);
    const current = aggregate("3105557777");
    const result = findPaidReorderEvidence({
      tenantId,
      mission: mission({ tenantId, snapshotCustomerId: snapshot }),
      aggregates: [current],
      paidEvents: [
        paidEvent({ eventKey: "order:9", occurredAt: "2026-09-21T00:00:00.000Z", phone: "3105557777" }),
      ],
    });
    expect(result).toBeNull();
  });

  it("records customer_ordered through a store instance using post-send paid evidence", async () => {
    const tenantId = "tenant-a";
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId(tenantId, row);
    const store = new MemoryRescueMissionStore();
    await store.save(mission({ tenantId, snapshotCustomerId: snapshot }));
    const rows = await reconcilePaidOrderConsequencesForOperator(
      { tenantId, operatorUserId: "op" },
      {
        store,
        loadAggregates: async () => [row],
        loadLedger: async () => ({
          events: [
            paidEvent({ eventKey: "order:3", occurredAt: "2026-09-20T00:00:00.000Z", phone: "3105550101" }),
          ],
        } as never),
      }
    );
    expect(rows[0]?.consequences).toEqual([
      expect.objectContaining({ kind: "customer_ordered", evidenceId: "paid-order:order:3" }),
    ]);
  });
});
