import { describe, expect, it, vi } from "vitest";
import { defaultBusinessQuery, type BusinessQueryResult } from "../../analytics/businessQuery";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState, type ClaireTurnTraceForTest } from "../turn/claireTurn";
import { referentTokens, resolveReferencedClaim, speakPriorClaimVerification, verifyPriorClaim, type FactualClaimReceipt } from "./claimReceipts";

const NOW = new Date("2026-09-17T18:00:00Z");
const period = { label: "all time", start: "2020-01-01", end: "2026-09-18" } as never;
const order = (key: string, number: string, name: string, cents: number, at: string) => ({
  eventKey: key, orderNumber: number, date: at.slice(0, 10), occurredAt: at, cents, source: "cleancloud",
  businessLine: null, processor: null, building: null, serviceType: null, summary: "Fluff & Fold", customerName: name, address: null, ingestedAt: null,
});
const latest = (orders: ReturnType<typeof order>[]): BusinessQueryResult => ({
  status: "ok", query: defaultBusinessQuery("latest_sales"), period, comparisonPeriod: null,
  coverage: { completeness: "complete", loadedSources: ["cleancloud"], failedSources: [], unverifiedNativeCount: 0, unverifiedNativeCents: 0, overlap: null, serviceFilterUnclassified: null, lineage: null, union: null } as never,
  data: { kind: "orders", ordering: "latest", orders: orders as never },
});
const THOMAS = order("cc:584", "584", "Thomas", 7040, "2026-09-17T09:34:00.000Z");

function harness(current: { result: BusinessQueryResult } = { result: latest([THOMAS]) }) {
  const base = (over: Partial<ClaireTurnDeps>): ClaireTurnDeps => ({
    now: () => NOW, timeZone: () => "America/Los_Angeles",
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: async () => current.result },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Noted.") as never,
    extractModel: null, loadExisting: async () => [], commit: vi.fn() as never, campaign: async () => null, vocabulary: async () => [],
    accounts: async () => [], accountHistory: vi.fn() as never, commitFollowUp: vi.fn() as never, dayWork: vi.fn() as never, unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never, memoryBetween: vi.fn(async () => []) as never, encyclopedia: null, watchBoard: undefined, doctrineTurn: undefined,
    classifyPriorClaim: async ({ utterance }) => /\b(sure|really|believe|made|invent|lying|real|right|source|order 14)\b/i.test(utterance), rerunBusinessQuery: async () => current.result, ...over,
  });
  const state: ClaireTurnState = {};
  async function say(utterance: string, over: Partial<ClaireTurnDeps> = {}) {
    let trace: ClaireTurnTraceForTest | null = null;
    const result = await runClaireTurn(
      { tenantId: "default", operatorUserId: "adam", dayDirectorActorId: "1", surface: "voice", utterance, state, conversationKey: "call:h", allowFragmentWait: false,
        brief: "Two stops today.", context: { businessDate: "2026-09-17", actorId: "adam", macroGoalKnown: false, blockers: [], relevantTimeline: [] } as never },
      base({ ...over, onTurnTrace: t => { trace = t; } })
    );
    return { result, trace: trace as ClaireTurnTraceForTest | null };
  }
  return { state, say, current };
}
const model = (text: string) => ({ followUp: vi.fn(async () => text) as never });
const BAD = /made (?:that|it) up|invented|fabricat|lied|guess|shouldn't have|wasn't certain|overstated|can't stand behind|wasn't based/i;

