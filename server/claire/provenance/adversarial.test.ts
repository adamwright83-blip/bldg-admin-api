import { describe, expect, it, vi } from "vitest";
import type { BusinessQueryResult } from "../../analytics/businessQuery";
import { latest, harness, model, order, reading, THOMAS, type Summary } from "./testHarness";
import { appendClaimReceipt, MAX_CLAIM_RECEIPTS, receiptFromBusinessResult, receiptFromReader, speakPriorClaimVerification, verifyPriorClaim, UNVERIFIABLE_SPEECH, AMBIGUOUS_REFERENT_SPEECH, type FactualClaimReceipt } from "./claimReceipts";
import { normalizeReading, summarizeReceipts } from "./priorClaimChallenge";
import { suppressRestartedQuestion, recordClaireQuestionCoverage, recordOperatorReplyCoverage, type CoveredSubject } from "./callCoverage";

const CONCEDE = ["You're right. I shouldn't have said that.", "No, I wasn't certain.", "Fair point, I overstated it.", "I can't stand behind what I said.", "That wasn't based on anything solid.", "I made that up."];
const DEFEND = ["Yes, I'm certain of it.", "Absolutely, I'm sure Dana approved it.", "100 percent, that's confirmed."];

const mk = (over: Partial<FactualClaimReceipt> & Pick<FactualClaimReceipt, "id" | "claireTurnOrdinal" | "answerText">): FactualClaimReceipt => ({
  conversationKey: "k", claimedAtMs: 0, claimType: "x", grounding: "deterministic", answerPath: "business_reader", reader: null, metric: null, periodLabel: null,
  evidence: [], fingerprint: over.id, newestRecordAt: null, asOf: "", freshness: null, recheck: { kind: "none" }, ...over,
});

// ── C. classifier failure modes × target kinds ────────────────────────────────────────────────────────────
type Fail = { name: string; classify: never };
const FAILS: Fail[] = [
  { name: "timeout", classify: (() => new Promise(() => {})) as never },
  { name: "throws", classify: (async () => { throw new Error("boom"); }) as never },
  { name: "malformed object", classify: (async () => ({ probe: "yes", receiptId: 7 })) as never },
  { name: "malformed string", classify: (async () => "probes_prior_claim") as never },
  { name: "null", classify: (async () => null) as never },
];

