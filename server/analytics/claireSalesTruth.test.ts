import { describe, expect, it } from "vitest";
import { certifyHistoricalSales } from "./salesTruthCertificate";
import { validateHistoricalPayload } from "../cleancloudBrowserSync/validation";
import {
  applyLineageFilters,
  lineageBreakdown,
  salesDimensions,
} from "./businessLineage";
import { previousPeriod, resolvePeriod } from "./businessPeriods";
import { reconcileLedgerSpan, reconcilePaidRevenue } from "./canonicalRevenue";
import { loadPaidOrderLedger, type PaidOrderEvent } from "./paidOrderLedger";
import { defaultBusinessQuery, runBusinessQuery } from "./businessQuery";
import {
  fixtureCompleteness,
  fixtureLoaders,
  provenBusinessCoverageSnapshot,
  FIXTURE_NOW,
  FIXTURE_TZ,
} from "./businessLedgerFixture";
import { answerClaireBusinessTurn } from "../claire/businessConversation";

function syntheticExports() {
  const header =
    "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Paid Date,Total,Total after Credit Used,Summary";
  const orders = [header],
    revenue = [header];
  for (let id = 1; id <= 533; id++) {
    const sale = id <= 493 && id !== 141;
    const amount = id === 1 ? "26755.97" : id === 141 ? "-10.00" : "1.00";
    const line = `${id},01 Sep 2026 12:00,Synthetic Customer,1,,${sale || id === 141 ? 1 : 0},${sale ? "01 Sep 2026 12:00" : ""},${sale ? "01 Sep 2026 12:00" : ""},${amount},${amount},${id === 141 ? "Refund for 122" : "Laundry"}`;
    orders.push(line);
    if (sale) revenue.push(line);
  }
  return { ordersCsv: orders.join("\n"), revenueCsv: revenue.join("\n") };
}

const event = (
  key: string,
  source: PaidOrderEvent["source"],
  extra: Partial<PaidOrderEvent> = {}
): PaidOrderEvent => ({
  source,
  eventKey: key,
  cents: 1000,
  occurredAt: new Date("2026-09-01T19:00:00Z"),
  businessDate: "2026-09-01",
  customerName: "Synthetic Customer",
  identity: { cleancloudCustomerId: "1", email: "synthetic@example.invalid" },
  serviceType: null,
  businessLine: source === "cleancloud" ? "laundry_farm" : "laundry_butler",
  building: "centuryparkeast",
  processor: source === "cleancloud" ? "clearent" : "stripe",
  ...extra,
});

describe("Claire sales source completeness", () => {
  it("derives all controls and retains the undated refund without inventing payment time", () => {
    const input = syntheticExports();
    const witness = certifyHistoricalSales(input);
    expect(witness.passed).toBe(true);
    expect(witness.money.revenueCents).toBe(2724697);
    expect(witness.reconciliation.undatedAdjustments).toEqual({
      count: 1,
      cents: -1000,
    });
    expect(JSON.stringify(witness)).not.toContain("Synthetic Customer");
    const validated = validateHistoricalPayload(
      {
        csv: input.ordersCsv,
        from: "2024-01-01",
        to: "2026-10-04",
        storeId: "1",
      },
      "tenant"
    );
    expect(validated.normalized).toHaveLength(533);
    expect(
      validated.normalized.find(row => row.cleancloudOrderId === "141")
    ).toMatchObject({ totalCents: -1000, paymentDateUtc: null });
  });
  it("fails when a source row, control cent, or refund vanishes", () => {
    const input = syntheticExports();
    expect(
      certifyHistoricalSales({
        ...input,
        ordersCsv: input.ordersCsv.split("\n").slice(0, -1).join("\n"),
      }).passed
    ).toBe(false);
    expect(
      certifyHistoricalSales({
        ...input,
        revenueCsv: input.revenueCsv.replaceAll("26755.97", "26755.98"),
      }).passed
    ).toBe(false);
    expect(
      certifyHistoricalSales({
        ...input,
        ordersCsv: input.ordersCsv.replaceAll("-10.00", "0.00"),
      }).passed
    ).toBe(false);
  });
});

