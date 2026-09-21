import { describe, expect, it } from "vitest";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";
import { openOrderedQuery, recordPresented } from "../workingMemory/orderedQuery";
import { BUSINESS_ANSWER_UNAVAILABLE } from "../contracts/executiveDecision";
import type { EvidenceItem } from "../contracts/evidence";
import type { OrderedQueryMember } from "../contracts/workingMemory";

const CTX = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
  conversationKey: "claire-call:corpus",
};

async function brain(rawText: string, state: Record<string, unknown> = {}) {
  return runClaireBrainTurn({ rawText, state, ...CTX });
}

const FIVE: OrderedQueryMember[] = [
  { id: "evt-1", label: "Thomas" },
  { id: "evt-2", label: "Dana" },
  { id: "evt-3", label: "Priya" },
  { id: "evt-4", label: "Marcus" },
  { id: "evt-5", label: "Lena" },
];

/** The authoritative read that produced the five; a continuation re-cites exactly this. */
const SOURCE: EvidenceItem = {
  id: "ev-last-five",
  type: "business_query",
  source: "runBusinessQuery",
  provenance: { reader: "runBusinessQuery" },
  observedAt: "2026-09-20T00:00:00.000Z",
  asOf: "2026-09-20",
  freshness: { completeness: "complete", loadedSources: ["laundry_butler"], failedSources: [] },
  coverage: { complete: true, gaps: [] },
  authoritativeFor: ["current_business_truth"],
  payload: {},
  operatorVisible: true,
};

/** Claire resolved five sales but actually spoke only Thomas. */
function afterPresentingThomas() {
  const opened = openOrderedQuery({
    queryFingerprint: "latest_sales:5",
    parameters: { metric: "latest_sales", limit: 5 },
    requestedCardinality: 5,
    ordering: "last",
    anchorEntity: null,
    resolved: FIVE,
    sourceEvidence: SOURCE,
  });
  return { orderedQuery: recordPresented(opened, [FIVE[0]]) };
}

function factText(result: Awaited<ReturnType<typeof brain>>): string {
  const fact = result.decision.responsePlan.segments.find(
    segment => segment.type === "BusinessFactSegment"
  );
  return fact?.text ?? "";
}

/**
 * Stateful regression corpus to port from PR #192 / production calls.
 * Cases marked `todo` are specified so the next agent implements them against
 * runClaireBrainTurn rather than inventing a parallel helper suite.
 */
