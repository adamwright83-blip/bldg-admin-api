import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldTodayItem, FieldTodayProjection } from "../field/types";

const mocks = vi.hoisted(() => ({
  getFieldToday: vi.fn(),
  getCommercialMissionFieldState: vi.fn(),
  ensureCurrentMissionSalesBrief: vi.fn(),
  getActiveMacroGoal: vi.fn(),
  getClaireCampaignSummary: vi.fn(),
}));

vi.mock("../field/fieldTodayService", () => ({ getFieldToday: mocks.getFieldToday }));
vi.mock("../commercialMissions/commercialMissionFieldService", () => ({
  getCommercialMissionFieldState: mocks.getCommercialMissionFieldState,
}));
vi.mock("../missionSalesBrief/missionSalesBriefService", () => ({
  ensureCurrentMissionSalesBrief: mocks.ensureCurrentMissionSalesBrief,
}));
vi.mock("./macroGoalService", () => ({ getActiveMacroGoal: mocks.getActiveMacroGoal }));
vi.mock("./campaignAwareness", () => ({ getClaireCampaignSummary: mocks.getClaireCampaignSummary }));

import {
  assembleClaireDriveContext,
  buildClaireClock,
  buildClaireWorkDay,
} from "./contextAssembler";

function item(id: string, kind: FieldTodayItem["kind"], title = id): FieldTodayItem {
  return {
    id,
    kind,
    source: { entityType: "fixture", entityId: id, sourceReference: `fixture:${id}` },
    scheduledAt: null,
    urgency: "scheduled",
    title,
    subtitle: kind,
    status: "active",
    destination: null,
    customer: null,
    money: null,
    verificationClass: "VERIFIED",
    actions: [],
  };
}

function projection(
  businessDate: string,
  timeline: FieldTodayItem[],
  blockers: FieldTodayItem[] = []
): FieldTodayProjection {
  return {
    generatedAt: `${businessDate}T12:00:00.000Z`,
    businessDate,
    currentUserId: "operator-1",
    timeline,
    authoritativeCompletedObjectiveIds: [],
    nextFixedCommitment: timeline[0] ?? null,
    blockers,
    dataQuality: { status: "trusted", warnings: [], sources: ["fixture"] },
  };
}

describe("Claire temporal orientation", () => {
  it.each([
    ["8 AM", "2026-09-14T15:00:00.000Z", "morning", "open", "8:00 AM"],
    ["1 PM", "2026-09-14T20:00:00.000Z", "midday", "open", "1:00 PM"],
    ["5:30 PM", "2026-09-15T00:30:00.000Z", "afternoon", "winding_down", "5:30 PM"],
    ["7 PM", "2026-09-15T02:00:00.000Z", "evening", "over", "7:00 PM"],
    ["11:50 PM", "2026-09-15T06:50:00.000Z", "late_night", "over", "11:50 PM"],
  ])("classifies %s in the canonical business timezone", (_label, iso, daypart, state, localTime) => {
    const clock = buildClaireClock(new Date(iso));
    expect(clock).toMatchObject({
      businessDate: "2026-09-14",
      weekday: "Monday",
      daypart,
      fieldSalesDayState: state,
      localTime,
      tomorrowBusinessDate: "2026-09-15",
      timeZone: "America/Los_Angeles",
    });
  });

  it("crosses the local next-day boundary without moving the timezone by hand", () => {
    expect(buildClaireClock(new Date("2026-09-15T06:59:00.000Z")).businessDate).toBe("2026-09-14");
    expect(buildClaireClock(new Date("2026-09-15T07:01:00.000Z"))).toMatchObject({
      businessDate: "2026-09-15",
      weekday: "Tuesday",
      tomorrowBusinessDate: "2026-09-16",
    });
  });

  it("uses the correct local clock across the spring DST transition", () => {
    expect(buildClaireClock(new Date("2026-03-08T10:30:00.000Z"))).toMatchObject({
      businessDate: "2026-03-08",
      weekday: "Sunday",
      localTime: "3:30 AM",
      daypart: "late_night",
      fieldSalesDayState: "before",
      tomorrowBusinessDate: "2026-03-09",
    });
  });
});

describe("Claire today and tomorrow work picture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommercialMissionFieldState.mockResolvedValue(null);
    mocks.getActiveMacroGoal.mockResolvedValue(null);
    mocks.getClaireCampaignSummary.mockResolvedValue(null);
  });

  it("keeps explicit zero route counts when sales work exists", () => {
    const day = buildClaireWorkDay({
      businessDate: "2026-09-15",
      timeline: [item("visit-1", "commercial_visit"), item("call-1", "commercial_call")],
      blockers: [],
    });
    expect(day.counts).toEqual({
      pickups: 0,
      dropoffs: 0,
      commercialVisits: 1,
      commercialCalls: 1,
      followUps: 0,
      dayDirectorCommitments: 0,
      blockers: 0,
      campaignWorkReferences: 0,
    });
    expect(day.items).toHaveLength(2);
  });

  it("keeps route work and campaign references together and bounds items at eight", () => {
    const timeline = [
      item("pickup-1", "pickup"),
      item("delivery-1", "delivery"),
      item("campaign-1", "mission_dispatch"),
      ...Array.from({ length: 8 }, (_, index) => item(`follow-${index}`, "follow_up")),
    ];
    const day = buildClaireWorkDay({ businessDate: "2026-09-15", timeline, blockers: [] });
    expect(day.counts).toMatchObject({ pickups: 1, dropoffs: 1, followUps: 8, campaignWorkReferences: 1 });
    expect(day.items).toHaveLength(8);
  });

  it("does not invent title-based test or archive filtering", () => {
    const day = buildClaireWorkDay({
      businessDate: "2026-09-15",
      timeline: [item("visit-1", "commercial_visit", "TEST ARCHIVE — authoritative live visit")],
      blockers: [],
    });
    expect(day.counts.commercialVisits).toBe(1);
    expect(day.items[0]?.title).toContain("TEST ARCHIVE");
  });

  it("assembles tomorrow from tomorrow's explicit business date", async () => {
    mocks.getFieldToday
      .mockResolvedValueOnce(projection("2026-09-14", [item("pickup-1", "pickup")]))
      .mockResolvedValueOnce(projection("2026-09-15", [item("delivery-1", "delivery"), item("visit-1", "commercial_visit")]));

    const now = new Date("2026-09-15T02:00:00.000Z");
    const context = await assembleClaireDriveContext({
      tenantId: "tenant-1",
      actorId: "operator-1",
      phase: "pre_drive",
      now,
    });

    expect(mocks.getFieldToday).toHaveBeenNthCalledWith(2, expect.objectContaining({
      businessDate: "2026-09-15",
      now,
      timeZone: "America/Los_Angeles",
    }));
    expect(context.clock?.fieldSalesDayState).toBe("over");
    expect(context.macroGoalKnown).toBe(false);
    expect(context.workPicture?.today.counts).toMatchObject({ pickups: 1, dropoffs: 0 });
    expect(context.workPicture?.tomorrow.counts).toMatchObject({ pickups: 0, dropoffs: 1, commercialVisits: 1 });
  });
});
