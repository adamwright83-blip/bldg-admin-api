import { withFixturePaymentAuthority } from "../analytics/businessLedgerFixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as canonical from "../analytics/canonicalRevenue";
import type {
  CleanCloudOrderRow,
  LedgerLoaders,
  NativeOrderRow,
} from "../analytics/paidOrderLedger";
import { listCustomerAssets } from "../customerAssets/customerAssetProjection";
import { getTruePnlCockpitSummary } from "../truePnlCockpit";
import { getMoneyProjection } from "./moneyProjectionService";

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: async () => [] }) }),
  }),
}));
vi.mock("../customerAssets/customerAssetProjection", () => ({
  listCustomerAssets: vi.fn(async () => []),
}));
vi.mock("../truePnlCockpit", () => ({
  getTruePnlCockpitSummary: vi.fn(async () => null),
}));

const actualRead = canonical.readCanonicalRevenue;
const paidAt = new Date("2026-10-01T19:00:00Z");
function native(id: number, total: string, date = paidAt): NativeOrderRow {
  return {
    id,
    total,
    paid: true,
    paidAt: date,
    stripePaymentIntentId: `pi_${id}`,
    serviceType: "wash_fold",
    firstName: "",
    lastName: "",
    phone: null,
    email: null,
    bldgUserId: null,
  };
}
function cleancloud(
  report: "orders_sales" | "orders_revenue",
  date = paidAt
): CleanCloudOrderRow {
  return {
    cleancloudOrderId: "602",
    cleancloudCustomerId: null,
    sourceReportType: report,
    paymentDateUtc: report === "orders_sales" ? date : null,
    paidDateUtc: report === "orders_revenue" ? date : null,
    paid: true,
    totalCents: 73739,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
  };
}
function integrate(
  nativeRows: NativeOrderRow[],
  cleancloudRows: CleanCloudOrderRow[],
  fail = false,
  proof: "admitted" | "missing" | "unavailable" = "admitted"
) {
  const loaders: LedgerLoaders = {
    laundry_butler: async () => {
      if (fail) throw new Error("unavailable");
      return nativeRows;
    },
    cleancloud: async () => {
      if (fail) throw new Error("unavailable");
      return cleancloudRows;
    },
  };
  const admitted = withFixturePaymentAuthority(loaders);
  if (proof === "missing") admitted.paymentAuthority = async () => [];
  if (proof === "unavailable") admitted.paymentAuthority = async () => { throw new Error("authority unavailable"); };
  // Only source loading is substituted: real canonical mapping, deduplication,
  // period filtering and coverage qualification all execute beneath Money.
  return vi
    .spyOn(canonical, "readCanonicalRevenue")
    .mockImplementation(input =>
      actualRead({ ...input, loaders: admitted, coverage: null })
    );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T01:00:00Z"));
  vi.mocked(listCustomerAssets).mockResolvedValue([]);
  vi.mocked(getTruePnlCockpitSummary).mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Money canonical paid revenue", () => {
  it("includes Stripe with empty payment projections", async () => {
    integrate([native(701, "85.80")], []);
    const money = await getMoneyProjection({ tenantId: "default" });
    expect(money.collectedRevenue.value).toBe(8580);
    expect(money.realizedRevenue.value).toBe(8580);
    expect(money.refunds.value).toBe(0);
  });
  it("includes CleanCloud without native orders or payment projections", async () => {
    integrate([], [cleancloud("orders_sales")]);
    expect(
      (await getMoneyProjection({ tenantId: "default" })).collectedRevenue.value
    ).toBe(73739);
  });
  it("uses real canonical CleanCloud deduplication when both reports overlap", async () => {
    integrate(
      [native(701, "85.80")],
      [cleancloud("orders_sales"), cleancloud("orders_revenue")]
    );
    const money = await getMoneyProjection({ tenantId: "default" });
    expect(money.collectedRevenue.value).toBe(82319);
    expect(money.realizedRevenue.value).toBe(82319);
  });
  it("preserves cumulative payment revenue, business-local boundaries and monthly P&L", async () => {
    const read = integrate(
      [
        native(1, "10.00", new Date("2024-11-19T20:00:00Z")),
        native(2, "20.00"),
        native(3, "999.00", new Date("2026-10-06T07:00:00Z")),
      ],
      []
    );
    expect(
      (await getMoneyProjection({ tenantId: "default" })).collectedRevenue.value
    ).toBe(3000);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "default",
        from: "2020-01-01",
        to: "2026-10-05",
        timeZone: "America/Los_Angeles",
      })
    );
    expect(getTruePnlCockpitSummary).toHaveBeenCalledWith({ period: "month" });
  });
  it("never adds attributed commercial revenue on top of canonical payments", async () => {
    integrate([native(1, "100.00")], []);
    vi.mocked(listCustomerAssets).mockResolvedValue([
      {
        outstandingReceivables: { value: 1200 },
        commercial: { realizedRevenue: { value: 10000 } },
      },
    ] as unknown as Awaited<ReturnType<typeof listCustomerAssets>>);
    const money = await getMoneyProjection({ tenantId: "default" });
    expect(money.realizedRevenue.value).toBe(10000);
    expect(money.receivables.value).toBe(1200);
  });
  it("keeps recorded revenue nonzero but qualifies missing coverage", async () => {
    integrate([], [cleancloud("orders_sales")]);
    const money = await getMoneyProjection({ tenantId: "other-tenant" });
    expect(money.collectedRevenue.value).toBe(73739);
    expect(money.collectedRevenue.confidence).toBe("medium");
    expect(money.collectedRevenue.sourceReference).toContain(
      "other-tenant:2020-01-01:2026-10-05:America/Los_Angeles:recorded_only"
    );
    expect(money.trust.trusted).toBe(false);
    expect(money.trust.warnings.some(w => w.includes("recorded only"))).toBe(
      true
    );
    expect(getTruePnlCockpitSummary).not.toHaveBeenCalled();
  });
  it("returns unknown rather than zero when both canonical sources fail", async () => {
    integrate([], [], true);
    const money = await getMoneyProjection({ tenantId: "default" });
    expect(money.collectedRevenue.value).toBeNull();
    expect(money.realizedRevenue.provenance).toBe("UNKNOWN");
    expect(money.dataQuality.status).toBe("insufficient");
  });
});


describe("Money Authority Receipt availability", () => {
 it("keeps an unread receipt batch unknown for cumulative payment revenue", async()=>{
  integrate([native(701,"85.80")],[cleancloud("orders_sales")],false,"unavailable");
  const money=await getMoneyProjection({tenantId:"default"});
  expect(money.collectedRevenue).toMatchObject({value:null,provenance:"UNKNOWN"});
  expect(money.trust.warnings.join(" ")).toContain("unavailable");
 });
 it("holds missing proof out with recorded-only qualification, not an exact cumulative zero",async()=>{
  integrate([native(701,"85.80")],[cleancloud("orders_sales")],false,"missing");
  const money=await getMoneyProjection({tenantId:"default"});
  expect(money.collectedRevenue).toMatchObject({value:0,confidence:"medium"});
  expect(money.collectedRevenue.sourceReference).toContain(":recorded_only");
 });
});
