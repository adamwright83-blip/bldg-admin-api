import { describe, expect, it } from "vitest";
import { getRepeatCustomerStats, getRevenueSummary, getTopCustomersByRevenue } from "./analyticsQueries";
import {
  emptyLoaders,
  failingLoaders,
  FIXTURE_NOW,
  FIXTURE_TZ,
  fixtureCompleteness,
  fixtureLoaders,
} from "./businessLedgerFixture";
import { defaultBusinessQuery, runBusinessQuery, type BusinessQueryDeps } from "./businessQuery";
import { loadPaidOrderLedger, type LedgerLoaders } from "./paidOrderLedger";

function deps(loaders: LedgerLoaders): BusinessQueryDeps {
  return {
    loadLedger: input => loadPaidOrderLedger(input, loaders),
    loadOpenOrders: async () => ({ openTotal: 4, byStatus: {}, awaitingPayment: 1 }),
    loadCompleteness: async () => fixtureCompleteness,
    now: () => FIXTURE_NOW,
    timeZone: () => FIXTURE_TZ,
  };
}

describe("runBusinessQuery", () => {
  it("returns structured revenue with coverage evidence", async () => {
    const result = await runBusinessQuery("tenant-1", { ...defaultBusinessQuery("revenue"), comparison: "previous" }, deps(fixtureLoaders()));
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "totals") throw new Error("unexpected");
    expect(result.data.current).toEqual({ revenueCents: 19000, orderCount: 5, aovCents: 3800 });
    expect(result.data.previous).toEqual({ revenueCents: 9500, orderCount: 2, aovCents: 4750 });
    expect(result.coverage).toMatchObject({ completeness: "complete", unverifiedNativeCount: 1, unverifiedNativeCents: 7000 });
  });

  it("unavailable data is a status, never a zero", async () => {
    const result = await runBusinessQuery("tenant-1", defaultBusinessQuery("revenue"), deps(failingLoaders));
    expect(result).toMatchObject({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("revenueCents");
  });

  it("a genuinely empty period is a real zero", async () => {
    const result = await runBusinessQuery("tenant-1", defaultBusinessQuery("revenue"), deps(emptyLoaders));
    expect(result).toMatchObject({ status: "ok", data: { current: { revenueCents: 0, orderCount: 0, aovCents: null } } });
  });

  it("queries only the tenant it was given", async () => {
    const seen: string[] = [];
    await runBusinessQuery("tenant-a", defaultBusinessQuery("active_customers"), deps(fixtureLoaders(seen)));
    expect(new Set(seen)).toEqual(new Set(["tenant-a"]));
  });

  it("ordered sale queries support continuation offsets and anchored exclusions", async () => {
    const base = { ...defaultBusinessQuery("latest_sales"), limit: 5 };
    const first = await runBusinessQuery("tenant-1", base, deps(fixtureLoaders()));
    if (first.status !== "ok" || first.data.kind !== "orders") throw new Error("unexpected first list");
    expect(first.data.orders.length).toBeGreaterThanOrEqual(4);

    const continued = await runBusinessQuery(
      "tenant-1",
      { ...base, limit: 2, offset: 1 },
      deps(fixtureLoaders())
    );
    if (continued.status !== "ok" || continued.data.kind !== "orders") throw new Error("unexpected continuation");
    expect(continued.data.orders[0]?.eventKey).toBe(first.data.orders[1]?.eventKey);
    expect(continued.data.orders.map(order => order.eventKey)).not.toContain(first.data.orders[0]?.eventKey);

    const anchored = await runBusinessQuery(
      "tenant-1",
      { ...base, limit: 3, anchorCustomerName: "Ben Ortiz", excludeCustomerNames: ["Ben Ortiz"] },
      deps(fixtureLoaders())
    );
    if (anchored.status !== "ok" || anchored.data.kind !== "orders") throw new Error("unexpected anchor result");
    expect(anchored.data.orders.every(order => order.customerName !== "Ben Ortiz")).toBe(true);
    const anchorAt = first.data.orders.find(order => order.customerName === "Ben Ortiz")!.occurredAt;
    expect(anchored.data.orders[0]?.occurredAt < anchorAt).toBe(true);

    const afterAnchor = await runBusinessQuery(
      "tenant-1",
      {
        ...base,
        limit: 3,
        anchorCustomerName: "Ben Ortiz",
        anchorDirection: "after",
        excludeCustomerNames: ["Ben Ortiz"],
      },
      deps(fixtureLoaders())
    );
    if (afterAnchor.status !== "ok" || afterAnchor.data.kind !== "orders") throw new Error("unexpected after-anchor result");
    expect(afterAnchor.data.orders.every(order => order.customerName !== "Ben Ortiz")).toBe(true);
    expect(afterAnchor.data.orders.every(order => order.occurredAt > anchorAt)).toBe(true);
  });

  it("discloses in-scope CleanCloud orders a service filter cannot classify", async () => {
    const result = await runBusinessQuery(
      "tenant-1",
      { ...defaultBusinessQuery("revenue"), serviceType: "wash_fold" },
      deps(fixtureLoaders())
    );
    expect(result).toMatchObject({
      status: "ok",
      data: { current: { revenueCents: 10000, orderCount: 2 } },
      coverage: { serviceFilterUnclassified: { orders: 1, cents: 3000 } },
    });
  });
});

describe("Admin analytics and Claire share one truth", () => {
  it("revenue, repeat customers and top customers match the Claire query for the same period", async () => {
    const range = { start: "2026-08-16", end: "2026-09-14" };
    const adminDeps = { loadLedger: deps(fixtureLoaders()).loadLedger, timeZone: () => FIXTURE_TZ };
    const [adminRevenue, adminRepeat, adminTop, claireRevenue, claireActive] = await Promise.all([
      getRevenueSummary("tenant-1", { range, groupBy: "day" }, adminDeps),
      getRepeatCustomerStats("tenant-1", { range }, adminDeps),
      getTopCustomersByRevenue("tenant-1", { range, limit: 3 }, adminDeps),
      runBusinessQuery("tenant-1", defaultBusinessQuery("revenue"), deps(fixtureLoaders())),
      runBusinessQuery("tenant-1", defaultBusinessQuery("active_customers"), deps(fixtureLoaders())),
    ]);
    if (claireRevenue.status !== "ok" || claireRevenue.data.kind !== "totals") throw new Error("unexpected");
    if (claireActive.status !== "ok" || claireActive.data.kind !== "customers") throw new Error("unexpected");
    expect(Math.round(adminRevenue.totalRevenue * 100)).toBe(claireRevenue.data.current.revenueCents);
    expect(adminRevenue.orderCount).toBe(claireRevenue.data.current.orderCount);
    expect(adminRepeat.totalCustomers).toBe(claireActive.data.population.count);
    expect(adminTop.customers.map(c => c.customerName)).toEqual(
      claireActive.data.population.members.slice(0, 3).map(m => m.displayName)
    );
  });
});
