import { describe, expect, it } from "vitest";
import { detectCallControl, interpretTurn, parseCardinality } from "./interpretTurn";

/**
 * Natural-language robustness corpus. These are intentionally paraphrases, not copies of the
 * production transcript, so exact-phrase patches cannot satisfy the suite.
 */
describe("Claire semantic variant corpus", () => {
  it.each([
    "Okay.", "Got it.", "Gotcha", "Understood.", "I'm good.", "We're good.",
    "Yeah.", "Right.", "Cool.", "That answers it.",
  ])("acknowledgement: %s", utterance => {
    const turn = interpretTurn(utterance);
    expect(turn.acknowledgement).toBe(true);
    expect(turn.mayProposeWork).toBe(false);
    expect(turn.callControl).toBe("continue");
  });

  it.each([
    "I gotta go.", "I need to go.", "I've got to run.", "Talk later.", "Catch you later.",
    "Bye.", "Goodbye.", "I'm done talking.", "End the call.", "That's all for now.",
  ])("call ending: %s", utterance => {
    expect(detectCallControl(utterance)).toBe("end");
    expect(interpretTurn(utterance).mayProposeWork).toBe(false);
  });

  it.each([
    ["my last 5 sales", 5],
    ["the latest five orders", 5],
    ["the first three sales", 3],
    ["my recent four orders", 4],
    ["the previous two sales", 2],
    ["top ten customers", 10],
    ["biggest six orders", 6],
    ["best seven customers", 7],
    ["another two orders", 2],
    ["the other four", 4],
  ] as const)("cardinality: %s", (utterance, expected) => {
    expect(parseCardinality(utterance)).toBe(expected);
  });

  it.each([
    "Don't add that.",
    "Do not track it.",
    "I didn't ask you to add anything.",
    "No need to schedule that.",
    "Nothing to log there.",
    "Not on the Day Line.",
    "Don't put anything on the Day Line.",
    "Actually don't do that.",
    "Do not save it.",
    "That isn't a Day Line task.",
  ])("refusal/correction cannot authorize work: %s", utterance => {
    expect(interpretTurn(utterance, { extractedWorkItems: 9 }).mayProposeWork).toBe(false);
  });

  it.each([
    "What should I do about Dana Tuesday?",
    "How should I handle The Louise?",
    "What would you do about this prospect?",
    "Would you call Dana?",
    "Would you text Dana?",
    "Would you email Dana?",
    "Would you visit The Louise?",
    "Would you go back to The Louise?",
    "Is it worth calling Dana?",
    "Is it worth visiting The Louise?",
  ])("business judgment never authorizes mutation: %s", utterance => {
    const turn = interpretTurn(utterance);
    expect(turn.businessJudgment).toBe(true);
    expect(turn.mayProposeWork).toBe(false);
  });

  it.each([
    "I need to call Dana Tuesday.",
    "I have to deliver the towels tomorrow.",
    "I'll text Dana after lunch.",
    "I plan to email The Louise.",
    "I'm going to visit The Louise.",
    "Tomorrow I need to pick up the dry cleaning.",
    "Buy detergent.",
    "Order hangers.",
    "Send the proposal.",
    "Check the printer.",
  ])("real operator work retains authority: %s", utterance => {
    expect(interpretTurn(utterance).mayProposeWork).toBe(true);
  });

  it.each([
    ["What should I do today?", true],
    ["What do I need to know today?", true],
    ["What's the most important thing?", true],
    ["Good morning Claire, what do I need to know today?", true],
    ["Hey Claire, what should I do today?", true],
    ["What should I do about Dana Tuesday?", false],
    ["What should I do with The Louise?", false],
    ["How should I handle Dana?", false],
    ["Good morning Claire, what should I do about Dana?", false],
    ["What would you do about The Louise?", false],
  ] as const)("broad-vs-scoped briefing: %s", (utterance, broad) => {
    expect(interpretTurn(utterance).broadOperationalBriefing).toBe(broad);
  });

  it.each([
    ["Are you sure?", true, false],
    ["Check that again.", true, false],
    ["Verify those numbers.", true, false],
    ["Is that number right?", true, false],
    ["Are these figures correct?", true, false],
    ["What were the other four?", false, true],
    ["Give me the other three.", false, true],
    ["What about the rest?", false, true],
    ["And the others?", false, true],
    ["I asked you for revenue — are you sure those numbers are correct?", true, false],
  ] as const)("correctness-vs-refinement: %s", (utterance, correctness, refinement) => {
    const turn = interpretTurn(utterance);
    expect(turn.correctnessChallenge).toBe(correctness);
    expect(turn.queryRefinement).toBe(refinement);
  });
});
