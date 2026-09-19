import { describe, expect, it } from "vitest";
import { enforceTitleContract, isProtectedTitleToken } from "./titleContract";
import { dayMention, briefingClock } from "./briefingTiming";
import { parseBriefingDeterministically } from "./deterministicBriefing";

describe("title contract is semantic, not a truncation game", () => {
  it("leaves a short faithful title alone", () => {
    expect(enforceTitleContract("Pick up OPUS towels")).toBe("Pick up OPUS towels");
  });

  it("keeps product/building identifiers even if the title exceeds eight words", () => {
    expect(isProtectedTitleToken("Zeely.ai")).toBe(true);
    expect(isProtectedTitleToken("Wilshire")).toBe(true);
    const title = enforceTitleContract("Make Zeely.ai Instagram static ad for Wilshire Grand");
    expect(title).toMatch(/Zeely/i);
    expect(title).toMatch(/Instagram/i);
  });

  it("never uses the title as a substitute for the raw quote", () => {
    const clock = briefingClock(new Date("2026-09-19T17:00:00Z"), "America/Los_Angeles");
    const parsed = parseBriefingDeterministically(
      "Russell gave me an assignment which is creating a static image advertisement for Instagram using Zeely.ai",
      clock
    );
    for (const item of parsed.items) {
      expect(item.quote.length).toBeGreaterThan(item.title.length);
    }
  });
});

describe("future-date semantics", () => {
  it("put this on Sunday lands on the next Sunday, not today", () => {
    const today = "2026-09-19"; // Saturday
    expect(dayMention("put this on Sunday", today)?.ymd).toBe("2026-09-20");
    expect(dayMention("tomorrow", today)?.ymd).toBe("2026-09-20");
    expect(dayMention("Saturday", today)?.ymd).toBe("2026-09-19");
  });
});
