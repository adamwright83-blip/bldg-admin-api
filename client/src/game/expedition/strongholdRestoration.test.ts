import { describe, expect, it } from "vitest";
import {
  projectStrongholdRestoration,
  restorationDelta,
  STRONGHOLD_LANTERN_COUNT,
} from "./strongholdRestoration";

/**
 * §39 plus the correction that matters most: the order status transition to
 * `collected` is PRIMARY truth, and the `operations_events` audit row is
 * supporting evidence only. Those two writes are not one transaction, so a
 * projection that required the event would under-report genuine collections.
 */

describe("canonical collected-order state is primary truth", () => {
  it("restores from a collected order even with NO audit event", () => {
    const restoration = projectStrongholdRestoration({
      orders: [{ id: 630031, status: "collected" }],
      auditEvents: [],
    });

    expect(restoration.restoredCount).toBe(1);
    expect(restoration.lanternsLit).toBe(1);
    expect(restoration.collectedWithoutAuditEvent).toBe(1);
  });

  it("is unchanged whether or not the audit event exists", () => {
    const orders = [{ id: 1, status: "collected" }];
    const without = projectStrongholdRestoration({ orders, auditEvents: [] });
    const with_ = projectStrongholdRestoration({
      orders,
      auditEvents: [{ orderId: 1, sourceEventType: "pickup_completed" }],
    });

    expect(without.restoredCount).toBe(with_.restoredCount);
    expect(without.lanternsLit).toBe(with_.lanternsLit);
    expect(without.conduitCharge).toBe(with_.conduitCharge);
    // Only the diagnostic differs, which is the point of surfacing it.
    expect(without.collectedWithoutAuditEvent).toBe(1);
    expect(with_.collectedWithoutAuditEvent).toBe(0);
  });

  it("never restores from an audit event whose order is not collected", () => {
    const restoration = projectStrongholdRestoration({
      orders: [{ id: 7, status: "new" }],
      auditEvents: [{ orderId: 7, sourceEventType: "pickup_completed" }],
    });

    expect(restoration.restoredCount).toBe(0);
    expect(restoration.lanternsLit).toBe(0);
  });

  it("counts statuses downstream of collected as genuine proof", () => {
    // An order cannot reach processing/ready/delivered without having been
    // collected first, so those still prove a real collection happened.
    const restoration = projectStrongholdRestoration({
      orders: [
        { id: 1, status: "processing" },
        { id: 2, status: "ready" },
        { id: 3, status: "delivered" },
        { id: 4, status: "new" },
        { id: 5, status: "intake-pending" },
        { id: 6, status: "cancelled" },
      ],
    });
    expect(restoration.restoredCount).toBe(3);
  });

  it("counts distinct orders, not duplicate evidence rows", () => {
    const restoration = projectStrongholdRestoration({
      orders: [
        { id: 9, status: "collected" },
        { id: 9, status: "collected" },
      ],
      auditEvents: [
        { orderId: 9, sourceEventType: "pickup_completed" },
        { orderId: 9, sourceEventType: "pickup_completed" },
      ],
    });
    expect(restoration.restoredCount).toBe(1);
  });

  it("ignores dropoff events entirely", () => {
    const restoration = projectStrongholdRestoration({
      orders: [{ id: 3, status: "collected" }],
      auditEvents: [{ orderId: 3, sourceEventType: "dropoff_completed" }],
    });
    expect(restoration.restoredCount).toBe(1);
    expect(restoration.collectedWithoutAuditEvent).toBe(1);
  });
});

describe("visible BEFORE -> AFTER delta", () => {
  it("proves the payoff from THIS expedition's own collection", () => {
    // Deliberately starts with real history already present, so a global
    // `restoredCount > 0` boolean would have been true before the action
    // and would have proven nothing.
    const history = [
      { id: 100, status: "delivered" },
      { id: 101, status: "collected" },
    ];
    const expeditionOrderId = 630031;

    const before = projectStrongholdRestoration({
      orders: [...history, { id: expeditionOrderId, status: "new" }],
      expeditionOrderId,
    });
    const after = projectStrongholdRestoration({
      orders: [...history, { id: expeditionOrderId, status: "collected" }],
      expeditionOrderId,
    });

    expect(before.restoredCount).toBe(2);
    expect(before.expeditionOrderCollected).toBe(false);
    expect(after.expeditionOrderCollected).toBe(true);

    const delta = restorationDelta(before, after);
    expect(delta.changed).toBe(true);
    expect(delta.expeditionOrderNewlyCollected).toBe(true);
    expect(delta.lanternsGained).toBe(1);
    expect(delta.conduitGained).toBeGreaterThan(0);
  });

  it("reports no change when the expedition order stays pending", () => {
    const orders = [{ id: 1, status: "collected" }, { id: 2, status: "new" }];
    const before = projectStrongholdRestoration({ orders, expeditionOrderId: 2 });
    const after = projectStrongholdRestoration({ orders, expeditionOrderId: 2 });

    expect(restorationDelta(before, after).changed).toBe(false);
    expect(after.expeditionOrderCollected).toBe(false);
  });

  it("keeps the first genuine collection unmistakable from zero", () => {
    const before = projectStrongholdRestoration({ orders: [], expeditionOrderId: 5 });
    const after = projectStrongholdRestoration({
      orders: [{ id: 5, status: "collected" }],
      expeditionOrderId: 5,
    });

    expect(before.lanternsLit).toBe(0);
    expect(before.conduitCharge).toBe(0);
    expect(after.lanternsLit).toBe(1);
    expect(after.conduitCharge).toBeGreaterThan(0);
    expect(restorationDelta(before, after).changed).toBe(true);
  });
});

describe("restoration curve", () => {
  it("saturates rather than overflowing on a long real history", () => {
    const orders = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      status: "delivered",
    }));
    const restoration = projectStrongholdRestoration({ orders });

    expect(restoration.lanternsLit).toBe(STRONGHOLD_LANTERN_COUNT);
    expect(restoration.conduitCharge).toBe(1);
    // Truthful: production history legitimately starts already restored.
    expect(restoration.restoredCount).toBe(40);
  });

  it("presents marks derived from evidence, never stored", () => {
    const restoration = projectStrongholdRestoration({
      orders: [
        { id: 1, status: "collected" },
        { id: 2, status: "delivered" },
      ],
    });
    expect(restoration.marksPresented).toBe(2);
  });
});
