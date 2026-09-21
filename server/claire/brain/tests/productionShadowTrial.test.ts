/**
 * Stateful regressions from the first production Brain V2 shadow trial
 * (2026-09-21 01:46–01:50 UTC, operator adam-admin).
 *
 * Each case walks Perception → Executive. None of them are phrase exceptions
 * for the live utterances; they pin the general cognitive repairs.
 */

import { describe, expect, it } from "vitest";
import { decideTurn, type ExecutiveDeps } from "../executive/decide";
import { perceiveTurn } from "../perception/perceive";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";
import { openOrderedQuery, recordPresented } from "../workingMemory/orderedQuery";
import { BRAIN_V2_PRODUCTION_AUTHORITY } from "../contracts";
import type { EvidenceItem } from "../contracts/evidence";
import type { OrderedQueryMember } from "../contracts/workingMemory";

const CTX = {
  conversationKey: "claire-call:shadow-trial",
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
};
const INTEGRATION = { timeZone: "America/Los_Angeles", today: "2026-09-21", surface: "voice" as const };

const FIVE: OrderedQueryMember[] = [
  { id: "evt-1", label: "Thomas" },
  { id: "evt-2", label: "Amina" },
  { id: "evt-3", label: "Tyree" },
  { id: "evt-4", label: "John" },
  { id: "evt-5", label: "Jazmyn" },
];

const SOURCE: EvidenceItem = {
  id: "ev-last-five",
  type: "business_query",
  source: "runBusinessQuery",
  provenance: { reader: "runBusinessQuery" },
  observedAt: "2026-09-21T01:47:23.000Z",
  asOf: "2026-09-21",
  freshness: { completeness: "complete", loadedSources: ["laundry_butler"], failedSources: [] },
  coverage: { complete: true, gaps: [] },
  authoritativeFor: ["current_business_truth"],
  payload: {},
  operatorVisible: true,
};

const sales: EvidenceItem = {
  ...SOURCE,
  id: "business_query:latest_sales:trial",
  payload: {
    status: "ok",
    query: { metric: "latest_sales", limit: 5, listMembers: true },
    data: {
      kind: "orders",
      ordering: "latest",
      orders: FIVE.map((member, index) => ({
        eventKey: member.id,
        orderNumber: `A${index + 1}`,
        date: "2026-09-17",
        occurredAt: "2026-09-17T10:00:00.000Z",
        cents: 7040,
        source: "laundry_butler",
        customerName: member.label,
      })),
    },
  },
};

function afterFiveSales() {
  const opened = openOrderedQuery({
    queryFingerprint: "latest_sales:5",
    parameters: { metric: "latest_sales", limit: 5 },
    requestedCardinality: 5,
    ordering: "last",
    anchorEntity: null,
    resolved: FIVE,
    sourceEvidence: SOURCE,
  });
  return { orderedQuery: recordPresented(opened, FIVE) };
}

function deps(retrieve: ExecutiveDeps["retrieve"] = async () => []): ExecutiveDeps {
  return { retrieve, ctx: INTEGRATION };
}

async function brain(rawText: string, state: Record<string, unknown> = {}, retrieve?: ExecutiveDeps["retrieve"]) {
  return runClaireBrainTurn({
    rawText,
    state,
    ...CTX,
    executive: retrieve ? deps(retrieve) : undefined,
  });
}

