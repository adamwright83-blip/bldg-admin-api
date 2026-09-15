import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ readMission: vi.fn(), createMission: vi.fn() }));
vi.mock("../openChannel/day1TenDoorsService", () => ({
  getDay1TenDoorsMissionReadOnly: mocks.readMission,
  getOrCreateDay1TenDoorsMission: mocks.createMission,
}));
import { getClaireCampaignSummary } from "./campaignAwareness";

const targets = Array.from({ length: 12 }, (_, index) => ({ id: `target-${index}`, name: `Greystar ${index}`, address: `${index} Main St` }));

describe("getClaireCampaignSummary — authoritative, read-only", () => {
  it("shows authoritative remaining targets, bounded at ten, with zero writes", async () => {
    mocks.readMission.mockResolvedValue({ isComplete: false, visitedCount: 2, totalCount: 12, targets, outcomes: { "target-0": "pitched", "target-1": "couldnt_reach" } });
    const summary = await getClaireCampaignSummary({ tenantId: "tenant-1", actorId: "operator-1" });
    expect(summary).toMatchObject({ campaignName: "Colosseum", active: true, completedCount: 2, remainingCount: 10, totalCount: 12, realWorldExtension: "Greystar property prospecting visits", relationToGoal: "customer acquisition pipeline" });
    expect(summary?.remainingTargets).toHaveLength(10);
    expect(summary?.remainingTargets[0]).toEqual({ name: "Greystar 2", address: "2 Main St" });
    expect(mocks.createMission).not.toHaveBeenCalled();
  });

  it("reports a completed campaign", async () => {
    mocks.readMission.mockResolvedValue({ isComplete: true, visitedCount: 12, totalCount: 12, targets, outcomes: Object.fromEntries(targets.map(target => [target.id, "pitched"])) });
    expect(await getClaireCampaignSummary({ tenantId: "tenant-1", actorId: "operator-1" })).toMatchObject({ active: false, remainingCount: 0, remainingTargets: [] });
  });

  it("returns inactive and performs zero writes when no mission exists", async () => {
    mocks.readMission.mockResolvedValue(null);
    expect(await getClaireCampaignSummary({ tenantId: "tenant-1", actorId: "operator-1" })).toMatchObject({ active: false, totalCount: 0 });
    expect(mocks.createMission).not.toHaveBeenCalled();
  });

  it("fails closed to null", async () => {
    mocks.readMission.mockRejectedValue(new Error("Database not available"));
    expect(await getClaireCampaignSummary({ tenantId: "tenant-1", actorId: "operator-1" })).toBeNull();
  });
});
