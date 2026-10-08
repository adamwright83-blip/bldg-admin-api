import { describe, expect, it } from "vitest";
import { applyCommandProtection, detectTimePockets } from "./pocketDetection";
import { computePlanningFingerprint } from "./missionDirectorService";
import { buildCampaign } from "./testFixtures";
import type { RankingContext } from "./missionRank";

const sparseContext: RankingContext = {
  businessDate: "2026-09-21",
  macroGoal: null,
  openTasks: [],
};

describe("Mission Director Daily Command constraints", () => {
  it("treats protected occupancies as fixed time", () => {
    const pockets = detectTimePockets({
      timeline: [
        { id: "p1", title: "John pickup", scheduledAt: "2026-09-21T15:00:00.000Z", kind: "pickup" },
        { id: "zeely", title: "Zeely", scheduledAt: "2026-09-21T16:30:00.000Z", kind: "protected" },
      ],
    });
    expect(pockets).toHaveLength(1);
    expect(pockets[0]?.boundedBy).toEqual({ before: "p1", after: "zeely" });
  });

  it("zeros discretionary pockets while primary/prep protect the day", () => {
    const pockets = applyCommandProtection(
      detectTimePockets({
        timeline: [
          { id: "p1", title: "Pickup", scheduledAt: "2026-09-21T15:00:00.000Z", kind: "pickup" },
          { id: "d1", title: "Delivery", scheduledAt: "2026-09-21T17:00:00.000Z", kind: "delivery" },
        ],
      }),
      true
    );
    expect(pockets[0]?.usableMinutes).toBe(0);
    expect(pockets[0]?.warnings.join(" ")).toMatch(/Daily Command/);
  });

  it("replans when protected command constraints change", () => {
    const campaign = buildCampaign({
      campaignId: "office-pitch",
      title: "Office pitch",
      objective: "Win one office",
    });
    const base = {
      businessDate: "2026-09-21",
      fieldItemIds: ["pickup:1"],
      fieldScheduledAts: ["2026-09-21T15:00:00.000Z"] as (string | null)[],
      campaigns: [campaign],
      prepReady: { "office-pitch": true },
      rankingContext: sparseContext,
    };
    const before = computePlanningFingerprint({ ...base, commandFingerprint: "primary:zeely" });
    const after = computePlanningFingerprint({ ...base, commandFingerprint: "primary:dana" });
    expect(before).not.toBe(after);
  });
});
