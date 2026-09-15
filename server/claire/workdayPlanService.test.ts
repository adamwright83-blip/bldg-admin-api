import { describe, expect, it } from "vitest";
import type { ClaireDriveContext, ClaireWorkCounts } from "./contextAssembler";
import { assembleTodayCandidates, assembleTomorrowCandidates, isHiddenWorkdayPlan } from "./workdayPlanService";
import { diffWorkdayPlans, proposeTomorrowDraft, speakEveningPlan, speakMorningDelta } from "../../shared/claireWorkday";
import { assembleClaireRuntimeView } from "./runtimeView";

const zeroCounts: ClaireWorkCounts = {
  pickups: 0,
  dropoffs: 0,
  commercialVisits: 0,
  commercialCalls: 0,
  followUps: 0,
  dayDirectorCommitments: 0,
  blockers: 0,
  campaignWorkReferences: 0,
};

function context(): ClaireDriveContext {
  return {
    phase: "pre_drive",
    generatedAt: "2026-09-15T02:00:00.000Z",
    businessDate: "2026-09-14",
    actorId: "operator-1",
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment: null,
    blockers: [],
    relevantTimeline: [],
    mission: null,
    macroGoalKnown: true,
    clock: {
      isoTimestamp: "2026-09-15T02:00:00.000Z",
      timeZone: "America/Los_Angeles",
      businessDate: "2026-09-14",
      weekday: "Monday",
      localTime: "7:00 PM",
      daypart: "evening",
      fieldSalesDayState: "over",
      tomorrowBusinessDate: "2026-09-15",
    },
    workPicture: {
      today: {
        businessDate: "2026-09-14",
        counts: { ...zeroCounts, pickups: 1 },
        items: [
          {
            id: "today-1",
            kind: "pickup",
            title: "Today Silver Lake pickup",
            subtitle: "pickup",
            urgency: "scheduled",
            scheduledAt: "2026-09-14T16:00:00.000Z",
            destination: null,
            sourceReference: "orders:1",
            whySurfaced: null,
            actions: [],
          },
        ],
      },
      tomorrow: {
        businessDate: "2026-09-15",
        counts: { ...zeroCounts, pickups: 1, dropoffs: 1 },
        items: [
          {
            id: "tom-1",
            kind: "pickup",
            title: "Los Feliz pickup",
            subtitle: "pickup",
            urgency: "scheduled",
            scheduledAt: "2026-09-15T16:00:00.000Z",
            destination: null,
            sourceReference: "orders:2",
            whySurfaced: null,
            actions: [],
          },
          {
            id: "tom-2",
            kind: "delivery",
            title: "Rebecca dropoff",
            subtitle: "delivery",
            urgency: "scheduled",
            scheduledAt: null,
            destination: null,
            sourceReference: "orders:3",
            whySurfaced: null,
            actions: [],
          },
        ],
      },
    },
  };
}

describe("workday plan projection", () => {
  it("projects tomorrow from existing truth without inventing appointments", () => {
    const ctx = context();
    ctx.runtime = assembleClaireRuntimeView(ctx);
    const tomorrow = assembleTomorrowCandidates(ctx);
    expect(tomorrow.map(item => item.title)).toEqual([
      "Today Silver Lake pickup",
      "Los Feliz pickup",
      "Rebecca dropoff",
    ]);
    expect(proposeTomorrowDraft(tomorrow).every(item => item.alreadyExists)).toBe(true);
    expect(speakEveningPlan(tomorrow)).toMatch(/mostly built/i);
  });

  it("diffs overnight add without asking the operator to re-brief", () => {
    const ctx = context();
    ctx.runtime = assembleClaireRuntimeView(ctx);
    const night = assembleTomorrowCandidates(ctx);
    const morning = [
      ...night,
      {
        ...night[0]!,
        id: "tom-3",
        title: "New Echo Park pickup",
        provenance: "external:cleancloud",
      },
    ];
    const deltas = diffWorkdayPlans({
      confirmed: {
        businessDate: "2026-09-15",
        confirmedAt: "2026-09-15T02:00:00.000Z",
        actorId: "operator-1",
        items: night,
        missingQuestion: null,
      },
      current: morning,
    });
    expect(deltas).toEqual([
      expect.objectContaining({ kind: "ADDED", title: "New Echo Park pickup" }),
    ]);
    expect(speakMorningDelta(deltas)).toMatch(/changed overnight/i);
    expect(assembleTodayCandidates(ctx).some(item => item.title.includes("Silver Lake"))).toBe(true);
  });

  it("hides plan snapshots from the dayline", () => {
    expect(isHiddenWorkdayPlan({ hiddenFromDayPlan: true })).toBe(true);
    expect(isHiddenWorkdayPlan({ detailState: "NEEDS_DETAILS" })).toBe(false);
  });
});
