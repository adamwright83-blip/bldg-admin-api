import { describe, expect, it, vi } from "vitest";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "./claireTurn";
import { defaultBusinessQuery, type BusinessQuery } from "../../analytics/businessQuery";

const NOW = new Date("2026-09-20T18:00:00Z");
const base = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  dayDirectorActorId: "1",
  surface: "voice" as const,
  conversationKey: "claire-call:kernel",
  brief: "Business context.",
  context: {
    businessDate: "2026-09-20",
    actorId: "adam-admin",
    macroGoalKnown: false,
    blockers: [],
    relevantTimeline: [],
    clock: {
      localTime: "11:00 AM",
      weekday: "Sunday",
      businessDate: "2026-09-20",
      timeZone: "America/Los_Angeles",
    },
  } as never,
};

function deps(overrides: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps {
  const defaults: ClaireTurnDeps = {
    now: () => NOW,
    timeZone: () => "America/Los_Angeles",
    business: {
      now: () => NOW,
      timeZone: () => "America/Los_Angeles",
      plan: async () => null,
      loadBindings: async () => ({
        laundry_butler: { state: "bound" as const, lastSuccessAt: NOW, isSystemOfRecord: true },
        cleancloud: { state: "absent" as const, lastSuccessAt: null, isSystemOfRecord: false },
      }),
      runQuery: (async (_tenant: string, query: BusinessQuery) => ({
        status: "unavailable",
        query,
        period: { label: "x", start: "2026-01-01", end: "2026-09-20" },
        comparisonPeriod: null,
        reason: "test",
      })) as never,
    },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Scoped answer.") as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: vi.fn(async () => ({ added: [], completed: [], failed: [], commitmentIds: [], receipts: [] })) as never,
    campaign: async () => null,
    vocabulary: async () => [],
    accounts: async () => [],
    accountHistory: vi.fn() as never,
    commitFollowUp: vi.fn() as never,
    dayWork: vi.fn() as never,
    unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never,
    memoryBetween: vi.fn(async () => []) as never,
    encyclopedia: null,
    watchBoard: undefined,
    doctrineTurn: undefined,
    classifyPriorClaim: vi.fn(async () => null) as never,
    rerunBusinessQuery: vi.fn(async (_tenant: string, query: BusinessQuery) => ({
      status: "unavailable",
      query,
      period: { label: "x", start: "2026-01-01", end: "2026-09-20" },
      comparisonPeriod: null,
      reason: "test",
    })) as never,
  };
  return { ...defaults, ...overrides, business: { ...defaults.business, ...(overrides.business ?? {}) } };
}

describe("authoritative kernel routing", () => {
  it("a scoped Dana advice question never opens the global proactive board", async () => {
    const watchBoard = vi.fn(async () => ({ brief: "GUMBALL / Andrew / unrelated mission" }));
    const accountHistory = vi.fn(async () => ({
      account: { id: 1, name: "The Louise", accountType: "apartment" },
      missions: [],
      events: [],
      fieldVisits: [],
      outcomes: [],
      followUps: [{ id: "f1", pipelineId: 1, status: "open", dueAt: "2026-09-22T17:00:00.000Z", note: "Call Dana", completedAt: null }],
      pipelineStage: "follow_up",
      pipelineId: 1,
      contacts: [{ name: "Dana", title: "GM", relationshipType: "decision_maker" }],
      dayLineMentions: [],
      conversationMentions: [],
    })) as never;
    const result = await runClaireTurn(
      { ...base, utterance: "What should I do about Dana Tuesday?", state: {} },
      deps({
        watchBoard,
        accounts: async () => [{ id: 1, name: "The Louise", accountType: "apartment", aliases: ["Dana"] }],
        accountHistory,
      })
    );
    expect(watchBoard).not.toHaveBeenCalled();
    expect(accountHistory).toHaveBeenCalled();
    expect(result.speak).toContain("Scoped answer");
    expect(result.speak).not.toMatch(/GUMBALL|Andrew|unrelated mission/);
  });

  it("a new business question supersedes an unrelated pending proposal before it can interpret the turn", async () => {
    const state: ClaireTurnState = {
      pendingProposal: {
        title: "Wrong old task",
        sourceText: "Wrong old task",
        quantity: null,
      } as never,
      analytics: {
        query: defaultBusinessQuery("latest_sales"),
        periods: [],
        disclosed: [],
        pendingClarification: null,
        touchedAt: NOW.getTime(),
      },
    };
    const result = await runClaireTurn(
      { ...base, utterance: "What were my last five sales?", state },
      deps()
    );
    expect(state.pendingProposal).toBeNull();
    expect(result.speak).not.toMatch(/still holding|say yes to add/i);
  });

  it("'actually don't do that' clears a held proposal and does not reopen clarification", async () => {
    const state: ClaireTurnState = {
      pendingProposal: {
        title: "Call Dana",
        sourceText: "I need to call Dana Tuesday",
        quantity: null,
      } as never,
    };
    const result = await runClaireTurn(
      { ...base, utterance: "Um, actually don't do that.", state },
      deps()
    );
    expect(state.pendingProposal).toBeNull();
    expect(result.speak).toMatch(/won't add|won't.*change/i);
    expect(result.speak).not.toMatch(/add something|catching me up/i);
  });

  it("a truly broad morning request may still invoke the proactive board", async () => {
    const watchBoard = vi.fn(async () => ({ brief: "Actual scoped morning brief." }));
    const result = await runClaireTurn(
      { ...base, utterance: "What should I do today?", state: {} },
      deps({ watchBoard })
    );
    expect(watchBoard).toHaveBeenCalledTimes(1);
    expect(result.speak).toContain("Actual scoped morning brief");
  });
});
