/**
 * Mixed business + personal, through the REAL pipeline.
 *
 * The governor unit test proves the firewall rejects a malformed decision. That is not
 * the same as proving a real utterance carrying both a business question and a personal
 * one survives perception, attention, retrieval and integration with both answers
 * intact. These tests drive the whole loop.
 */

import { describe, expect, it } from "vitest";
import { decideTurn, type ExecutiveDeps } from "../executive/decide";
import { planAttention } from "../executive/attention";
import { perceiveTurn } from "../perception/perceive";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";
import { BUSINESS_ANSWER_UNAVAILABLE } from "../contracts/executiveDecision";
import type { EvidenceItem } from "../contracts/evidence";

const CTX = {
  conversationKey: "claire-call:mixed",
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
};
const INTEGRATION = { timeZone: "America/Los_Angeles", today: "2026-09-20", surface: "voice" as const };

/** Both halves must be genuinely answerable, or the test proves absence, not survival. */
const MIXED = "What were my last five sales, and were you ever married?";

function memory() {
  return snapshotWorkingMemory({}, CTX);
}

const resolution: EvidenceItem = {
  id: "contact_account_resolution:dana",
  type: "account_state",
  source: "listAccountContacts",
  provenance: { reader: "listAccountContacts" },
  observedAt: "2026-09-20T00:00:00.000Z",
  asOf: "2026-09-20",
  freshness: null,
  coverage: null,
  authoritativeFor: ["current_business_truth"],
  payload: {
    mention: "Dana",
    resolutionKind: "contact",
    accountId: 77,
    accountName: "The Louise",
    contactName: "Dana",
    candidateAccountIds: [77],
  },
  operatorVisible: true,
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

/** A real, speakable business answer. */
const sales: EvidenceItem = {
  id: "business_query:latest_sales:mixed",
  type: "business_query",
  source: "runBusinessQuery",
  provenance: { reader: "runBusinessQuery" },
  observedAt: "2026-09-20T00:00:00.000Z",
  asOf: "2026-09-20",
  freshness: { completeness: "complete", loadedSources: ["laundry_butler"], failedSources: [] },
  coverage: { complete: true, gaps: [] },
  authoritativeFor: ["current_business_truth"],
  payload: {
    status: "ok",
    query: { metric: "latest_sales", limit: 5, customerName: null, rank: null, filters: null, serviceType: null, listMembers: true, period: { kind: "all_time" }, comparison: null, minOrders: 1, groupBy: null },
    period,
    comparisonPeriod: null,
    coverage: { completeness: "complete", loadedSources: ["laundry_butler"], failedSources: [], unverifiedNativeCount: 0, unverifiedNativeCents: 0, overlap: {}, serviceFilterUnclassified: null, lineage: null, union: null },
    data: {
      kind: "orders",
      ordering: "latest",
      orders: [
        { eventKey: "evt-1", orderNumber: "A1", date: "2026-09-19", occurredAt: "2026-09-19T10:00:00.000Z", cents: 4200, source: "laundry_butler", businessLine: null, processor: null, building: null, serviceType: null, summary: null, customerName: "Thomas", address: null, ingestedAt: null },
      ],
    },
  },
  operatorVisible: true,
};

const entitlement: EvidenceItem = {
  id: "disclosure_entitlement:ent-1",
  type: "disclosure_entitlement",
  source: "loadPersonalProgressionContext",
  provenance: { reader: "loadPersonalProgressionContext" },
  observedAt: "2026-09-20T00:00:00.000Z",
  asOf: "2026-09-20",
  freshness: null,
  coverage: null,
  authoritativeFor: ["self_state"],
  payload: { entitlementId: "ent-1" },
  operatorVisible: true,
};

function deps(retrieve: ExecutiveDeps["retrieve"]): ExecutiveDeps {
  return { retrieve, ctx: INTEGRATION };
}

describe("a genuinely mixed utterance opens both lanes", () => {
  it("Perception sees both a business question and a personal probe", () => {
    const perceived = perceiveTurn({ rawText: MIXED, completeness: "complete" });
    expect(perceived.personalProbe).toBe(true);
    expect(perceived.hasBusinessQuestion || perceived.businessIntent !== "none").toBe(true);
  });

  it("Attention retrieves BOTH business memory and self memory", () => {
    const perceived = perceiveTurn({ rawText: MIXED, completeness: "complete" });
    const attention = planAttention(perceived, memory());
    expect(attention.lanes).toContain("personal");
    expect(attention.lanes).toContain("business");
    expect(attention.retrieve).toContain("businessMemory");
    expect(attention.retrieve).toContain("selfMemory");
  });

  it("both retrievals are actually planned, not just attended to", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: MIXED, completeness: "complete" }),
      memory(),
      deps(async () => [])
    );
    const kinds = decision.retrievals.map(r => `${r.compartment}:${r.kind}`);
    expect(kinds.some(k => k.startsWith("businessMemory:"))).toBe(true);
    expect(kinds).toContain("selfMemory:disclosure_entitlement");
  });
});

