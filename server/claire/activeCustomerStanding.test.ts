import { describe, expect, it } from "vitest";
import type { PaidOrderEvent, PaidOrderLedger } from "../analytics/paidOrderLedger";
import type { BusinessSourceCoverageSnapshot } from "../analytics/sourceCoverage";
import { getActiveCustomerStanding, standingTenants } from "./activeCustomerStanding";

const NOW = new Date("2026-10-30T03:00:00.000Z"); // Oct 29, 8 PM in Los Angeles
const ZONE = "America/Los_Angeles";

function event(key: string, phone: string, source: "cleancloud" | "laundry_butler", date = "2026-10-20"): PaidOrderEvent {
  return {
    source,
    eventKey: key,
    occurredAt: new Date(`${date}T19:00:00.000Z`),
    businessDate: date,
    cents: 3000,
    serviceType: "wash_fold",
    customerName: "Resident",
    identity: { phone, cleancloudCustomerId: null },
    orderNumber: key,
    address: null,
    buildingSlug: null,
    processor: source === "laundry_butler" ? "stripe" : "clearent",
    authorityReceiptId: `receipt:${key}`,
  } as PaidOrderEvent;
}

function ledger(events: PaidOrderEvent[], overrides: Partial<PaidOrderLedger> = {}): PaidOrderLedger {
  return {
    startUtc: new Date("2026-09-30T07:00:00.000Z"),
    endExclusiveUtc: NOW,
    timeZone: ZONE,
    events,
    unverifiedNative: [],
    provenDuplicateExclusions: [],
    loadedSources: ["laundry_butler", "cleancloud"],
    failedSources: [],
    completeness: "complete",
    reconciliationEvidence: { decisions: [], attributions: [] },
    ...overrides,
  };
}

function coverage(sources: Array<{ name: string; status: "fresh" | "stale"; coveredThrough: string | null }>): BusinessSourceCoverageSnapshot {
  return { sources: sources.map(source => ({ ...source, includedInCombinedBook: true })) } as unknown as BusinessSourceCoverageSnapshot;
}

describe("active-customer standing across the Laundry Farm company", () => {
  it("measures a goal on either company tenant across both books", () => {
    expect(standingTenants("default", ["default", "laundry_farm"]).sort()).toEqual(["default", "laundry_farm"]);
    expect(standingTenants("laundry_farm", ["laundry_farm", "default"]).sort()).toEqual(["default", "laundry_farm"]);
    expect(standingTenants("t-other", ["t-other", "laundry_farm"])).toEqual(["t-other"]);
  });

  it("never reads a company book the operator is not authorized for", () => {
    expect(standingTenants("default", ["default"])).toEqual(["default"]);
    expect(standingTenants("default", [])).toEqual(["default"]);
  });

  it("counts customers from both books once each (Oct 29: default alone said 2, the company had 23)", async () => {
    const books: Record<string, PaidOrderLedger> = {
      laundry_farm: ledger([event("cc-1", "3105550001", "cleancloud"), event("cc-2", "3105550002", "cleancloud"), event("cc-3", "3105550003", "cleancloud")]),
      // One Laundry Butler customer is also a CleanCloud customer: counted once.
      default: ledger([event("lb-1", "3105550003", "laundry_butler"), event("lb-2", "3105550004", "laundry_butler")]),
    };
    const standing = await getActiveCustomerStanding(
      { tenantId: "default", operatorUserId: "adam-admin", now: NOW, timeZone: ZONE },
      { loadAuthorizedTenantIds: async () => ["default", "laundry_farm"], loadLedger: async input => books[input.tenantId]!, loadCoverage: async () => coverage([]) }
    );
    expect(standing).toMatchObject({ value: 4, complete: true, countedThrough: "2026-10-29", caveats: [] });
  });

  it("keeps the real count but says through when, and why, when CleanCloud is behind and some payments are unproven", async () => {
    const standing = await getActiveCustomerStanding(
      { tenantId: "default", operatorUserId: "adam-admin", now: NOW, timeZone: ZONE },
      {
        loadAuthorizedTenantIds: async () => ["default", "laundry_farm"],
        loadLedger: async input =>
          input.tenantId === "laundry_farm"
            ? ledger([event("cc-1", "3105550001", "cleancloud"), event("cc-2", "3105550002", "cleancloud")])
            : ledger([event("lb-1", "3105550009", "laundry_butler")], {
                failedSources: ["laundry_butler"],
                completeness: "partial",
                unverifiedPaymentAuthority: [1, 2, 3, 4].map(n => ({ eventKey: `order:70${n}`, businessDate: "2026-10-01", source: "laundry_butler" as const, cents: 0, reason: "captured_amount_unknown" as const })),
              }),
        loadCoverage: async input =>
          input.tenantId === "laundry_farm" ? coverage([{ name: "CleanCloud", status: "stale", coveredThrough: "2026-10-26" }, { name: "Laundry Butler", status: "fresh", coveredThrough: null }]) : coverage([]),
      }
    );
    expect(standing.value).toBe(3);
    expect(standing.complete).toBe(false);
    expect(standing.countedThrough).toBe("2026-10-26");
    expect(standing.caveats).toEqual([
      "CleanCloud records only reach 2026-10-26; nothing newer has been imported.",
      "4 Laundry Butler orders have a payment with no recorded captured amount, so they aren't counted.",
    ]);
  });

  it("an unreadable book is a caveat, not a zero; nothing readable is no count at all", async () => {
    const half = await getActiveCustomerStanding(
      { tenantId: "default", operatorUserId: "adam-admin", now: NOW, timeZone: ZONE },
      {
        loadAuthorizedTenantIds: async () => ["default", "laundry_farm"],
        loadLedger: async input => (input.tenantId === "laundry_farm" ? Promise.reject(new Error("db down")) : ledger([event("lb-1", "3105550001", "laundry_butler")])),
        loadCoverage: async () => coverage([]),
      }
    );
    expect(half).toMatchObject({ value: 1, complete: false, caveats: ["The Laundry Farm order book could not be read."] });
    const none = await getActiveCustomerStanding(
      { tenantId: "default", operatorUserId: "adam-admin", now: NOW, timeZone: ZONE },
      { loadAuthorizedTenantIds: async () => ["default", "laundry_farm"], loadLedger: async () => ledger([], { completeness: "unavailable", loadedSources: [] }), loadCoverage: async () => coverage([]) }
    );
    expect(none).toMatchObject({ value: null, complete: false, countedThrough: null });
  });
});