describe("Brain V2 regression corpus", () => {
  it("What were my last five sales?", async () => {
    const result = await brain("What were my last five sales?");
    expect(result.decision.perceivedTurn.cardinality).toBe(5);
    expect(result.decision.attention.boardEligible).toBe(false);
    expect(result.mutations).toEqual([]);
  });

  it("The other four. — requires ordered query memory (resolved ≠ presented)", async () => {
    const result = await brain("The other four.");
    expect(result.decision.perceivedTurn.priorQueryReference || result.decision.perceivedTurn.businessIntent === "query_refinement").toBe(true);
  });

  it("The other four. — returns the remaining four of THAT result", async () => {
    const result = await brain("What about the other four?", afterPresentingThomas());
    const text = factText(result);
    expect(text).toContain("Dana");
    expect(text).toContain("Priya");
    expect(text).toContain("Marcus");
    expect(text).toContain("Lena");
    // Thomas was already presented; he is not repeated.
    expect(text).not.toContain("Thomas");
  });

  it("the continuation cites the original read, not a new one", async () => {
    const result = await brain("What about the other four?", afterPresentingThomas());
    const fact = result.decision.responsePlan.segments.find(
      segment => segment.type === "BusinessFactSegment"
    );
    expect(fact && "evidence" in fact && fact.evidence).toEqual([{ evidenceId: "ev-last-five" }]);
    expect(result.decision.conclusions.some(c => c.kind === "ordered_query_continuation")).toBe(true);
    // No fresh business query was issued for a pure continuation.
    expect(result.decision.retrievals.some(request => request.kind === "business_query")).toBe(false);
  });

  it("What happened before Thomas? — continues the same ordered query window", async () => {
    const state = {
      orderedQuery: openOrderedQuery({
        queryFingerprint: "latest_sales:5",
        parameters: {},
        requestedCardinality: 5,
        ordering: "before_anchor",
        anchorEntity: "Thomas",
        resolved: [FIVE[1], FIVE[2], FIVE[0], FIVE[3]],
        sourceEvidence: SOURCE,
      }),
    };
    const result = await brain("What happened before Thomas?", state);
    const text = factText(result);
    expect(text).toContain("Dana");
    expect(text).toContain("Priya");
    expect(text).not.toContain("Marcus");
  });

  it("Don't tell me about Thomas. — exclusion stays on this query thread", async () => {
    const opened = openOrderedQuery({
      queryFingerprint: "latest_sales:5",
      parameters: {},
      requestedCardinality: 5,
      ordering: "last",
      anchorEntity: null,
      resolved: FIVE,
      sourceEvidence: SOURCE,
    });
    const result = await brain("Don't tell me about Thomas, what about the rest?", { orderedQuery: opened });
    const text = factText(result);
    if (text) expect(text).not.toContain("Thomas");
  });

  it("I asked for five — what about the rest? — remaining of the same result, not records 6-9", async () => {
    const result = await brain("What about the rest?", afterPresentingThomas());
    const text = factText(result);
    // Every named member must come from the original five.
    for (const name of ["Dana", "Priya", "Marcus", "Lena"]) expect(text).toContain(name);
    expect(result.decision.retrievals.some(request => request.kind === "business_query")).toBe(false);
  });

  it("a continuation with nothing left says so instead of fetching more", async () => {
    const opened = openOrderedQuery({
      queryFingerprint: "latest_sales:5",
      parameters: {},
      requestedCardinality: 5,
      ordering: "last",
      anchorEntity: null,
      resolved: FIVE,
      sourceEvidence: SOURCE,
    });
    const exhausted = { orderedQuery: recordPresented(opened, FIVE) };
    const result = await brain("What about the rest?", exhausted);
    expect(result.decision.responsePlan.segments.some(s2 => s2.type === "BusinessFactSegment")).toBe(false);
    expect(result.decision.conclusions.some(c => c.kind === BUSINESS_ANSWER_UNAVAILABLE)).toBe(true);
  });

  it("Are you sure? — asks for a correctness recheck of the held claim", async () => {
    const state = {
      claimReceipts: [
        { id: "r1", claireTurnOrdinal: 2, claimType: "revenue", recheck: { kind: "business_query" } },
      ],
    };
    const result = await brain("Are you sure?", state);
    expect(result.decision.attention.priorClaim).toBe("correctness");
    const recheck = result.decision.retrievals.find(request => request.kind === "prior_claim_recheck");
    expect(recheck).toBeDefined();
    expect(recheck && "mode" in recheck && recheck.mode).toBe("correctness");
  });

  it("Check that again. — same as a correctness challenge", async () => {
    const state = {
      claimReceipts: [
        { id: "r1", claireTurnOrdinal: 2, claimType: "revenue", recheck: { kind: "business_query" } },
      ],
    };
    const result = await brain("Check that again.", state);
    expect(result.decision.attention.priorClaim).toBe("correctness");
  });

  it("a correctness challenge with no fresh reread renders no fact", async () => {
    const state = {
      claimReceipts: [
        { id: "r1", claireTurnOrdinal: 2, claimType: "revenue", recheck: { kind: "business_query" } },
      ],
    };
    const result = await brain("Are you sure?", state);
    // Nothing was retrieved, so the old receipt may not stand in as fresh proof.
    expect(result.decision.responsePlan.segments.some(s2 => s2.type === "BusinessFactSegment")).toBe(false);
  });

  it("Where did that number come from? — provenance may use the existing receipt", async () => {
    const state = {
      claimReceipts: [
        { id: "r1", claireTurnOrdinal: 2, claimType: "revenue", recheck: { kind: "business_query" } },
      ],
    };
    const result = await brain("Where did that number come from?", state);
    expect(result.decision.attention.priorClaim).toBe("provenance");
    const recheck = result.decision.retrievals.find(request => request.kind === "prior_claim_recheck");
    expect(recheck && "mode" in recheck && recheck.mode).toBe("provenance");
  });
  it("What should I do about Dana Tuesday?", async () => {
    const result = await brain("What should I do about Dana Tuesday?");
    expect(result.decision.perceivedTurn.businessIntent).toBe("judgment_question");
    expect(result.decision.attention.boardEligible).toBe(false);
    expect(result.decision.actionGrants).toEqual([]);
  });
  it("Dana at The Louise. What should I do Tuesday? — resolves contact and account, stays scoped", async () => {
    const result = await brain("Dana at The Louise. What should I do Tuesday?");
    expect(result.decision.perceivedTurn.businessIntent).toBe("judgment_question");
    // The account is resolved authoritatively, never hardcoded to this pair.
    const resolution = result.decision.retrievals.find(
      request => request.kind === "contact_account_resolution"
    );
    expect(resolution).toBeDefined();
    expect(result.decision.attention.boardEligible).toBe(false);
    expect(result.decision.retrievals.some(request => request.compartment === "goals")).toBe(false);
    expect(result.decision.actionGrants).toEqual([]);
  });
  it("I need to call Dana Tuesday.", async () => {
    const result = await brain("I need to call Dana Tuesday.");
    expect(result.decision.perceivedTurn.operatorWorkCommitment).toBe(true);
    expect(result.decision.actionGrants[0]?.constraints.mutationAllowed).toBe(false);
  });
  it("No. — rejects pending", async () => {
    const result = await brain("No.", { pendingBriefing: { parsed: { items: [{}] }, createdAt: 1 } });
    expect(result.decision.attention.pendingDisposition).toBe("reject");
  });
  it("Actually don't do that. — remains cleared; acknowledge", async () => {
    const result = await brain("Actually don't do that.", { pendingBriefing: { parsed: { items: [{}] }, createdAt: 1 } });
    expect(result.decision.attention.pendingDisposition).toBe("reject");
  });
  it("No, Wednesday. — revise pending", async () => {
    const result = await brain("No, Wednesday.", { pendingBriefing: { parsed: { items: [{}] }, createdAt: 1 } });
    expect(result.decision.attention.pendingDisposition).toBe("revise");
  });
  it("Wait, change Dana to Wednesday. — revises the pending item rather than reinterpreting", async () => {
    const result = await brain("Wait, change Dana to Wednesday.", {
      pendingBriefing: { parsed: { items: [{}] }, createdAt: 1 },
    });
    expect(result.decision.attention.pendingDisposition).toBe("revise");
    expect(result.mutations).toEqual([]);
  });

  it("Forget that, what were my last five sales? — supersedes and routes business", async () => {
    const result = await brain("Forget that. What were my last five sales?", {
      pendingBriefing: { parsed: { items: [{}] }, createdAt: 1 },
    });
    expect(result.decision.attention.pendingDisposition).toBe("supersede");
    expect(result.decision.attention.lanes).toContain("business");
    expect(result.decision.actionGrants).toEqual([]);
  });
  it("Good morning.", async () => {
    const result = await brain("Good morning.");
    expect(result.decision.perceivedTurn.dialogueActs).toContain("greeting");
    expect(result.decision.callControl.endCall).toBe(false);
  });
  it("Good morning, what should I know today?", async () => {
    const result = await brain("Good morning, what should I know today?");
    expect(result.decision.perceivedTurn.broadBriefingRequest).toBe(true);
    expect(result.decision.attention.boardEligible).toBe(true);
    expect(result.decision.control.activeTaskSets.some(task => task.kind === "account_judgment")).toBe(false);
  });
  it("Good morning, I need to call Dana.", async () => {
    const result = await brain("Good morning, I need to call Dana.");
    expect(result.decision.attention.boardEligible).toBe(false);
    expect(result.decision.perceivedTurn.operatorWorkCommitment).toBe(true);
  });
  it("I'm good.", async () => {
    const result = await brain("I'm good.");
    expect(result.decision.perceivedTurn.acknowledgement).toBe(true);
    expect(result.decision.callControl.endCall).toBe(false);
  });
  it("Got it.", async () => {
    const result = await brain("Got it.");
    expect(result.decision.perceivedTurn.acknowledgement).toBe(true);
    expect(result.decision.callControl.endCall).toBe(false);
  });
  it("I gotta go.", async () => {
    const result = await brain("I gotta go.");
    expect(result.decision.callControl.endCall).toBe(true);
  });
  it("Dana hasn't replied, but I gotta go.", async () => {
    const result = await brain("Dana hasn't replied, but I gotta go.");
    expect(result.decision.callControl.endCall).toBe(true);
    expect(result.decision.attention.lanes).toContain("call_control");
  });
  it("mixed business + call control — the business lane is not lost to the hangup", async () => {
    const result = await brain("Dana hasn't replied, but I gotta go.");
    expect(result.decision.callControl.endCall).toBe(true);
    expect(result.decision.attention.lanes).toContain("call_control");
    // Business was attended to, and its absence is stated rather than silently dropped.
    if (result.decision.attention.lanes.includes("business")) {
      const answered = result.decision.responsePlan.segments.some(
        segment => segment.type === "BusinessFactSegment" || segment.type === "BusinessJudgmentSegment"
      );
      expect(answered || result.decision.conclusions.some(c => c.kind === BUSINESS_ANSWER_UNAVAILABLE)).toBe(true);
    }
  });

  it("a trailing fragment asserts nothing and proposes nothing", async () => {
    // Completeness is supplied by the caller; the shadow runner defaults to "complete".
    // Even so, a fragment carries no evidence, so it may not become a claim or an action.
    const held = await brain("So for Dana I was thinking");
    expect(held.decision.responsePlan.segments.some(s2 => s2.type === "BusinessFactSegment")).toBe(false);
    expect(held.decision.actionGrants).toEqual([]);
    expect(held.candidateSpeak).toBe("");
  });

  it("an explicitly incomplete fragment is inhibited and retrieves nothing", async () => {
    const result = await runClaireBrainTurn({
      rawText: "So for Dana I was thinking",
      completeness: "incomplete",
      ...CTX,
    });
    expect(result.decision.inhibitedCandidates.some(c => c.kind === "half_turn")).toBe(true);
    expect(result.decision.retrievals).toEqual([]);
    expect(result.candidateSpeak).toBe("");
  });
});
