import { describe, expect, it } from "vitest";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";

const CTX = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
  conversationKey: "claire-call:corpus",
};

async function brain(rawText: string, state: Record<string, unknown> = {}) {
  return runClaireBrainTurn({ rawText, state, ...CTX });
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

  it.todo("What happened before Thomas? — continues the same ordered query window");
  it.todo("Don't tell me about Thomas. — exclusion stays on this query thread");
  it.todo("I asked for five — what about the rest? — remaining of the same result, not records 6–9");
  it.todo("Are you sure? — fresh authoritative reread when recheckable");
  it.todo("Check that again. — same as correctness challenge");
  it.todo("Where did that number come from? — provenance may use the existing receipt");
  it("What should I do about Dana Tuesday?", async () => {
    const result = await brain("What should I do about Dana Tuesday?");
    expect(result.decision.perceivedTurn.businessIntent).toBe("judgment_question");
    expect(result.decision.attention.boardEligible).toBe(false);
    expect(result.decision.actionGrants).toEqual([]);
  });
  it.todo("Dana at The Louise. What should I do Tuesday? — contact/account resolution then scoped judgment");
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
  it.todo("Wait, change Dana to Wednesday. — revise identity on the pending item");
  it("Good morning.", async () => {
    const result = await brain("Good morning.");
    expect(result.decision.perceivedTurn.dialogueActs).toContain("greeting");
    expect(result.decision.callControl.endCall).toBe(false);
  });
  it("Good morning, what should I know today?", async () => {
    const result = await brain("Good morning, what should I know today?");
    expect(result.decision.attention.boardEligible).toBe(true);
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
  it.todo("mixed business + personal — both segments; neither suppresses the other");
  it.todo("voice fragments — Perception holds; Executive never sees a half-turn unless flushed");
});
