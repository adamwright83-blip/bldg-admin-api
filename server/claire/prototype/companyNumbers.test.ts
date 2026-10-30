import { describe, expect, it, vi } from "vitest";
import type { PaidOrderEvent, PaidOrderLedger } from "../../analytics/paidOrderLedger";
import type { BusinessSourceCoverageSnapshot } from "../../analytics/sourceCoverage";
import type { LaundryFarmCompanyView } from "../../analytics/laundryFarmCompanyView";
import { executeTool, type ToolContext } from "./tools";

const NOW = new Date("2026-10-30T03:00:00.000Z");

function event(key: string, phone: string, source: "cleancloud" | "laundry_butler"): PaidOrderEvent {
  return {
    source, eventKey: key, occurredAt: new Date("2026-10-20T19:00:00.000Z"), businessDate: "2026-10-20", cents: 3000, serviceType: "wash_fold",
    customerName: "Resident", identity: { phone, cleancloudCustomerId: null }, orderNumber: key, address: null, buildingSlug: null,
    processor: source === "laundry_butler" ? "stripe" : "clearent", authorityReceiptId: `receipt:${key}`,
  } as PaidOrderEvent;
}

function ledger(events: PaidOrderEvent[]): PaidOrderLedger {
  return { startUtc: NOW, endExclusiveUtc: NOW, timeZone: "America/Los_Angeles", events, unverifiedNative: [], provenDuplicateExclusions: [], loadedSources: ["laundry_butler", "cleancloud"], failedSources: [], completeness: "complete", reconciliationEvidence: { decisions: [], attributions: [] } };
}

const BOOKS: Record<string, PaidOrderLedger> = {
  laundry_farm: ledger([event("cc-1", "3105550001", "cleancloud"), event("cc-2", "3105550002", "cleancloud")]),
  default: ledger([event("lb-1", "3105550002", "laundry_butler"), event("lb-2", "3105550003", "laundry_butler")]),
};

const staleCleanCloud = { sources: [{ name: "CleanCloud", includedInCombinedBook: true, status: "stale", coveredThrough: "2026-10-26" }] } as unknown as BusinessSourceCoverageSnapshot;
const fresh = { sources: [] } as unknown as BusinessSourceCoverageSnapshot;

function money(cents: number, orders: number) {
  return { recordedSalesCents: cents, capturedPaymentsCents: cents, capturedPaymentsKnownCents: cents, refundCents: 0, netRevenueCents: cents, unpaidBalanceCents: null, orderCount: orders };
}

function readersFor(authorized: string[], extra: Partial<NonNullable<ToolContext["companyReaders"]>> = {}): NonNullable<ToolContext["companyReaders"]> {
  return {
    loadAuthorizedTenantIds: async () => authorized,
    loadLedger: async input => BOOKS[input.tenantId]!,
    loadCoverage: async input => (input.tenantId === "laundry_farm" ? staleCleanCloud : fresh),
    ...extra,
  };
}

function contextWith(authorized: string[], extra: Partial<NonNullable<ToolContext["companyReaders"]>> = {}): ToolContext {
  const readers = readersFor(authorized, extra);
  return {
    tenantId: "default", operatorUserId: "adam-admin", dayDirectorActorId: "1", canonicalOperatorId: "c", timeZone: "America/Los_Angeles", now: () => NOW,
    conversationId: "conv", nextTurnId: () => "t1", operatorTurns: () => [], lastClaireText: () => null, callRowIds: new Set(),
    goalProgressReaders: {
      readMacroGoal: async () => ({ id: "g", objective: "Get to 50 active customers", metricKey: "active_customers", unit: "customers", targetValue: 50, targetDate: null }),
      readRunBaseline: async () => 23,
      readCurrentValue: async input => {
        const { getActiveCustomerStanding } = await import("../activeCustomerStanding");
        const standing = await getActiveCustomerStanding({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, now: input.now, timeZone: input.timeZone }, readers);
        return standing.complete ? { value: standing.value, note: null, standing } : { value: null, note: standing.caveats.join(" "), standing };
      },
    },
    companyReaders: readers,
  };
}