describe("C. classifier failure never hands adjudication to a free-form model", () => {
  describe.each(FAILS)("classifier $name", ({ classify }) => {
    it.each(CONCEDE)("grounded adjacent claim: model concession is replaced — %s", async concession => {
      const h = harness();
      await h.say("Who was my most recent sale?");
      const { result } = await h.say("Why should I believe that was real?", { classifyPriorClaim: classify, ...model(concession) });
      expect(result.speak).not.toBe(concession);
      expect(result.speak).toMatch(/CleanCloud order 584|can't verify/);
      expect(result.speak).not.toMatch(/made (?:that|it) up|shouldn't have|wasn't certain|overstated|stand behind/i);
    });
    it.each(CONCEDE)("grounded OLD claim, no adjacent receipt: concession replaced — %s", async concession => {
      const h = harness();
      await h.say("Who was my most recent sale?");
      h.state.claireTurnCount = (h.state.claireTurnCount ?? 0) + 6;
      const { result } = await h.say("That sale thing you told me earlier, was that real?", { classifyPriorClaim: classify, ...model(concession) });
      expect(result.speak).toBe(UNVERIFIABLE_SPEECH);
    });
    it.each(DEFEND)("unsupported claim of UNKNOWN nature: confident defence is replaced, not adjudicated as fact — %s", async defence => {
      const h = harness();
      await h.say("Should I keep pushing on this one?", { ...model("Dana approved it.") });
      const { result } = await h.say("Are you sure?", { classifyPriorClaim: classify, ...model(defence) });
      expect(result.speak).toBe(UNVERIFIABLE_SPEECH);
    });
    it("known advice is NOT punished: an outage cannot make advice look like an unsupported fact", async () => {
      const h = harness();
      await h.say("Should I follow up Tuesday or wait?", { ...model("I'd wait until Tuesday.") });
      await h.say("Are you sure?", { classifyPriorClaim: reading({ assertsFact: false }), ...model("Yes, it buys time.") });
      for (const r of h.state.claimReceipts!) r.assertsFact = false; // both turns are known judgment
      const { result } = await h.say("Really, are you certain?", { classifyPriorClaim: classify, ...model("Yes. Tuesday gives them room.") });
      expect(result.speak).toBe("Yes. Tuesday gives them room.");
    });
  });

  it("wrong receipt id (does not exist) fails closed as ambiguous, on both paths", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    const adjacent = await h.say("Are you sure?", { classifyPriorClaim: reading({ receiptId: "claim_nope" }), ...model("I made that up.") });
    expect(adjacent.result.speak).toBe(AMBIGUOUS_REFERENT_SPEECH);
    h.state.claireTurnCount = (h.state.claireTurnCount ?? 0) + 6;
    const old = await h.say("That thing you told me earlier, really?", { classifyPriorClaim: reading({ receiptId: "claim_nope" }), ...model("I made that up.") });
    expect(old.result.speak).toBe(AMBIGUOUS_REFERENT_SPEECH);
  });

  it("classifier says ambiguous → ask which statement; says other → ordinary conversation", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    expect((await h.say("Are you sure?", { classifyPriorClaim: reading({ ambiguous: true }), ...model("x") })).result.speak).toBe(AMBIGUOUS_REFERENT_SPEECH);
    const other = await h.say("Now what should I do about The Louise?", { classifyPriorClaim: (async () => ({ probe: false, receiptId: null, ambiguous: false, assertsFact: null })) as never, ...model("Call them.") });
    expect(other.result.speak).toBe("Call them.");
  });

  it("a misclassification that names a DIFFERENT held receipt only ever adjudicates that receipt from evidence", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    await h.say("Should I keep pushing?", { ...model("Dana approved it.") });
    const wrong = h.state.claimReceipts!.find(r => r.grounding === "deterministic")!.id;
    const { result } = await h.say("Are you sure?", { classifyPriorClaim: reading({ receiptId: wrong }), ...model("I made that up.") });
    expect(result.speak).toMatch(/CleanCloud order 584/);
  });

  it("normalizeReading rejects every malformed shape", () => {
    for (const bad of ["yes", 7, { probe: "yes" }, { probe: true, receiptId: 5 }, [], undefined]) expect(normalizeReading(bad)).toBeNull();
    expect(normalizeReading({ probe: true, receiptId: "a", ambiguous: false, assertsFact: true })).toMatchObject({ probe: true, receiptId: "a" });
  });
});

