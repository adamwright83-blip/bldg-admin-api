import { describe, expect, it } from "vitest";
import {
  answerDecision,
  canStart,
  chapterAvailability,
  conditionHolds,
  daysAway,
  daysBetween,
  EMPTY_PROGRESS,
  localDateOf,
  progressAfter,
  resolveSlot,
  type StoryLineRow,
} from "./storyEngine";

const line = (over: Partial<StoryLineRow>): StoryLineRow => ({
  slot: "before",
  lineKey: "b1",
  variantKey: "default",
  sortOrder: 0,
  condition: null,
  text: "x",
  stillId: null,
  ...over,
});

describe("story engine: calendar", () => {
  it("dates an instant in the business time zone, not UTC", () => {
    // 2026-10-28 05:30 UTC is still the evening of the 27th in Los Angeles
    expect(localDateOf(new Date("2026-10-28T05:30:00Z"), "America/Los_Angeles")).toBe("2026-10-27");
    expect(localDateOf(new Date("2026-10-28T05:30:00Z"), "UTC")).toBe("2026-10-28");
  });

  it("counts calendar days across month and DST boundaries", () => {
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-11-01", "2026-11-01")).toBe(0);
    expect(daysBetween("2026-11-02", "2026-11-01")).toBe(-1);
    expect(daysBetween("not-a-date", "2026-11-01")).toBe(0);
  });
});

describe("story engine: one chapter per night", () => {
  it("opens chapter 1 on the first night", () => {
    expect(chapterAvailability(EMPTY_PROGRESS, 3, "2026-10-27")).toEqual({ state: "available", chapterNumber: 1 });
  });

  it("locks the next chapter until the next local date after a win", () => {
    const p = { highestChapterWon: 1, lastWonOn: "2026-10-27", lastPlayedOn: "2026-10-27", chapterDaysAway: 0 };
    expect(chapterAvailability(p, 3, "2026-10-27")).toEqual({ state: "won_tonight", chapterNumber: 1 });
    expect(chapterAvailability(p, 3, "2026-10-28")).toEqual({ state: "available", chapterNumber: 2 });
    expect(chapterAvailability(p, 3, "2026-11-05")).toEqual({ state: "available", chapterNumber: 2 });
  });

  it("never opens more than one chapter after a long absence", () => {
    const p = { highestChapterWon: 2, lastWonOn: "2026-10-01", lastPlayedOn: "2026-10-01", chapterDaysAway: 0 };
    expect(chapterAvailability(p, 8, "2026-10-27")).toEqual({ state: "available", chapterNumber: 3 });
  });

  it("treats a clock that went backwards as won tonight, not as a new chapter", () => {
    const p = { highestChapterWon: 1, lastWonOn: "2026-10-28", lastPlayedOn: "2026-10-28", chapterDaysAway: 0 };
    expect(chapterAvailability(p, 3, "2026-10-27").state).toBe("won_tonight");
  });

  it("finishes the season the night after the last win", () => {
    const p = { highestChapterWon: 3, lastWonOn: "2026-10-27", lastPlayedOn: "2026-10-27", chapterDaysAway: 0 };
    expect(chapterAvailability(p, 3, "2026-10-27")).toEqual({ state: "won_tonight", chapterNumber: 3 });
    expect(chapterAvailability(p, 3, "2026-10-28")).toEqual({ state: "season_complete", chapterNumber: null });
  });

  it("refuses to start anything but the open chapter", () => {
    expect(canStart(EMPTY_PROGRESS, 3, "2026-10-27", 1)).toBe(true);
    expect(canStart(EMPTY_PROGRESS, 3, "2026-10-27", 2)).toBe(false);
    expect(canStart(EMPTY_PROGRESS, 3, "2026-10-27", 0)).toBe(false);
    const wonTonight = { highestChapterWon: 1, lastWonOn: "2026-10-27", lastPlayedOn: "2026-10-27", chapterDaysAway: 0 };
    expect(canStart(wonTonight, 3, "2026-10-27", 1)).toBe(false);
    expect(canStart(wonTonight, 3, "2026-10-27", 2)).toBe(false);
  });
});

