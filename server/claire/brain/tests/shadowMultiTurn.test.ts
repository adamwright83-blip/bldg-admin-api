/**
 * Multi-turn shadow behaviour, through the SAME mechanism real observation uses.
 *
 * These do not hand-build brain working memory. Each turn goes through
 * `observeShadowTurn` with a real shadow-memory store, so what turn 2 sees is only
 * ever what turn 1 actually persisted. That is the difference between proving the
 * ordered-query primitive and proving that shadow mode can use it.
 *
 * Retrieval is injected — the rules under test are cognition, not the database.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clearRecordedObservations, observeShadowTurn } from "../shadow/observeShadowTurn";
import {
  createInMemoryShadowMemoryStore,
  type ShadowMemoryStore,
} from "../shadow/shadowMemory";
import type { EvidenceItem } from "../contracts/evidence";
import type { ExecutiveDeps } from "../executive/decide";
import type { BusinessQueryResult } from "../../../analytics/businessQuery";

const ON = { CLAIRE_BRAIN_V2_SHADOW: "1" } as unknown as NodeJS.ProcessEnv;
const CTX = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
  conversationKey: "claire-call:multiturn",
};

const period = {
  spec: { kind: "all_time" },
  start: "2026-01-01",
  end: "2026-09-20",
  startUtc: new Date("2026-01-01"),
  endExclusiveUtc: new Date("2026-09-21"),
  days: 263,
  timeZone: "America/Los_Angeles",
  label: "all time",
} as never;

function order(key: string, name: string | null, cents: number, date: string) {
  return {
    eventKey: key,
    orderNumber: key.toUpperCase(),
    date,
    occurredAt: `${date}T10:00:00.000Z`,
    cents,
    source: "laundry_butler",
    businessLine: null,
    processor: null,
    building: null,
    serviceType: null,
    summary: null,
    customerName: name,
    address: null,
    ingestedAt: null,
  };
}

/** Five resolved sales. Only the first carries a name the speaker can say aloud. */
function fiveSales(namedAll: boolean): BusinessQueryResult {
  return {
    status: "ok",
    query: {
      metric: "latest_sales",
      limit: 5,
      customerName: null,
      rank: null,
      filters: null,
      serviceType: null,
      listMembers: true,
      period: { kind: "all_time" },
      comparison: null,
      minOrders: 1,
      groupBy: null,
    },
    period,
    comparisonPeriod: null,
    coverage: {
      completeness: "complete",
      loadedSources: ["laundry_butler"],
      failedSources: [],
      unverifiedNativeCount: 0,
      unverifiedNativeCents: 0,
      overlap: {},
      serviceFilterUnclassified: null,
      lineage: null,
      union: null,
    },
    data: {
      kind: "orders",
      ordering: "latest",
      orders: [
        order("evt-1", "Thomas", 4200, "2026-09-19"),
        order("evt-2", namedAll ? "Dana" : null, 3100, "2026-09-18"),
        order("evt-3", namedAll ? "Priya" : null, 2900, "2026-09-17"),
        order("evt-4", namedAll ? "Marcus" : null, 2500, "2026-09-16"),
        order("evt-5", namedAll ? "Lena" : null, 2100, "2026-09-15"),
      ],
    },
  } as unknown as BusinessQueryResult;
}

function salesEvidence(namedAll: boolean): EvidenceItem {
  return {
    id: "business_query:latest_sales:multiturn",
    type: "business_query",
    source: "runBusinessQuery",
    provenance: { reader: "runBusinessQuery" },
    observedAt: "2026-09-20T00:00:00.000Z",
    asOf: "2026-09-20",
    freshness: { completeness: "complete", loadedSources: ["laundry_butler"], failedSources: [] },
    coverage: { complete: true, gaps: [] },
    authoritativeFor: ["current_business_truth"],
    payload: fiveSales(namedAll),
    operatorVisible: true,
  };
}

function deps(namedAll: boolean): ExecutiveDeps {
  return {
    retrieve: async request => (request.kind === "business_query" ? [salesEvidence(namedAll)] : []),
    ctx: { timeZone: "America/Los_Angeles", today: "2026-09-20", surface: "voice" },
  };
}

let memory: ShadowMemoryStore;
beforeEach(() => {
  memory = createInMemoryShadowMemoryStore();
  clearRecordedObservations();
});

