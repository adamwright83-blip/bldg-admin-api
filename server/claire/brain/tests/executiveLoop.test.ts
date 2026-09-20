/**
 * The executive loop end to end: attention → retrieval plan → evidence → integration.
 *
 * Retrieval is injected, so these prove the cognition rather than the database.
 * The invariant under test throughout: a claim may only be spoken when authoritative
 * evidence licensed it, and Executive Function is the only thing that decides.
 */

import { describe, expect, it } from "vitest";
import { decideTurn, noRetrieval, type ExecutiveDeps, type RetrievalRunner } from "../executive/decide";
import { buildBusinessQuery, inferBusinessMetric, planRetrieval } from "../executive/retrievalPlan";
import { planAttention } from "../executive/attention";
import { ExecutiveGovernorError } from "../executive/governor";
import { perceiveTurn } from "../perception/perceive";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";
import { BUSINESS_ANSWER_UNAVAILABLE } from "../contracts/executiveDecision";
import type { EvidenceItem } from "../contracts/evidence";
import type { BusinessQueryResult } from "../../../analytics/businessQuery";

const CTX = {
  conversationKey: "claire-call:test",
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
};

const INTEGRATION = { timeZone: "America/Los_Angeles", today: "2026-09-20", surface: "voice" as const };

function memory(source: Parameters<typeof snapshotWorkingMemory>[0] = {}) {
  return snapshotWorkingMemory(source, CTX);
}

function deps(retrieve: RetrievalRunner): ExecutiveDeps {
  return { retrieve, ctx: INTEGRATION };
}

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

function ordersResult(): BusinessQueryResult {
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
        {
          eventKey: "evt-1",
          orderNumber: "A1",
          date: "2026-09-19",
          occurredAt: "2026-09-19T10:00:00.000Z",
          cents: 4200,
          source: "laundry_butler",
          businessLine: null,
          processor: null,
          building: null,
          serviceType: null,
          summary: null,
          customerName: "Thomas",
          address: null,
          ingestedAt: null,
        },
      ],
    },
  } as unknown as BusinessQueryResult;
}

function businessEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: "ev-orders",
    type: "business_query",
    source: "runBusinessQuery",
    provenance: { reader: "runBusinessQuery" },
    observedAt: "2026-09-20T00:00:00.000Z",
    asOf: "2026-09-20",
    freshness: { completeness: "complete", loadedSources: ["laundry_butler"], failedSources: [] },
    coverage: { complete: true, gaps: [] },
    authoritativeFor: ["current_business_truth"],
    payload: ordersResult(),
    operatorVisible: true,
    ...overrides,
  };
}

describe("retrieval planning", () => {
  it("infers a metric explicitly and returns null when it cannot tell", () => {
    expect(inferBusinessMetric("What were my last five sales?")).toBe("latest_sales");
    expect(inferBusinessMetric("How are you feeling today?")).toBeNull();
  });

  it("carries the operator's cardinality into the query rather than a default limit", () => {
    const query = buildBusinessQuery(perceiveTurn({ rawText: "What were my last five sales?", completeness: "complete" }));
    expect(query?.metric).toBe("latest_sales");
    expect(query?.limit).toBe(5);
  });

  it("a scoped Dana question never requests the global board", () => {
    const perceived = perceiveTurn({ rawText: "What should I do about Dana Tuesday?", completeness: "complete" });
    const attention = planAttention(perceived, memory());
    const requests = planRetrieval(perceived, memory(), attention);
    expect(requests.some(request => request.compartment === "goals")).toBe(false);
  });

  it("a pure continuation does not issue a fresh business query", () => {
    const perceived = perceiveTurn({ rawText: "What about the other four?", completeness: "complete" });
    const attention = { ...planAttention(perceived, memory()), continueOrderedQuery: true, retrieve: ["workingMemory", "businessMemory"] as never };
    const requests = planRetrieval(perceived, memory(), attention);
    expect(requests.some(request => request.kind === "business_query")).toBe(false);
  });
});

