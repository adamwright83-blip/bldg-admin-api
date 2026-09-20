import { describe, expect, it, vi } from "vitest";
import { defaultBusinessQuery, type BusinessQueryResult } from "../../analytics/businessQuery";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState, type ClaireTurnTraceForTest } from "../turn/claireTurn";
import { modelReplyRewritesPriorClaim, verifyPriorClaim, speakPriorClaimVerification } from "./claimReceipts";

/**
 * Thomas-class regression: a deterministic latest-sale answer leaves a receipt, and a later
 * challenge is adjudicated from evidence — never by a free-form model.
 */
const NOW = new Date("2026-09-17T18:00:00Z");
const period = { label: "all time", start: "2020-01-01", end: "2026-09-18" } as never;

function order(key: string, number: string, name: string, cents: number, at: string) {
  return {
    eventKey: key, orderNumber: number, date: at.slice(0, 10), occurredAt: at, cents, source: "cleancloud",
    businessLine: null, processor: null, building: null, serviceType: null, summary: "Fluff & Fold", customerName: name, address: null, ingestedAt: null,
  };
}

function latestResult(orders: ReturnType<typeof order>[], coverage: { completeness: string; failedSources?: string[] } = { completeness: "complete" }): BusinessQueryResult {
  return {
    status: "ok",
    query: defaultBusinessQuery("latest_sales"),
    period,
    comparisonPeriod: null,
    coverage: { completeness: coverage.completeness, loadedSources: ["cleancloud"], failedSources: coverage.failedSources ?? [], unverifiedNativeCount: 0, unverifiedNativeCents: 0, overlap: null, serviceFilterUnclassified: null, lineage: null, union: null } as never,
    data: { kind: "orders", ordering: "latest", orders: orders as never },
  };
}

const THOMAS = order("cc:584", "584", "Thomas", 7040, "2026-09-17T09:34:00.000Z");

function deps(over: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps {
  return {
    now: () => NOW,
    timeZone: () => "America/Los_Angeles",
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: async () => latestResult([THOMAS]) },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Honestly, I made that up.") as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: vi.fn() as never,
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
    classifyPriorClaim: async () => true,
    rerunBusinessQuery: async () => latestResult([THOMAS]),
    ...over,
  };
}

async function say(utterance: string, state: ClaireTurnState, over: Partial<ClaireTurnDeps> = {}) {
  let trace: ClaireTurnTraceForTest | null = null;
  const result = await runClaireTurn(
    {
      tenantId: "default", operatorUserId: "adam", dayDirectorActorId: "1", surface: "voice", utterance, state,
      conversationKey: "call:thomas", brief: "Two stops today.", context: { businessDate: "2026-09-17", actorId: "adam", macroGoalKnown: false, blockers: [], relevantTimeline: [] } as never,
    },
    deps({ ...over, onTurnTrace: t => { trace = t; } })
  );
  return { result, trace: trace as ClaireTurnTraceForTest | null };
}

async function askLatest(state: ClaireTurnState, over: Partial<ClaireTurnDeps> = {}) {
  return say("Who was my most recent sale?", state, over);
}

const FABRICATION = /made (?:that|it) up|invented|fabricat|lied|guess/i;