async function turn(text: string, namedAll: boolean) {
  return observeShadowTurn({ rawText: text, executive: deps(namedAll), ...CTX }, { env: ON, memory });
}

describe("shadow mode remembers its own previous answer", () => {
  it("turn 1 persists the resolved result and what was actually presented", async () => {
    const first = await turn("What were my last five sales?", false);
    expect(first.observed).toBe(true);

    const stored = await memory.load(`default:adam-admin:${CTX.conversationKey}`);
    expect(stored?.orderedQuery).toBeTruthy();
    // The whole result is remembered...
    expect(stored?.orderedQuery?.resolved).toHaveLength(5);
    // ...but only the member Claire could actually name counts as presented.
    expect(stored?.orderedQuery?.presented.map(m => m.label)).toEqual(["Thomas"]);
  });

  it("turn 2 continues THAT result without issuing a new query", async () => {
    await turn("What were my last five sales?", false);
    const second = await turn("What about the other four?", false);

    expect(second.observed).toBe(true);
    if (!second.observed) return;
    // A continuation is served from memory: no fresh business query was PLANNED.
    expect(second.comparison.retrievalKinds).not.toContain("businessMemory:business_query");
    expect(second.comparison.segmentTypes).toContain("BusinessFactSegment");
    // It re-cites the original read rather than producing a new one.
    expect(second.comparison.evidenceIds).toEqual(["business_query:latest_sales:multiturn"]);
    expect(second.comparison.conclusions).toContain("ordered_query_continuation");
  });

  it("the continuation names the remaining four of the same result, not records 6-9", async () => {
    await turn("What were my last five sales?", false);
    const second = await turn("What about the other four?", false);
    expect(second.observed).toBe(true);

    const stored = await memory.load(`default:adam-admin:${CTX.conversationKey}`);
    // All five of the ORIGINAL result are now presented — nothing new was fetched.
    expect(stored?.orderedQuery?.presented).toHaveLength(5);
    expect(stored?.orderedQuery?.resolved).toHaveLength(5);
    const ids = stored?.orderedQuery?.presented.map(m => m.id) ?? [];
    expect(new Set(ids)).toEqual(new Set(["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"]));
  });

  it("a third turn has nothing left and says so rather than fetching more", async () => {
    await turn("What were my last five sales?", false);
    await turn("What about the other four?", false);
    const third = await turn("What about the rest?", false);

    expect(third.observed).toBe(true);
    if (!third.observed) return;
    expect(third.comparison.segmentTypes).not.toContain("BusinessFactSegment");
  });

  it("when Claire names every member, presented equals resolved and nothing remains", async () => {
    // The deterministic speaker lists everything, so there is genuinely no remainder.
    await turn("What were my last five sales?", true);
    const stored = await memory.load(`default:adam-admin:${CTX.conversationKey}`);
    expect(stored?.orderedQuery?.presented).toHaveLength(5);

    const second = await turn("What about the other four?", true);
    expect(second.observed).toBe(true);
    if (second.observed) expect(second.comparison.segmentTypes).not.toContain("BusinessFactSegment");
  });
});

describe("shadow memory is per-conversation and never touches V1", () => {
  it("a different conversation does not inherit the first one's result", async () => {
    await turn("What were my last five sales?", false);
    const other = await observeShadowTurn(
      { rawText: "What about the other four?", executive: deps(false), ...CTX, conversationKey: "claire-call:other" },
      { env: ON, memory }
    );
    expect(other.observed).toBe(true);
    if (!other.observed) return;
    // No prior result in this thread, so there is nothing to continue.
    expect(other.comparison.segmentTypes).not.toContain("BusinessFactSegment");
  });

  it("stores cognitive state only — no transcript, no operator words", async () => {
    await turn("What were my last five sales?", false);
    const stored = await memory.load(`default:adam-admin:${CTX.conversationKey}`);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("What were my last five sales");
    expect(stored?.priorDecisionRefs.every(ref => /^[A-Za-z+]+$/.test(ref))).toBe(true);
  });

  it("nothing is stored while the flag is off", async () => {
    const off = await observeShadowTurn(
      { rawText: "What were my last five sales?", executive: deps(false), ...CTX },
      { env: {} as unknown as NodeJS.ProcessEnv, memory }
    );
    expect(off.observed).toBe(false);
    expect(await memory.load(`default:adam-admin:${CTX.conversationKey}`)).toBeNull();
  });
});
