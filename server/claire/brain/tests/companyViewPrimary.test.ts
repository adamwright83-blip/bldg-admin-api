/**
 * Brain V2 primary phone and Claire Desk company questions.
 *
 * These turns must call readLaundryFarmCompanyView. The tenant-only business
 * reader stays in place for questions that are not the company view.
 */

import { describe, expect, it, vi } from "vitest";
import { defaultBusinessQuery } from "../../../analytics/businessQuery";
import {
  companyViewRequest,
  LAUNDRY_FARM_COMPANY_READER,
  readLaundryFarmCompanyView,
  type CompanyLedgerWindow,
} from "../../../analytics/laundryFarmCompanyView";
import type { PaidOrderEvent, PaidOrderLedger } from "../../../analytics/paidOrderLedger";
import { defaultBusinessMemoryDeps, retrieveBusinessEvidence } from "../businessMemory/adapter";
import {
  runClaireV2PrimaryTurn,
  type ClaireV2PrimaryDeps,
  type ClaireV2PrimaryInput,
  type ClaireV2PrimaryState,
} from "../live/primaryTurn";

const NOW = new Date("2026-10-19T18:00:00.000Z");

function event(input: {
  key: string;
  cents: number;
  rail: "stripe" | "cleancloud_clearant";
  date: string;
  address: string;
}): PaidOrderEvent {
  return {
    source: input.rail === "stripe" ? "laundry_butler" : "cleancloud",
    eventKey: input.key,
    occurredAt: new Date(`${input.date}T19:00:00.000Z`),
    businessDate: input.date,
    cents: input.cents,
    serviceType: "wash_fold",
    customerName: "Resident",
    identity: { phone: input.key },
    orderNumber: input.key,
    address: input.address,
    buildingSlug: null,
    processor: input.rail === "stripe" ? "stripe" : "clearent",
    authorityReceiptId: input.rail === "stripe" ? `receipt:${input.key}` : undefined,
  };
}

const BOOKS: Record<string, PaidOrderEvent[]> = {
  default: [
    event({ key: "stripe-opus", cents: 25000, rail: "stripe", date: "2026-10-02", address: "3545 Wilshire Blvd" }),
    event({ key: "stripe-sept", cents: 50000, rail: "stripe", date: "2026-09-15", address: "3545 Wilshire Blvd" }),
  ],
  laundry_farm: [
    event({ key: "cloud-opus", cents: 17500, rail: "cleancloud_clearant", date: "2026-10-02", address: "3650 W 6th Street" }),
  ],
};

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

function depsFor(authorized: string[]): {
  deps: ClaireV2PrimaryDeps;
  runQuery: ReturnType<typeof vi.fn>;
  readCompanyView: ReturnType<typeof vi.fn>;
} {
  const runQuery = vi.fn();
  const readCompanyView = vi.fn((input: { period?: { kind?: string }; operatorUserId?: string }) =>
    readLaundryFarmCompanyView({
      operatorUserId: input.operatorUserId ?? "operator-1",
      now: NOW,
      period: input.period,
      authorizedTenantIds: authorized,
      loadUnpaid: async () => [],
      loadLedger: async window => ledger(window, authorized.includes(window.tenantId) ? BOOKS[window.tenantId] ?? [] : []),
    })
  );
  const deps: ClaireV2PrimaryDeps = {
    now: () => NOW,
    speak: vi.fn(async () => "composed") as never,
    interpretPerception: null,
    planBusinessQuery: async () => defaultBusinessQuery("revenue"),
    legacyShadow: null,
    liveDeps: {
      business: {
        ...defaultBusinessMemoryDeps,
        runQuery: runQuery as never,
        readCompanyView: readCompanyView as never,
        listAccounts: async () => [],
        listContacts: async () => [],
        loadOpenOrders: async () => [],
        loadOperations: async ({ businessDate }) => ({ businessDate, open: [], completed: [], routeAvailable: true }) as never,
      },
    },
    executeGrant: vi.fn() as never,
    routeWeekly: vi.fn(async () => null) as never,
    beginWeekly: vi.fn(async () => ""),
    ingestDaphne: vi.fn(async () => ({})),
    capturePreference: vi.fn(async () => ({ status: "disabled", corrections: [], observationIds: [], readbackVerified: false })) as never,
    loadDaphneGuidance: vi.fn(async () => null),
    commitPendingDisclosures: vi.fn(async () => undefined),
  };
  return { deps, runQuery, readCompanyView };
}

function turn(utterance: string, surface: "voice" | "text", tenantId: string, state: ClaireV2PrimaryState = {}): ClaireV2PrimaryInput {
  return {
    authority: { authorized: true, tenantId, operatorUserId: "operator-1", role: "owner", basis: "verified_membership" },
    tenantId,
    operatorUserId: "operator-1",
    dayDirectorActorId: "42",
    surface,
    utterance,
    state,
    conversationKey: `claire-${surface}`,
    conversationId: `conversation-${surface}`,
    timeZone: "America/Los_Angeles",
    businessDate: "2026-10-19",
    context: { businessDate: "2026-10-19", actorId: "operator-1", blockers: [], nextFixedCommitment: null, clock: { localTime: "11:00 AM", tomorrowBusinessDate: "2026-10-20" } } as never,
    allowFragmentWait: false,
  };
}