describe("factual claim receipts", () => {
  it("gives the deterministic latest-sale answer a retrievable receipt", async () => {
    const state: ClaireTurnState = {};
    const { trace, result } = await askLatest(state);
    expect(trace?.path).toBe("business_reader");
    expect(result.speak).toMatch(/Thomas/);
    const receipt = state.claimReceipts?.[0];
    expect(receipt).toMatchObject({ claimType: "newest_paid_sale", grounding: "deterministic", metric: "latest_sales", answerPath: "business_reader", claireTurnOrdinal: 1 });
    expect(receipt?.evidence.some(e => e.ref === "cleancloud:584")).toBe(true);
    expect(receipt?.recheck.kind).toBe("business_query");
    expect(trace?.claimReceipt?.fingerprint).toBeTruthy();
  });

  it.each(["Did you make that up?", "Are you sure?", "Where did that come from?", "Wait, was Thomas really the latest?"])(
    "verifies against the receipt when challenged: %s",
    async challenge => {
      const state: ClaireTurnState = {};
      await askLatest(state);
      const followUp = vi.fn(async () => "I made that up.");
      const { result, trace } = await say(challenge, state, { followUp: followUp as never });
      expect(trace?.path).toBe("prior_claim_verification");
      expect(followUp).not.toHaveBeenCalled();
      expect(result.speak).not.toMatch(FABRICATION);
      expect(result.speak).toMatch(/CleanCloud order 584/);
      expect(trace?.priorClaim).toMatchObject({ outcome: "verified", resolution: "fresh_query", originalAnswerPath: "business_reader", presentation: "deterministic" });
    }
  );

  it("says newer data exists, not fabricated, when a newer sale has since arrived", async () => {
    const state: ClaireTurnState = {};
    await askLatest(state);
    const newer = order("cc:590", "590", "Priya", 3000, "2026-09-17T17:00:00.000Z");
    const { result, trace } = await say("did you invent that?", state, { rerunBusinessQuery: async () => latestResult([newer]) });
    expect(trace?.priorClaim).toMatchObject({ outcome: "superseded", evidenceChanged: true });
    expect(result.speak).toMatch(/newest Goldline had.*newer has arrived/);
    expect(result.speak).not.toMatch(FABRICATION);
  });

  it("distinguishes a stale source from fabrication", async () => {
    const state: ClaireTurnState = {};
    await askLatest(state, { business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: async () => latestResult([THOMAS], { completeness: "partial", failedSources: ["cleancloud"] }) } });
    const older = order("cc:583", "583", "Ana", 1000, "2026-09-16T10:00:00.000Z");
    const { result, trace } = await say("is that right?", state, { rerunBusinessQuery: async () => latestResult([older]) });
    expect(trace?.priorClaim).toMatchObject({ outcome: "stale_source", freshnessAffected: true });
    expect(result.speak).toMatch(/source was behind/);
    expect(result.speak).not.toMatch(FABRICATION);
  });

  it("handles an unsupported prior model claim as unsupported, from the receipt alone", async () => {
    const state: ClaireTurnState = {};
    const rerun = vi.fn();
    await say("Should I chase The Louise?", state, { followUp: vi.fn(async () => "They ordered 14 times last year.") as never });
    expect(state.claimReceipts?.[0]?.grounding).toBe("ungrounded");
    const { result, trace } = await say("are you sure about that?", state, { rerunBusinessQuery: rerun as never });
    expect(trace?.priorClaim).toMatchObject({ outcome: "unsupported", resolution: "receipt_only" });
    expect(rerun).not.toHaveBeenCalled();
    expect(result.speak).toMatch(/didn't have enough to state that as fact/);
  });

  it("fails closed on timeout: no affirm, no retract, no confession", async () => {
    const state: ClaireTurnState = {};
    await askLatest(state);
    const { result, trace } = await say("Did you make that up?", state, { rerunBusinessQuery: () => new Promise(() => {}), priorClaimBudgetMs: 20 });
    expect(trace?.priorClaim).toMatchObject({ outcome: "unverifiable", timedOut: true });
    expect(result.speak).toBe("I can't verify that properly right now.");
    expect(result.speak).not.toMatch(/checking|sorry|apolog|wrong|lied|made|invent|CleanCloud|still checks/i);
  });

  it("fails closed when the authoritative reader throws or is unavailable", async () => {
    const state: ClaireTurnState = {};
    await askLatest(state);
    const { result } = await say("are you lying?", state, { rerunBusinessQuery: async () => { throw new Error("db down"); } });
    expect(result.speak).toBe("I can't verify that properly right now.");
  });

  it("a model cannot downgrade the claim when the classifier is unavailable (structural invariant)", async () => {
    const state: ClaireTurnState = {};
    await askLatest(state);
    // Classifier down → turn falls through to free-form generation, which tries to concede.
    const { result, trace } = await say("Why should I believe that was real?", state, {
      classifyPriorClaim: async () => null,
      followUp: vi.fn(async () => "Fine. I made that up.") as never,
    });
    expect(trace?.priorClaimClassifier).toBe("unavailable");
    expect(result.speak).not.toMatch(FABRICATION);
    expect(trace?.priorClaim).toMatchObject({ presentation: "guard_replacement", outcome: "verified" });
  });

  it("does not spend a classifier hop on turns with no recent factual claim", async () => {
    const classify = vi.fn(async () => true);
    const { trace } = await say("Are you sure?", {}, { classifyPriorClaim: classify });
    expect(classify).not.toHaveBeenCalled();
    expect(trace?.path).not.toBe("prior_claim_verification");
  });

  it("does not hijack an ordinary follow-up business question", async () => {
    const state: ClaireTurnState = {};
    await askLatest(state);
    const { trace } = await say("Who was my most recent sale?", state, { classifyPriorClaim: async () => false });
    expect(trace?.path).toBe("business_reader");
  });
});

describe("verifyPriorClaim (unit)", () => {
  it("never yields an outcome whose wording alleges lying", async () => {
    const state: ClaireTurnState = {};
    await askLatest(state);
    const receipt = state.claimReceipts![0]!;
    for (const rerun of [async () => latestResult([THOMAS]), async () => { throw new Error("x"); }]) {
      const v = await verifyPriorClaim(receipt, { rerun: rerun as never });
      expect(speakPriorClaimVerification(v)).not.toMatch(/\blie|lied|deceiv|fabricat|made up/i);
    }
  });
  it("lexical lint only detects; it is not the enforcement", () => {
    expect(modelReplyRewritesPriorClaim("I made that up.")).toBe(true);
    expect(modelReplyRewritesPriorClaim("That came from CleanCloud.")).toBe(false);
  });
});
