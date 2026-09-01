import { describe, expect, it } from "vitest";
import type { GoldlineObjective } from "./goldlineAdventure";
import {
  campaignInputFingerprint,
  stableCampaignChapterId,
  type CampaignInstance,
  type TerritoryCampaignHint,
} from "./goldlineCampaign";
import { compileGoldlineCampaign } from "./goldlineCampaignCompiler";
import {
  markChapterCompleted,
  recompileCampaignFuture,
} from "./goldlineCampaignRevisions";

function objective(
  id: string,
  overrides: Partial<GoldlineObjective> = {}
): GoldlineObjective {
  return {
    id,
    physicalEntityId: null,
    kind: "recovery",
    authority: "persisted_task",
    status: "ready",
    latitude: 34.05,
    longitude: -118.3,
    windowStart: null,
    windowEnd: null,
    priority: 1,
    explanation: "Real source objective",
    sourceEvidenceReference: `source:${id}`,
    ...overrides,
  };
}

function compile(
  objectives: GoldlineObjective[],
  authoritativeCompletedObjectiveIds: readonly string[] = [],
  territories: readonly TerritoryCampaignHint[] = []
) {
  return compileGoldlineCampaign({
    tenantId: "default",
    operatorId: "driver-1",
    businessDate: "2026-09-01",
    objectives,
    authoritativeCompletedObjectiveIds,
    territories,
  });
}

function asInstance(draft: ReturnType<typeof compile>): CampaignInstance {
  return {
    ...draft,
    id: "campaign-1",
    revision: 1,
    createdAt: "2026-09-01T08:00:00.000Z",
    startedAt: "2026-09-01T08:00:00.000Z",
    completedAt: null,
  };
}

