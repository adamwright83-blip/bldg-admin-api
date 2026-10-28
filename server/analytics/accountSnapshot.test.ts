import { describe, expect, it, vi } from "vitest";
import { percentChange } from "../../shared/accountSnapshot";
import { cityFromAddress, readAccountSnapshot, type AccountSnapshotDeps } from "./accountSnapshot";
import {
  emptyLoaders,
  failingLoaders,
  FIXTURE_TZ,
  fixtureLoaders,
  provenBusinessCoverageSnapshot,
  withFixturePaymentAuthority,
} from "./businessLedgerFixture";
import { readCanonicalRevenue } from "./canonicalRevenue";
import { loadPaidOrderLedger, type LedgerLoaders } from "./paidOrderLedger";
import type { BusinessSourceCoverageSnapshot } from "./sourceCoverage";

// Saturday September 12, 2026, 7pm in Los Angeles: week to date is Mon Sep 7 – Sat Sep 12.
const SATURDAY = new Date("2026-09-13T02:00:00.000Z");

function deps(loaders: LedgerLoaders, coverage: BusinessSourceCoverageSnapshot | null, extra: Partial<AccountSnapshotDeps> = {}): Partial<AccountSnapshotDeps> {
  const admitted = withFixturePaymentAuthority(loaders);
  return {
    now: () => SATURDAY,
    timeZone: () => FIXTURE_TZ,
    readRevenue: input => readCanonicalRevenue({ ...input, loaders: admitted }),
    loadLedger: input => loadPaidOrderLedger(input, admitted),
    readSourceCoverage: async () => coverage,
    loadCity: async () => "Los Angeles",
    ...extra,
  };
}

describe("readAccountSnapshot", () => {
  it("states week and month to date from the canonical ledger, against the comparable stretch before", async () => {
    const snapshot = await readAccountSnapshot({ tenantId: "tenant-1", deps: deps(fixtureLoaders(), provenBusinessCoverageSnapshot()) });

    expect(snapshot).toMatchObject({ today: "2026-09-12", monthName: "September", city: "Los Angeles", timeZone: FIXTURE_TZ });
    // Week: Ava $60 (Sep 10) + $40 (Sep 12). The same days last week: Ben $30 (Sep 5). Zed's unverified $70 never counts.
    expect(snapshot.week).toMatchObject({
      start: "2026-09-07",
      end: "2026-09-12",
      comparison: { start: "2026-08-31", end: "2026-09-05" },
      revenueCents: { value: 10000, previous: 3000, changePct: 233.3, precision: "exact" },
      orders: { value: 2, previous: 1, changePct: 100, precision: "exact" },
    });
    // Month: Sep 1–12 holds Ava $100 and Ben $30; Aug 1–12 holds Ava $50 and Eli $45. Zed's unresolved
    // unverified order sits on Sep 1, so the month is the recorded figure, not a licensed exact one.
    expect(snapshot.month).toMatchObject({
      start: "2026-09-01",
      comparison: { start: "2026-08-01", end: "2026-08-12" },
      revenueCents: { value: 13000, previous: 9500, changePct: 36.8, precision: "recorded" },
      orders: { value: 3, previous: 2, precision: "recorded" },
    });
  });

  it("counts a new customer only when their first paid order ever falls in the period", async () => {
    const snapshot = await readAccountSnapshot({ tenantId: "tenant-1", deps: deps(fixtureLoaders(), provenBusinessCoverageSnapshot()) });
    // Ava first paid Aug 1 and Eli Aug 10: both new in early August, neither new in September. Ben first paid in July.
    expect(snapshot.month.newCustomers).toMatchObject({ value: 0, previous: 2, changePct: -100, precision: "exact" });
    expect(snapshot.week.newCustomers).toMatchObject({ value: 0, previous: 0, precision: "exact" });
  });

  it("loads the full-history ledger once for every new-customer span", async () => {
    const admitted = withFixturePaymentAuthority(fixtureLoaders());
    const loadLedger = vi.fn((input: Parameters<typeof loadPaidOrderLedger>[0]) => loadPaidOrderLedger(input, admitted));
    await readAccountSnapshot({ tenantId: "tenant-1", deps: deps(fixtureLoaders(), provenBusinessCoverageSnapshot(), { loadLedger }) });
    expect(loadLedger).toHaveBeenCalledTimes(1);
  });

  it("an unreadable ledger is unavailable, never zero", async () => {
    const snapshot = await readAccountSnapshot({ tenantId: "tenant-1", deps: deps(failingLoaders, provenBusinessCoverageSnapshot()) });
    for (const period of [snapshot.week, snapshot.month]) {
      for (const metric of [period.revenueCents, period.orders, period.newCustomers]) {
        expect(metric).toEqual({ value: null, previous: null, changePct: null, precision: "unavailable" });
      }
    }
  });

  it("an empty ledger without proven coverage is withheld, not stated as $0", async () => {
    const snapshot = await readAccountSnapshot({ tenantId: "tenant-1", deps: deps(emptyLoaders, null) });
    expect(snapshot.week.revenueCents.value).toBeNull();
    expect(snapshot.week.orders.value).toBeNull();
    expect(snapshot.month.newCustomers.value).toBeNull();
  });

  it("without proven coverage, recorded figures stay but say they are recorded", async () => {
    const snapshot = await readAccountSnapshot({ tenantId: "tenant-1", deps: deps(fixtureLoaders(), null) });
    expect(snapshot.week.revenueCents).toMatchObject({ value: 10000, precision: "recorded" });
  });

  it("a revenue read that throws is unavailable for that period only", async () => {
    const base = deps(fixtureLoaders(), provenBusinessCoverageSnapshot());
    const snapshot = await readAccountSnapshot({
      tenantId: "tenant-1",
      deps: {
        ...base,
        readRevenue: async input => {
          if (input.from === "2026-09-07") throw new Error("boom");
          return base.readRevenue!(input);
        },
      },
    });
    expect(snapshot.week.revenueCents.value).toBeNull();
    expect(snapshot.month.revenueCents.value).toBe(13000);
  });
});

describe("cityFromAddress", () => {
  it("reads the city before the state and zip", () => {
    expect(cityFromAddress("2401 Hyperion Ave, Los Angeles, CA 90027")).toBe("Los Angeles");
    expect(cityFromAddress("100 Main St, Suite 4, Beverly Hills, CA")).toBe("Beverly Hills");
  });
  it("returns null when the address does not name one", () => {
    expect(cityFromAddress("2401 Hyperion Ave")).toBeNull();
    expect(cityFromAddress("Los Angeles, CA 90027")).toBeNull();
    expect(cityFromAddress(null)).toBeNull();
  });
});

describe("percentChange", () => {
  it("is null without two figures or against a zero base", () => {
    expect(percentChange(5, null)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(50, 40)).toBe(25);
    expect(percentChange(30, 40)).toBe(-25);
  });
});