describe("story engine: outcomes", () => {
  it("only a win on the open chapter advances", () => {
    expect(progressAfter(EMPTY_PROGRESS, 3, "2026-10-27", 1, "lose")).toEqual({ progress: EMPTY_PROGRESS, advanced: false });
    expect(progressAfter(EMPTY_PROGRESS, 3, "2026-10-27", 1, "quit").advanced).toBe(false);
    expect(progressAfter(EMPTY_PROGRESS, 3, "2026-10-27", 2, "win").advanced).toBe(false);
    const won = progressAfter(EMPTY_PROGRESS, 3, "2026-10-27", 1, "win");
    expect(won).toEqual({ progress: { highestChapterWon: 1, lastWonOn: "2026-10-27", lastPlayedOn: null, chapterDaysAway: 0 }, advanced: true });
  });

  it("a repeated win the same night is a no-op", () => {
    const once = progressAfter(EMPTY_PROGRESS, 3, "2026-10-27", 1, "win").progress;
    expect(progressAfter(once, 3, "2026-10-27", 1, "win")).toEqual({ progress: once, advanced: false });
  });

  it("days away counts nights since the last start", () => {
    expect(daysAway(EMPTY_PROGRESS, "2026-10-27")).toBe(0);
    expect(daysAway({ ...EMPTY_PROGRESS, lastPlayedOn: "2026-10-24", chapterDaysAway: 0 }, "2026-10-27")).toBe(3);
    expect(daysAway({ ...EMPTY_PROGRESS, lastPlayedOn: "2026-10-28", chapterDaysAway: 0 }, "2026-10-27")).toBe(0);
  });
});

describe("story engine: absence", () => {
  it("keeps the absence measured when tonight's chapter was opened", () => {
    expect(daysAway({ ...EMPTY_PROGRESS, lastPlayedOn: "2026-10-27", chapterDaysAway: 8 }, "2026-10-27")).toBe(8);
    expect(daysAway({ ...EMPTY_PROGRESS, lastPlayedOn: "2026-10-27", chapterDaysAway: 8 }, "2026-10-28")).toBe(1);
  });
});

describe("story engine: variants", () => {
  const rows = [
    line({ lineKey: "b1", text: "any" }),
    line({ lineKey: "b1", variantKey: "left", condition: { answers: { q1: "left" } }, text: "left" }),
    line({ lineKey: "b1", variantKey: "left-away", condition: { answers: { q1: "left" }, minDaysAway: 2 }, text: "left and away" }),
    line({ lineKey: "b0", variantKey: "away", condition: { minDaysAway: 2 }, text: "away only", sortOrder: -1 }),
    line({ slot: "after", lineKey: "a1", text: "after" }),
  ];

  it("picks the most specific variant that holds, per key", () => {
    expect(resolveSlot(rows, "before", { answers: {}, daysAway: 0 }).map(l => l.text)).toEqual(["any"]);
    expect(resolveSlot(rows, "before", { answers: { q1: "left" }, daysAway: 0 }).map(l => l.text)).toEqual(["left"]);
    expect(resolveSlot(rows, "before", { answers: { q1: "left" }, daysAway: 3 }).map(l => l.text)).toEqual(["away only", "left and away"]);
    expect(resolveSlot(rows, "before", { answers: { q1: "right" }, daysAway: 0 }).map(l => l.text)).toEqual(["any"]);
  });

  it("never returns another slot's lines or losing variants", () => {
    const out = resolveSlot(rows, "before", { answers: { q1: "left" }, daysAway: 0 });
    expect(out.some(l => l.text === "after" || l.text === "any")).toBe(false);
  });

  it("drops a key whose every variant is conditional and unmet", () => {
    expect(resolveSlot([line({ condition: { minDaysAway: 5 } })], "before", { answers: {}, daysAway: 1 })).toEqual([]);
  });

  it("checks every condition", () => {
    expect(conditionHolds(null, { answers: {}, daysAway: 0 })).toBe(true);
    expect(conditionHolds({ answers: { a: "x", b: "y" } }, { answers: { a: "x" }, daysAway: 0 })).toBe(false);
    expect(conditionHolds({ answers: { a: "x", b: "y" } }, { answers: { a: "x", b: "y" }, daysAway: 0 })).toBe(true);
  });
});

describe("story engine: answers are final", () => {
  it("accepts a new answer, accepts the same answer again, refuses a change or an unknown option", () => {
    expect(answerDecision(["left", "right"], null, "left")).toEqual({ ok: true, write: true });
    expect(answerDecision(["left", "right"], "left", "left")).toEqual({ ok: true, write: false });
    expect(answerDecision(["left", "right"], "left", "right")).toEqual({ ok: false, reason: "already_answered" });
    expect(answerDecision(["left", "right"], null, "up")).toEqual({ ok: false, reason: "unknown_option" });
  });
});
