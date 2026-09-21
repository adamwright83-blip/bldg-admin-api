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

const period = {
  spec: { kind: "all_time" },
  start: "2026-01-01",
  end: "2026-09-21",
  startUtc: new Date("2026-01-01"),
  endExclusiveUtc: new Date("2026-09-22"),
  days: 264,
  timeZone: "America/Los_Angeles",
  label: "all time",
} as never;

const sales: EvidenceItem = {
  ...SOURCE,
  id: "business_query:latest_sales:trial",
  payload: {
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

function afterPresentingFirst() {
  const opened = openOrderedQuery({
    queryFingerprint: "latest_sales:5",
    parameters: { metric: "latest_sales", limit: 5 },
    requestedCardinality: 5,
    ordering: "last",
    anchorEntity: null,
    resolved: FIVE,
    sourceEvidence: SOURCE,
  });
  return { orderedQuery: recordPresented(opened, [FIVE[0]!]) };
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
  it("just my most recent order, not the five is a parameter-changing re-query", async () => {
    let queried = false;
    const result = await brain("So, just my just, my most recent order not the five.", afterFiveSales(), async request => {
      if (request.kind === "business_query") {
        queried = true;
        return [sales];
      }
      return [];
    });
    expect(result.decision.perceivedTurn.businessIntent).toBe("query_requery");
    expect(result.decision.control.change).toBe("query_requery");
    expect(result.decision.control.change).not.toBe("prior_claim_challenge");
    expect(result.decision.attention.priorClaim).toBe("none");
    expect(result.decision.perceivedTurn.cardinality).toBe(1);
    expect(result.decision.attention.continueOrderedQuery).toBe(false);
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.input).toBe("replace");
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.output).toBe(
      "suppress"
    );
    expect(queried).toBe(true);
    expect(result.decision.workingMemoryUpdate?.continuationPresented).toBeUndefined();
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

  it("a standalone Stop. is discourse, not a route question", async () => {
    const result = await brain("Stop.");
    expect(result.decision.retrievals.some(request => request.kind === "operations")).toBe(false);
  });

  it("What's my next stop? still retrieves operations", async () => {
    const result = await brain("What's my next stop?");
    expect(result.decision.attention.lanes).toContain("business");
    expect(result.decision.retrievals.some(request => request.kind === "operations")).toBe(true);
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

  it("a punctuationless desk query is not held by the voice-fragment heuristic", async () => {
    const result = await runClaireBrainTurn({
      rawText: "Tell me where my order is",
      completeness: "complete",
      ...CTX,
      surface: "text",
      conversationKey: "claire-desk:shadow-trial",
    });
    expect(result.decision.perceivedTurn.completeness).toBe("complete");
    expect(result.decision.inhibitedCandidates.some(candidate => candidate.kind === "half_turn")).toBe(false);
  });
});

describe("ordered continuation, mixed lanes, hangup, and authority", () => {
  it("the other four continues the ordered result", async () => {
    const result = await brain("What about the other four?", afterPresentingFirst());
    expect(result.decision.attention.continueOrderedQuery).toBe(true);
    expect(result.decision.perceivedTurn.businessIntent).toBe("query_refinement");
    expect(result.decision.workingMemoryUpdate?.continuationPresented?.map(member => member.id)).toEqual(
      FIVE.slice(1).map(member => member.id)
    );
  });

  it("pending unrelated work does not reset an ordered-query continuation", async () => {
    const pending = { pendingProposal: { title: "Call Dana Tuesday" } };
    const first = await brain("What were my last five sales?", pending, async request =>
      request.kind === "business_query" ? [sales] : []
    );
    expect(first.decision.attention.pendingDisposition).toBe("supersede");
    expect(first.decision.control.workingMemoryGates.find(gate => gate.slot === "pending_proposal")?.output).toBe(
      "suppress"
    );
    const opened = first.decision.workingMemoryUpdate?.orderedQuery;
    expect(opened?.resolved.map(member => member.id)).toEqual(FIVE.map(member => member.id));

    const second = await brain(
      "What about the other four?",
      {
        ...pending,
        orderedQuery: recordPresented(
          openOrderedQuery({
            queryFingerprint: opened!.queryFingerprint,
            parameters: opened!.parameters,
            requestedCardinality: opened!.requestedCardinality,
            ordering: opened!.ordering,
            anchorEntity: opened!.anchorEntity,
            resolved: opened!.resolved,
            sourceEvidence: opened!.sourceEvidence,
          }),
          [opened!.resolved[0]!]
        ),
      },
      async request => {
        if (request.kind === "business_query") {
          throw new Error("continuation must not re-query");
        }
        return [];
      }
    );
    expect(second.decision.control.change).not.toBe("task_switch");
    expect(second.decision.attention.pendingDisposition).toBe("supersede");
    expect(second.decision.control.workingMemoryGates.find(gate => gate.slot === "pending_proposal")?.output).toBe(
      "suppress"
    );
    expect(second.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.output).toBe("allow");
    expect(second.decision.attention.continueOrderedQuery).toBe(true);
    expect(second.decision.workingMemoryUpdate?.continuationPresented?.map(member => member.id)).toEqual(
      FIVE.slice(1).map(member => member.id)
    );
  });

  it("Forget that; just show my most recent order does not continue the abandoned result", async () => {
    const result = await brain(
      "Forget that; just show my most recent order.",
      afterPresentingFirst(),
      async request => (request.kind === "business_query" ? [sales] : [])
    );
    expect(result.decision.control.change).toBe("task_switch");
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.input).toBe("replace");
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.output).toBe(
      "suppress"
    );
    expect(result.decision.attention.continueOrderedQuery).toBe(false);
    expect(result.decision.workingMemoryUpdate?.continuationPresented).toBeUndefined();
  });

  it("Instead, show my most recent order does not continue the previous result", async () => {
    const result = await brain(
      "Instead, show my most recent order.",
      afterPresentingFirst(),
      async request => (request.kind === "business_query" ? [sales] : [])
    );
    expect(result.decision.control.change).toBe("set_shift");
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.output).toBe(
      "suppress"
    );
    expect(result.decision.attention.continueOrderedQuery).toBe(false);
    expect(result.decision.workingMemoryUpdate?.continuationPresented).toBeUndefined();
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

describe("same-set continuation vs parameter-changing re-query", () => {
  async function requery(text: string, expectedCardinality: number | null) {
    let queried = false;
    const result = await brain(text, afterPresentingFirst(), async request => {
      if (request.kind === "business_query") {
        queried = true;
        return [sales];
      }
      if (request.kind === "contact_account_resolution") return [];
      return [];
    });
    expect(result.decision.perceivedTurn.businessIntent).toBe("query_requery");
    expect(result.decision.control.change).toBe("query_requery");
    expect(result.decision.attention.continueOrderedQuery).toBe(false);
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.input).toBe("replace");
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.output).toBe(
      "suppress"
    );
    expect(result.decision.workingMemoryUpdate?.continuationPresented).toBeUndefined();
    expect(queried).toBe(true);
    if (expectedCardinality != null) {
      expect(result.decision.perceivedTurn.cardinality).toBe(expectedCardinality);
    }
    return result;
  }

  it("last five → the other four walks the same resolved set", async () => {
    const result = await brain("What about the other four?", afterPresentingFirst(), async request => {
      if (request.kind === "business_query") throw new Error("continuation must not re-query");
      return [];
    });
    expect(result.decision.perceivedTurn.businessIntent).toBe("query_refinement");
    expect(result.decision.attention.continueOrderedQuery).toBe(true);
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.output).toBe("allow");
    expect(result.decision.workingMemoryUpdate?.continuationPresented?.map(member => member.id)).toEqual(
      FIVE.slice(1).map(member => member.id)
    );
  });

  it("last five → just show my most recent order, not the five is a fresh cardinality-1 query", async () => {
    await requery("Just show my most recent order, not the five.", 1);
  });

  it("last five → only the latest one is a fresh query", async () => {
    await requery("Only the latest one.", 1);
  });

  it("last five → actually give me the last two is a fresh cardinality-2 query", async () => {
    await requery("Actually give me the last two.", 2);
  });
});

describe("explicit set-shift after discourse prefixes", () => {
  it.each([
    "No, instead, just show my most recent order",
    "Okay, instead show the latest one",
    "Actually, rather than sales, show orders",
    "Yeah, but instead show the latest one",
  ])("%s is a set-shift that closes the previous result", async utterance => {
    const result = await brain(utterance, afterPresentingFirst(), async request =>
      request.kind === "business_query" ? [sales] : []
    );
    expect(result.decision.control.change).toBe("set_shift");
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.input).toBe("replace");
    expect(result.decision.control.workingMemoryGates.find(gate => gate.slot === "ordered_query")?.output).toBe(
      "suppress"
    );
    expect(result.decision.attention.continueOrderedQuery).toBe(false);
    expect(result.decision.workingMemoryUpdate?.continuationPresented).toBeUndefined();
  });

  it("ordinary continuation phrases still continue", async () => {
    for (const utterance of ["the other four", "What about the rest?", "and the next one"]) {
      const result = await brain(utterance, afterPresentingFirst());
      expect(result.decision.control.change).not.toBe("set_shift");
      expect(result.decision.attention.continueOrderedQuery).toBe(true);
      expect(result.decision.perceivedTurn.businessIntent).toBe("query_refinement");
    }
  });
});

