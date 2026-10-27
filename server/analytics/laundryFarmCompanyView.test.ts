import { describe, expect, it, vi } from "vitest";
import { BUILDINGS, type BuildingConfig } from "../../shared/buildings";
import { zonedDayStartUtc } from "../dashboardZoned";
import { answerClaireBusinessTurn, type ClaireAnalyticsState } from "../claire/businessConversation";
import {
  attributeCompanyBuilding,
  companyBuildingTableRows,
  composeLaundryFarmCompanyView,
  LAUNDRY_FARM_COMPANY_READER,
  LAUNDRY_FARM_COMPANY_TIME_ZONE,
  matchLaundryFarmCompanyQuestion,
  readLaundryFarmCompanyView,
  type CompanyLedgerWindow,
  type CompanySaleInput,
} from "./laundryFarmCompanyView";
import type { PaidOrderEvent, PaidOrderLedger } from "./paidOrderLedger";

const NOW = new Date("2026-10-19T18:00:00.000Z");
const RESIDENCES: BuildingConfig = {
  id: "the_residences",
  slug: "the-residences",
  name: "The Residences",
  addressKeywords: ["888 grand"],
  total_units: 120,
  slugAliases: ["the-residences"],
};
const CATALOG = [...BUILDINGS, RESIDENCES];

function sale(partial: Partial<CompanySaleInput> & Pick<CompanySaleInput, "tenantId" | "eventKey" | "rail" | "recordedSalesCents">): CompanySaleInput {
  return {
    businessDate: "2026-10-05",
    address: null,
    buildingSlug: null,
    capturedPaymentsCents: partial.rail === "stripe" ? partial.recordedSalesCents : null,
    refundCents: 0,
    identity: { phone: partial.eventKey },
    ...partial,
  };
}

function compose(sales: CompanySaleInput[], extra: Partial<Parameters<typeof composeLaundryFarmCompanyView>[0]> = {}) {
  return composeLaundryFarmCompanyView({
    period: { start: "2026-10-01", end: "2026-10-19", label: "this month so far" },
    scope: "company",
    mayStateCompanyTotal: true,
    tenantsRead: ["laundry_farm", "default"],
    tenantsUnread: [],
    sales,
    unpaid: null,
    catalog: CATALOG,
    ...extra,
  });
}

function event(input: {
  key: string;
  cents: number;
  rail: "stripe" | "cleancloud_clearant";
  date?: string;
  address?: string | null;
  buildingSlug?: string | null;
  phone?: string | null;
  cleancloudCustomerId?: string | null;
  customerName?: string | null;
}): PaidOrderEvent {
  return {
    source: input.rail === "stripe" ? "laundry_butler" : "cleancloud",
    eventKey: input.key,
    occurredAt: new Date(`${input.date ?? "2026-10-05"}T19:00:00.000Z`),
    businessDate: input.date ?? "2026-10-05",
    cents: input.cents,
    serviceType: "wash_fold",
    customerName: input.customerName ?? "Resident",
    identity: { phone: input.phone ?? input.key, cleancloudCustomerId: input.cleancloudCustomerId ?? null },
    orderNumber: input.key,
    address: input.address ?? null,
    buildingSlug: input.buildingSlug ?? null,
    processor: input.rail === "stripe" ? "stripe" : "clearent",
    authorityReceiptId: input.rail === "stripe" && input.cents >= 0 ? `receipt:${input.key}` : undefined,
  };
}

function ledger(window: CompanyLedgerWindow, events: PaidOrderEvent[]): PaidOrderLedger {
  return {
    startUtc: window.startUtc,
    endExclusiveUtc: window.endExclusiveUtc,
    timeZone: window.timeZone,
    events,
    unverifiedNative: [],
    provenDuplicateExclusions: [],
    loadedSources: ["laundry_butler", "cleancloud"],
    failedSources: [],
    completeness: "complete",
    reconciliationEvidence: { decisions: [], attributions: [] },
  };
}