describe("campaign review hardening", () => {
  it("keeps chapter ids deterministic and safely below varchar(191)", () => {
    const ids = Array.from({ length: 4 }, (_, index) =>
      `recovery:${index}:12345678-1234-4234-8234-123456789012`
    );
    const forward = stableCampaignChapterId({
      businessDate: "2026-09-01",
      chapterKind: "recovery_branch",
      objectiveIds: ids,
    });
    const reversed = stableCampaignChapterId({
      businessDate: "2026-09-01",
      chapterKind: "recovery_branch",
      objectiveIds: [...ids].reverse(),
    });
    expect(forward).toBe(reversed);
    expect(forward.length).toBeLessThanOrEqual(191);
  });

  it("fingerprints terminal source evidence even when the live objective disappears", () => {
    const ready = objective("pickup:42", {
      kind: "pickup",
      authority: "fixed_commitment",
    });
    const before = campaignInputFingerprint({
      tenantId: "default",
      operatorId: "driver-1",
      businessDate: "2026-09-01",
      objectives: [ready],
    });
    const after = campaignInputFingerprint({
      tenantId: "default",
      operatorId: "driver-1",
      businessDate: "2026-09-01",
      objectives: [],
      authoritativeCompletedObjectiveIds: ["pickup:42"],
    });
    expect(after).not.toBe(before);
  });

  it("fingerprints coordinates that determine chapter order", () => {
    const base = {
      tenantId: "default",
      operatorId: "driver-1",
      businessDate: "2026-09-01",
      objectives: [objective("follow-up:1", { kind: "follow_up", latitude: 34.05, longitude: -118.3 })],
    };
    const before = campaignInputFingerprint(base);
    const after = campaignInputFingerprint({
      ...base,
      objectives: [objective("follow-up:1", { kind: "follow_up", latitude: 34.2, longitude: -118.2 })],
    });
    expect(after).not.toBe(before);
  });

  it("locks a chapter when authoritative source evidence completes an objective omitted from Today", () => {
    const morning = compile([objective("pickup:42", {
      kind: "pickup",
      authority: "fixed_commitment",
    })]);
    const instance = asInstance(morning);
    const chapterId = instance.chapters[0]!.stableChapterId;
    const noon = compile([], ["pickup:42"]);
    const revised = recompileCampaignFuture({ instance, next: noon });

    expect(noon.authoritativeCompletedObjectiveIds).toContain("pickup:42");
    expect(revised.instance.completedChapterIds).toContain(chapterId);
    expect(revised.instance.chapters.some(chapter => chapter.stableChapterId === chapterId)).toBe(true);
    expect(revised.instance.currentChapterId).toBeNull();
    expect(revised.instance.status).toBe("completed");
    expect(revised.instance.completedAt).toMatch(/^20\d\d-/);
    expect(revised.diff?.reasonCodes).toContain("AUTHORITATIVE_ACTION_COMPLETED");
    expect(revised.diff?.reasonCodes).not.toContain("OPPORTUNITY_NO_LONGER_ELIGIBLE");
  });

  it("locks a chapter when a completed row is still present in the projection", () => {
    const morning = compile([objective("recovery:one")]);
    const instance = asInstance(morning);
    const chapterId = instance.chapters[0]!.stableChapterId;
    const noon = compile([objective("recovery:one", { status: "completed" })]);
    const revised = recompileCampaignFuture({ instance, next: noon });

    expect(revised.instance.completedChapterIds).toContain(chapterId);
    expect(revised.instance.chapters.some(chapter => chapter.stableChapterId === chapterId)).toBe(true);
    expect(revised.instance.currentChapterId).toBeNull();
    expect(revised.instance.status).toBe("completed");
    expect(revised.instance.completedAt).not.toBeNull();
    expect(revised.diff?.reasonCodes).toContain("AUTHORITATIVE_ACTION_COMPLETED");
    expect(revised.diff?.reasonCodes).not.toContain("OPPORTUNITY_NO_LONGER_ELIGIBLE");
  });

  it("does not claim completion when an optional objective merely disappears", () => {
    const morning = compile([objective("recovery:optional")]);
    const instance = asInstance(morning);
    const chapterId = instance.chapters[0]!.stableChapterId;
    const noon = compile([]);
    const revised = recompileCampaignFuture({ instance, next: noon });

    expect(revised.instance.completedChapterIds).not.toContain(chapterId);
    expect(revised.instance.chapters.some(chapter => chapter.stableChapterId === chapterId)).toBe(false);
    expect(revised.instance.currentChapterId).toBeNull();
    expect(revised.instance.status).toBe("quiet");
    expect(revised.instance.completedAt).toBeNull();
    expect(revised.diff?.reasonCodes).toContain("OPPORTUNITY_NO_LONGER_ELIGIBLE");
    expect(revised.diff?.reasonCodes).not.toContain("AUTHORITATIVE_ACTION_COMPLETED");
  });

  it("heals a persisted Guardian finale from cleared territory game history", () => {
    const readyTerritory: TerritoryCampaignHint = {
      territoryId: "territory-1",
      memberPhysicalEntityIds: ["building-1"],
      confrontationReady: true,
      cleared: false,
    };
    const morning = compile([], [], [readyTerritory]);
    const instance = asInstance(morning);
    const finale = instance.chapters.find(chapter => chapter.chapterKind === "guardian_finale");
    expect(finale).toBeTruthy();

    const cleared = compile([], [], [{ ...readyTerritory, cleared: true }]);
    expect(cleared.clearedTerritoryIds).toContain("territory-1");
    expect(cleared.chapters.some(chapter => chapter.chapterKind === "guardian_finale")).toBe(false);

    const revised = recompileCampaignFuture({ instance, next: cleared });
    expect(revised.instance.chapters.some(chapter => chapter.stableChapterId === finale!.stableChapterId)).toBe(true);
    expect(revised.instance.completedChapterIds).toContain(finale!.stableChapterId);
    expect(revised.instance.currentChapterId).toBeNull();
    expect(revised.instance.status).toBe("completed");
    expect(revised.instance.completedAt).toMatch(/^20\d\d-/);
  });

  it("records an actual supplied completion time instead of the Unix epoch", () => {
    const instance = asInstance(compile([objective("recovery:one")]));
    const chapterId = instance.chapters[0]!.stableChapterId;
    const completedAt = "2026-09-01T18:42:11.000Z";
    const completed = markChapterCompleted(instance, chapterId, completedAt);

    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBe(completedAt);
    expect(completed.completedAt).not.toBe("1970-01-01T00:00:00.000Z");
  });

  it("locks a completed commercial follow-up into authoritative campaign history", () => {
    const morning = compile([objective("follow-up:88", { kind: "follow_up" })]);
    const instance = asInstance(morning);
    const chapterId = instance.chapters[0]!.stableChapterId;
    const noon = compile([], ["follow-up:88"]);
    const revised = recompileCampaignFuture({ instance, next: noon });

    expect(noon.authoritativeCompletedObjectiveIds).toContain("follow-up:88");
    expect(revised.instance.completedChapterIds).toContain(chapterId);
    expect(revised.instance.chapters.some(chapter => chapter.stableChapterId === chapterId)).toBe(true);
    expect(revised.instance.status).toBe("completed");
    expect(revised.diff?.reasonCodes).toContain("AUTHORITATIVE_ACTION_COMPLETED");
    expect(revised.diff?.reasonCodes).not.toContain("OPPORTUNITY_NO_LONGER_ELIGIBLE");
  });

  it("clears completedAt when new real work reopens a completed campaign", () => {
    const morning = compile([objective("follow-up:88", { kind: "follow_up" })]);
    const completed = recompileCampaignFuture({
      instance: asInstance(morning),
      next: compile([], ["follow-up:88"]),
    });
    expect(completed.instance.status).toBe("completed");
    expect(completed.instance.completedAt).toMatch(/^20\d\d-/);

    const afternoon = compile(
      [objective("pickup:99", { kind: "pickup", authority: "fixed_commitment" })],
      ["follow-up:88"]
    );
    const reopened = recompileCampaignFuture({
      instance: {
        ...completed.instance,
        completedAt: "2026-09-01T12:00:00.000Z",
      },
      next: afternoon,
    });

    expect(reopened.instance.status).toBe("active");
    expect(reopened.instance.completedAt).toBeNull();
    expect(reopened.instance.completedChapterIds).toContain(
      completed.instance.chapters[0]!.stableChapterId
    );
    expect(reopened.instance.chapters.some(chapter => chapter.objectiveIds.includes("pickup:99"))).toBe(
      true
    );
  });
});
