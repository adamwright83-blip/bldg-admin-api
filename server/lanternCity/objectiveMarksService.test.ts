import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CampaignRun } from "../../shared/campaignRun";
import { projectCurrentDayLine } from "../../shared/currentDayLine";
import { loadLanternObjectiveMarks, type ObjectiveMarksDeps } from "./objectiveMarksService";

function run(tenantId: string, id: string): CampaignRun {
  return {
    campaignRunId: id,
    tenantId,
    operatorUserId: "driver-1",
    campaignId: "campaign-flyers",
    campaignVersion: 1,
    fictionPackId: "bio_containment",
    fictionPackVersion: 1,
    targetSetId: `set-${id}`,
    startedAt: "2026-09-20T16:00:00.000Z",
    status: "active",
    completedAt: null,
  };
}

function deps(over: Partial<ObjectiveMarksDeps> = {}): ObjectiveMarksDeps {
  return {
    readDayLine: vi.fn(async () =>
      projectCurrentDayLine({
        businessDate: "2026-09-28",
        rankingStatus: "ranked",
        rankedWorks: [{ id: "campaign-flyers", title: "Flyers", executionType: "mission" }],
        designated: null,
      })
    ),
    listTenantRuns: vi.fn(async ({ tenantId }) => [run(tenantId, "run-1")]),
    listRunSlots: vi.fn(async ({ campaignRunId }) => [{ campaignRunId, slotId: "s1", originalTargetId: "t1" }]),
    listTargets: vi.fn(async ({ targetSetId }) => [
      {
        targetId: "t1",
        targetSetId,
        label: "Building One",
        address: "1 Real St",
        lat: 34.1,
        lng: -118.3,
        placementPoint: "front_door_knob" as const,
        sourceNote: "walked",
        provenance: "operator_observed" as const,
      },
    ]),
    listRunEvents: vi.fn(async () => []),
    ...over,
  };
}

describe("loadLanternObjectiveMarks", () => {
  it("calls every reader with the caller's tenant and nobody else's", async () => {
    const d = deps();
    const out = await loadLanternObjectiveMarks({ tenantId: "tenant-b", operatorId: "7", viewerOpenId: "driver-1" }, d);
    expect(out.todayStatus).toBe("ok");
    expect(d.readDayLine).toHaveBeenCalledWith({ tenantId: "tenant-b", operatorId: "7" });
    expect(d.listTenantRuns).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-b" }));
    for (const reader of [d.listRunSlots, d.listTargets, d.listRunEvents]) {
      for (const call of (reader as ReturnType<typeof vi.fn>).mock.calls) {
        expect(call[0].tenantId).toBe("tenant-b");
      }
    }
  });

  it("drops a run a reader returns for another tenant", async () => {
    const d = deps({ listTenantRuns: vi.fn(async () => [run("tenant-a", "run-a")]) });
    const out = await loadLanternObjectiveMarks({ tenantId: "tenant-b", operatorId: "7", viewerOpenId: "driver-1" }, d);
    expect(out.today).toBeNull();
    expect(d.listRunEvents).not.toHaveBeenCalled();
  });

  it("an unavailable Day Line still returns history, with no today", async () => {
    const d = deps({ readDayLine: vi.fn(async () => { throw new Error("db down"); }) });
    const out = await loadLanternObjectiveMarks({ tenantId: "tenant-b", operatorId: "7", viewerOpenId: "driver-1" }, d);
    expect(out.todayStatus).toBe("day_line_unavailable");
    expect(out.today).toBeNull();
  });

  it("a blank tenant reads nothing", async () => {
    const d = deps();
    const out = await loadLanternObjectiveMarks({ tenantId: "  ", operatorId: "7", viewerOpenId: "driver-1" }, d);
    expect(out.today).toBeNull();
    expect(d.listTenantRuns).not.toHaveBeenCalled();
  });
});

describe("Lantern City server path is read-only", () => {
  it("contains no insert, update, delete or mutation", () => {
    for (const file of ["./objectiveMarksService.ts", "./lanternCityRouter.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/\.(insert|update|delete)\s*\(/);
      expect(source).not.toMatch(/\.mutation\s*\(/);
      expect(source).not.toMatch(/\b(recordTerritoryPresence|recordPlacement|replaceTarget|startCampaignRun|freezeTargetSet)\b/);
    }
  });
});