const STRIPE_OPUS = event({ key: "stripe-opus", cents: 25000, rail: "stripe", date: "2026-10-02", address: "3545 Wilshire Blvd", phone: "3105551001" });
const STRIPE_CPE = event({ key: "stripe-cpe", cents: 8000, rail: "stripe", date: "2026-10-03", address: "2170 Century Park East", phone: "3105551002" });
const STRIPE_UNASSIGNED = event({ key: "stripe-lux", cents: 4000, rail: "stripe", date: "2026-10-04", address: "100 Unknown Plaza", buildingSlug: "luxury", phone: "3105551003" });
const STRIPE_REGULAR = event({ key: "stripe-regular", cents: 2200, rail: "stripe", date: "2026-10-06", address: "742 Evergreen Terrace", phone: "3105551004" });
const CLOUD_OPUS = event({ key: "cloud-opus", cents: 17500, rail: "cleancloud_clearant", date: "2026-10-02", address: "3650 W 6th Street", phone: "3105552001" });
const CLOUD_CPE = event({ key: "cloud-cpe", cents: 6000, rail: "cleancloud_clearant", date: "2026-10-03", address: "2160 Century Park E", phone: "3105552002" });
const CLOUD_REGULAR = event({ key: "cloud-regular", cents: 3000, rail: "cleancloud_clearant", date: "2026-10-07", address: "88 Oak Street", phone: "3105552003" });
const CLOUD_REFUND = event({ key: "cloud-refund", cents: -500, rail: "cleancloud_clearant", date: "2026-10-08", address: "88 Oak Street", phone: "3105552003" });
const PROOF = event({
  key: "proof",
  cents: 99900,
  rail: "cleancloud_clearant",
  date: "2026-10-09",
  address: "88 Oak Street",
  cleancloudCustomerId: "dgoal_proof_silver_lake_objective",
  customerName: "mission_winback_silver-lake",
});
const SEPTEMBER = event({ key: "september", cents: 50000, rail: "stripe", date: "2026-09-30", address: "3545 Wilshire Blvd", phone: "3105551999" });

const BOOKS: Record<string, PaidOrderEvent[]> = {
  default: [STRIPE_OPUS, STRIPE_CPE, STRIPE_UNASSIGNED, STRIPE_REGULAR, SEPTEMBER],
  laundry_farm: [CLOUD_OPUS, CLOUD_CPE, CLOUD_REGULAR, CLOUD_REFUND, PROOF],
};

function readBooks(authorized: string[]) {
  const seen: string[] = [];
  const windows: CompanyLedgerWindow[] = [];
  const view = readLaundryFarmCompanyView({
    operatorUserId: "operator-1",
    now: NOW,
    authorizedTenantIds: authorized,
    loadUnpaid: async tenantId => (tenantId === "laundry_farm" ? [{ tenantId, totalCents: 1500, address: "3545 Wilshire Blvd", buildingSlug: "opusla" }] : []),
    loadLedger: async window => {
      seen.push(window.tenantId);
      windows.push(window);
      if (!authorized.includes(window.tenantId)) throw new Error(`read ${window.tenantId}`);
      return ledger(window, BOOKS[window.tenantId] ?? []);
    },
  });
  return { seen, windows, view };
}