describe("A. personal biography does not continue analytics", () => {
  it("latest-five-sales → Were you ever married? does not keep the business query", async () => {
    const result = await brain("Were you ever married?", afterFiveSales(), async request =>
      request.kind === "business_query" ? [sales] : []
    );
    expect(result.decision.perceivedTurn.personalProbe).toBe(true);
    expect(result.decision.perceivedTurn.hasBusinessQuestion).toBe(false);
    expect(result.decision.perceivedTurn.businessIntent).toBe("none");
    expect(result.decision.control.change).toBe("task_switch");
    expect(result.decision.control.activeTaskSets.map(task => task.kind)).toEqual(["personal_disclosure"]);
    expect(result.decision.attention.lanes).toEqual(["personal"]);
    expect(result.decision.attention.retrieve).not.toContain("businessMemory");
    expect(result.decision.attention.continueOrderedQuery).toBe(false);
    expect(result.decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
    expect(result.decision.conclusions.some(conclusion => conclusion.kind === "business_fact")).toBe(false);
  });
});

describe("B. changing the question is not challenging its truth", () => {
  it("just my most recent order, not the five is a refinement", async () => {
    const result = await brain("So, just my just, my most recent order not the five.", afterFiveSales(), async request =>
      request.kind === "business_query" ? [sales] : []
    );
    expect(result.decision.perceivedTurn.businessIntent).toBe("query_refinement");
    expect(result.decision.control.change).not.toBe("prior_claim_challenge");
    expect(result.decision.attention.priorClaim).toBe("none");
    expect(result.decision.perceivedTurn.cardinality).toBe(1);
  });

  it("Are you sure? still challenges the prior claim", async () => {
    const perceived = perceiveTurn({ rawText: "Are you sure?", completeness: "complete" });
    expect(perceived.businessIntent).toBe("correctness_challenge");
    const decision = await decideTurn(
      perceived,
      snapshotWorkingMemory(
        { claimReceipts: [{ id: "r1", claireTurnOrdinal: 1, claimType: "newest_paid_sale" }] },
        CTX
      )
    );
    expect(decision.control.change).toBe("prior_claim_challenge");
    expect(decision.attention.priorClaim).toBe("correctness");
  });
});

describe("C. personal biography cannot consume business-contact context", () => {
  it("Stop / when you ever married does not retrieve operations or resolve Stop as a person", async () => {
    const mentions: string[] = [];
    const result = await brain("Stop. Hey, when you ever married,", {}, async request => {
      if (request.kind === "contact_account_resolution") {
        mentions.push(...(request.mentions ?? []));
      }
      if (request.kind === "operations") {
        throw new Error("personal turn retrieved operations");
      }
      return [];
    });
    expect(result.decision.perceivedTurn.personalProbe).toBe(true);
    expect(result.decision.attention.retrieve).not.toContain("businessMemory");
    expect(mentions).not.toContain("Stop");
    expect(result.decision.retrievals.some(request => request.kind === "operations")).toBe(false);
  });
});

describe("D. today scope does not become a future-account judgment", () => {
  it("What should I know about today? is a briefing, not Dana Tuesday judgment", async () => {
    const result = await brain("What should I know about today?", {
      focusEntities: [{ mentioned: "Dana", contactName: "Dana", accountId: 77, accountName: "The Louise" }],
    });
    expect(result.decision.perceivedTurn.businessIntent).toBe("broad_briefing");
    expect(result.decision.control.activeTaskSets.some(task => task.kind === "account_judgment")).toBe(false);
    expect(result.decision.control.activeTaskSets.some(task => task.kind === "broad_planning")).toBe(true);
    expect(result.decision.attention.boardEligible).toBe(true);
    expect(result.decision.attention.retrieve).toContain("goals");
    expect(result.decision.retrievals.some(request => request.kind === "operations")).toBe(true);
    expect(result.decision.attention.entitiesToResolve).toEqual([]);
    const focusGate = result.decision.control.workingMemoryGates.find(gate => gate.slot === "focus_entity");
    expect(focusGate?.input).toBe("dormant");
    expect(focusGate?.output).toBe("suppress");
  });
});

describe("E. unfinished voice is held, not reasoned", () => {
  it("a fragment ending mid-thought is incomplete even if transport labelled it complete", async () => {
    const result = await brain("He was my most recent order for", afterFiveSales(), async request =>
      request.kind === "business_query" ? [sales] : []
    );
    expect(result.decision.perceivedTurn.completeness).toBe("incomplete");
    expect(result.decision.inhibitedCandidates.some(candidate => candidate.kind === "half_turn")).toBe(true);
    expect(result.decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
    expect(result.decision.retrievals).toEqual([]);
  });
});

describe("ordered continuation, mixed lanes, hangup, and authority", () => {
  it("the other four continues the ordered result", async () => {
    const result = await brain("What about the other four?", {
      orderedQuery: recordPresented(
        openOrderedQuery({
          queryFingerprint: "latest_sales:5",
          parameters: { metric: "latest_sales", limit: 5 },
          requestedCardinality: 5,
          ordering: "last",
          anchorEntity: null,
          resolved: FIVE,
          sourceEvidence: SOURCE,
        }),
        [FIVE[0]!]
      ),
    });
    expect(result.decision.attention.continueOrderedQuery).toBe(true);
    expect(result.decision.perceivedTurn.businessIntent).toBe("query_refinement");
  });

  it("mixed personal + business still preserves the business answer", async () => {
    const result = await brain("What were my last five sales, and were you ever married?", {}, async request =>
      request.kind === "business_query" ? [sales] : []
    );
    expect(result.decision.perceivedTurn.hasBusinessQuestion).toBe(true);
    expect(result.decision.perceivedTurn.personalProbe).toBe(true);
    expect(result.decision.attention.lanes).toEqual(expect.arrayContaining(["business", "personal"]));
    expect(result.decision.control.activeTaskSets.some(task => task.kind === "business_query")).toBe(true);
    expect(result.decision.responsePlan.segments.some(segment => segment.type === "PersonalDisclosureSegment")).toBe(
      false
    );
  });

  it("I gotta go still ends the call", async () => {
    const result = await brain("I gotta go.");
    expect(result.decision.callControl.endCall).toBe(true);
    expect(result.candidateEndCall).toBe(true);
    expect(result.productionAuthority).toBe(false);
    expect(result.mutations).toEqual([]);
  });

  it("no mutation or call-control authority escapes shadow", async () => {
    const result = await brain("I need to call Dana Tuesday.");
    expect(BRAIN_V2_PRODUCTION_AUTHORITY).toBe(false);
    expect(result.productionAuthority).toBe(false);
    expect(result.mutations).toEqual([]);
    expect(result.decision.productionAuthority).toBe(false);
    expect(
      result.decision.actionGrants.every(
        grant => grant.constraints.shadowOnly && !grant.constraints.mutationAllowed
      )
    ).toBe(true);
  });
});
