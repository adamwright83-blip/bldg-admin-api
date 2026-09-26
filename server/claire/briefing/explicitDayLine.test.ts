import { describe, expect, it } from "vitest";
import { briefingClock } from "./briefingTiming";
import {
  assembleReferencedDayLineWork,
  refersToPriorWork,
} from "./explicitDayLine";

const clock = briefingClock(
  new Date("2026-09-26T19:00:00.000Z"),
  "America/Los_Angeles"
);

describe("explicit Day Line prior-work references", () => {
  it.each([
    "Add the stuff to the Day Line.",
    "Put all that stuff on my Day Line.",
    "Add those things to the Day Line.",
    "Put the things I mentioned on the Day Line.",
    "Add everything we just talked about to the Day Line.",
  ])("recognizes %j as a reference to prior operator work", utterance => {
    expect(refersToPriorWork(utterance)).toBe(true);
  });

  it("turns 'add the stuff' into the actual prior work instead of a fake 'stuff' task", () => {
    const items = assembleReferencedDayLineWork({
      utterance: "Add the stuff to the Day Line.",
      priorOperatorUtterances: [
        "I need to call the permit office.",
        "Then I need to send the revised estimate to Oak Ridge Estates.",
      ],
      clock,
      unfinished: () => false,
    });

    expect(items.map(item => item.title)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/call the permit office/i),
        expect.stringMatching(/send the revised estimate/i),
      ])
    );
    expect(items).toHaveLength(2);
    expect(items.map(item => item.title).join(" ")).not.toMatch(/\bstuff\b/i);
  });
});