describe("1. referent resolution", () => {
  it("verifies Thomas even when Thomas is NOT the newest receipt, well past four Claire turns", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    for (const q of ["Should I chase The Louise?", "Should I call Priya first?", "Should I visit Ana today?", "Should I skip Friday?", "Should I email Dana?", "Should I move the pilot?"]) {
      await h.say(q, model("They ordered 14 times last year."));
    }
    const { result, trace } = await h.say("Wait, was Thomas really the latest sale?");
    expect(trace?.path).toBe("prior_claim_verification");
    expect(trace?.priorClaim).toMatchObject({ receiptId: expect.stringContaining("_1"), resolvedClaireTurn: 1, resolvedVia: "explicit_reference", outcome: "verified" });
    expect(result.speak).toMatch(/CleanCloud order 584/);
  });

  it("a bare 'are you sure?' targets only the immediately preceding claim", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    await h.say("Should I chase The Louise?", model("They ordered 14 times last year."));
    const { trace } = await h.say("Are you sure?");
    expect(trace?.priorClaim).toMatchObject({ resolvedClaireTurn: 2, resolvedVia: "immediately_preceding", outcome: "unsupported" });
  });

  it("fails closed when two different claims match the reference equally", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    h.current.result = latest([order("cc:590", "590", "Thomas", 3000, "2026-09-17T12:00:00.000Z")]);
    await h.say("Who was my most recent sale?");
    const { result, trace } = await h.say("Was Thomas really the latest?");
    expect(trace?.priorClaim?.outcome).toBe("ambiguous_referent");
    expect(result.speak).toMatch(/not sure which statement/);
    expect(result.speak).not.toMatch(/checks out|CleanCloud order/);
  });

  it("unit: an explicit reference beats recency; nothing preceding and nothing named resolves to none", () => {
    const mk = (id: string, ordinal: number, text: string): FactualClaimReceipt => ({ id, conversationKey: "k", claireTurnOrdinal: ordinal, claimedAtMs: 0, claimType: "x", answerText: text, grounding: "deterministic", answerPath: "business_reader", reader: null, metric: null, periodLabel: null, evidence: [], fingerprint: id, newestRecordAt: null, asOf: "", freshness: null, recheck: { kind: "none" } });
    const receipts = [mk("a", 1, "Thomas paid $70.40."), mk("b", 5, "Priya paid $30.00.")];
    expect(resolveReferencedClaim(receipts, "was Thomas right", 9)).toMatchObject({ kind: "resolved", via: "explicit_reference", receipt: { id: "a" } });
    expect(resolveReferencedClaim(receipts, "are you sure", 6)).toMatchObject({ kind: "resolved", via: "immediately_preceding", receipt: { id: "b" } });
    expect(resolveReferencedClaim(receipts, "are you sure", 9)).toEqual({ kind: "none" });
    expect(referentTokens("Thomas paid $70.40.").numbers.has("70.40")).toBe(true);
  });
});

describe("2. retrieved evidence is not a verified model reply", () => {
  const Q = "Who was my latest sale, and what should I do about them?";
  async function synth(reply: string, h = harness()) {
    const first = await h.say(Q, model(reply));
    return { h, first };
  }
  it("a false detail added to a synthesis over true evidence is NOT 'still checks out'", async () => {
    const { h, first } = await synth("Thomas, $70.40. He has ordered 14 times, so I'd lead with a loyalty offer.");
    expect(first.trace?.claimReceipt?.grounding).toBe("synthesized");
    const { result, trace } = await h.say("Did he really order 14 times?");
    expect(trace?.priorClaim?.outcome).toBe("unsupported");
    expect(result.speak).not.toMatch(/checks out|still holds/);
    expect(result.speak).toBe("I didn't have enough to state that as fact.");
  });
  it("a faithful paraphrase is only credited for its figures and names, never as a verified statement", async () => {
    const { h } = await synth("That's Thomas at $70.40, your newest one; I'd follow up this week.");
    const { result, trace } = await h.say("Are you sure about Thomas?");
    expect(trace?.priorClaim?.outcome).toBe("synthesis_grounded");
    expect(result.speak).toMatch(/figures and names in that came from CleanCloud order 584/);
    expect(result.speak).toMatch(/my own read, not a record/);
    expect(result.speak).not.toMatch(/checks out/);
  });
});

describe("3. classifier outage cannot restore model authority", () => {
  it.each([
    "You're right. I shouldn't have said that.",
    "No, I wasn't certain.",
    "Fair point. I overstated it.",
    "I can't stand behind what I said.",
    "That wasn't based on anything solid.",
    "Honestly, take that one with a pinch of salt.",
  ])("replaces the concession: %s", async concession => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    const { result, trace } = await h.say("Why should I believe that was real?", { classifyPriorClaim: async () => null, ...model(concession) });
    expect(trace?.priorClaimClassifier).toBe("unavailable");
    expect(result.speak).not.toBe(concession);
    expect(result.speak).not.toMatch(BAD);
    expect(trace?.priorClaim).toMatchObject({ presentation: "guard_replacement", outcome: "verified" });
  });
});