describe("Laundry Farm company view", () => {
  it("attributes buildings from address and property evidence, never tenant id", () => {
    expect(attributeCompanyBuilding({ address: "3545 Wilshire Blvd", buildingSlug: null }).bucket).toBe("opus_la");
    expect(attributeCompanyBuilding({ address: "2170 Century Park East", buildingSlug: null }).bucket).toBe("century_park_east");
    expect(attributeCompanyBuilding({ address: "742 Evergreen Terrace", buildingSlug: null }).bucket).toBe("regular_apartments");
    expect(attributeCompanyBuilding({ address: "100 Unknown Plaza", buildingSlug: "luxury" })).toMatchObject({
      bucket: "unassigned_building",
      kind: "unassigned_building",
    });
    const swapped = compose([
      sale({ tenantId: "default", eventKey: "a", rail: "stripe", recordedSalesCents: 100, address: "742 Evergreen Terrace" }),
      sale({ tenantId: "laundry_farm", eventKey: "b", rail: "cleancloud_clearant", recordedSalesCents: 200, address: "3545 Wilshire Blvd" }),
    ]);
    expect(swapped.buildings.find(row => row.bucket === "regular_apartments")?.figures.recordedSalesCents).toBe(100);
    expect(swapped.buildings.find(row => row.bucket === "opus_la")?.figures.recordedSalesCents).toBe(200);
    expect(swapped.buildings.find(row => row.bucket === "unassigned_building")).toBeUndefined();
  });

  it("rolls every bucket into the company total, with both rails inside OPUS and Century Park East", () => {
    const view = compose([
      sale({ tenantId: "default", eventKey: "so", rail: "stripe", recordedSalesCents: 25000, address: "3545 Wilshire Blvd", capturedPaymentsCents: 25000 }),
      sale({ tenantId: "laundry_farm", eventKey: "co", rail: "cleancloud_clearant", recordedSalesCents: 17500, address: "3650 W 6th Street", capturedPaymentsCents: null }),
      sale({ tenantId: "default", eventKey: "sc", rail: "stripe", recordedSalesCents: 8000, address: "2170 Century Park East", capturedPaymentsCents: 8000 }),
      sale({ tenantId: "laundry_farm", eventKey: "cc", rail: "cleancloud_clearant", recordedSalesCents: 6000, address: "2160 Century Park E", capturedPaymentsCents: null }),
      sale({ tenantId: "laundry_farm", eventKey: "lux", rail: "cleancloud_clearant", recordedSalesCents: 4000, buildingSlug: "luxury", address: "100 Unknown Plaza", capturedPaymentsCents: null }),
      sale({ tenantId: "default", eventKey: "reg", rail: "stripe", recordedSalesCents: 3000, address: "742 Evergreen Terrace", capturedPaymentsCents: 3000 }),
      sale({ tenantId: "default", eventKey: "res", rail: "stripe", recordedSalesCents: 9000, address: "888 Grand Avenue", capturedPaymentsCents: 9000 }),
    ]);
    const sum = view.buildings.reduce((total, building) => total + building.figures.recordedSalesCents, 0);
    expect(sum).toBe(view.totals.recordedSalesCents);
    expect(view.totals.recordedSalesCents).toBe(72500);
    const opus = view.buildings.find(row => row.bucket === "opus_la")!;
    const century = view.buildings.find(row => row.bucket === "century_park_east")!;
    expect(opus.rails.map(rail => rail.rail).sort()).toEqual(["cleancloud_clearant", "stripe"]);
    expect(century.rails.map(rail => rail.rail).sort()).toEqual(["cleancloud_clearant", "stripe"]);
    expect(opus.figures.recordedSalesCents).toBe(42500);
    expect(century.figures.recordedSalesCents).toBe(14000);
    expect(view.buildings.find(row => row.bucket === "unassigned_building")?.figures.recordedSalesCents).toBe(4000);
    expect(view.buildings.find(row => row.bucket === "regular_apartments")?.figures.recordedSalesCents).toBe(3000);
    expect(view.buildings.find(row => row.bucket === "the_residences")?.label).toBe("The Residences");
    expect(view.buildings.find(row => row.label === "Unassigned building")?.kind).not.toBe("regular_apartments");
  });

  it("keeps recorded sales, captured payments, refunds, net revenue, and unpaid balances distinct", () => {
    const view = compose(
      [
        sale({
          tenantId: "default",
          eventKey: "captured-less",
          rail: "stripe",
          recordedSalesCents: 10000,
          capturedPaymentsCents: 9000,
          admittedCents: 9000,
          address: "3545 Wilshire Blvd",
        }),
        sale({
          tenantId: "laundry_farm",
          eventKey: "recorded-only",
          rail: "cleancloud_clearant",
          recordedSalesCents: 4000,
          capturedPaymentsCents: null,
          admittedCents: 4000,
          address: "88 Oak Street",
        }),
        sale({
          tenantId: "laundry_farm",
          eventKey: "refund",
          rail: "cleancloud_clearant",
          recordedSalesCents: 0,
          capturedPaymentsCents: null,
          refundCents: -500,
          admittedCents: -500,
          address: "88 Oak Street",
        }),
      ],
      { unpaid: [{ tenantId: "laundry_farm", totalCents: 2000, address: "88 Oak Street" }] }
    );
    expect(view.totals.recordedSalesCents).toBe(14000);
    expect(view.totals.capturedPaymentsCents).toBeNull();
    expect(view.totals.capturedPaymentsKnownCents).toBe(9000);
    expect(view.totals.refundCents).toBe(-500);
    expect(view.totals.netRevenueCents).toBe(12500);
    expect(view.totals.unpaidBalanceCents).toBe(2000);
    const figures = [
      view.totals.recordedSalesCents,
      view.totals.capturedPaymentsKnownCents,
      view.totals.refundCents,
      view.totals.netRevenueCents,
      view.totals.unpaidBalanceCents,
    ];
    expect(new Set(figures).size).toBe(figures.length);
  });

  it("discloses an unresolved cross-rail overlap without erasing verified totals or inventing a deduplicated total", () => {
    const phone = "3105553333";
    const view = compose([
      sale({ tenantId: "default", eventKey: "native", rail: "stripe", recordedSalesCents: 5000, address: "3545 Wilshire Blvd", identity: { phone }, capturedPaymentsCents: 5000 }),
      sale({ tenantId: "laundry_farm", eventKey: "cloud", rail: "cleancloud_clearant", recordedSalesCents: 5000, address: "3545 Wilshire Blvd", identity: { phone }, capturedPaymentsCents: null }),
      sale({ tenantId: "laundry_farm", eventKey: "other-day", rail: "cleancloud_clearant", recordedSalesCents: 3200, businessDate: "2026-10-06", address: "88 Oak Street", identity: { phone }, capturedPaymentsCents: null }),
      sale({ tenantId: "default", eventKey: "same-day-other-amount", rail: "stripe", recordedSalesCents: 1800, address: "3545 Wilshire Blvd", identity: { phone }, capturedPaymentsCents: 1800 }),
      sale({ tenantId: "default", eventKey: "verified", rail: "stripe", recordedSalesCents: 7000, address: "742 Evergreen Terrace", identity: { phone: "3105554444" }, capturedPaymentsCents: 7000 }),
    ]);
    expect(view.overlap.status).toBe("unresolved");
    expect(view.overlap.unresolvedPairCount).toBe(1);
    expect(view.overlap.unresolvedIncludedCents).toBe(5000);
    expect(view.mayStateDeduplicatedTotal).toBe(false);
    expect(view.totals.recordedSalesCents).toBe(22000);
    expect(view.buildings.reduce((total, building) => total + building.figures.recordedSalesCents, 0)).toBe(22000);
    expect(view.buildings.find(row => row.bucket === "regular_apartments")?.figures.recordedSalesCents).toBe(10200);
    expect(view.buildings.find(row => row.bucket === "opus_la")?.figures.recordedSalesCents).toBe(11800);
  });

  it("reads only the authorized tenant and uses Los Angeles month boundaries", async () => {
    const single = readBooks(["laundry_farm"]);
    const singleView = await single.view;
    expect(single.seen).toEqual(["laundry_farm"]);
    expect(singleView.scope).toBe("single_tenant");
    expect(singleView.mayStateCompanyTotal).toBe(false);
    expect(singleView.tenantsUnread).toContain("default");
    expect(singleView.totals.recordedSalesCents).toBe(26500);
    expect(JSON.stringify(singleView)).not.toContain("25000");
    expect(JSON.stringify(singleView)).not.toContain("99900");
    expect(JSON.stringify(singleView)).not.toContain("50000");

    const both = readBooks(["laundry_farm", "default"]);
    const view = await both.view;
    expect(both.seen.sort()).toEqual(["default", "laundry_farm"]);
    expect(both.windows.every(window => window.timeZone === LAUNDRY_FARM_COMPANY_TIME_ZONE)).toBe(true);
    expect(both.windows[0]!.startUtc.toISOString()).toBe(zonedDayStartUtc("2026-10-01", LAUNDRY_FARM_COMPANY_TIME_ZONE).toISOString());
    expect(view.period).toMatchObject({ start: "2026-10-01", end: "2026-10-19" });
    expect(view.reader).toBe(LAUNDRY_FARM_COMPANY_READER);
    expect(view.mayStateCompanyTotal).toBe(true);
    expect(view.totals.recordedSalesCents).toBe(65700);
    expect(view.totals.refundCents).toBe(-500);
    expect(view.totals.netRevenueCents).toBe(65200);
    expect(view.totals.capturedPaymentsCents).toBeNull();
    expect(view.totals.capturedPaymentsKnownCents).toBe(39200);
    expect(view.totals.unpaidBalanceCents).toBe(1500);
    expect(view.buildings.find(row => row.bucket === "opus_la")?.rails.map(rail => rail.rail).sort()).toEqual(["cleancloud_clearant", "stripe"]);
    expect(view.buildings.find(row => row.bucket === "century_park_east")?.figures.recordedSalesCents).toBe(14000);
    expect(view.buildings.find(row => row.bucket === "unassigned_building")?.figures.recordedSalesCents).toBe(4000);
    expect(view.buildings.find(row => row.bucket === "regular_apartments")?.figures.recordedSalesCents).toBe(5200);
    expect(view.buildings.reduce((total, building) => total + building.figures.recordedSalesCents, 0)).toBe(view.totals.recordedSalesCents);

    const denied = readBooks([]);
    const deniedView = await denied.view;
    expect(denied.seen).toEqual([]);
    expect(deniedView.scope).toBe("unauthorized");
    expect(deniedView.totals.recordedSalesCents).toBe(0);
  });

  it("publishes the same building buckets on the approved company_buildings view", () => {
    const rows = companyBuildingTableRows([CLOUD_OPUS, CLOUD_CPE, CLOUD_REGULAR], "laundry_farm");
    const recorded = rows.reduce((sum, row) => sum + Number(row[3]), 0);
    expect(recorded).toBe(26500);
    expect(rows.some(row => row[0] === "opus_la" && row[2] === "cleancloud_clearant")).toBe(true);
    expect(rows.some(row => row[0] === "regular_apartments")).toBe(true);
  });
});

