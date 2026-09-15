import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getOrCreateDay1TenDoorsMission: vi.fn() }));
vi.mock("../openChannel/day1TenDoorsService", () => ({
  getOrCreateDay1TenDoorsMission: mocks.getOrCreateDay1TenDoorsMission,
}));

import { getClaireCampaignSummary } from "./campaignAwareness";

describe("getClaireCampaignSummary — authoritative, read-only", () => {
  it("reports active/remaining/completed from the real mission's own counts", async () => {
    mocks.getOrCreateDay1TenDoorsMission.mockResolvedValue({
      isComplete: false,
      visitedCount: 7,
      totalCount: 10,
    });
    const summary = await getClaireCampaignSummary({ tenantId: "tenant-1", actorId: "operator-1" });
    expect(summary).toEqual({ active: true, completedCount: 7, remainingCount: 3 });
  });

  it("reports inactive once the mission is complete", async () => {
    mocks.getOrCreateDay1TenDoorsMission.mockResolvedValue({
      isComplete: true,
      visitedCount: 10,
      totalCount: 10,
    });
    const summary = await getClaireCampaignSummary({ tenantId: "tenant-1", actorId: "operator-1" });
    expect(summary?.active).toBe(false);
    expect(summary?.remainingCount).toBe(0);
  });

  it("fails closed to null rather than throwing, never blocking Claire's core flow", async () => {
    mocks.getOrCreateDay1TenDoorsMission.mockRejectedValue(new Error("Database not available"));
    const summary = await getClaireCampaignSummary({ tenantId: "tenant-1", actorId: "operator-1" });
    expect(summary).toBeNull();
  });
});
