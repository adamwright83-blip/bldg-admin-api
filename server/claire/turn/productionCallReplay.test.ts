import { describe, expect, it } from "vitest";
import { detectOperatorWorkCommitment, interpretTurn, parseCardinality } from "./interpretTurn";

/**
 * Deterministic replay of the 2026-09-20 production call
 * (session ed854eb3-e40f-473b-8d57-c89016e2cbc6), turn by turn, using the operator's ACTUAL
 * speech including its ASR damage. Each case asserts the routing property that failed live.
 *
 * These are not paraphrases invented after the fact — they are what Adam really said.
 */

const T4 = "you were my last five sales and when were they"; // ASR dropped the leading "What"
const T6 = "I asked you for the last five sales, you just gave me Thomas. What were the other four?";
const T8 = "What were the last five orders?";
const T10 = "What sales happen before Thomas? Hartmann, don't tell me about Thomas, Hartmann. Tell me about the sales that happened before. Thomas.";
const T12 = "What should I do about? Dana Tuesday.";
const T16 = "I need to call. I need to call Dana on Tuesday on the phone.";
const T20 = "Um, actually don't do that.";
const T30 = "I'm good.";
const T32 = "I got to go.";

describe("2026-09-20 replay — cardinality (turns 4, 6, 8)", () => {
  it("turn 4: 'last five sales' is a list of five, not the singular latest sale", () => {
    const turn = interpretTurn(T4);
    expect(parseCardinality(T4)).toBe(5);
    expect(turn.listRequest).toBe(true);
    expect(turn.mayProposeWork).toBe(false);
  });

  it("turn 6: 'the other four' is a QUERY REFINEMENT, not a challenge to the claim's truth", () => {
    const turn = interpretTurn(T6);
    expect(turn.queryRefinement).toBe(true);
    expect(parseCardinality(T6)).toBe(4);
    // Live, this was swallowed by prior-claim: "That came from CleanCloud order 584, and it still
    // checks out." A refinement must never route to claim adjudication.
    expect(turn.acknowledgement).toBe(false);
  });

  it("turn 8: 'last five orders' is five orders", () => {
    expect(parseCardinality(T8)).toBe(5);
    expect(interpretTurn(T8).listRequest).toBe(true);
  });
});

describe("2026-09-20 replay — the Day Line failure (turn 10)", () => {
  it("REPRODUCTION: the exclusion turn can never authorize work", () => {
    const turn = interpretTurn(T10, { extractedWorkItems: 3 });
    // Live: "Got it. For today: Hartmann, don't tell me about Thomas, and Hartmann."
    expect(turn.mayProposeWork).toBe(false);
    expect(turn.operatorWorkCommitment).toBe(false);
    expect(turn.hasExplicitActionRequest).toBe(false);
  });

  it("it stays false no matter how many items a downstream parser extracts", () => {
    for (const extracted of [0, 1, 5, 50]) {
      expect(interpretTurn(T10, { extractedWorkItems: extracted }).mayProposeWork).toBe(false);
    }
  });

  it("the exclusion and the anchor are captured structurally", () => {
    const turn = interpretTurn("What sales happened before Thomas Hartmann? Don't tell me about Thomas.");
    expect(turn.anchorEntity).toMatch(/Thomas/);
    expect(turn.exclusions.join(" ")).toMatch(/Thomas/);
  });
});

describe("2026-09-20 replay — advice vs work (turns 12, 16)", () => {
  it("turn 12: 'What should I do about Dana Tuesday?' is advice, never a mutation", () => {
    const turn = interpretTurn(T12, { extractedWorkItems: 2 });
    expect(turn.mayProposeWork).toBe(false);
    expect(turn.hasBusinessQuestion).toBe(true);
  });

  it("turn 16: 'I need to call Dana on Tuesday' IS an operator work commitment", () => {
    const turn = interpretTurn(T16);
    expect(turn.operatorWorkCommitment).toBe(true);
    expect(turn.mayProposeWork).toBe(true);
  });

  it("the two turns are separated by a real property, not a phrase list", () => {
    // The only structural difference: one contains work the operator committed to, one does not.
    expect(detectOperatorWorkCommitment(T16)).toBe(true);
    expect(detectOperatorWorkCommitment(T12)).toBe(false);
    expect(detectOperatorWorkCommitment(T10)).toBe(false);
  });
});

