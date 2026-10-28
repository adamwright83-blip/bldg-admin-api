import { describe, expect, it } from "vitest";
import {
  deferralTarget,
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

  it("picks the named commit, else the most recent, never all of them", () => {
    const commits = [
      {
        ids: ["c-dana"],
        title: "Follow up with Dana",
        businessDate: "2026-10-27",
        atMs: 1,
      },
      {
        ids: ["c-opus"],
        title: "Pickup at OPUS",
        businessDate: "2026-10-27",
        atMs: 2,
      },
      {
        ids: ["c-ad"],
        title: "Post the Instagram ad",
        businessDate: "2026-10-27",
        atMs: 3,
      },
    ];
    const ids = (utterance: string) => {
      const t = deferralTarget(commits, utterance);
      return t.kind === "target" ? t.commit.ids : t.kind;
    };
    expect(ids("I'll send the Dana email tomorrow.")).toEqual(["c-dana"]);
    expect(ids("Let's do the Opus pickup in the morning.")).toEqual(["c-opus"]);
    expect(ids("I'll do it tomorrow.")).toEqual(["c-ad"]);
    expect(ids("Yeah, I'm gonna handle that tomorrow morning.")).toEqual([
      "c-ad",
    ]);
    expect(ids("Push it to tomorrow.")).toEqual(["c-ad"]);
    expect(deferralTarget([], "Tomorrow.").kind).toBe("none");
  });

  it("a named task that matches nothing placed on this call moves nothing", () => {
    const commits = [
      {
        ids: ["c-opus"],
        title: "Pickup at OPUS",
        businessDate: "2026-10-27",
        atMs: 2,
      },
    ];
    expect(
      deferralTarget(commits, "I'll do the Louise email tomorrow.")
    ).toEqual({ kind: "unmatched", named: ["louise"] });
  });
});
