import { describe, expect, it } from "vitest";
import {
  capSpokenReply,
  countQuestions,
  splitSpokenSentences,
} from "./spokenReplyCap";

// What Claire said on the 2026-10-27 evening call to "I'm overwhelmed, tell me what to do."
const OCT_27 =
  "Fine. One thing tonight: The Louise. The follow-up to Dana has been overdue since August 7. Send Dana a short email. " +
  "Tomorrow, pitch Wilshire Vermont in person. Want me to draft the email? Want me to put that on today's Day Line?";

describe("capSpokenReply", () => {
  it("splits spoken sentences and counts questions", () => {
    expect(splitSpokenSentences("One. Two? Three!")).toEqual([
      "One.",
      "Two?",
      "Three!",
    ]);
    expect(countQuestions(OCT_27)).toBe(2);
  });

  it("relief: two sentences, no question, order kept", () => {
    const capped = capSpokenReply(OCT_27, { maxSentences: 2, maxQuestions: 0 });
    expect(capped).toBe("Fine. One thing tonight: The Louise.");
    expect(countQuestions(capped)).toBe(0);
  });

  it("lead plan: every statement stays, questions drop to one", () => {
    const capped = capSpokenReply(OCT_27, {
      maxSentences: Number.MAX_SAFE_INTEGER,
      maxQuestions: 1,
    });
    expect(countQuestions(capped)).toBe(1);
    expect(capped).toMatch(/Want me to draft the email\?$/);
    expect(capped).toContain("Tomorrow, pitch Wilshire Vermont in person.");
  });

  it("the held approval ask survives over an earlier question, even at zero questions", () => {
    const ask = "Want me to put that on today's Day Line?";
    const one = capSpokenReply(OCT_27, {
      maxSentences: Number.MAX_SAFE_INTEGER,
      maxQuestions: 1,
      keepQuestion: ask,
    });
    expect(one).not.toContain("Want me to draft the email?");
    expect(one).toMatch(/Day Line\?$/);
    const relief = capSpokenReply(OCT_27, {
      maxSentences: 2,
      maxQuestions: 0,
      keepQuestion: ask,
    });
    expect(relief).toBe(`Fine. ${ask}`);
  });

  it("returns an empty string for empty input so the caller can fall back", () => {
    expect(capSpokenReply("   ", { maxSentences: 2, maxQuestions: 0 })).toBe(
      ""
    );
  });
});