describe("2026-09-20 replay — conversational acts (turns 20, 30, 32)", () => {
  it("turn 30: 'I'm good.' is an acknowledgement — not a verification failure", () => {
    const turn = interpretTurn(T30);
    // Live: "I can't verify that properly right now." Semantically absurd.
    expect(turn.acknowledgement).toBe(true);
    expect(turn.hasBusinessQuestion).toBe(false);
    expect(turn.queryRefinement).toBe(false);
    expect(turn.mayProposeWork).toBe(false);
    expect(turn.callControl).toBe("continue"); // and it must NOT hang up
  });

  it("turn 32: 'I got to go.' ends the call", () => {
    expect(interpretTurn(T32).callControl).toBe("end");
  });

  it("turn 20: 'actually don't do that' is a refusal, not a new proposal", () => {
    const turn = interpretTurn(T20, { extractedWorkItems: 1 });
    expect(turn.mayProposeWork).toBe(false);
  });

  it.each(["I'm good", "Got it.", "Okay", "Right", "Cool", "That answers it", "makes sense", "yep"])(
    "acknowledgement stays an acknowledgement: %s",
    utterance => {
      const turn = interpretTurn(utterance, { extractedWorkItems: 2 });
      expect(turn.acknowledgement).toBe(true);
      expect(turn.mayProposeWork).toBe(false);
      expect(turn.callControl).toBe("continue");
    }
  );
});

// ── Generative variants: the point is that natural rephrasings behave identically ────────────
describe("paraphrase robustness (not the exact transcript)", () => {
  it.each([
    "what were my last 5 sales",
    "give me the last five sales",
    "who were my last five customers",
    "show me the last three orders",
    "what are my two most recent sales",
  ])("list request keeps its cardinality: %s", utterance => {
    expect(parseCardinality(utterance)).toBeGreaterThan(1);
  });

  it.each([
    "What should I do about The Louise on Thursday?",
    "Would you chase Dana this week?",
    "Is it worth going back to OPUS?",
    "How should I handle the Greystar stall?",
  ])("advice never authorizes work: %s", utterance => {
    expect(interpretTurn(utterance, { extractedWorkItems: 3 }).mayProposeWork).toBe(false);
  });

  it.each([
    "I need to call Dana Tuesday",
    "I have to drop off the towels at OPUS tomorrow",
    "Deliver towels to OPUS LA",
    "Pick up from the dry cleaners at nine",
    "Tomorrow I'm hitting three buildings",
  ])("genuine work narration still proposes: %s", utterance => {
    expect(interpretTurn(utterance).mayProposeWork).toBe(true);
  });

  it.each([
    "You already know my sales",
    "That isn't a Day Line task",
    "I didn't ask you to add anything",
    "don't put that on the day line",
    "No, I meant I want to talk it through",
  ])("corrections and refusals never propose: %s", utterance => {
    expect(interpretTurn(utterance, { extractedWorkItems: 4 }).mayProposeWork).toBe(false);
  });
});

// ── The LIVE query path, not just the interpreter ────────────────────────────────────────────
import { vi } from "vitest";
import { answerClaireBusinessTurn } from "../businessConversation";
import type { BusinessQuery } from "../../analytics/businessQuery";

