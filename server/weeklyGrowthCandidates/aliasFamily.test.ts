import { describe, expect, it, vi } from "vitest";
import type { WeeklyGrowthSourceBundle } from "./rawRecord";
import { loadWeeklyGrowthCandidates } from "./loadWeeklyGrowthCandidates";

function unavailableBundle(): WeeklyGrowthSourceBundle {
  const unavailable = { status: "unavailable" as const, reason: "test" };
  return {
    unfinished: unavailable,
    commercialFollowUps: unavailable,
    proactiveObligations: unavailable,
    recovery: unavailable,
    campaigns: unavailable,
    macroGoal: unavailable,
  };
}

describe("weekly growth candidate alias family", () => {
  it("forwards authorized openId and Day Director actor aliases to the source reader", async () => {
    const readSources = vi.fn(async () => unavailableBundle());
    await loadWeeklyGrowthCandidates(
      {
        tenantId: "tenant-a",
        operatorUserId: "admin-owner",
        operatorUserIds: ["admin-owner", "driver-alias"],
        dayDirectorActorId: "11",
        dayDirectorActorIds: ["11", "22"],
        remainingDates: ["2026-09-28"],
        now: new Date("2026-09-28T18:00:00.000Z"),
        timeZone: "America/Los_Angeles",
      },
      {
        readSources,
        today: () => "2026-09-28",
      }
    );

    expect(readSources).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      operatorUserId: "admin-owner",
      operatorUserIds: ["admin-owner", "driver-alias"],
      dayDirectorActorId: "11",
      dayDirectorActorIds: ["11", "22"],
      timeZone: "America/Los_Angeles",
    });
  });
});
