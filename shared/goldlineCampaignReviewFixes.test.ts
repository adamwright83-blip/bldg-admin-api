import { describe, expect, it } from "vitest";
import type { GoldlineObjective } from "./goldlineAdventure";
import {
  stableCampaignChapterId,
  type CampaignInstance,
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

function compile(objectives: GoldlineObjective[]) {
  return compileGoldlineCampaign({
    tenantId: "default",
    operatorId: "driver-1",
    businessDate: "2026-09-01",
    objectives,
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

  it("locks a chapter only when FieldToday says its source objective completed", () => {
    const morning = compile([objective("recovery:one")]);
    const instance = asInstance(morning);
    const chapterId = instance.chapters[0]!.stableChapterId;
    const noon = compile([objective("recovery:one", { status: "completed" })]);
    const revised = recompileCampaignFuture({ instance, next: noon });

    expect(revised.instance.completedChapterIds).toContain(chapterId);
    expect(revised.instance.chapters.some(chapter => chapter.stableChapterId === chapterId)).toBe(true);
    expect(revised.instance.currentChapterId).toBeNull();
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
    expect(revised.diff?.reasonCodes).toContain("OPPORTUNITY_NO_LONGER_ELIGIBLE");
    expect(revised.diff?.reasonCodes).not.toContain("AUTHORITATIVE_ACTION_COMPLETED");
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
});