describe("evidenced business facts", () => {
  it("authoritative evidence licenses a BusinessFactSegment that cites it", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: "What were my last five sales?", completeness: "complete" }),
      memory(),
      deps(async request => (request.kind === "business_query" ? [businessEvidence()] : []))
    );
    const fact = decision.responsePlan.segments.find(segment => segment.type === "BusinessFactSegment");
    expect(fact).toBeDefined();
    expect(fact && "evidence" in fact && fact.evidence).toEqual([{ evidenceId: "ev-orders" }]);
    expect(decision.evidence.map(item => item.id)).toContain("ev-orders");
  });

  it("no evidence means no fact and an explicit unavailable conclusion", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: "What were my last five sales?", completeness: "complete" }),
      memory(),
      deps(noRetrieval)
    );
    expect(decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
    expect(decision.conclusions.some(conclusion => conclusion.kind === BUSINESS_ANSWER_UNAVAILABLE)).toBe(true);
  });

  it("an unavailable read cannot become a spoken fact", async () => {
    const unavailable = businessEvidence({ id: "ev-none", authoritativeFor: [], payload: { status: "unavailable" } });
    const decision = await decideTurn(
      perceiveTurn({ rawText: "What was my revenue?", completeness: "complete" }),
      memory(),
      deps(async () => [unavailable])
    );
    expect(decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
    expect(decision.conclusions.some(conclusion => conclusion.kind === BUSINESS_ANSWER_UNAVAILABLE)).toBe(true);
  });

  it("the spoken text comes from the deterministic reader, not the brain", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: "What were my last five sales?", completeness: "complete" }),
      memory(),
      deps(async request => (request.kind === "business_query" ? [businessEvidence()] : []))
    );
    const fact = decision.responsePlan.segments.find(segment => segment.type === "BusinessFactSegment");
    // Whatever the speaker produced, it must mention only what the evidence carried.
    expect(fact?.text.length).toBeGreaterThan(0);
    expect(fact?.text).toMatch(/Thomas|\$42/);
  });
});

function accountEvidence(): EvidenceItem {
  return businessEvidence({
    id: "ev-account",
    type: "account_state",
    source: "listAccountRefs",
    provenance: { reader: "listAccountRefs", accountType: "property" },
    payload: { accountId: 77, name: "The Louise", accountType: "property" },
  });
}

describe("business judgment is not a business fact", () => {
  it("a judgment question yields an advisory segment with no mutation authority", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: "What should I do about Dana Tuesday?", completeness: "complete" }),
      memory(),
      deps(async request => (request.kind === "account_state" ? [accountEvidence()] : []))
    );
    const judgment = decision.responsePlan.segments.find(segment => segment.type === "BusinessJudgmentSegment");
    expect(judgment).toBeDefined();
    expect(judgment && "mutationAuthority" in judgment && judgment.mutationAuthority).toBe(false);
    expect(decision.actionGrants).toEqual([]);
    expect(decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
  });

  it("a judgment cites the evidence it reasoned over", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: "What should I do about Dana Tuesday?", completeness: "complete" }),
      memory(),
      deps(async request => (request.kind === "account_state" ? [accountEvidence()] : []))
    );
    const judgment = decision.responsePlan.segments.find(segment => segment.type === "BusinessJudgmentSegment");
    expect(judgment && "evidence" in judgment && judgment.evidence).toEqual([{ evidenceId: "ev-account" }]);
    expect(judgment && "accountId" in judgment && judgment.accountId).toBe(77);
    expect(judgment && "contactName" in judgment && judgment.contactName).toBe("Dana");
  });
});

describe("inhibition", () => {
  it("synthetic evidence reaching the bundle fails the governor", async () => {
    const synthetic = businessEvidence({ id: "ev-fake", operatorVisible: false });
    await expect(
      decideTurn(
        perceiveTurn({ rawText: "What were my last five sales?", completeness: "complete" }),
        memory(),
        deps(async () => [synthetic])
      )
    ).rejects.toBeInstanceOf(ExecutiveGovernorError);
  });

  it("history claiming current truth fails the governor and is recorded as inhibited", async () => {
    const episodic = businessEvidence({
      id: "ev-history",
      type: "conversation_turn",
      authoritativeFor: ["current_business_truth"],
    });
    await expect(
      decideTurn(
        perceiveTurn({ rawText: "What were my last five sales?", completeness: "complete" }),
        memory(),
        deps(async () => [episodic])
      )
    ).rejects.toThrow(/episodic memory cannot be current business truth/);
  });

  it("a half turn never reaches retrieval", async () => {
    let called = 0;
    const decision = await decideTurn(
      perceiveTurn({ rawText: "So for Dana I was thinking", completeness: "incomplete" }),
      memory(),
      deps(async () => {
        called += 1;
        return [];
      })
    );
    expect(called).toBe(0);
    expect(decision.retrievals).toEqual([]);
    expect(decision.inhibitedCandidates.some(candidate => candidate.kind === "half_turn")).toBe(true);
  });

  it("the brain retrieves nothing unless a caller explicitly supplies live readers", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: "What was my revenue?", completeness: "complete" }),
      memory()
    );
    // Default deps reach no database and assert nothing.
    expect(decision.evidence).toEqual([]);
    expect(decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
  });
});
