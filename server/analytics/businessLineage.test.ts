import { describe, expect, it } from "vitest";
import {
  applyLineageFilters,
  buildingFor,
  cleanCloudBusinessLine,
  cleanCloudProcessor,
  lineageBreakdown,
  unionOfSlices,
} from "./businessLineage";
import { loadPaidOrderLedger } from "./paidOrderLedger";
import { BUSINESS_TZ, businessLoaders } from "../claire/testSupport/claireBusinessFixture";

async function allEvents() {
  const ledger = await loadPaidOrderLedger(
    { tenantId: "default", startUtc: new Date("2020-01-01T08:00:00Z"), endExclusiveUtc: new Date("2026-09-16T07:00:00Z"), timeZone: BUSINESS_TZ },
    businessLoaders()
  );
  return ledger;
}

describe("business lineage rules come from record evidence", () => {
  it("CleanCloud is Laundry Farm only when the GUMBALL store is Laundry Farm", () => {
    expect(cleanCloudBusinessLine("Laundry Farm")).toBe("laundry_farm");
    expect(cleanCloudBusinessLine("Some Other Store")).toBeNull();
    expect(cleanCloudBusinessLine(null)).toBeNull();
  });

  it("processors are read from CleanCloud's own payment fields", () => {
    expect(cleanCloudProcessor("Card", "Clearent Saved Card")).toBe("clearent");
    expect(cleanCloudProcessor("Card", "Clearent Terminal")).toBe("clearent");
    expect(cleanCloudProcessor("Cash", null)).toBe("cash");
    expect(cleanCloudProcessor("Card", "Square")).toBe("other_or_unknown");
  });

  it("buildings resolve from slugs or tower addresses, never invented", () => {
    expect(buildingFor({ buildingSlug: "3650" })).toBe("opusla");
    expect(buildingFor({ buildingSlug: "centuryparkeast" })).toBe("centuryparkeast");
    expect(buildingFor({ address: "2160 Century Park E, Los Angeles" })).toBe("centuryparkeast");
    expect(buildingFor({ address: "2140 Clarissa Ave, Los Angeles, CA 90027" })).toBeNull();
  });
});

describe("the ledger carries lineage without changing totals", () => {
  it("every event knows its business line, processor, and ingestion time; Stripe-less native orders stay out", async () => {
    const ledger = await allEvents();
    expect(ledger.events).toHaveLength(23);
    expect(ledger.unverifiedNative).toHaveLength(1);
    const native = ledger.events.filter(event => event.source === "laundry_butler");
    const cloud = ledger.events.filter(event => event.source === "cleancloud");
    expect(native.every(event => event.businessLine === "laundry_butler" && event.processor === "stripe" && event.ingestedAt === null)).toBe(true);
    expect(cloud.every(event => event.businessLine === "laundry_farm" && event.ingestedAt instanceof Date)).toBe(true);
    expect(cloud.filter(event => event.eventKey === "cleancloud:562")).toHaveLength(1);
  });

  it("breakdown: lines, processors, buildings, Laundry Farm residents, unclassified service", async () => {
    const ledger = await allEvents();
    const breakdown = lineageBreakdown(ledger.events);
    expect(breakdown.total).toEqual({ cents: 116869, orders: 23 });
    expect(breakdown.byBusinessLine.map(slice => [slice.key, slice.cents, slice.orders])).toEqual([
      ["laundry_farm", 77251, 13],
      ["laundry_butler", 39618, 10],
    ]);
    expect(breakdown.byProcessor.find(slice => slice.key === "cash")).toMatchObject({ cents: 6500, orders: 2 });
    expect(breakdown.laundryFarmBuildingResidents).toEqual({ cents: 7941, orders: 1 });
    expect(breakdown.cleancloudUnclassifiedService).toEqual({ cents: 7941, orders: 1 });
  });

  it("filters by line, processor, building include/exclude, and neighborhood ZIP", async () => {
    const ledger = await allEvents();
    expect(applyLineageFilters(ledger.events, { processors: ["clearent"] })).toHaveLength(11);
    expect(applyLineageFilters(ledger.events, { includeBuildings: ["opusla"] })).toHaveLength(5);
    expect(applyLineageFilters(ledger.events, { excludeBuildings: ["opusla", "centuryparkeast"] })).toHaveLength(12);
    const losFeliz = applyLineageFilters(ledger.events, { businessLines: ["laundry_farm"], addressAny: ["90027", "los feliz"] });
    expect(Array.from(new Set(losFeliz.map(event => event.customerName))).sort()).toEqual(["John Cunningham", "Sean Cohen", "Sophie Tran"]);
  });

  it("combining overlapping slices counts each order once", async () => {
    const ledger = await allEvents();
    const combined = unionOfSlices(ledger.events, [
      { label: "Laundry Farm", filters: { businessLines: ["laundry_farm"] } },
      { label: "Clearent", filters: { processors: ["clearent"] } },
    ]);
    expect(combined.events).toHaveLength(13);
    expect(combined.overlapOrders).toBe(11);
  });
});