describe("Brain V2 primary company view", () => {
  it("wires the production business-memory default to readLaundryFarmCompanyView", async () => {
    const view = await defaultBusinessMemoryDeps.readCompanyView!({
      operatorUserId: "operator-1",
      now: NOW,
      period: { kind: "this_month" },
      authorizedTenantIds: [],
      loadLedger: async () => {
        throw new Error("unauthorized company view must not load a book");
      },
    });
    expect(view.reader).toBe(LAUNDRY_FARM_COMPANY_READER);
    expect(view.scope).toBe("unauthorized");
    expect(view.mayStateCompanyTotal).toBe(false);
  });

  it("the business_query adapter calls the company reader and skips the tenant reader", async () => {
    const runQuery = vi.fn();
    const readCompanyView = vi.fn(async () =>
      readLaundryFarmCompanyView({
        operatorUserId: "operator-1",
        now: NOW,
        authorizedTenantIds: ["laundry_farm", "default"],
        loadUnpaid: async () => [],
        loadLedger: async window => ledger(window, BOOKS[window.tenantId] ?? []),
      })
    );
    const evidence = await retrieveBusinessEvidence(
      {
        compartment: "businessMemory",
        kind: "business_query",
        query: companyViewRequest({ aspect: "revenue", period: { kind: "this_month" } }),
      },
      { tenantId: "default", operatorUserId: "operator-1", nowIso: NOW.toISOString() },
      { ...defaultBusinessMemoryDeps, runQuery: runQuery as never, readCompanyView: readCompanyView as never }
    );
    expect(runQuery).not.toHaveBeenCalled();
    expect(readCompanyView).toHaveBeenCalledTimes(1);
    expect(evidence[0]?.provenance.reader).toBe(LAUNDRY_FARM_COMPANY_READER);
    expect(evidence[0]?.authoritativeFor).toContain("current_business_truth");
  });

  it("phone and Desk company questions use the company view for both tenant contexts", async () => {
    const both = depsFor(["laundry_farm", "default"]);
    const phone = await runClaireV2PrimaryTurn(
      turn("How much have we made this month?", "voice", "default"),
      both.deps
    );
    expect(both.runQuery).not.toHaveBeenCalled();
    expect(both.readCompanyView).toHaveBeenCalled();
    expect(phone.brainV2.composition).toBe("deterministic");
    expect(phone.brainV2.evidenceReaders).toContain(LAUNDRY_FARM_COMPANY_READER);
    expect(phone.speak).toContain("Recorded sales this month so far are $425.00");
    expect(phone.speak).toContain("OPUS LA recorded $425.00");
    expect(phone.speak).toContain("Stripe");
    expect(phone.speak).toContain("CleanCloud / Clearant");
    expect(phone.speak).not.toContain("deduplicated");

    const deskState: ClaireV2PrimaryState = {};
    const deskDeps = depsFor(["laundry_farm", "default"]);
    const desk = await runClaireV2PrimaryTurn(
      turn("What's my revenue this week?", "text", "laundry_farm", deskState),
      deskDeps.deps
    );
    expect(deskDeps.runQuery).not.toHaveBeenCalled();
    expect(desk.brainV2.evidenceReaders).toContain(LAUNDRY_FARM_COMPANY_READER);
    expect(desk.speak).toContain("this week so far");
    const follow = await runClaireV2PrimaryTurn(
      turn("What about last month?", "text", "laundry_farm", deskState),
      deskDeps.deps
    );
    expect(deskDeps.runQuery).not.toHaveBeenCalled();
    expect(follow.speak).toContain("OPUS LA recorded $500.00");
    expect(follow.speak).not.toContain("$425.00");

    const farmOnly = depsFor(["laundry_farm"]);
    const farm = await runClaireV2PrimaryTurn(
      turn("How did OPUS LA do last month?", "voice", "default"),
      farmOnly.deps
    );
    expect(farm.speak).toContain("This is not a combined Laundry Farm total.");
    expect(farm.speak).toContain("Laundry Butler Stripe book is not included");
    expect(farm.speak).not.toContain("$500.00");
    expect(farm.speak).not.toContain("$250.00");

    const butlerOnly = depsFor(["default"]);
    const butler = await runClaireV2PrimaryTurn(
      turn("How much have we made this month?", "text", "laundry_farm"),
      butlerOnly.deps
    );
    expect(butler.speak).toContain("This is not a combined Laundry Farm total.");
    expect(butler.speak).toContain("CleanCloud / Clearant book is not included");
    expect(butler.speak).toContain("$250.00");
    expect(butler.speak).not.toContain("$175.00");
    expect(butler.speak).not.toContain("$425.00");
  });
});