describe("cardinality reaches the actual business query", () => {
  const askCapturingQuery = async (utterance: string) => {
    const seen: BusinessQuery[] = [];
    await answerClaireBusinessTurn(
      { tenantId: "t1", utterance, state: {}, surface: "voice" },
      {
        now: () => new Date("2026-09-20T18:00:00Z"),
        timeZone: () => "America/Los_Angeles",
        plan: vi.fn(async () => null) as never,
        loadBindings: async () => ({
          laundry_butler: { state: "bound" as const, lastSuccessAt: new Date(), isSystemOfRecord: true },
          cleancloud: { state: "bound" as const, lastSuccessAt: new Date(), isSystemOfRecord: false },
        }),
        runQuery: (async (_t: string, query: BusinessQuery) => {
          seen.push(query);
          return { status: "unavailable", query, period: { label: "x", start: "2026-01-01", end: "2026-09-20" }, comparisonPeriod: null, reason: "test" };
        }) as never,
      }
    );
    return seen[0] ?? null;
  };

  it("REPRODUCTION: 'last five sales' asks the ledger for five, not one", async () => {
    const query = await askCapturingQuery("What were my last five sales and when were they?");
    expect(query?.metric).toBe("latest_sales");
    expect(query?.limit).toBe(5); // live it was 1 — the singular default
  });

  it("the ASR-damaged form from the real call also asks for five", async () => {
    expect((await askCapturingQuery(T4))?.limit).toBe(5);
  });

  it("'the last five orders' asks for five", async () => {
    expect((await askCapturingQuery(T8))?.limit).toBe(5);
  });

  it("a genuinely singular request still asks for one", async () => {
    expect((await askCapturingQuery("Who was my most recent sale?"))?.limit).toBe(1);
  });

  it("a plural request with no number asks for more than one", async () => {
    const query = await askCapturingQuery("What were my last sales?");
    expect(query?.limit ?? 0).toBeGreaterThan(1);
  });
});

// ── Route scope, pending state, and correctness challenges (turns 12-23, 28) ─────────────────
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "./claireTurn";

const T13_BOARD = "GUMBALL did not run today. Text Andrew is on the line. Mission 6. Synthetic verification follow-up.";