describe("4. nonnumeric unsupported claims get receipts", () => {
  it.each(["Dana approved it.", "The Louise rejected the pilot.", "Thomas already paid.", "Rebecca moved out.", "The property manager called back."])(
    "%s is recorded ungrounded and, if challenged, is unsupported",
    async claim => {
      const h = harness();
      const first = await h.say("Should I keep pushing on this one?", model(claim));
      expect(first.trace?.claimReceipt).toMatchObject({ grounding: "ungrounded" });
      const { result, trace } = await h.say("Are you sure?");
      expect(trace?.priorClaim?.outcome).toBe("unsupported");
      expect(result.speak).toBe("I didn't have enough to state that as fact.");
    }
  );
});

describe("6. a non-rerunnable receipt is provenance, not current verification", () => {
  it("is 'grounded as stated', never 'still checks out'", async () => {
    const receipt: FactualClaimReceipt = { id: "r", conversationKey: "k", claireTurnOrdinal: 1, claimedAtMs: 0, claimType: "day_line_state", answerText: "You have two stops.", grounding: "deterministic", answerPath: "day_work", reader: null, metric: null, periodLabel: null, evidence: [{ source: "day_work", ref: null }], fingerprint: "f", newestRecordAt: null, asOf: "", freshness: null, recheck: { kind: "none" } };
    const v = await verifyPriorClaim(receipt, { rerun: vi.fn() as never });
    expect(v).toMatchObject({ outcome: "grounded_as_stated", resolution: "receipt_only" });
    expect(speakPriorClaimVerification(v)).not.toMatch(/checks out/);
    expect(speakPriorClaimVerification(v)).toMatch(/won't say it still holds/);
  });
});

// ── Round 3: semantic older-referent resolution, and judgment is not a factual claim ────────────────────────
type Summary = { id: string; claireTurn: number; grounding: string; text: string };
const semanticStub = (over: Partial<{ probe: RegExp; ambiguous: boolean; assertsFact: boolean }> = {}) =>
  (async ({ utterance, receipts }: { utterance: string; receipts: Summary[] }) => {
    if (!(over.probe ?? /\b(earlier|told me|you said|sale thing)\b/i).test(utterance)) return { probe: false, receiptId: null, ambiguous: false, assertsFact: null };
    const thomas = receipts.find(r => /Thomas/.test(r.text));
    return { probe: true, receiptId: over.ambiguous ? null : thomas?.id ?? null, ambiguous: Boolean(over.ambiguous), assertsFact: over.assertsFact ?? true };
  }) as never;

describe("7. older claims referenced in other words", () => {
  const OLDER = [
    "Earlier you said you knew my latest sale. Was that actually from CleanCloud?",
    "That sale thing you told me earlier, was that really in the records?",
    "What was the source for what you said earlier about my newest order?",
  ];
  async function longCall(h = harness()) {
    await h.say("Who was my most recent sale?");
    for (const q of ["Should I chase The Louise?", "Should I call Priya first?", "Should I visit Ana today?", "Should I skip Friday?", "Should I email Dana?"]) {
      await h.say(q, { ...model("Worth a call."), classifyPriorClaim: semanticStub() });
    }
    return h;
  }
  it.each(OLDER)("resolves the Thomas receipt with no name, order number or amount: %s", async utterance => {
    const h = await longCall();
    expect(utterance).not.toMatch(/Thomas|584|70/);
    // Even a model that tries to concede cannot: the reply is discarded for the adjudication.
    const { result, trace } = await h.say(utterance, { classifyPriorClaim: semanticStub(), ...model("I made that up.") });
    expect(trace?.priorClaim).toMatchObject({ resolvedClaireTurn: 1, outcome: "verified", originalAnswerPath: "business_reader" });
    expect(result.speak).toMatch(/CleanCloud order 584/);
    expect(result.speak).not.toMatch(BAD);
  });

  it("fails closed as ambiguous when the classifier cannot pick one statement", async () => {
    const h = await longCall();
    const { result, trace } = await h.say(OLDER[0]!, { classifyPriorClaim: semanticStub({ ambiguous: true }), ...model("Sure, I made it up.") });
    expect(trace?.priorClaim?.outcome).toBe("ambiguous_referent");
    expect(result.speak).toMatch(/not sure which statement/);
  });

  it("resolves semantically even when nothing is adjacent (no receipt on the preceding turns)", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    h.state.claireTurnCount = (h.state.claireTurnCount ?? 0) + 5; // five intervening turns that left no receipt
    for (const utterance of OLDER) {
      const { result, trace } = await h.say(utterance, { classifyPriorClaim: semanticStub(), ...model("I made that up.") });
      expect(trace?.priorClaim).toMatchObject({ resolvedClaireTurn: 1, outcome: "verified" });
      expect(result.speak).not.toMatch(BAD);
      h.state.claireTurnCount = (h.state.claireTurnCount ?? 0) + 5;
    }
  });

  it("with the classifier unavailable it invents no association", async () => {
    const h = await longCall();
    const { result, trace } = await h.say(OLDER[1]!, { classifyPriorClaim: (async () => null) as never, ...model("Worth a call.") });
    expect(trace?.priorClaim).toBeNull();
    expect(result.speak).toBe("Worth a call.");
  });

  it("deterministic name/number resolution is still the cheap first path", async () => {
    const h = await longCall();
    const { trace } = await h.say("Wait, was Thomas really the latest sale?");
    expect(trace?.priorClaim).toMatchObject({ resolvedVia: "explicit_reference", outcome: "verified" });
  });
});

