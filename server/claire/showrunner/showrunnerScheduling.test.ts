import { describe, expect, it } from "vitest";
import { dateFromOperatorWords, scheduleSlots } from "./showrunnerDebrief";

describe("operator-stated dates", () => {
  it("resolves weekday names against the call's business date", () => {
    // Tue Oct 20 2026: "Thursday" is Oct 22, not Friday.
    expect(dateFromOperatorWords("She moved our meeting to Thursday at 10.", "2026-10-20")).toBe("2026-10-22");
    expect(dateFromOperatorWords("meet Wednesday at 10am", "2026-10-19")).toBe("2026-10-21");
    expect(dateFromOperatorWords("can we do it tomorrow", "2026-10-20")).toBe("2026-10-21");
    expect(dateFromOperatorWords("next time works", "2026-10-20")).toBeNull();
  });
});

describe("slot scheduling", () => {
  it("keeps fixed meetings, places flexible work in the preferred window, never double-books", () => {
    const out = scheduleSlots({
      dates: ["2026-10-21", "2026-10-22", "2026-10-23"],
      fixed: [{ key: "maria", date: "2026-10-22", window: "morning" }],
      flexible: [{ key: "winback", earliest: "2026-10-22" }],
      preferred: "morning",
      avoid: ["afternoon"],
    });
    expect(out.get("maria")).toEqual({ date: "2026-10-22", window: "morning" });
    expect(out.get("winback")).toEqual({ date: "2026-10-23", window: "morning" });
  });
});
