import { describe, expect, it } from "vitest";
import {
  activeCustomerPopulation,
  compareTotals,
  dormantCustomerPopulation,
  findCustomersByName,
  newCustomerPopulation,
  summarizeTotals,
  topCustomers,
} from "./businessMetrics";
import { resolveCustomerIdentities } from "./customerIdentityResolution";
import {
  failingLoaders,
  FIXTURE_TZ,
  fixtureCleanCloudRows,
  fixtureLoaders,
} from "./businessLedgerFixture";
import {
  detectCrossSourceOverlap,
  loadPaidOrderLedger,
  mapCleanCloudOrders,
  type CleanCloudOrderRow,
  type PaidOrderEvent,
} from "./paidOrderLedger";

const wideWindow = {
  startUtc: new Date("2025-01-01T08:00:00.000Z"),
  endExclusiveUtc: new Date("2026-09-15T07:00:00.000Z"),
};

async function ledger() {
  return loadPaidOrderLedger({ tenantId: "tenant-1", ...wideWindow, timeZone: FIXTURE_TZ }, fixtureLoaders());
}

describe("paid-order ledger", () => {
  it("counts each CleanCloud order once, preferring the Sales report", () => {
    const events = mapCleanCloudOrders(fixtureCleanCloudRows, wideWindow, FIXTURE_TZ);
    expect(events.filter(event => event.eventKey === "cleancloud:cc-ben-1")).toHaveLength(1);
  });

  it("dates a deduplicated CleanCloud order by its preferred row, so a twin outside the window is not counted", () => {
    const rows: CleanCloudOrderRow[] = [
      { ...fixtureCleanCloudRows[0]!, cleancloudOrderId: "cc-edge", paymentDateUtc: new Date("2026-09-16T19:00:00.000Z") },
      {
        ...fixtureCleanCloudRows[1]!,
        cleancloudOrderId: "cc-edge",
        paidDateUtc: new Date("2026-09-14T19:00:00.000Z"),
      },
    ];
    expect(mapCleanCloudOrders(rows, wideWindow, FIXTURE_TZ)).toEqual([]);
  });

  it("holds out native orders without Stripe evidence as unverified", async () => {
    const result = await ledger();
    expect(result.events.some(event => event.eventKey === "order:99")).toBe(false);
    expect(result.unverifiedNative).toEqual([{ eventKey: "order:99", businessDate: "2026-09-01", cents: 7000 }]);
    expect(result.completeness).toBe("complete");
  });

  it("reports partial and unavailable coverage instead of a total", async () => {
    const partial = await loadPaidOrderLedger(
      { tenantId: "tenant-1", ...wideWindow, timeZone: FIXTURE_TZ },
      { laundry_butler: fixtureLoaders().laundry_butler, cleancloud: failingLoaders.cleancloud }
    );
    expect(partial).toMatchObject({ completeness: "partial", loadedSources: ["laundry_butler"], failedSources: ["cleancloud"] });
    const none = await loadPaidOrderLedger({ tenantId: "tenant-1", ...wideWindow, timeZone: FIXTURE_TZ }, failingLoaders);
    expect(none).toMatchObject({ completeness: "unavailable", events: [] });
  });

  it("flags native/CleanCloud pairs that look like the same order without removing them", () => {
    const base = { occurredAt: new Date(), serviceType: null, customerName: "Ava" } as const;
    const events: PaidOrderEvent[] = [
      { ...base, source: "laundry_butler", eventKey: "order:1", businessDate: "2026-09-10", cents: 4500, identity: { phone: "3105550100" } },
      { ...base, source: "cleancloud", eventKey: "cleancloud:x", businessDate: "2026-09-10", cents: 4500, identity: { phone: "+1 310 555 0100" } },
      { ...base, source: "cleancloud", eventKey: "cleancloud:y", businessDate: "2026-09-10", cents: 9900, identity: { phone: "3105550100" } },
    ];
    expect(detectCrossSourceOverlap(events)).toEqual({ status: "suspected", suspectedPairs: 1, suspectedCents: 4500 });
    expect(detectCrossSourceOverlap(events.slice(0, 1))).toMatchObject({ status: "none_detected" });
  });
});

describe("customer identity", () => {
  it("links records transitively across phone, email and CleanCloud id, and counts unidentifiable orders separately", () => {
    const records = [
      { phone: "(310) 555-0100", email: "ava@example.com" },
      { email: "AVA@example.com", cleancloudCustomerId: "c-1" },
      { cleancloudCustomerId: "c-1" },
      { phone: null, email: null },
    ];
    const resolved = resolveCustomerIdentities(records, record => record);
    expect(resolved.groups).toHaveLength(2);
    expect(resolved.groups[0]).toMatchObject({ id: "phone:3105550100", matched: true });
    expect(resolved.unmatchedRecordCount).toBe(1);
  });
});

describe("business metrics", () => {
  const last30 = { start: "2026-08-16", end: "2026-09-14" };
  const prev30 = { start: "2026-07-17", end: "2026-08-15" };

  it("active customers honor the window and the minimum order count", async () => {
    const { events } = await ledger();
    expect(activeCustomerPopulation(events, last30, 1).count).toBe(3);
    expect(activeCustomerPopulation(events, { start: "2026-07-17", end: "2026-09-14" }, 1).count).toBe(4);
    const repeat = activeCustomerPopulation(events, { start: "2026-07-17", end: "2026-09-14" }, 2);
    expect(repeat.members.map(member => member.displayName)).toEqual(["Ava Stone", "Cara Diaz"]);
  });

  it("new customers are relative to an explicit lookback", async () => {
    const { events } = await ledger();
    const result = newCustomerPopulation(events, last30, "2025-08-16", 1);
    expect(result).toMatchObject({ count: 1, activeCount: 3 });
    expect(result.members[0]!.displayName).toBe("Cara Diaz");
  });

  it("dormant customers ordered in the lookback and not in the quiet window", async () => {
    const { events } = await ledger();
    const result = dormantCustomerPopulation(events, { start: "2026-07-17", end: "2026-09-14" }, "2025-07-17");
    expect(result.members.map(member => member.displayName)).toEqual(["Dee Lopez"]);
  });

  it("top customers and name lookup use the same identities", async () => {
    const { events } = await ledger();
    expect(topCustomers(events, { start: "2026-06-17", end: "2026-09-14" }, 3).map(m => [m.displayName, m.revenueCents])).toEqual([
      ["Ava Stone", 15000],
      ["Dee Lopez", 8000],
      ["Ben Ortiz", 6000],
    ]);
    expect(findCustomersByName(events, { start: "2026-01-01", end: "2026-09-14" }, "ava")).toMatchObject([
      { displayName: "Ava Stone", orderCount: 3, revenueCents: 15000, lastOrderDate: "2026-09-12" },
    ]);
  });

  it("comparison separates volume from average order value", async () => {
    const { events } = await ledger();
    const current = summarizeTotals(events.filter(e => e.businessDate >= last30.start && e.businessDate <= last30.end));
    const previous = summarizeTotals(events.filter(e => e.businessDate >= prev30.start && e.businessDate <= prev30.end));
    expect(current).toEqual({ revenueCents: 19000, orderCount: 5, aovCents: 3800 });
    expect(previous).toEqual({ revenueCents: 9500, orderCount: 2, aovCents: 4750 });
    expect(compareTotals(current, previous)).toMatchObject({
      revenueChangeCents: 9500,
      revenueChangePct: 100,
      volumeEffectCents: 14250,
      aovEffectCents: -4750,
    });
  });
});
