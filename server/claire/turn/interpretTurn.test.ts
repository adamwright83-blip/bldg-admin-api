import { describe, expect, it } from "vitest";
import { detectCallControl, interpretTurn } from "./interpretTurn";
import { harness, model } from "../provenance/testHarness";
import { isClaireCallComplete, isExplicitClaireCallEnd, shouldEndClaireCallOnUtterance } from "../preDriveConversation";

/**
 * The InterpretedTurn seam: one authoritative reading of the utterance before any mutation-capable
 * route acts. Reproductions are drawn from the 2026-09-20 production transcript.
 */

// ── A. Day Line arbitration ──────────────────────────────────────────────────────────────────
const NEVER_WORK = [
  // The exact class from the transcript: Adam arguing that Claire already has his sales data.
  "Well, of course you do because, you know, my sales data, if I asked you how many sales I got the last 30 days, you would be able to give me a number.",
  "You already know my sales.",
  "That isn't a Day Line task.",
  "Planning the week with you isn't something I want added.",
  "I said Dana hasn't replied; I didn't ask you to add anything.",
  "No, I meant I want to talk through it with you.",
];

describe("A. a parser finding task-like words is not action intent", () => {
  it.each(NEVER_WORK)("never proposes work: %s", utterance => {
    // Even when the briefing parser DID extract items, the interpretation refuses the proposal.
    expect(interpretTurn(utterance, { extractedWorkItems: 2 }).mayProposeWork).toBe(false);
  });

  it.each(NEVER_WORK)("through the live turn, no Day Line proposal is offered: %s", async utterance => {
    const h = harness();
    const { result } = await h.say(utterance, model("Noted."));
    expect(result.kind).not.toBe("briefing_proposed");
    expect(result.speak).not.toMatch(/on the Day Line\?|put (?:both|all of that|that) on/i);
  });

  it("a genuine directive may activate the action path", () => {
    for (const utterance of [
      "Add a follow-up with Dana Tuesday.",
      "Put the building visit on tomorrow's Day Line.",
      "Remind me to return there Thursday.",
    ]) {
      const turn = interpretTurn(utterance, { extractedWorkItems: 1 });
      expect(turn.hasExplicitActionRequest).toBe(true);
      expect(turn.mayProposeWork).toBe(true);
    }
  });

  it("narrating your own day still reaches the ordinary briefing flow", () => {
    // The briefing product depends on this: it is not an imperative, but it IS the operator's work.
    expect(interpretTurn("Tomorrow I'm hitting three buildings and doing a pickup at two.", { extractedWorkItems: 2 }).mayProposeWork).toBe(true);
  });

  it("MIXED: business question + explicit action are represented independently", () => {
    const turn = interpretTurn("Did Dana reply, and add a follow-up Tuesday.", { extractedWorkItems: 1 });
    expect(turn.hasBusinessQuestion).toBe(true);
    expect(turn.hasExplicitActionRequest).toBe(true);
    expect(turn.mayProposeWork).toBe(true);
  });

  it("MIXED: business question + refusal answers the question and proposes nothing", async () => {
    const utterance = "What were sales? Don't put anything on the Day Line.";
    const turn = interpretTurn(utterance, { extractedWorkItems: 1 });
    expect(turn.hasBusinessQuestion).toBe(true);
    expect(turn.actionRefused).toBe(true);
    expect(turn.mayProposeWork).toBe(false);
    const h = harness();
    const { result } = await h.say(utterance, model("Noted."));
    expect(result.kind).not.toBe("briefing_proposed");
  });

  it("ambiguity fails toward no mutation", () => {
    // Nothing positively identifies work: no directive, no extracted items.
    expect(interpretTurn("Hmm. The Louise, maybe.", { extractedWorkItems: 0 }).mayProposeWork).toBe(false);
  });
});

// ── B. Call control ──────────────────────────────────────────────────────────────────────────
const ENDS = [
  "I gotta go.",
  "I've got to run.",
  "I need to go.",
  "Talk later.",
  "Catch you later.",
  "Bye.",
  "That's it for now.",
  "We're done.",
  "I'll talk to you tomorrow.",
];
const CONTINUES = ["got it", "I'm good", "that's enough detail", "Okay.", "yeah", "Understood."];

describe("B. call ending is a first-class intent", () => {
  it.each(ENDS)("ends the call: %s", utterance => {
    expect(detectCallControl(utterance)).toBe("end");
    // The webhook boundary, which is where production actually hangs up, must agree.
    expect(isExplicitClaireCallEnd(utterance)).toBe(true);
    expect(shouldEndClaireCallOnUtterance(utterance, { holding: false })).toBe(true);
  });

  it.each(CONTINUES)("does not hang up on an acknowledgement: %s", utterance => {
    expect(detectCallControl(utterance)).toBe("continue");
    expect(shouldEndClaireCallOnUtterance(utterance, { holding: true })).toBe(false);
    expect(shouldEndClaireCallOnUtterance(utterance, { holding: false })).toBe(false);
  });

  it("REPRODUCTION: 'I gotta go' no longer falls through to the opener", async () => {
    // Transcript turn 15: Claire replayed "Tomorrow's a blank slate — what's the plan…".
    expect(shouldEndClaireCallOnUtterance("I gotta go.", { holding: false })).toBe(true);
    const h = harness();
    const { result } = await h.say("I gotta go.", model("Tomorrow's a blank slate — what's the plan, buildings or something else?"));
    expect(result.kind).not.toBe("briefing_proposed");
  });

  it("MIXED: a status update ending in departure still terminates", () => {
    expect(detectCallControl("Dana still hasn't replied, but I gotta go.")).toBe("end");
    expect(isExplicitClaireCallEnd("Dana still hasn't replied, but I gotta go.")).toBe(true);
  });

  it("a judgment question containing 'I go' is NOT a departure (false-hangup guard)", () => {
    for (const utterance of [
      "Should I go back to The Louise?",
      "Do you think I go there first or call ahead?",
      "When I go tomorrow, should I bring the samples?",
    ]) {
      expect(detectCallControl(utterance)).toBe("continue");
    }
  });

  it("a departure quoted inside a story is not the operator leaving", () => {
    expect(detectCallControl("I told Dana goodbye and then drove to the next stop.")).toBe("continue");
  });

  it("the prior false-hangup protections still hold", () => {
    // These were real bugs before; they must not regress.
    expect(isClaireCallComplete("Have a good day.")).toBe(true);
    expect(shouldEndClaireCallOnUtterance("I'm good", { holding: true })).toBe(false);
  });

  it("a departure never creates Day Line work", () => {
    expect(interpretTurn("I gotta go.", { extractedWorkItems: 1 }).mayProposeWork).toBe(false);
  });
});

describe("greeting remainder, not prefix, decides board breadth", () => {
  it("a greeting alone may be a broad check-in", () => {
    expect(interpretTurn("Good morning.").broadBriefingRequest).toBe(true);
    expect(interpretTurn("Good morning — what should I know today?").broadBriefingRequest).toBe(true);
  });

  it("a greeting plus work is not broad", () => {
    const turn = interpretTurn("Good morning, I need to call the dry cleaner and deliver towels today.");
    expect(turn.broadBriefingRequest).toBe(false);
    expect(turn.operatorWorkCommitment).toBe(true);
  });
});