// ── A + H. resolution across a long call and the receipt cap ──────────────────────────────────────────────
describe("A/H. every retained receipt is reachable", () => {
  function filled() {
    const h = harness();
    const ids: string[] = [];
    for (let i = 1; i <= MAX_CLAIM_RECEIPTS; i++) {
      const r = receiptFromBusinessResult({ conversationKey: "call:adv", claireTurnOrdinal: i, nowMs: 0, answerText: `Customer${i} paid $${i}0.00.`, reader: "query", result: latest([order(`k${i}`, `${900 + i}`, `Customer${i}`, i * 1000, "2026-09-17T09:00:00.000Z")]) });
      h.state.claimReceipts = appendClaimReceipt(h.state.claimReceipts, r);
      ids.push(r.id);
    }
    h.state.claireTurnCount = MAX_CLAIM_RECEIPTS + 10;
    return { h, ids };
  }
  it("the resolver is handed ALL retained receipts, and oldest / middle / newest are each reachable", async () => {
    const { h, ids } = filled();
    expect(h.state.claimReceipts).toHaveLength(MAX_CLAIM_RECEIPTS);
    let seen = 0;
    for (const target of [ids[0]!, ids[20]!, ids[MAX_CLAIM_RECEIPTS - 1]!]) {
      const classify = (async ({ receipts }: { receipts: Summary[] }) => { seen = receipts.length; return { probe: true, receiptId: target, ambiguous: false, assertsFact: true }; }) as never;
      const { trace } = await h.say("That thing you told me a while back, was it in the records?", { classifyPriorClaim: classify, ...model("x"), rerunBusinessQuery: async () => latest([order("zz", "1", "Someone", 1, "2026-09-17T09:00:00.000Z")]) });
      expect(seen).toBe(MAX_CLAIM_RECEIPTS);
      expect(trace?.priorClaim?.receiptId).toBe(target);
    }
  });
  it("two similar claims → ambiguity, never an arbitrary pick", async () => {
    const { h } = filled();
    const { result } = await h.say("What you said earlier about a customer paying?", { classifyPriorClaim: reading({ ambiguous: true }), ...model("x") });
    expect(result.speak).toBe(AMBIGUOUS_REFERENT_SPEECH);
  });
  it("beyond the cap the oldest UNGROUNDED receipt is shed first; grounded ones outlive them", () => {
    let receipts: FactualClaimReceipt[] = [mk({ id: "g0", claireTurnOrdinal: 1, answerText: "G" })];
    for (let i = 1; i <= MAX_CLAIM_RECEIPTS + 5; i++) receipts = appendClaimReceipt(receipts, mk({ id: `u${i}`, claireTurnOrdinal: i + 1, answerText: "U", grounding: "ungrounded" }));
    expect(receipts).toHaveLength(MAX_CLAIM_RECEIPTS);
    expect(receipts.some(r => r.id === "g0")).toBe(true);
  });
  it("summaries are compressed, not dropped", () => {
    const long = mk({ id: "a", claireTurnOrdinal: 1, answerText: "x ".repeat(200) });
    expect(summarizeReceipts([long, long])[0]!.text.length).toBeLessThanOrEqual(100);
    expect(summarizeReceipts([long, long])).toHaveLength(2);
  });
  it("exact name, amount, order number all resolve deterministically with no classifier hop for the referent", async () => {
    const h = harness();
    await h.say("Who was my most recent sale?");
    h.state.claireTurnCount = (h.state.claireTurnCount ?? 0) + 8;
    for (const u of ["Was Thomas right?", "Was that $70.40 real?", "Is order 584 really in CleanCloud?"]) {
      const { trace } = await h.say(u, { classifyPriorClaim: reading({}), ...model("x") });
      expect(trace?.priorClaim).toMatchObject({ resolvedVia: "explicit_reference", outcome: "verified" });
    }
  });
});

// ── D. synthesis provenance ───────────────────────────────────────────────────────────────────────────────
describe("D. synthesized prose never gets stronger provenance than the evidence warrants", () => {
  const backing = mk({ id: "b", claireTurnOrdinal: 1, answerText: "The newest sale I have is $70.40 for Thomas, paid today at 2:34 AM.", evidence: [{ source: "ledger_record", ref: "cleancloud:584" }] });
  const synth = (text: string): FactualClaimReceipt => mk({ id: "s", claireTurnOrdinal: 2, answerText: text, grounding: "synthesized", supportedBy: backing });
  const verify = (r: FactualClaimReceipt) => verifyPriorClaim(r, { rerun: vi.fn() as never });
  it.each([
    ["correct name, wrong number", "Thomas paid $71.00.", "unsupported"],
    ["correct number, wrong name", "Priya paid $70.40.", "unsupported"],
    ["wrong number that only matches a date/time in the evidence", "Thomas paid $17.", "unsupported"],
    ["false extra customer history", "Thomas paid $70.40 and has ordered 14 times.", "unsupported"],
    ["unrelated extra entity", "Thomas paid $70.40, the same as Rebecca last week.", "unsupported"],
  ])("%s → %s", async (_n, text, outcome) => {
    const v = await verify(synth(text));
    expect(v.outcome).toBe(outcome);
    expect(speakPriorClaimVerification(v)).not.toMatch(/checks out|still holds/);
  });
  it.each([
    ["correct fact + recommendation", "Thomas paid $70.40. I'd follow up Tuesday."],
    ["correct fact + speculation", "Thomas paid $70.40, probably because of the promo."],
    ["false predicate (not provable here)", "Thomas cancelled his $70.40 order."],
    ["unsupported causal claim with no new figure", "Thomas paid $70.40 because you called him."],
  ])("%s → credited ONLY for names/figures, never as a verified statement", async (_n, text) => {
    const v = await verify(synth(text));
    expect(v.outcome).toBe("synthesis_grounded");
    const said = speakPriorClaimVerification(v);
    expect(said).toMatch(/figures and names/);
    expect(said).toMatch(/my own read, not a record/);
    expect(said).not.toMatch(/checks out|still holds|verified|true/);
  });
  it("a synthesis with no authoritative backing is unsupported", async () => {
    expect((await verify({ ...synth("Thomas paid $70.40."), supportedBy: null })).outcome).toBe("unsupported");
  });
});

