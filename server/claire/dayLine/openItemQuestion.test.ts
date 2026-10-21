import { describe, expect, it } from "vitest";
import { interpretOpenItemReply, isQuestion } from "./openItemLifecycle";

// W9, 2026-10-21: "What do you want me to do tomorrow?" was read as "snooze the carried item",
// which moved Call Dana and cancelled its older copies on a turn that only asked for the plan.
describe("a question is never the answer to the carried item's yes/no", () => {
  const today = "2026-10-21";
  it.each([
    "What do you want me to do tomorrow?",
    "what do you want me to do tomorrow",
    "Should I drop it",
    "Can you move it to tomorrow",
    "Do you want me to call her tomorrow?",
  ])("%s disposes of nothing", utterance => {
    expect(isQuestion(utterance)).toBe(true);
    expect(interpretOpenItemReply(utterance, today).kind).toBe("unclear");
  });

  it.each([
    ["Tomorrow.", "snooze"],
    ["Do it tomorrow", "snooze"],
    ["Not this week", "snooze"],
    ["Drop it", "drop"],
  ] as const)("%s is still an answer (%s)", (utterance, kind) => {
    expect(isQuestion(utterance)).toBe(false);
    expect(interpretOpenItemReply(utterance, today).kind).toBe(kind);
  });
});