describe("independent sales dimensions and durable reconciliation", () => {
  it("CPE, CleanCloud and Clearent never prove Butler; service buckets union once", () => {
    const cloud = event("cleancloud:1", "cleancloud");
    expect(salesDimensions(cloud).serviceLine).toBe("unresolved");
    const events = [
      cloud,
      event("order:1", "laundry_butler"),
      event("cleancloud:2", "cleancloud", { serviceLine: "laundry_farm_core" }),
    ];
    const breakdown = lineageBreakdown(events);
    expect(
      breakdown.byServiceLine.reduce((sum, row) => sum + row.cents, 0)
    ).toBe(breakdown.total.cents);
    expect(
      applyLineageFilters(events, { companies: ["laundry_farm"] })
    ).toHaveLength(3);
    expect(
      applyLineageFilters(events, { serviceLines: ["laundry_butler"] })
    ).toHaveLength(1);
  });
  it("proven same counts once, proven distinct counts twice, unresolved is withheld", () => {
    const events = [
      event("order:1", "laundry_butler"),
      event("cleancloud:1", "cleancloud"),
    ];
    const link = { keptEventKey: "order:1", excludedEventKey: "cleancloud:1" };
    expect(reconcilePaidRevenue({ events }).suspectedWithheld.count).toBe(1);
    expect(
      reconcilePaidRevenue({ events, explicitEconomicLinks: [link] })
        .exactIncludedCents
    ).toBe(1000);
    expect(
      reconcilePaidRevenue({ events, provenDistinctPairs: [link] })
        .exactIncludedCents
    ).toBe(2000);
    const ledger = {
      events,
      provenDuplicateExclusions: [],
      unverifiedNative: [],
      reconciliationEvidence: {
        attributions: [],
        decisions: [
          {
            keptEventKey: "order:1",
            otherEventKey: "cleancloud:1",
            decision: "distinct_sales" as const,
            evidenceReference: "authoritative:separate-orders",
          },
        ],
      },
    };
    expect(
      reconcileLedgerSpan(ledger, { start: "2026-09-01", end: "2026-09-01" })
        .suspectedWithheld.count
    ).toBe(0);
  });
});

describe("period and residential knowledge", () => {
  it("October 4 MTD compares with September 1–4; completed September with completed August", () => {
    const now = new Date("2026-10-04T19:00:00Z");
    expect(
      previousPeriod(
        resolvePeriod({ kind: "this_month" }, now, FIXTURE_TZ),
        now
      )
    ).toMatchObject({ start: "2026-09-01", end: "2026-09-04" });
    expect(
      previousPeriod(
        resolvePeriod({ kind: "last_month" }, now, FIXTURE_TZ),
        now
      )
    ).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
  });
  it("looks up a residential customer before asking the operator", async () => {
    const runQuery = (
      tenant: string,
      query: ReturnType<typeof defaultBusinessQuery>
    ) =>
      runBusinessQuery(tenant, query, {
        loadLedger: input => loadPaidOrderLedger(input, fixtureLoaders()),
        loadOpenOrders: async () => ({
          openTotal: 0,
          byStatus: {},
          awaitingPayment: 0,
        }),
        loadCompleteness: async () => fixtureCompleteness,
        readSourceCoverage: async () => provenBusinessCoverageSnapshot(tenant),
        now: () => FIXTURE_NOW,
        timeZone: () => FIXTURE_TZ,
      });
    const result = await answerClaireBusinessTurn(
      {
        tenantId: "test",
        utterance: "Who is Ava?",
        state: {},
        surface: "text",
      },
      {
        runQuery,
        now: () => FIXTURE_NOW,
        timeZone: () => FIXTURE_TZ,
        plan: async () => null,
        loadBindings: async () => ({
          laundry_butler: {
            state: "bound",
            lastSuccessAt: FIXTURE_NOW,
            coverageRanges: [],
            latestAttempt: null,
            isSystemOfRecord: true,
          },
          cleancloud: {
            state: "bound",
            lastSuccessAt: FIXTURE_NOW,
            coverageRanges: [],
            latestAttempt: null,
            isSystemOfRecord: false,
          },
        }),
      }
    );
    expect(result.handled).toBe(true);
    expect(result.speak).toContain("Ava");
    expect(result.result?.status).toBe("ok");
  });
});

describe("economic decision graph safety", () => {
  it("rejects duplicate event keys and circular or conflicting economic links", () => {
    const a = event("a", "laundry_butler"), b = event("b", "cleancloud");
    expect(() => reconcilePaidRevenue({ events: [a, a] })).toThrow("Duplicate economic event key");
    expect(() => reconcilePaidRevenue({ events: [a, b], explicitEconomicLinks: [{ keptEventKey: "a", excludedEventKey: "b" }, { keptEventKey: "b", excludedEventKey: "a" }] })).toThrow("cycle");
    expect(() => reconcilePaidRevenue({ events: [a, b], explicitEconomicLinks: [{ keptEventKey: "a", excludedEventKey: "b" }, { keptEventKey: "c", excludedEventKey: "b" }] })).toThrow("conflicting");
  });
  it("withholds a proven copy when its canonical parent is outside the window", () => {
    const result = reconcilePaidRevenue({ events: [event("b", "cleancloud")], explicitEconomicLinks: [{ keptEventKey: "a", excludedEventKey: "b" }] });
    expect(result.exactIncludedCents).toBe(0);
    expect(result.unresolvedLinkCount).toBe(1);
  });
});
