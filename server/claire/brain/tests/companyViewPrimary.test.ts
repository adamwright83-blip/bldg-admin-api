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

  it("treats bare how much did we make as the company on phone and Desk", async () => {
    const phone = depsFor(["laundry_farm", "default"]);
    const voice = await runClaireV2PrimaryTurn(turn("How much did we make?", "voice", "default"), phone.deps);
    expect(phone.runQuery).not.toHaveBeenCalled();
    expect(phone.readCompanyView).toHaveBeenCalled();
    expect(voice.brainV2.composition).toBe("deterministic");
    expect(voice.brainV2.evidenceReaders).toContain(LAUNDRY_FARM_COMPANY_READER);
    expect(voice.speak).toContain("Recorded sales this month so far are $425.00");
    expect(voice.speak).not.toContain("Do you mean revenue or profit?");

    const desk = depsFor(["laundry_farm", "default"]);
    const text = await runClaireV2PrimaryTurn(turn("How much have we made?", "text", "laundry_farm"), desk.deps);
    expect(desk.runQuery).not.toHaveBeenCalled();
    expect(desk.readCompanyView).toHaveBeenCalled();
    expect(text.brainV2.evidenceReaders).toContain(LAUNDRY_FARM_COMPANY_READER);
    expect(text.speak).toContain("Recorded sales this month so far are $425.00");
    expect(text.speak).not.toContain("profit");
  });

  it("routes unqualified revenue questions to the company reader on phone and Desk", async () => {
    const books: Record<string, PaidOrderEvent[]> = {
      default: [
        event({ key: "oct-stripe", cents: 25000, rail: "stripe", date: "2026-10-02", address: "3545 Wilshire Blvd" }),
        event({ key: "trail-stripe", cents: 8000, rail: "stripe", date: "2026-09-25", address: "3545 Wilshire Blvd" }),
        event({ key: "aug-stripe", cents: 11100, rail: "stripe", date: "2026-08-10", address: "3545 Wilshire Blvd" }),
      ],
      laundry_farm: [
        event({ key: "oct-cloud", cents: 17500, rail: "cleancloud_clearant", date: "2026-10-02", address: "3650 W 6th Street" }),
        event({ key: "aug-cloud", cents: 11100, rail: "cleancloud_clearant", date: "2026-08-10", address: "3545 Wilshire Blvd" }),
      ],
    };
    books.default[2]!.identity = { phone: "3105550188" };
    books.laundry_farm[1]!.identity = { phone: "3105550188" };

    function routed(authorized: string[]) {
      const runQuery = vi.fn(async () => ({
        status: "unavailable",
        query: { metric: "revenue" },
        period: { end: "2026-10-19" },
      }));
      const periods: Array<{ kind?: string; days?: number; start?: string; end?: string }> = [];
      const readCompanyView = vi.fn((input: { period?: { kind?: string; days?: number; start?: string; end?: string } }) => {
        if (input.period) periods.push(input.period);
        return readLaundryFarmCompanyView({
          operatorUserId: "operator-1",
          now: NOW,
          period: input.period,
          authorizedTenantIds: authorized,
          loadUnpaid: async () => [],
          loadLedger: async window => ledger(window, authorized.includes(window.tenantId) ? books[window.tenantId] ?? [] : []),
        });
      });
      const deps: ClaireV2PrimaryDeps = {
        ...depsFor(authorized).deps,
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
      };
      return { deps, runQuery, readCompanyView, periods };
    }

    const phone = routed(["laundry_farm", "default"]);
    const augustVoice = await runClaireV2PrimaryTurn(
      turn("How much did Laundry Farm make in August?", "voice", "default"),
      phone.deps
    );
    expect(phone.runQuery).not.toHaveBeenCalled();
    expect(phone.readCompanyView).toHaveBeenCalled();
    expect(phone.periods[0]).toMatchObject({ kind: "between", start: "2026-08-01", end: "2026-08-31" });
    expect(augustVoice.brainV2.composition).toBe("deterministic");
    expect(augustVoice.brainV2.evidenceReaders).toContain(LAUNDRY_FARM_COMPANY_READER);
    expect(augustVoice.speak).toContain("August");
    expect(augustVoice.speak).toContain("$222.00");
    expect(augustVoice.speak).toContain("no deduplicated company total");
    expect(augustVoice.speak).not.toContain("$425.00");
    expect(augustVoice.speak).not.toContain("$505.00");

    const desk = routed(["laundry_farm", "default"]);
    const deskState: ClaireV2PrimaryState = {};
    const trailing = await runClaireV2PrimaryTurn(
      turn("What was revenue in the last 30 days?", "text", "laundry_farm", deskState),
      desk.deps
    );
    expect(desk.runQuery).not.toHaveBeenCalled();
    expect(desk.periods[0]).toEqual({ kind: "trailing_days", days: 30 });
    expect(trailing.brainV2.evidenceReaders).toContain(LAUNDRY_FARM_COMPANY_READER);
    expect(trailing.speak).toContain("the last 30 days");
    expect(trailing.speak).toContain("$505.00");
    expect(trailing.speak).not.toContain("$222.00");
    const augustFollow = await runClaireV2PrimaryTurn(
      turn("What about August?", "text", "laundry_farm", deskState),
      desk.deps
    );
    expect(desk.runQuery).not.toHaveBeenCalled();
    expect(desk.periods[1]).toMatchObject({ kind: "between", start: "2026-08-01", end: "2026-08-31" });
    expect(augustFollow.speak).toContain("August");
    expect(augustFollow.speak).toContain("$222.00");
    expect(augustFollow.speak).toContain("no deduplicated company total");
    expect(augustFollow.speak).not.toContain("$505.00");

    const deskAugust = routed(["laundry_farm", "default"]);
    const augustText = await runClaireV2PrimaryTurn(
      turn("How much did Laundry Farm make in August?", "text", "default"),
      deskAugust.deps
    );
    expect(deskAugust.runQuery).not.toHaveBeenCalled();
    expect(augustText.speak).toContain("$222.00");
    expect(augustText.brainV2.evidenceReaders).toContain(LAUNDRY_FARM_COMPANY_READER);

    const voiceTrailing = routed(["laundry_farm", "default"]);
    const voiceState: ClaireV2PrimaryState = {};
    const trailingVoice = await runClaireV2PrimaryTurn(
      turn("What was revenue in the last 30 days?", "voice", "default", voiceState),
      voiceTrailing.deps
    );
    expect(trailingVoice.speak).toContain("the last 30 days");
    expect(trailingVoice.speak).toContain("$505.00");
    const weekFollow = await runClaireV2PrimaryTurn(
      turn("What about this week?", "voice", "default", voiceState),
      voiceTrailing.deps
    );
    expect(voiceTrailing.periods[1]).toEqual({ kind: "this_week" });
    expect(weekFollow.speak).toContain("this week so far");
    expect(weekFollow.speak).not.toContain("$505.00");
    const orders = await runClaireV2PrimaryTurn(
      turn("How many orders did we have last month?", "voice", "laundry_farm", voiceState),
      voiceTrailing.deps
    );
    expect(voiceTrailing.runQuery).not.toHaveBeenCalled();
    expect(voiceTrailing.periods.at(-1)).toEqual({ kind: "last_month" });
    expect(orders.speak).toContain("paid order last month");

    const farmOnly = routed(["laundry_farm"]);
    const farmAugust = await runClaireV2PrimaryTurn(
      turn("How much did Laundry Farm make in August?", "voice", "default"),
      farmOnly.deps
    );
    expect(farmAugust.speak).toContain("This is not a combined Laundry Farm total.");
    expect(farmAugust.speak).toContain("Laundry Butler Stripe book is not included");
    expect(farmAugust.speak).toContain("$111.00");
    expect(farmAugust.speak).not.toContain("$222.00");

    const narrower = routed(["laundry_farm", "default"]);
    await runClaireV2PrimaryTurn(turn("What was revenue from OPUS last month?", "text", "default"), narrower.deps);
    await runClaireV2PrimaryTurn(
      turn("How much revenue did we do in August through CleanCloud?", "voice", "laundry_farm"),
      narrower.deps
    );
    expect(narrower.readCompanyView).not.toHaveBeenCalled();
    expect(narrower.runQuery).toHaveBeenCalled();
  });

  it("keeps unpaid, named-customer, and growth questions off the company total on phone and Desk", async () => {
    const missed = [
      "How many unpaid orders do we have?",
      "What was revenue from Dana in August?",
      "What is our revenue growth?",
    ];
    for (const utterance of missed) {
      for (const surface of ["voice", "text"] as const) {
        const routed = depsFor(["laundry_farm", "default"]);
        routed.runQuery.mockImplementation(async (_tenant: string, query: { metric: string }) => ({
          status: "unavailable",
          query,
          period: { end: "2026-10-19" },
        }));
        routed.deps.planBusinessQuery = async () => null;
        const result = await runClaireV2PrimaryTurn(turn(utterance, surface, "default"), routed.deps);
        expect(routed.readCompanyView).not.toHaveBeenCalled();
        expect(routed.runQuery).toHaveBeenCalled();
        expect(result.brainV2.evidenceReaders).not.toContain(LAUNDRY_FARM_COMPANY_READER);
        expect(result.speak).not.toContain("Recorded sales");
        expect(result.speak).not.toContain("paid order");
        expect(result.speak).not.toContain("$425.00");
        expect(result.speak).not.toContain("$222.00");
        const query = routed.runQuery.mock.calls[0]?.[1] as {
          metric?: string;
          customerName?: string | null;
          comparison?: string | null;
          period?: { kind?: string; start?: string; end?: string };
        };
        if (utterance.startsWith("How many unpaid")) {
          expect(query.metric).toBe("open_orders");
        } else if (utterance.includes("Dana")) {
          expect(query.metric).toBe("customer_history");
          expect(query.customerName).toBe("Dana");
          expect(query.period).toMatchObject({ kind: "between", start: "2026-08-01", end: "2026-08-31" });
        } else {
          expect(query.metric).toBe("revenue");
          expect(query.comparison).toBe("previous");
        }
      }
    }
  });
});
