import { describe, expect, it } from "vitest";
import { resolveSpokenDate, spokenDay } from "./spokenDate";

// 2026-10-28 is a Wednesday.
const today = "2026-10-28";
const resolve = (spoken: string) => resolveSpokenDate(spoken, { today });

describe("resolveSpokenDate", () => {
  it.each([
    ["today", "2026-10-28"],
    ["tonight", "2026-10-28"],
    ["tomorrow", "2026-10-29"],
    ["tomorrow morning", "2026-10-29"],
    ["day after tomorrow", "2026-10-30"],
    ["the day after tomorrow", "2026-10-30"],
    ["Friday", "2026-10-30"],
    ["on friday", "2026-10-30"],
    ["this Friday", "2026-10-30"],
    ["next Thursday", "2026-11-05"],
    ["next Monday", "2026-11-02"],
    ["next Friday", "2026-11-06"],
    ["Wednesday", "2026-11-04"],
    ["this Wednesday", "2026-10-28"],
    ["in 3 days", "2026-10-31"],
    ["November 3", "2026-11-03"],
    ["nov 3rd", "2026-11-03"],
    ["the 3rd", "2026-11-03"],
    ["the 30th", "2026-10-30"],
    ["2026-12-01", "2026-12-01"],
  ])("%s → %s", (spoken, expected) => {
    expect(resolve(spoken)).toMatchObject({ kind: "resolved", businessDate: expected });
  });

  it.each(["sometime next week", "next week", "soon", "later", "at some point", "this week", "whenever", "end of the month"])(
    "refuses a vague day: %s",
    spoken => {
      expect(resolve(spoken).kind).toBe("ambiguous");
    }
  );

  it("refuses nonsense and impossible dates", () => {
    expect(resolve("").kind).toBe("invalid");
    expect(resolve("February 30").kind).toBe("invalid");
    expect(resolve("purple").kind).toBe("ambiguous");
  });
});

describe("spokenDay", () => {
  it("reads a date back the way the operator would say it", () => {
    expect(spokenDay("2026-10-28", today)).toBe("today");
    expect(spokenDay("2026-10-29", today)).toBe("tomorrow");
    expect(spokenDay("2026-10-30", today)).toBe("Friday");
    expect(spokenDay("2026-11-05", today)).toBe("Thursday 2026-11-05");
  });
});