// ── E. temporal truth ─────────────────────────────────────────────────────────────────────────────────────
describe("E. 'grounded when spoken' is never 'still true now'", () => {
  const run = async (first: BusinessQueryResult, second: BusinessQueryResult | "throw" | "hang") => {
    const r = receiptFromBusinessResult({ conversationKey: "k", claireTurnOrdinal: 1, nowMs: 0, answerText: "x Thomas $70.40", reader: "query", result: first });
    return verifyPriorClaim(r, { budgetMs: 20, rerun: (async () => (second === "throw" ? (() => { throw new Error("down"); })() : second === "hang" ? new Promise(() => {}) : second)) as never });
  };
  const newer = latest([order("cc:590", "590", "Priya", 100, "2026-09-17T17:00:00.000Z")]);
  it("still current → verified (fresh reread only)", async () => expect((await run(latest([THOMAS]), latest([THOMAS]))).outcome).toBe("verified"));
  it("newer record arrived → superseded", async () => expect((await run(latest([THOMAS]), newer)).outcome).toBe("superseded"));
  it("source was incomplete then → stale_source", async () => expect((await run(latest([THOMAS], "partial", ["cleancloud"]), latest([order("cc:1", "1", "A", 1, "2026-09-16T00:00:00.000Z")]))).outcome).toBe("stale_source"));
  it("source changed without newer data → changed", async () => expect((await run(latest([THOMAS]), latest([order("cc:584", "584", "Thomas", 5000, "2026-09-17T09:34:00.000Z")]))).outcome).toBe("changed"));
  it("same records but the fresh read is from an INCOMPLETE source → cannot claim it still holds", async () => {
    const v = await run(latest([THOMAS]), latest([THOMAS], "partial", ["cleancloud"]));
    expect(v).toMatchObject({ outcome: "grounded_as_stated", freshnessAffected: true });
    expect(speakPriorClaimVerification(v)).not.toMatch(/checks out/);
  });
  it("source unavailable / throws / hangs → unverifiable, never a confession", async () => {
    const unavailable = { status: "unavailable", query: latest([]).query, period: latest([]).period, comparisonPeriod: null, reason: "x" } as BusinessQueryResult;
    for (const second of [unavailable, "throw", "hang"] as const) {
      const v = await run(latest([THOMAS]), second);
      expect(v.outcome).toBe("unverifiable");
      expect(speakPriorClaimVerification(v)).toBe(UNVERIFIABLE_SPEECH);
    }
  });
  it("non-rerunnable original source → provenance only", async () => {
    const v = await verifyPriorClaim(mk({ id: "n", claireTurnOrdinal: 1, answerText: "Two stops.", answerPath: "day_work" }), { rerun: vi.fn() as never });
    expect(v.outcome).toBe("grounded_as_stated");
    expect(speakPriorClaimVerification(v)).not.toMatch(/checks out/);
  });
  it("no outcome, for any input, ever alleges lying/fabrication", async () => {
    for (const outcome of ["verified", "superseded", "stale_source", "changed", "unsupported", "unverifiable", "grounded_as_stated", "synthesis_grounded"] as const) {
      const said = speakPriorClaimVerification({ receipt: mk({ id: "z", claireTurnOrdinal: 1, answerText: "x" }), outcome, resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: false, latencyMs: 0 });
      expect(said).not.toMatch(/\blie|lied|deceiv|fabricat|made (?:that )?up|invent/i);
    }
  });
});

