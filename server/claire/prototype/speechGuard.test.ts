import { describe, expect, it } from "vitest";
import { checkSpeech, heldTopicsFrom, restateInstruction, withoutOffendingSentences } from "./speechGuard";

const rules = [
  { kind: "call_rule" as const, status: "active" as const, text: "Operator rule for calls, in the operator's words: Don't bring up the magazine interview on calls. It makes me nervous and I'll deal with it on the day.", quote: "Don't bring up the magazine interview on calls. It makes me nervous and I'll deal with it on the day." },
  { kind: "call_rule" as const, status: "active" as const, text: "Operator rule for calls: Stop reminding me about the state licensing visit unless I ask.", quote: "Stop reminding me about the state licensing visit unless I ask." },
  { kind: "call_rule" as const, status: "active" as const, text: "Keep answers short.", quote: "Keep your answers shorter from now on." },
];

describe("heldTopicsFrom", () => {
  it("extracts the topic words from hold rules and ignores other rules", () => {
    const topics = heldTopicsFrom(rules);
    expect(topics.map(topic => topic.words)).toEqual([["magazine", "interview"], ["state", "licensing", "visit"]]);
  });
});

describe("checkSpeech", () => {
  const heldTopics = heldTopicsFrom(rules);
  it("flags naming a held topic and announcing a withholding (runs 11 and 20)", () => {
    const problems = checkSpeech("Saturday's Day Line has an interview on it, and I'm leaving it out because of your standing rule about the magazine interview. Sunday is clear.", { heldTopics, operatorTurns: ["And the rest of the week after that?"] });
    expect(problems.map(problem => problem.kind)).toEqual(["names_held_topic", "announces_withholding"]);
    expect(checkSpeech("I won't mention the licensing item, per your standing rule, and I'll just report the rest.", { heldTopics, operatorTurns: ["Anything this week I should be bracing for?"] }).length).toBeGreaterThan(0);
  });

  it("is quiet when the operator raised the topic first, and on ordinary speech", () => {
    expect(checkSpeech("The magazine interview is Saturday at two.", { heldTopics, operatorTurns: ["What's the deal with the magazine interview?"] })).toEqual([]);
    expect(checkSpeech("Tomorrow you have the pack walk and the husky meet-and-greet. Sunday is clear.", { heldTopics, operatorTurns: ["What's on tomorrow?"] })).toEqual([]);
  });

  it("produces a restate note and a last-resort cut", () => {
    const speech = "Saturday has one thing I'm leaving out per your rule. Sunday is clear.";
    const problems = checkSpeech(speech, { heldTopics, operatorTurns: [] });
    expect(restateInstruction(problems)).toMatch(/Say your reply again/);
    expect(withoutOffendingSentences(speech, problems)).toBe("Sunday is clear.");
  });
});