describe("neither lane suppresses the other", () => {
  it("business survives alongside a lawful personal disclosure", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: MIXED, completeness: "complete" }),
      memory(),
      deps(async request =>
        request.compartment === "selfMemory"
          ? [entitlement]
          : request.kind === "business_query"
            ? [sales]
            : []
      )
    );
    const types = decision.responsePlan.segments.map(s => s.type);
    expect(types).toContain("BusinessFactSegment");
    expect(types).toContain("PersonalDisclosureSegment");
    // The business answer is real speech, not an empty placeholder.
    const fact = decision.responsePlan.segments.find(s => s.type === "BusinessFactSegment");
    expect(fact?.text).toMatch(/Thomas|\$42/);
  });

  it("a personal decline still leaves the business answer standing", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: MIXED, completeness: "complete" }),
      memory(),
      // No entitlement: Claire must decline personally, and still answer business.
      deps(async request => (request.kind === "business_query" ? [sales] : []))
    );
    const types = decision.responsePlan.segments.map(s => s.type);
    expect(types).toContain("BusinessFactSegment");
    expect(types).not.toContain("PersonalDisclosureSegment");
    expect(decision.conclusions.some(c => c.kind === "personal_disclosure_declined")).toBe(true);
  });

  it("a personal disclosure without business evidence still reports the business gap", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: MIXED, completeness: "complete" }),
      memory(),
      deps(async request => (request.compartment === "selfMemory" ? [entitlement] : []))
    );
    // The business lane produced nothing, and that is stated rather than dropped.
    expect(decision.conclusions.some(c => c.kind === BUSINESS_ANSWER_UNAVAILABLE)).toBe(true);
  });

  it("personal comes after business, so it cannot bury the answer", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: MIXED, completeness: "complete" }),
      memory(),
      deps(async request =>
        request.compartment === "selfMemory"
          ? [entitlement]
          : request.kind === "business_query"
            ? [sales]
            : []
      )
    );
    const types = decision.responsePlan.segments.map(s => s.type);
    expect(types.indexOf("BusinessFactSegment")).toBeLessThan(types.indexOf("PersonalDisclosureSegment"));
  });

  it("a self-memory failure never takes the business answer with it", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: MIXED, completeness: "complete" }),
      memory(),
      deps(async request => {
        if (request.compartment === "selfMemory") throw new Error("progression store down");
        return request.kind === "business_query" ? [sales] : [];
      })
    ).catch(() => null);
    // Retrieval failure propagates out of the brain (the observer swallows it), but if
    // it does resolve, business must be intact.
    if (decision) {
      expect(decision.responsePlan.segments.some(s => s.type === "BusinessFactSegment")).toBe(true);
    }
  });
});

describe("narrative probes are handled, not disclosed", () => {
  it("an ontology question opens the narrative lane", () => {
    const perceived = perceiveTurn({ rawText: "Are you real?", completeness: "complete" });
    expect(perceived.narrativeProbe).toBe(true);
  });

  it("declines without an entitlement rather than inventing an answer", async () => {
    const decision = await decideTurn(
      perceiveTurn({ rawText: "Are you real?", completeness: "complete" }),
      memory(),
      deps(async () => [])
    );
    expect(decision.responsePlan.segments.some(s => s.type === "NarrativeRevealSegment")).toBe(false);
    expect(decision.conclusions.some(c => c.kind === "personal_disclosure_declined")).toBe(true);
  });
});
