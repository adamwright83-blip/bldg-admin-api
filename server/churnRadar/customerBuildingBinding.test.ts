import { describe, expect, it } from "vitest";
import {
  bindCustomerToBuilding,
  describeUnresolved,
  summarizeBindings,
  type CustomerBinding,
} from "./customerBuildingBinding";

const OPUS_ADDRESS = "3545 Wilshire Blvd, Los Angeles, CA 90010";
const CPE_ADDRESS = "2170 Century Park E, Los Angeles, CA 90067";

function order(over: Partial<{ id: number; address: string | null; buildingSlug: string | null }> = {}) {
  return { id: 1, address: OPUS_ADDRESS, buildingSlug: null, ...over };
}

describe("bindCustomerToBuilding", () => {
  it("places a customer from their last order's address", () => {
    const bound = bindCustomerToBuilding({ lastOrderId: 1, order: order() });
    expect(bound).toMatchObject({
      resolved: true,
      buildingId: "opus_la",
      basis: "address",
    });
  });

  it("falls back to the persisted slug when the address names no building", () => {
    const bound = bindCustomerToBuilding({
      lastOrderId: 1,
      order: order({ address: "somewhere unlisted", buildingSlug: "centuryparkeast" }),
    });
    expect(bound).toMatchObject({ resolved: true, buildingId: "century_park_east", basis: "slug" });
  });

  it("accepts a slug alias, not only the canonical slug", () => {
    const bound = bindCustomerToBuilding({
      lastOrderId: 1,
      order: order({ address: "unlisted", buildingSlug: "cpe-north" }),
    });
    expect(bound).toMatchObject({ resolved: true, buildingId: "century_park_east" });
  });

  /*
    The label is operator-facing and load-bearing. A last order proves where
    somebody was served once; it is not a claim about where they live, and the
    wording must not let a reader infer residence.
  */
  it("labels the placement as evidence, never as residence", () => {
    const bound = bindCustomerToBuilding({ lastOrderId: 1, order: order() });
    expect(bound.resolved && bound.evidenceLabel).toBe("Last order at Opus Los Angeles");
    expect(bound.resolved && bound.evidenceLabel).not.toMatch(/lives|resident|home|address of/i);
  });
});

describe("ambiguity stays ambiguous", () => {
  it("declines to place a customer with no last order", () => {
    expect(bindCustomerToBuilding({ lastOrderId: null, order: null })).toEqual({
      resolved: false,
      buildingId: null,
      reason: "no_last_order",
    });
  });

  it("reports a missing order row rather than treating it as no evidence", () => {
    expect(bindCustomerToBuilding({ lastOrderId: 99, order: null })).toEqual({
      resolved: false,
      buildingId: null,
      reason: "order_not_found",
    });
  });

  it("declines when neither address nor slug names a known building", () => {
    const bound = bindCustomerToBuilding({
      lastOrderId: 1,
      order: order({ address: "1 Nowhere Rd", buildingSlug: null }),
    });
    expect(bound).toEqual({ resolved: false, buildingId: null, reason: "no_building_evidence" });
  });

  /*
    The decisive case. `resolveBuildingEvidence` resolves a contradiction by
    letting the address win and reporting the conflict — correct for reporting,
    wrong for lighting a window. A lit window claims one specific building, and
    that claim must not rest on evidence that contradicts itself.
  */
  it("declines when address and slug name DIFFERENT buildings", () => {
    const bound = bindCustomerToBuilding({
      lastOrderId: 1,
      order: order({ address: OPUS_ADDRESS, buildingSlug: "centuryparkeast" }),
    });
    expect(bound).toEqual({ resolved: false, buildingId: null, reason: "conflicting_evidence" });
  });

  it("never invents a building for any unresolved case", () => {
    const inputs = [
      { lastOrderId: null, order: null },
      { lastOrderId: 5, order: null },
      { lastOrderId: 5, order: order({ address: "unlisted", buildingSlug: null }) },
      { lastOrderId: 5, order: order({ address: OPUS_ADDRESS, buildingSlug: "centuryparkeast" }) },
    ];
    for (const input of inputs) {
      expect(bindCustomerToBuilding(input).buildingId).toBeNull();
    }
  });
});

describe("summarizeBindings", () => {
  const placed = (id: string): CustomerBinding => ({
    resolved: true,
    buildingId: id,
    buildingName: id,
    basis: "address",
    evidenceLabel: `Last order at ${id}`,
  });

  it("groups placed customers by building", () => {
    const summary = summarizeBindings([
      { customerId: "a", binding: placed("opus_la") },
      { customerId: "b", binding: placed("opus_la") },
      { customerId: "c", binding: placed("century_park_east") },
    ]);
    expect(summary.placedByBuilding.get("opus_la")).toEqual(["a", "b"]);
    expect(summary.placedByBuilding.get("century_park_east")).toEqual(["c"]);
    expect(summary.unresolvedCount).toBe(0);
  });

  /*
    The unplaced must stay countable. A city that silently omits them reads as
    "there are no others", which is a quieter lie than a wrong placement but a
    lie all the same.
  */
  it("counts the unplaced by reason instead of dropping them", () => {
    const summary = summarizeBindings([
      { customerId: "a", binding: placed("opus_la") },
      { customerId: "b", binding: { resolved: false, buildingId: null, reason: "no_last_order" } },
      { customerId: "c", binding: { resolved: false, buildingId: null, reason: "no_last_order" } },
      { customerId: "d", binding: { resolved: false, buildingId: null, reason: "conflicting_evidence" } },
    ]);
    expect(summary.unresolvedCount).toBe(3);
    expect(summary.unresolvedByReason.no_last_order).toBe(2);
    expect(summary.unresolvedByReason.conflicting_evidence).toBe(1);
    expect(summary.placedByBuilding.get("opus_la")).toEqual(["a"]);
  });

  it("says the unplaced tally in plain language, or nothing when all are placed", () => {
    const none = summarizeBindings([{ customerId: "a", binding: placed("opus_la") }]);
    expect(describeUnresolved(none)).toBeNull();

    const some = summarizeBindings([
      { customerId: "b", binding: { resolved: false, buildingId: null, reason: "no_last_order" } },
    ]);
    expect(describeUnresolved(some)).toBe(
      "1 customer not placed — no clear building on their last order"
    );
  });
});
