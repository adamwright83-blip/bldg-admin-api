import { describe, expect, it } from "vitest";
import { verifyOperatorAuthorization } from "./authorization";

const turns = [
  "What's the state of my business?",
  "I might swing by the Chadwick next week, we'll see.",
  "Can you add the marketing challenge to the day line tomorrow?",
  "Yeah. Of course. Put them on tomorrow's day line.",
];

describe("verifyOperatorAuthorization", () => {
  it("accepts words the operator actually said", () => {
    expect(verifyOperatorAuthorization({ quote: "add the marketing challenge to the day line tomorrow", operatorTurns: turns, lastClaireText: null })).toMatchObject({ ok: true });
    expect(verifyOperatorAuthorization({ quote: "Put them on tomorrow's day line.", operatorTurns: turns, lastClaireText: null })).toMatchObject({ ok: true });
  });

  it("refuses words the operator never said: approval cannot be fabricated", () => {
    const verdict = verifyOperatorAuthorization({ quote: "add the Chadwick visit for Tuesday", operatorTurns: turns, lastClaireText: null });
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/did not say/);
  });

  it("a mention is not a quote of authorization, but the server only checks the words; the test suite's scenarios check the judgment", () => {
    // "I might swing by the Chadwick next week" was said, so the words verify; whether it is an
    // instruction is the model's call and is graded by the mentioned-not-requested scenarios.
    expect(verifyOperatorAuthorization({ quote: "I might swing by the Chadwick next week", operatorTurns: turns, lastClaireText: null }).ok).toBe(true);
  });

  it("a bare yes needs a question right before it", () => {
    const withQuestion = verifyOperatorAuthorization({ quote: "Yes.", operatorTurns: ["Yes."], lastClaireText: "Want me to put the Opus pickup on today?" });
    expect(withQuestion.ok).toBe(true);
    const withoutQuestion = verifyOperatorAuthorization({ quote: "Yes.", operatorTurns: ["Yes."], lastClaireText: "You did 12 orders last week." });
    expect(withoutQuestion.ok).toBe(false);
    expect((withoutQuestion as { reason: string }).reason).toMatch(/answers nothing/);
    const never = verifyOperatorAuthorization({ quote: "yes", operatorTurns: ["No, leave it."], lastClaireText: "Want me to add it?" });
    expect(never.ok).toBe(false);
  });

  it("refuses an empty citation", () => {
    expect(verifyOperatorAuthorization({ quote: "", operatorTurns: turns, lastClaireText: null }).ok).toBe(false);
    expect(verifyOperatorAuthorization({ quote: undefined, operatorTurns: turns, lastClaireText: null }).ok).toBe(false);
  });
});
