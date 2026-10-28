import { describe, expect, it } from "vitest";
import {
  deferralToTomorrow,
  recentDayLineCommits,
  rememberDayLineCommit,
  RECENT_COMMIT_WINDOW_MS,
} from "./dayLineDeferral";

describe("deferral to tomorrow (2026-10-27 evening call)", () => {
  it.each([
    "I'll do it tomorrow.",
    "Yeah, I'll do that tomorrow morning.",
    "Tomorrow.",
    "Not tonight.",
    "Let's handle it in the morning.",
    "Push it to tomorrow.",
    "I'm gonna send the Dana email tomorrow.",
    "Tomorrow then.",
  ])("reads: %s", text => {
    expect(deferralToTomorrow(text)).toBe(true);
  });

  it.each([
    "I'll do it tonight.",
    "I'll send it right now.",
    "What do you have for me tomorrow?",
    "Tomorrow I'm hitting three buildings.",
    "Okay.",
  ])("does not read a deferral into: %s", text => {
    expect(deferralToTomorrow(text)).toBe(false);
  });

  it("remembers only what landed on today within the window", () => {
    const now = Date.parse("2026-10-28T00:40:00.000Z");
    const commits = rememberDayLineCommit(
      rememberDayLineCommit(undefined, {
        ids: ["c-1"],
        title: "Follow up with Dana",
        businessDate: "2026-10-27",
        atMs: now - 60_000,
      }),
      {
        ids: ["c-2"],
        title: "Pitch Wilshire Vermont",
        businessDate: "2026-10-28",
        atMs: now - 60_000,
      }
    );
    expect(
      recentDayLineCommits(commits, { nowMs: now, today: "2026-10-27" }).map(
        c => c.ids
      )
    ).toEqual([["c-1"]]);
    expect(
      recentDayLineCommits(commits, {
        nowMs: now + RECENT_COMMIT_WINDOW_MS + 1,
        today: "2026-10-27",
      })
    ).toEqual([]);
  });
});