describe("Claire's business numbers read the whole company, the same way as her goal", () => {
  it("read_goal_progress and read_business_numbers give the same active-customer count (a customer in both books counts once)", async () => {
    const context = contextWith(["default", "laundry_farm"]);
    const goal = (await executeTool(context, "read_goal_progress", {})).output as Record<string, unknown>;
    const numbers = (await executeTool(context, "read_business_numbers", { metric: "active_customers", period: "trailing_days", trailing_days: 30 })).output as Record<string, unknown>;
    expect(goal).toMatchObject({ current: 3, current_is_complete: false, current_is_partial: true, to_go: 47 });
    expect(numbers).toMatchObject({ count: 3, complete: false, partial: true, books: ["Laundry Farm", "Laundry Butler"] });
    expect(numbers.caveats).toEqual(goal.caveats);
    expect(numbers.caveats).toEqual(["CleanCloud records only reach 2026-10-26; nothing newer has been imported."]);
  });

  it("revenue comes from the authorized company view with a per-book breakdown, and stale records forbid a final company total", async () => {
    const readCompanyView = vi.fn(async () => ({
      scope: "company", mayStateCompanyTotal: true, tenantsRead: ["laundry_farm", "default"], tenantsUnread: [],
      period: { start: "2026-10-01", end: "2026-10-29", label: "this month" },
      totals: money(120000, 30), businessRevenue: [{ tenantId: "laundry_farm", figures: money(100000, 25) }, { tenantId: "default", figures: money(20000, 5) }],
      overlap: { status: "none", unresolvedIncludedCents: 0, unresolvedPairCount: 0, withheldCents: 0, withheldCount: 0 },
    }) as unknown as LaundryFarmCompanyView);
    const out = (await executeTool(contextWith(["default", "laundry_farm"], { readCompanyView }), "read_business_numbers", { metric: "revenue", period: "this_month" })).output as Record<string, unknown>;
    expect(readCompanyView).toHaveBeenCalledWith(expect.objectContaining({ operatorUserId: "adam-admin", authorizedTenantIds: ["default", "laundry_farm"] }));
    expect(out).toMatchObject({ scope: "company", totals: { recorded_sales: 1200, orders: 30, average_order: 40 }, may_state_company_total: false });
    expect(out.by_book).toEqual([
      { book: "Laundry Farm", recorded_sales: 1000, net_revenue: 1000, refunds: 0, orders: 25, average_order: 40 },
      { book: "Laundry Butler", recorded_sales: 200, net_revenue: 200, refunds: 0, orders: 5, average_order: 40 },
    ]);
  });

  it("an operator authorized for one book reads only that book; the company view is never asked", async () => {
    const readCompanyView = vi.fn();
    const runQuery = vi.fn(async () => ({ status: "ok", period: { start: "2026-10-01", end: "2026-10-29" }, coverage: "complete", data: { revenueCents: 20000 } }));
    const context = contextWith(["default"], { readCompanyView: readCompanyView as never, runQuery: runQuery as never });
    const revenue = (await executeTool(context, "read_business_numbers", { metric: "revenue", period: "this_month" })).output as Record<string, unknown>;
    expect(readCompanyView).not.toHaveBeenCalled();
    expect(runQuery).toHaveBeenCalledWith("default", expect.anything());
    expect(revenue.status).toBe("ok");
    const active = (await executeTool(context, "read_business_numbers", { metric: "active_customers", period: "trailing_days" })).output as Record<string, unknown>;
    expect(active).toMatchObject({ count: 2, books: ["Laundry Butler"], complete: true });
  });

  it("customer lists come per book and say not to add them", async () => {
    const runQuery = vi.fn(async (tenantId: string) => ({ status: "ok", period: { start: "2026-10-01", end: "2026-10-29" }, coverage: "complete", data: { customers: [tenantId] } }));
    const out = (await executeTool(contextWith(["default", "laundry_farm"], { runQuery: runQuery as never }), "read_business_numbers", { metric: "top_customers", period: "this_month" })).output as Record<string, unknown>;
    expect(runQuery.mock.calls.map(call => call[0])).toEqual(["laundry_farm", "default"]);
    expect(out).toMatchObject({ scope: "per_book" });
    expect(String(out.note)).toContain("never add customer counts across books");
  });
});
