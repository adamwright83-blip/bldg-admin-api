import { withFixturePaymentAuthority } from "./analytics/businessLedgerFixture";
/* LEGACY DAYFORGE COMPATIBILITY: membership openId fixtures exercise the existing authenticated tenant path. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import * as canonical from "./analytics/canonicalRevenue";
import type {
  CleanCloudOrderRow,
  LedgerLoaders,
  NativeOrderRow,
} from "./analytics/paidOrderLedger";
import {
  getAdminDashboardSummary,
  resetDbForTesting,
  setDbForTesting,
} from "./db";
import { createContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";
import { getCollectedTodayCents } from "./revenueIntervention";
import { getClearentCollectedTodayCents } from "./clearent";

vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: vi.fn(), authenticateSessionToken: vi.fn() },
}));
vi.mock("./goldlineOnboarding/demoAccess", () => ({
  authenticateGoldlineDemoRequest: async () => null,
}));
vi.mock("./clearent", async importOriginal => ({
  ...(await importOriginal<typeof import("./clearent")>()),
  getClearentCollectedTodayCents: vi.fn(async () => null),
}));
const actualRead = canonical.readCanonicalRevenue;
const now = new Date("2026-10-05T19:00:00Z");
function native(id: number, total: string, paidAt = now): NativeOrderRow {
  return {
    id,
    total,
    paid: true,
    paidAt,
    stripePaymentIntentId: `pi_${id}`,
    serviceType: "wash_fold",
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    bldgUserId: null,
  };
}
function cleancloud(
  report: "orders_sales" | "orders_revenue"
): CleanCloudOrderRow {
  return {
    cleancloudOrderId: "603",
    cleancloudCustomerId: null,
    sourceReportType: report,
    paymentDateUtc: report === "orders_sales" ? now : null,
    paidDateUtc: report === "orders_revenue" ? now : null,
    paid: true,
    totalCents: 73739,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
  };
}
function integrate(
  rows: Record<
    string,
    { native: NativeOrderRow[]; cleancloud: CleanCloudOrderRow[] }
  >,
  fail = false,
  proof: "admitted" | "missing" | "unavailable" = "admitted"
) {
  return vi
    .spyOn(canonical, "readCanonicalRevenue")
    .mockImplementation(input => {
      const source = rows[input.tenantId] ?? { native: [], cleancloud: [] };
      const loaders: LedgerLoaders = {
        laundry_butler: async () => {
          if (fail) throw new Error("source down");
          return source.native;
        },
        cleancloud: async () => {
          if (fail) throw new Error("source down");
          return source.cleancloud;
        },
      };
      // The owning reader executes its real payment filters, deduplication,
      // calendar bounds, count and coverage logic; only source IO is replaced.
      const admitted = withFixturePaymentAuthority(loaders);
      if (proof === "missing") admitted.paymentAuthority = async () => [];
      if (proof === "unavailable") admitted.paymentAuthority = async () => { throw new Error("authority unavailable"); };
      return actualRead({ ...input, loaders: admitted, coverage: null });
    });
}
function operationalDb() {
  const query: any = {
    where: () => query,
    then: (resolve: (rows: unknown[]) => void) =>
      Promise.resolve([{ n: 999 }]).then(resolve),
  };
  return { select: () => ({ from: () => query }) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  setDbForTesting(operationalDb());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetDbForTesting();
});

describe("Home canonical revenue integration", () => {
  it("uses combined canonical today/week/month values, overlap deduplication, counts and AOV", async () => {
    const read = integrate({
      "tenant-a": {
        native: [
          native(701, "85.80"),
          native(1, "10.00", new Date("2026-10-01T19:00:00Z")),
        ],
        cleancloud: [cleancloud("orders_sales"), cleancloud("orders_revenue")],
      },
    });
    const home = await getAdminDashboardSummary({ tenantId: "tenant-a" });
    expect(home?.revenueToday).toBe(823.19);
    expect(home?.revenueWeek).toBe(823.19);
    expect(home?.revenueMonth).toBe(833.19);
    expect(home?.paidOrderCountMonth).toBe(3);
    expect(home?.avgOrderValueMonth).toBeCloseTo(833.19 / 3);
    expect(home?.totalOrders).toBe(999); // native operational counts are not revenue authority
    expect(
      read.mock.calls.map(([input]) => [
        input.tenantId,
        input.from,
        input.to,
        input.timeZone,
      ])
    ).toEqual([
      ["tenant-a", "2026-10-05", "2026-10-05", "America/Los_Angeles"],
      ["tenant-a", "2026-10-05", "2026-10-11", "America/Los_Angeles"],
      ["tenant-a", "2026-10-01", "2026-10-31", "America/Los_Angeles"],
    ]);
    expect(home?.revenuePeriods?.month).toMatchObject({
      precision: "recorded_only",
      recordedCents: 83319,
      statedExactCents: null,
      paidOrderCount: 3,
      stripeCents: 9580,
      cleanCloudCents: 73739,
    });
  });
  it("includes CleanCloud even without native paid orders", async () => {
    integrate({
      "tenant-a": { native: [], cleancloud: [cleancloud("orders_sales")] },
    });
    const home = await getAdminDashboardSummary({ tenantId: "tenant-a" });
    expect(home?.revenueMonth).toBe(737.39);
    expect(home?.paidOrderCountMonth).toBe(1);
    expect(home?.avgOrderValueMonth).toBe(737.39);
  });
  it("does not treat a native paid flag without Stripe evidence as revenue", async () => {
    integrate({
      "tenant-a": {
        native: [{ ...native(1, "999.00"), stripePaymentIntentId: null }],
        cleancloud: [],
      },
    });
    const home = await getAdminDashboardSummary({ tenantId: "tenant-a" });
    expect(home?.revenueMonth).toBe(0);
    expect(home?.paidOrderCountMonth).toBe(0);
    expect(home?.revenuePeriods?.month.statedExactCents).toBeNull();
  });
  it("returns null revenue and count, not exact zero, when canonical sources are unavailable", async () => {
    integrate({}, true);
    const home = await getAdminDashboardSummary({ tenantId: "tenant-a" });
    expect(home?.revenueToday).toBeNull();
    expect(home?.revenueWeek).toBeNull();
    expect(home?.revenueMonth).toBeNull();
    expect(home?.paidOrderCountMonth).toBeNull();
    expect(home?.avgOrderValueMonth).toBeNull();
    expect(home?.revenuePeriods?.month).toMatchObject({
      status: "unavailable",
      precision: "unavailable",
      recordedCents: null,
      statedExactCents: null,
    });
  });
  it("preserves full calendar weeks/months through the LA DST transition", async () => {
    vi.setSystemTime(new Date("2026-11-01T19:00:00Z"));
    const read = integrate({});
    await getAdminDashboardSummary({ tenantId: "tenant-a" });
    expect(read.mock.calls.map(([input]) => [input.from, input.to])).toEqual([
      ["2026-11-01", "2026-11-01"],
      ["2026-10-26", "2026-11-01"],
      ["2026-11-01", "2026-11-30"],
    ]);
  });
  it("passes the authenticated membership tenant through the real router despite a foreign Host header", async () => {
    const read = integrate({
      "tenant-a": { native: [native(1, "85.80")], cleancloud: [] },
      "tenant-b": { native: [native(2, "999.00")], cleancloud: [] },
    });
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({
      id: 1,
      openId: "dayforge:member-a",
      role: "user",
      tenantId: "tenant-a",
    } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);
    const ctx = await createContext({
      req: { headers: { host: "foreign.example", "x-tenant-id": "tenant-b" } },
      res: {},
    } as CreateExpressContextOptions);
    expect(ctx.tenantId).toBe("tenant-a");
    const home = await appRouter.createCaller(ctx).admin.dashboardSummary();
    expect(home.revenueToday).toBe(85.8);
    expect(home.paymentProcessorTotals.stripe.collectedToday).toBe(85.8);
    expect(home.paymentProcessorTotals.cleanCloud.includedInPaymentTruth).toBe(
      true
    );
    expect(
      read.mock.calls.every(([input]) => input.tenantId === "tenant-a")
    ).toBe(true);
    // An authenticated second tenant sees its own book, not tenant-a's book.
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({
      id: 2,
      openId: "dayforge:member-b",
      role: "user",
      tenantId: "tenant-b",
    } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);
    const secondCtx = await createContext({
      req: { headers: { host: "admin.bldg.chat" } },
      res: {},
    } as CreateExpressContextOptions);
    expect(
      (await appRouter.createCaller(secondCtx).admin.dashboardSummary())
        .revenueToday
    ).toBe(999);
  });
  it("keeps the router's no-database fallback unknown rather than zero", async () => {
    resetDbForTesting();
    const home = await appRouter
      .createCaller({
        user: {
          openId: "dayforge:member-a",
          role: "user",
          tenantId: "tenant-a",
        },
        tenantId: "tenant-a",
        vendorSession: null,
      } as any)
      .admin.dashboardSummary();
    expect(home.revenueMonth).toBeNull();
    expect(home.paidOrderCountMonth).toBeNull();
    expect(home.revenuePeriods).toBeNull();
  });
});


describe("Collected today canonical integration", () => {
  it("uses explicit tenant combined cents and canonical overlap/precision, without adding settlement totals", async () => {
    const read = integrate({
      "tenant-a": {
        native: [native(1, "85.80")],
        cleancloud: [cleancloud("orders_sales"), cleancloud("orders_revenue")],
      },
      "tenant-b": { native: [native(2, "999.00")], cleancloud: [] },
    });
    vi.mocked(getClearentCollectedTodayCents).mockResolvedValue({
      collectedCents: 50000,
      settledCents: 40000,
    } as any);
    const caller = (tenantId: string) =>
      appRouter.createCaller({
        user: { openId: "admin-owner", role: "admin", tenantId },
        tenantId,
        vendorSession: null,
      } as any);
    const result = await caller("tenant-a").admin.getCollectedToday();
    expect(result).toMatchObject({
      cents: 82319,
      stripeCents: 8580,
      cleanCloudCents: 73739,
      clearentCents: 50000,
      precision: "recorded_only",
      statedExactCents: null,
      dbAvailable: true,
      processorLabel: "Stripe + CleanCloud",
    });
    expect(read.mock.calls[0][0]).toMatchObject({
      tenantId: "tenant-a",
      from: "2026-10-05",
      to: "2026-10-05",
      timeZone: "America/Los_Angeles",
    });
    expect((await caller("tenant-b").admin.getCollectedToday()).cents).toBe(
      99900,
    );
  });
  it("returns unknown when canonical sources are unavailable, even when settlement evidence exists", async () => {
    integrate({}, true);
    vi.mocked(getClearentCollectedTodayCents).mockResolvedValue({
      collectedCents: 50000,
      settledCents: 40000,
    } as any);
    expect(await getCollectedTodayCents("tenant-a", now)).toBeNull();
    const result = await appRouter
      .createCaller({
        user: { openId: "admin-owner", role: "admin" },
        tenantId: "tenant-a",
        vendorSession: null,
      } as any)
      .admin.getCollectedToday();
    expect(result).toMatchObject({
      cents: null,
      stripeCents: null,
      cleanCloudCents: null,
      dbAvailable: false,
      precision: "unavailable",
      statedExactCents: null,
      clearentCents: 50000,
    });
  });
});


describe("Home payment proof availability", () => {
  it("keeps an unread receipt batch unknown across calendar revenue, count and AOV", async () => {
    integrate({"tenant-a":{native:[native(1,"85.80")],cleancloud:[cleancloud("orders_sales")]}},false,"unavailable");
    const home=await getAdminDashboardSummary({tenantId:"tenant-a"});
    expect(home).toMatchObject({revenueToday:null,revenueWeek:null,revenueMonth:null,paidOrderCountMonth:null,avgOrderValueMonth:null,revenuePeriods:{month:{precision:"unavailable",recordedCents:null}}});
  });
  it("qualifies held-out missing proof rather than claiming exact calendar zero", async () => {
    integrate({"tenant-a":{native:[native(1,"85.80")],cleancloud:[cleancloud("orders_sales")]}},false,"missing");
    const home=await getAdminDashboardSummary({tenantId:"tenant-a"});
    expect(home?.revenuePeriods?.month).toMatchObject({recordedCents:0,statedExactCents:null,precision:"recorded_only"});
    expect(home?.revenuePeriods?.month.coverage.failedSources).toEqual(expect.arrayContaining(["laundry_butler","cleancloud"]));
  });
});
