import { describe, expect, it, vi } from "vitest";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";
import { coveredThisCallLines } from "./callCoverage";

const NOW = new Date("2026-09-17T18:00:00Z");
const LOUISE = { id: 7, name: "The Louise", accountType: "commercial" };
const WILSHIRE = { id: 8, name: "The Wilshire", accountType: "commercial" };

function deps(followUp: ClaireTurnDeps["followUp"]): ClaireTurnDeps {
  return {
    now: () => NOW,
    timeZone: () => "America/Los_Angeles",
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: vi.fn() as never },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp,
    extractModel: null,
    loadExisting: async () => [],
    commit: vi.fn() as never,
    campaign: async () => null,
    vocabulary: async () => [],
    accounts: async () => [LOUISE, WILSHIRE],
    accountHistory: vi.fn() as never,
    commitFollowUp: vi.fn() as never,
    dayWork: vi.fn() as never,
    unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never,
    memoryBetween: vi.fn(async () => []) as never,
    encyclopedia: null,
    watchBoard: undefined,
    doctrineTurn: undefined,
    classifyPriorClaim: async () => false,
    rerunBusinessQuery: vi.fn() as never,
  };
}

async function say(utterance: string, state: ClaireTurnState, followUp: ClaireTurnDeps["followUp"]) {
  return runClaireTurn(
    {
      tenantId: "default", operatorUserId: "adam", dayDirectorActorId: "1", surface: "voice", utterance, state, conversationKey: "call:long", allowFragmentWait: false,
      brief: "Two stops today.", context: { businessDate: "2026-09-17", actorId: "adam", macroGoalKnown: false, blockers: [], relevantTimeline: [] } as never,
    },
    deps(followUp)
  );
}

describe("same-call semantic coverage (Louise / Dana)", () => {
  async function longCallWithLouiseCovered() {
    const state: ClaireTurnState = {};
    const seen: Array<string[] | undefined> = [];
    const model = vi.fn(async (input: { coveredThisCall?: string[]; utterance: string }) => {
      seen.push(input.coveredThisCall);
      if (/^Hello/.test(input.utterance)) return "How did it go with Dana at The Louise?";
      return "Noted. Anything else on your side?";
    });
    await say("Hello Claire, I'm heading out.", state, model as never);
    await say("Dana was fine, she wants a proposal next week.", state, model as never);
    // Push the Louise exchange far outside the model's 8-turn prompt window.
    for (let i = 0; i < 12; i++) await say(`Filler update number ${i} about the day so far.`, state, model as never);
    return { state, model, seen };
  }

  it("records the subject as covered and keeps it past the short history window", async () => {
    const { state, seen } = await longCallWithLouiseCovered();
    expect(state.coverage?.[0]).toMatchObject({ subject: "account:7", askedByClaire: true, answeredByOperator: true });
    expect(state.coverage?.[0]?.people).toContain("Dana");
    // 14 turns in, the prompt window (last 8) no longer contains the Louise exchange, but coverage still does.
    expect(coveredThisCallLines(state.coverage)[0]).toMatch(/The Louise \/ Dana/);
    expect(seen[seen.length - 1]?.[0]).toMatch(/The Louise/);
  });

  it("does not restart the subject even if the model tries to", async () => {
    const { state } = await longCallWithLouiseCovered();
    const restarting = vi.fn(async () => "Got it. Any update on Dana at The Louise?");
    const result = await say("Yeah, the day is moving along fine.", state, restarting as never);
    expect(result.speak).not.toMatch(/Dana|Louise/);
    expect(result.speak).toMatch(/Got it\./);
  });

  it("allows the subject again when the operator explicitly returns to it", async () => {
    const { state } = await longCallWithLouiseCovered();
    const model = vi.fn(async () => "Which part of The Louise do you want to revisit?");
    const result = await say("Actually, back to The Louise for a second.", state, model as never);
    expect(result.speak).toMatch(/The Louise/);
  });

  it("does not suppress questions about a subject that has not been covered", async () => {
    const state: ClaireTurnState = {};
    const model = vi.fn(async () => "How is The Wilshire looking?");
    const result = await say("Hello Claire, I'm heading out.", state, model as never);
    expect(result.speak).toMatch(/Wilshire/);
  });
});