describe("Claire company questions", () => {
  async function ask(utterance: string, authorized: string[]) {
    const state: ClaireAnalyticsState = {};
    const runQuery = vi.fn();
    const turn = await answerClaireBusinessTurn(
      { tenantId: "default", operatorUserId: "operator-1", utterance, state, surface: "text" },
      {
        now: () => NOW,
        timeZone: () => "America/Los_Angeles",
        plan: async () => null,
        runQuery,
        readCompanyView: input => readLaundryFarmCompanyView({ ...input, authorizedTenantIds: authorized, loadUnpaid: async tenantId => (tenantId === "laundry_farm" ? [{ tenantId, totalCents: 1500, address: "3545 Wilshire Blvd" }] : []), loadLedger: async window => {
          if (!authorized.includes(window.tenantId)) throw new Error(`other tenant ${window.tenantId}`);
          return ledger(window, BOOKS[window.tenantId] ?? []);
        } }),
      }
    );
    return { turn, runQuery };
  }

  it("keeps the monthly combined default and offers a verified breakdown only on request", async () => {
    const all = ["laundry_farm", "default"];
    const question = matchLaundryFarmCompanyQuestion("What's the month's current revenue?");
    expect(question).toEqual({ aspect: "revenue", period: { kind: "this_month" } });
    const combined = await ask("What's the month's current revenue?", all);
    expect(combined.turn.reader).toBe("company_view");
    expect(combined.turn.handled && combined.turn.speak).toContain("Recorded sales this month so far are $657.00 across 7 orders.");
    const direct = await ask("Break down this month's revenue between Laundry Farm and Laundry Butler", all);
    expect(direct.turn.reader).toBe("company_view");
    expect(direct.turn.handled && direct.turn.speak).toContain("Laundry Farm recorded sales this month so far: $265.00.");
    expect(direct.turn.handled && direct.turn.speak).toContain("Laundry Butler recorded sales this month so far: $392.00.");
    expect(direct.turn.handled && direct.turn.speak).toContain("Together, recorded sales this month so far are $657.00.");
    expect(matchLaundryFarmCompanyQuestion("Break that down by business", question)).toEqual({
      aspect: "breakdown", period: { kind: "this_month" },
    });
    expect(matchLaundryFarmCompanyQuestion("Compare Stripe vs CleanCloud revenue this month")?.aspect).toBe("breakdown");
    const limited = await ask("Break down our revenue by business", ["laundry_farm"]);
    expect(limited.turn.handled && limited.turn.speak).toContain("Laundry Butler's book is unavailable");
    expect(limited.turn.handled && limited.turn.speak).not.toContain("$392.00");
    expect(limited.turn.handled && limited.turn.speak).not.toContain("Together:");
    expect(matchLaundryFarmCompanyQuestion("What was wash-and-fold revenue in August?")).toBeNull();
    expect(matchLaundryFarmCompanyQuestion("Split wash-and-fold revenue by business")).toBeNull();
    expect(matchLaundryFarmCompanyQuestion("Break down cash revenue by business")).toBeNull();
    expect(matchLaundryFarmCompanyQuestion("Break down OPUS LA revenue by business")).toBeNull();
    expect(matchLaundryFarmCompanyQuestion("whats the months current revenue")?.aspect).toBe("revenue");
  });

  it("answers company questions from the company view, including both rails", async () => {
    const revenue = await ask("How much have we made this month?", ["laundry_farm", "default"]);
    expect(revenue.runQuery).not.toHaveBeenCalled();
    expect(revenue.turn.reader).toBe("company_view");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("Recorded sales this month so far are $657.00 across 7 orders.");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("OPUS LA recorded $425.00");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("Century Park East recorded $140.00");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("Stripe");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("CleanCloud / Clearant");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("Refunds are -$5.00.");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("Net revenue on the admitted records is $652.00.");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("Verified captured payments are $392.00.");
    expect(revenue.turn.handled && revenue.turn.speak).toContain("Unpaid balances recorded on open orders are $15.00.");

    const orders = await ask("How many orders did we get?", ["laundry_farm", "default"]);
    expect(orders.turn.handled && orders.turn.speak).toContain("There are 7 paid orders this month so far.");

    const health = await ask("How’s Laundry Farm doing?", ["laundry_farm", "default"]);
    expect(health.turn.reader).toBe("company_view");
    expect(health.turn.handled && health.turn.speak).toContain("$657.00");

    const buildings = await ask("How much business are we getting from OPUS LA versus Century Park East?", ["laundry_farm", "default"]);
    expect(buildings.turn.handled && buildings.turn.speak).toContain("OPUS LA recorded $425.00 across 2 orders.");
    expect(buildings.turn.handled && buildings.turn.speak).toContain("Century Park East recorded $140.00 across 2 orders.");
    expect(buildings.turn.handled && buildings.turn.speak).toContain("Those buildings roll into recorded sales of $657.00.");
  });

  it("does not let a single-tenant operator hear the other tenant's money", async () => {
    const farm = await ask("How much have we made this month?", ["laundry_farm"]);
    expect(farm.turn.handled && farm.turn.speak).toContain("This is not a combined Laundry Farm total.");
    expect(farm.turn.handled && farm.turn.speak).toContain("Recorded sales this month so far are $265.00 across 3 orders.");
    expect(farm.turn.handled && farm.turn.speak).not.toContain("$657.00");
    expect(farm.turn.handled && farm.turn.speak).not.toContain("$250.00");
    expect(farm.turn.handled && farm.turn.speak).not.toContain("$425.00");

    const butler = await ask("What's my revenue this week?", ["default"]);
    expect(butler.runQuery).not.toHaveBeenCalled();
    expect(butler.turn.reader).toBe("company_view");
    expect(butler.turn.handled && butler.turn.speak).toContain("This is not a combined Laundry Farm total.");
    expect(butler.turn.handled && butler.turn.speak).toContain("CleanCloud / Clearant book is not included");
    expect(butler.turn.handled && butler.turn.speak).not.toContain("$175.00");
    expect(butler.turn.handled && butler.turn.speak).not.toContain("$657.00");
    expect(butler.turn.handled && butler.turn.speak).not.toContain("$265.00");
  });

  it("answers natural company questions and follow-ups from the company view", async () => {
    expect(matchLaundryFarmCompanyQuestion("What's my revenue this week?")).toEqual({
      aspect: "revenue",
      period: { kind: "this_week" },
    });
    expect(matchLaundryFarmCompanyQuestion("How did OPUS LA do last month?")).toEqual({
      aspect: "buildings",
      period: { kind: "last_month" },
    });
    expect(matchLaundryFarmCompanyQuestion("What was revenue in the last 30 days?")).toBeNull();
    expect(matchLaundryFarmCompanyQuestion("How much did we make?")).toEqual({ aspect: "revenue", period: { kind: "this_month" } });
    expect(matchLaundryFarmCompanyQuestion("What was revenue from OPUS last month?")).toBeNull();
    expect(matchLaundryFarmCompanyQuestion("How much did Laundry Farm make in August?")).toBeNull();
    expect(matchLaundryFarmCompanyQuestion("How much profit did we make last month?")).toBeNull();

    const week = await ask("What's my revenue this week?", ["laundry_farm", "default"]);
    expect(week.runQuery).not.toHaveBeenCalled();
    expect(week.turn.reader).toBe("company_view");
    expect(week.turn.handled && week.turn.speak).toContain("Recorded sales this week so far are $0.00 across 0 orders.");
    expect(week.turn.handled && week.turn.speak).not.toContain("$657.00");

    const opus = await ask("How did OPUS LA do last month?", ["laundry_farm", "default"]);
    expect(opus.runQuery).not.toHaveBeenCalled();
    expect(opus.turn.handled && opus.turn.speak).toContain("OPUS LA recorded $500.00");
    expect(opus.turn.handled && opus.turn.speak).not.toContain("$425.00");
    expect(opus.turn.handled && opus.turn.speak).not.toContain("$250.00");

    const state: ClaireAnalyticsState = {};
    const runQuery = vi.fn();
    const periods: string[] = [];
    const readCompanyView = vi.fn(async (input: { period?: { kind?: string } }) => {
      periods.push(input.period?.kind ?? "unset");
      return readLaundryFarmCompanyView({
        operatorUserId: "operator-1",
        now: NOW,
        period: input.period,
        authorizedTenantIds: ["laundry_farm", "default"],
        loadUnpaid: async () => [],
        loadLedger: async window => ledger(window, BOOKS[window.tenantId] ?? []),
      });
    });
    const first = await answerClaireBusinessTurn(
      { tenantId: "laundry_farm", operatorUserId: "operator-1", utterance: "What's my revenue this week?", state, surface: "voice" },
      { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery, readCompanyView }
    );
    const follow = await answerClaireBusinessTurn(
      { tenantId: "default", operatorUserId: "operator-1", utterance: "What about last month?", state, surface: "text" },
      { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery, readCompanyView }
    );
    expect(runQuery).not.toHaveBeenCalled();
    expect(periods).toEqual(["this_week", "last_month"]);
    expect(first.handled && first.reader).toBe("company_view");
    expect(follow.handled && follow.speak).toContain("OPUS LA recorded $500.00");
  });
});