function stateful(over: Partial<ClaireTurnDeps> = {}) {
  const state: ClaireTurnState = {};
  const board = vi.fn(async () => ({ brief: T13_BOARD }));
  const deps = (extra: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps => ({
    now: () => new Date("2026-09-20T18:00:00Z"),
    timeZone: () => "America/Los_Angeles",
    business: { now: () => new Date("2026-09-20T18:00:00Z"), timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: vi.fn() as never },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Scoped answer.") as never,
    extractModel: null, loadExisting: async () => [], commit: vi.fn() as never, campaign: async () => null, vocabulary: async () => [],
    accounts: async () => [], accountHistory: vi.fn() as never, commitFollowUp: vi.fn() as never, dayWork: vi.fn() as never, unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never, memoryBetween: vi.fn(async () => []) as never, encyclopedia: null,
    watchBoard: board as never, doctrineTurn: undefined,
    classifyPriorClaim: (async () => false) as never, rerunBusinessQuery: vi.fn() as never, classifierBudgetMs: 30,
    ...over, ...extra,
  });
  const say = (utterance: string, extra: Partial<ClaireTurnDeps> = {}) =>
    runClaireTurn(
      { tenantId: "default", operatorUserId: "adam", dayDirectorActorId: "1", surface: "voice", utterance, state,
        conversationKey: "call:replay", allowFragmentWait: false, brief: "b",
        context: { businessDate: "2026-09-20", actorId: "adam", macroGoalKnown: false, blockers: [], relevantTimeline: [] } as never },
      deps(extra)
    );
  return { state, say, board };
}

describe("2026-09-20 replay — route scope (turn 12/13)", () => {
  it("REPRODUCTION: a scoped 'what should I do about X' never reaches the global board", async () => {
    const h = stateful();
    const result = await h.say("What should I do about? Dana Tuesday.");
    expect(h.board).not.toHaveBeenCalled();
    expect(result.speak).not.toMatch(/GUMBALL|Andrew|Mission 6|Synthetic/i);
  });

  it("a genuinely broad request still gets the board", async () => {
    const h = stateful();
    await h.say("Good morning.");
    expect(h.board).toHaveBeenCalled();
  });

  it.each([
    "What should I do about The Louise?",
    "What should I do about Thomas's order?",
    "What should I do with Dana this week?",
  ])("stays scoped: %s", async utterance => {
    const h = stateful();
    await h.say(utterance);
    expect(h.board).not.toHaveBeenCalled();
  });
});

describe("2026-09-20 replay — pending state (turns 15, 20, 21)", () => {
  it("REPRODUCTION: a refusal with nothing pending is settled, not reopened", async () => {
    const h = stateful();
    const result = await h.say("Um, actually don't do that.");
    // Live: "Do you want me to add something, change something, or are you just catching me up?"
    expect(result.speak).not.toMatch(/add something|catching me up|change something/i);
    expect(result.speak).toMatch(/won't add/i);
  });

  it("REPRODUCTION: Claire does not staple 'still holding' onto every later answer", async () => {
    const h = stateful();
    h.state.pendingProposal = { title: "Review revenue", sourceText: "x" } as never;
    const first = await h.say("What should I do about The Louise?");
    const second = await h.say("What should I do about Thomas?");
    const third = await h.say("What should I do about OPUS?");
    const mentions = [first, second, third].filter(r => /still holding/i.test(r.speak)).length;
    expect(mentions).toBeLessThanOrEqual(1); // once, not on every turn
  });
});

describe("2026-09-20 replay — entity vs time (turn 12/14)", () => {
  it("'Dana Tuesday' is an entity plus a weekday, never one literal name", () => {
    const turn = interpretTurn("What should I do about? Dana Tuesday.");
    expect(turn.entities).toContain("Dana");
    expect(turn.entities).not.toContain("Dana Tuesday");
    expect(turn.temporal).toContain("tuesday");
  });

  it.each([
    ["Rebecca Thursday", "Rebecca", "thursday"],
    ["Call Marcus Monday", "Marcus", "monday"],
    ["What about Priya tomorrow", "Priya", "tomorrow"],
  ])("generalises beyond Dana: %s", (utterance, entity, when) => {
    const turn = interpretTurn(utterance);
    expect(turn.entities).toContain(entity);
    expect(turn.temporal).toContain(when);
  });
});

describe("correctness challenge outranks refinement wording (review defect)", () => {
  it("REVIEW CASE: 'I asked you for revenue — are you sure those numbers are correct?'", () => {
    const turn = interpretTurn("I asked you for revenue — are you sure those numbers are correct?");
    expect(turn.correctnessChallenge).toBe(true);
    expect(turn.queryRefinement).toBe(false); // refinement must not swallow the challenge
  });

  it.each([
    "Are you sure?",
    "Are those numbers right?",
    "Check that again.",
    "Can you verify that?",
    "I asked you for the totals — are you certain?",
  ])("is a correctness challenge: %s", utterance => {
    expect(interpretTurn(utterance).correctnessChallenge).toBe(true);
  });

  it.each(["Where did that number come from?", "What are you basing that on?"])(
    "provenance question is NOT a correctness challenge: %s",
    utterance => {
      const turn = interpretTurn(utterance);
      expect(turn.provenanceQuestion).toBe(true);
      expect(turn.correctnessChallenge).toBe(false);
    }
  );

  it("a pure refinement is still a refinement", () => {
    const turn = interpretTurn("What were the other four?");
    expect(turn.queryRefinement).toBe(true);
    expect(turn.correctnessChallenge).toBe(false);
  });
});

describe("pending proposals are superseded, not just un-nagged", () => {
  const withPending = () => {
    const h = stateful();
    h.state.pendingProposal = { title: "Call Dana at The Louise", sourceText: "x" } as never;
    return h;
  };

  it.each([
    ["a refusal", "Actually don't do that."],
    ["a correction", "No, I meant I want to talk it through."],
    ["a query refinement", "What were the other four?"],
  ])("%s clears the pending proposal outright", async (_label, utterance) => {
    const h = withPending();
    await h.say(utterance);
    expect(h.state.pendingProposal).toBeFalsy();
  });

  it("nothing is left to remind about once superseded", async () => {
    const h = withPending();
    await h.say("Actually don't do that.");
    const next = await h.say("What should I do about The Louise?");
    expect(next.speak).not.toMatch(/still holding/i);
  });

  it("a still-valid proposal survives an ordinary question and is mentioned once", async () => {
    const h = withPending();
    const first = await h.say("What should I do about The Louise?");
    const second = await h.say("What should I do about OPUS?");
    expect(h.state.pendingProposal).toBeTruthy(); // not superseded by an ordinary question
    expect([first, second].filter(r => /still holding/i.test(r.speak)).length).toBeLessThanOrEqual(1);
  });
});