describe("8. judgment and opinion are not factual claims", () => {
  const judgment = (nature: boolean) => (async () => ({ probe: true, receiptId: null, ambiguous: false, assertsFact: nature })) as never;
  it.each([
    ["Should I follow up Tuesday or wait?", "I'd wait until Tuesday.", "Are you sure?"],
    ["What do you make of the pilot?", "I think the pilot is the cleaner offer.", "Really?"],
  ])("%s → '%s' → '%s' stays an ordinary judgment follow-up", async (q, advice, challenge) => {
    const h = harness();
    await h.say(q, { ...model(advice), classifyPriorClaim: (async () => false) as never });
    const { result, trace } = await h.say(challenge, { ...model("Yes. It buys them time."), classifyPriorClaim: judgment(false) });
    expect(trace?.path).not.toBe("prior_claim_verification");
    expect(result.speak).toBe("Yes. It buys them time.");
    expect(result.speak).not.toMatch(/enough to state that as fact/);
  });

  it("a model wobble about advice is not treated as rewriting a factual claim", async () => {
    const h = harness();
    await h.say("Should I follow up Tuesday or wait?", { ...model("I'd wait until Tuesday."), classifyPriorClaim: (async () => false) as never });
    const { result } = await h.say("Are you sure?", { ...model("Honestly I guessed at Tuesday."), classifyPriorClaim: judgment(false) });
    expect(result.speak).toBe("Honestly I guessed at Tuesday.");
  });

  it("an unsupported business assertion is still adjudicated as unsupported", async () => {
    const h = harness();
    await h.say("Should I keep pushing on this one?", { ...model("Dana approved it."), classifyPriorClaim: (async () => false) as never });
    const { result, trace } = await h.say("Are you sure?", { classifyPriorClaim: judgment(true) });
    expect(trace?.priorClaim?.outcome).toBe("unsupported");
    expect(result.speak).toBe("I didn't have enough to state that as fact.");
  });

  it("a mixed answer keeps provenance for the fact; the recommendation needs none", async () => {
    const h = harness();
    await h.say("Who was my latest sale, and what should I do about them?", { ...model("Thomas, $70.40. I'd follow up Tuesday."), classifyPriorClaim: (async () => false) as never });
    const { result, trace } = await h.say("Are you sure about Thomas?");
    expect(trace?.priorClaim?.outcome).toBe("synthesis_grounded");
    expect(result.speak).toMatch(/my own read, not a record/);
  });
});