// ── B/I. claim nature + false-confidence transformations ──────────────────────────────────────────────────
describe("B/I. fact vs judgment", () => {
  it.each(["Dana approved it.", "Thomas paid.", "The building rejected us."])("'%s' is an unsupported fact, adjudicated as such (never defended)", async claim => {
    const h = harness();
    await h.say("Should I keep pushing on this one?", { ...model(claim) });
    const { result } = await h.say("Are you sure?", { classifyPriorClaim: reading({ assertsFact: true }), ...model("Yes, certain.") });
    expect(result.speak).toBe("I didn't have enough to state that as fact.");
  });
  it.each(["I'd wait until Tuesday.", "I think the pilot is cleaner.", "I'd call Dana first."])("'%s' is judgment: not a factual-claim failure", async advice => {
    const h = harness();
    await h.say("What would you do?", { ...model(advice) });
    const { result, trace } = await h.say("Are you sure?", { classifyPriorClaim: reading({ assertsFact: false }), ...model("Reasonably.") });
    expect(trace?.path).not.toBe("prior_claim_verification");
    expect(result.speak).toBe("Reasonably.");
  });
  it("mixed answer: fact keeps provenance, recommendation needs none", async () => {
    const h = harness();
    await h.say("Who was my latest sale, and what should I do about them?", { ...model("Thomas, $70.40. I'd call him Tuesday.") });
    const { trace } = await h.say("Are you sure about Thomas?", { classifyPriorClaim: reading({}) });
    expect(trace?.priorClaim?.outcome).toBe("synthesis_grounded");
  });
  it("conversation history is not business truth: a call-memory quote is not a verified fact", async () => {
    const r = receiptFromReader({ conversationKey: "k", claireTurnOrdinal: 1, nowMs: 0, answerText: "On a call you said X.", answerPath: "memory_quote", claimType: "memory", grounding: "deterministic", sources: ["call_memory"] });
    const v = await verifyPriorClaim(r, { rerun: vi.fn() as never });
    expect(v.outcome).toBe("grounded_as_stated");
  });
});

// ── G. same-call continuity ───────────────────────────────────────────────────────────────────────────────
describe("G. covered subjects survive long calls", () => {
  const accounts = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: i === 0 ? "The Louise" : `Property${String.fromCharCode(65 + (i % 26))}${i}`, accountType: "c" }));
  const louise = accounts[0]!;
  function covered(): CoveredSubject[] {
    let c = recordClaireQuestionCoverage([], { claireText: "How did it go with Dana at The Louise?", accounts, turnOrdinal: 1 });
    c = recordOperatorReplyCoverage(c, { operatorText: "Dana said she wants a proposal next week.", accounts, turnOrdinal: 2 });
    return c;
  }
  it("holds after 30 other accounts are covered (no eviction of Louise)", () => {
    let c = covered();
    accounts.slice(1).forEach((a, i) => {
      c = recordClaireQuestionCoverage(c, { claireText: `Any news at ${a.name}?`, accounts, turnOrdinal: 3 + i * 2 });
      c = recordOperatorReplyCoverage(c, { operatorText: "Nothing much to report there.", accounts, turnOrdinal: 4 + i * 2 });
    });
    expect(c.some(e => e.subject === `account:${louise.id}`)).toBe(true);
    expect(suppressRestartedQuestion("Got it. How is Dana doing at The Louise?", { coverage: c, operatorText: "Fine, moving on.", accounts })).not.toBeNull();
  });
  it.each([
    ["differently worded status restart", "Any update on Dana at The Louise?", true],
    ["another wording, same subject", "So where do things stand with Dana over at The Louise?", true],
    ["operator reopens", "Any update on Dana at The Louise?", false, "Actually back to The Louise for a second."],
    ["genuinely narrower follow-up", "Did Dana give you a date for the budget approval?", false],
    ["unrelated subject", "How is Property B1 looking?", false],
  ])("%s", (_n, question, suppressed, operator = "Yeah, all fine here.") => {
    const out = suppressRestartedQuestion(`Noted. ${question}`, { coverage: covered(), operatorText: operator, accounts });
    expect(out !== null).toBe(suppressed);
  });
});
