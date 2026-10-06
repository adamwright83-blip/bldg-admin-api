import { describe, expect, it, vi } from "vitest";
import type { GrowthCampaign } from "../../campaignLibrary/campaignLibraryTypes";
import type { CampaignRun } from "../../../shared/campaignRun";
import { projectCurrentDayLine } from "../../../shared/currentDayLine";
import type { MissionPlanOutcome } from "../../../shared/missionDirector";
import { surfacedObjectiveIds } from "./currentDayLineRouter";
import { readCurrentDayLine } from "./currentDayLineService";

const outcome: MissionPlanOutcome = {
  status: "planned",
  explanation: "Already chosen.",
  intelligence: "deterministic",
  ranking: [
    {
      campaignId: "later-id",
      score: 10,
      confidence: "high",
      factors: [],
      warnings: [],
    },
    {
      campaignId: "earlier-id",
      score: 90,
      confidence: "high",
      factors: [],
      warnings: [],
    },
  ],
  primary: {
    campaignId: "later-id",
    title: "Visit",
    objective: "Visit",
    completionCondition: "The visit is completed.",
    pocket: {
      startsAt: null,
      endsAt: null,
      minutes: null,
      kind: "open_ended",
      boundedBy: { before: null, after: null },
      travelReserveMinutes: 0,
      unknownStopWorkReserveMinutes: null,
      usableMinutes: null,
      confidence: "low",
      warnings: [],
    },
    isFallbackVariant: false,
    rankEvidence: {
      campaignId: "later-id",
      score: 10,
      confidence: "high",
      factors: [],
      warnings: [],
    },
  },
  fallback: {
    campaignId: "earlier-id",
    title: "Email",
    objective: "Email",
    completionCondition: "Email the office.",
    pocket: {
      startsAt: null,
      endsAt: null,
      minutes: null,
      kind: "open_ended",
      boundedBy: { before: null, after: null },
      travelReserveMinutes: 0,
      unknownStopWorkReserveMinutes: null,
      usableMinutes: null,
      confidence: "low",
      warnings: [],
    },
    isFallbackVariant: true,
    rankEvidence: {
      campaignId: "earlier-id",
      score: 90,
      confidence: "high",
      factors: [],
      warnings: [],
    },
  },
};

function campaign(partial: Pick<GrowthCampaign, "id" | "campaignId" | "title" | "objective" | "completionCondition" | "missionCategory" | "opsTaskType">): GrowthCampaign {
  return {
    tenantId: "tenant-a",
    enabled: true,
    prepLeadDays: 0,
    prepCondition: null,
    pocketKind: "any",
    pocketMinutesMin: 5,
    fallbackVariant: null,
    autoVerifiable: [],
    selfReported: [],
    companionAbilityId: null,
    timingAssumptions: [],
    legacyContract: null,
    legacyContractRef: null,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
    ...partial,
  };
}

const campaigns: GrowthCampaign[] = [
  campaign({
    id: "row-earlier",
    campaignId: "earlier-id",
    title: "Email the office",
    objective: "Send the note",
    completionCondition: "Email the office.",
    missionCategory: "reputation",
    opsTaskType: "review_request",
  }),
  campaign({
    id: "row-later",
    campaignId: "later-id",
    title: "Visit the building",
    objective: "Walk the property",
    completionCondition: "The visit is completed.",
    missionCategory: "account_acquisition",
    opsTaskType: "office_account_pitch",
  }),
];

const directorState = {
  processingLocation: null,
  commitments: [
    {
      id: "commit-1",
      businessDate: "2026-09-23",
      title: "Call Dana",
      kind: "growth" as const,
      quantity: null,
      provenance: "user_reported" as const,
      status: "open" as const,
      completedAt: null,
      detailState: "COMPLETE" as const,
      missingDetails: [],
      detailNote: null,
      scheduleKind: null,
      scheduleLabel: null,
      sourceText: "Call Dana",
      command: {
        role: "primary" as const,
        designatedBy: "operator" as const,
        designatedAt: "2026-09-23T15:00:00.000Z",
        demotedAt: null,
        demotedReason: null,
        promisedTo: null,
        promisedDeadline: null,
        identityUnknown: false,
        cargoLink: null,
        recurrenceRuleId: null,
        constraints: { windowStart: null, windowEnd: null, scheduleLabel: null },
      },
      operatorMission: {
        version: 1 as const,
        source: "operator_explicit" as const,
        scope: "today_only" as const,
        completionCondition: "Operator reports completion of: Call Dana",
        verification: "operator_reported" as const,
        operatorMissionKey: "key",
        requestedAt: "2026-09-23T15:00:00.000Z",
        weeklyIntentDisplacement: true,
        sourceCommandRef: "ref",
        evidenceQuote: "Make calling Dana today's mission",
        businessDate: "2026-09-23",
      },
    },
  ],
  dismissedPromptKeys: [],
  intelligenceAvailable: false,
};

const storedPlan = {
  id: "plan-1",
  tenantId: "tenant-a",
  operatorId: "operator-1",
  businessDate: "2026-09-23",
  stableKey: "key",
  revision: 1,
  inputFingerprint: "fp",
  outcome,
  usageOutcome: null,
  createdAt: "2026-09-23T00:00:00.000Z",
};

const readerInput = {
  tenantId: "tenant-a",
  operatorId: "operator-1",
  timeZone: "UTC",
  now: new Date("2026-09-23T15:00:00.000Z"),
};

describe("Day Line diagnostic objective ids", () => {
  it("uses the newest active campaign-run id instead of the shared campaign id", () => {
    const line = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "ranked",
      rankedWorks: [
        { id: "campaign-a", title: "Campaign A" },
        { id: "campaign-b", title: "Campaign B" },
      ],
      designated: null,
    });
    const runs: CampaignRun[] = [
      {
        campaignRunId: "run-a-new",
        tenantId: "tenant-a",
        operatorUserId: "operator-1",
        campaignId: "campaign-a",
        campaignVersion: 1,
        fictionPackId: null,
        fictionPackVersion: null,
        targetSetId: "targets-a",
        startedAt: "2026-09-23T12:00:00.000Z",
        status: "active",
        completedAt: null,
      },
      {
        campaignRunId: "run-a-old",
        tenantId: "tenant-a",
        operatorUserId: "operator-1",
        campaignId: "campaign-a",
        campaignVersion: 1,
        fictionPackId: null,
        fictionPackVersion: null,
        targetSetId: "targets-old",
        startedAt: "2026-09-22T12:00:00.000Z",
        status: "active",
        completedAt: null,
      },
    ];
    expect(surfacedObjectiveIds(line, runs)).toEqual([
      "run-a-new",
      "campaign-b",
    ]);
  });
});

describe("readCurrentDayLine", () => {
  it("projects Mission Director order without rescoring", async () => {
    const planForDate = vi.fn(async () => storedPlan);
    const line = await readCurrentDayLine(readerInput, {
      planForDate,
      listCampaigns: async () => [
          {
            id: "row-earlier",
            tenantId: "tenant-a",
            campaignId: "earlier-id",
            enabled: true,
            title: "Email the office",
            objective: "Send the note",
            completionCondition: "Email the office.",
            prepLeadDays: 0,
            prepCondition: null,
            pocketKind: "any",
            pocketMinutesMin: 5,
            fallbackVariant: null,
            autoVerifiable: [],
            selfReported: [],
            missionCategory: "reputation",
            companionAbilityId: null,
            timingAssumptions: [],
            opsTaskType: "review_request",
            legacyContract: null,
            legacyContractRef: null,
            createdAt: "2026-09-23T00:00:00.000Z",
            updatedAt: "2026-09-23T00:00:00.000Z",
          },
          {
            id: "row-later",
            tenantId: "tenant-a",
            campaignId: "later-id",
            enabled: true,
            title: "Visit the building",
            objective: "Walk the property",
            completionCondition: "The visit is completed.",
            prepLeadDays: 0,
            prepCondition: null,
            pocketKind: "any",
            pocketMinutesMin: 5,
            fallbackVariant: null,
            autoVerifiable: [],
            selfReported: [],
            missionCategory: "account_acquisition",
            companionAbilityId: null,
            timingAssumptions: [],
            opsTaskType: "office_account_pitch",
            legacyContract: null,
            legacyContractRef: null,
            createdAt: "2026-09-23T00:00:00.000Z",
            updatedAt: "2026-09-23T00:00:00.000Z",
          },
        ],
        getDayDirectorState: async () => ({
          processingLocation: null,
          commitments: [
            {
              id: "commit-1",
              businessDate: "2026-09-23",
              title: "Call Dana",
              kind: "growth",
              quantity: null,
              provenance: "user_reported",
              status: "open",
              completedAt: null,
              detailState: "COMPLETE",
              missingDetails: [],
              detailNote: null,
              scheduleKind: null,
              scheduleLabel: null,
              sourceText: "Call Dana",
              command: {
                role: "primary",
                designatedBy: "operator",
                designatedAt: "2026-09-23T15:00:00.000Z",
                demotedAt: null,
                demotedReason: null,
                promisedTo: null,
                promisedDeadline: null,
                identityUnknown: false,
                cargoLink: null,
                recurrenceRuleId: null,
                constraints: { windowStart: null, windowEnd: null, scheduleLabel: null },
              },
              operatorMission: {
                version: 1,
                source: "operator_explicit",
                scope: "today_only",
                completionCondition: "Operator reports completion of: Call Dana",
                verification: "operator_reported",
                operatorMissionKey: "key",
                requestedAt: "2026-09-23T15:00:00.000Z",
                weeklyIntentDisplacement: true,
                sourceCommandRef: "ref",
                evidenceQuote: "Make calling Dana today's mission",
                businessDate: "2026-09-23",
              },
            },
          ],
          dismissedPromptKeys: [],
          intelligenceAvailable: false,
        }),
      }
    );

    expect(planForDate).toHaveBeenCalledWith(
      expect.objectContaining({ businessDate: "2026-09-23", tenantId: "tenant-a" })
    );
    expect(line.items.map(item => item.id)).toEqual(["later-id", "earlier-id"]);
    expect(line.items.map(item => item.executionType)).toEqual(["mission", "challenge"]);
    expect(line.designated?.executionType).toBe("challenge");
    expect(line.designated?.compatibilityPhrase).toBe("todays_mission");
    expect(line.scope).toBe("today");
    expect(line.orderingAuthority).toBe("system.mission_director");
    expect(planForDate.mock.calls[0]?.[0]).toEqual({
      tenantId: "tenant-a",
      operatorId: "operator-1",
      businessDate: "2026-09-23",
      timeZone: "UTC",
    });
  });

  it("forwards actor IDs and openIds as separate planning identities", async () => {
    const planForDate = vi.fn(async () => storedPlan);
    await readCurrentDayLine(
      {
        ...readerInput,
        operatorIds: ["operator-1", "22"],
        operatorUserId: "admin-owner",
        operatorUserIds: ["admin-owner", "driver-primary"],
      },
      {
        planForDate,
        listCampaigns: async () => campaigns,
        getDayDirectorState: async () => ({ ...directorState, commitments: [] }),
      }
    );
    expect(planForDate).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      operatorId: "operator-1",
      operatorIds: ["operator-1", "22"],
      operatorUserId: "admin-owner",
      operatorUserIds: ["admin-owner", "driver-primary"],
      businessDate: "2026-09-23",
      timeZone: "UTC",
    });
  });

  it("does not project a no_plan diagnostic ranking as today's line", async () => {
    const planForDate = vi.fn(async () => ({
      ...storedPlan,
      outcome: {
        status: "no_plan" as const,
        reason: "SCHEDULE_DATA_INSUFFICIENT" as const,
        remedy: "Tomorrow's schedule could not be read.",
        ranking: outcome.ranking,
      },
    }));
    const line = await readCurrentDayLine(readerInput, {
      planForDate,
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => directorState,
    });
    expect(line.rankingStatus).toBe("no_plan");
    expect(line.items).toEqual([]);
    expect(line.designated?.id).toBe("commit-1");
    expect(line.designated?.executionType).toBe("challenge");
    expect(line.designated?.position).toBe(-1);
  });

  it("does not call an empty planned ranking ranked", async () => {
    const line = await readCurrentDayLine(readerInput, {
      planForDate: async () => ({ ...storedPlan, outcome: { ...outcome, ranking: [] } }),
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => directorState,
    });
    expect(line.rankingStatus).toBe("unavailable");
    expect(line.items).toEqual([]);
  });

  it("keeps a fallback-only ranking in Mission Director order", async () => {
    const line = await readCurrentDayLine(readerInput, {
      planForDate: async () => ({
        ...storedPlan,
        outcome: {
          status: "fallback_only" as const,
          fallback: outcome.fallback,
          reason: "NO_QUALIFYING_POCKET" as const,
          explanation: "Fallback only.",
          ranking: outcome.ranking,
        },
      }),
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => ({ ...directorState, commitments: [] }),
    });
    expect(line.rankingStatus).toBe("ranked");
    expect(line.items.map(item => item.id)).toEqual(["later-id", "earlier-id"]);
  });

  it("drops a repeated campaign id without reordering", async () => {
    const line = await readCurrentDayLine(readerInput, {
      planForDate: async () => ({
        ...storedPlan,
        outcome: {
          ...outcome,
          ranking: [outcome.ranking[0]!, outcome.ranking[0]!, outcome.ranking[1]!],
        },
      }),
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => ({ ...directorState, commitments: [] }),
    });
    expect(line.items.map(item => item.id)).toEqual(["later-id", "earlier-id"]);
  });

  it("keeps the ranking when the designation read fails", async () => {
    const line = await readCurrentDayLine(readerInput, {
      planForDate: async () => storedPlan,
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => {
        throw new Error("day director down");
      },
    });
    expect(line.rankingStatus).toBe("ranked");
    expect(line.items.map(item => item.id)).toEqual(["later-id", "earlier-id"]);
    expect(line.designated).toBeNull();
  });

  it("uses the latest open operator primary when two are stored", async () => {
    const older = directorState.commitments[0]!;
    const line = await readCurrentDayLine(readerInput, {
      planForDate: async () => storedPlan,
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => ({
        ...directorState,
        commitments: [
          older,
          {
            ...older,
            id: "commit-newer",
            title: "Visit Dana",
            sourceText: "Visit Dana",
            command: { ...older.command, designatedAt: "2026-09-23T18:00:00.000Z" },
            operatorMission: {
              ...older.operatorMission!,
              completionCondition: "Operator reports completion of: Visit Dana",
              evidenceQuote: "Make visiting Dana today's mission",
            },
          },
        ],
      }),
    });
    expect(line.designated?.id).toBe("commit-newer");
    expect(line.designated?.executionType).toBe("mission");
    expect(line.items.map(item => item.id)).not.toContain("commit-newer");
  });

  it("does not read or write a plan for an unknown operator or another tenant", async () => {
    const planForDate = vi.fn();
    const listCampaigns = vi.fn();
    const missing = await readCurrentDayLine(
      { ...readerInput, operatorId: "unknown" },
      { planForDate, listCampaigns }
    );
    expect(missing.rankingStatus).toBe("unavailable");
    expect(planForDate).not.toHaveBeenCalled();
    expect(listCampaigns).not.toHaveBeenCalled();

    const getDayDirectorState = vi.fn(async () => directorState);
    const scopedCampaigns = vi.fn(async () => campaigns);
    const scopedPlan = vi.fn(async () => storedPlan);
    await readCurrentDayLine(
      { ...readerInput, tenantId: "tenant-b", operatorId: "operator-2" },
      { planForDate: scopedPlan, listCampaigns: scopedCampaigns, getDayDirectorState }
    );
    expect(scopedPlan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-b", operatorId: "operator-2" })
    );
    expect(scopedCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-b" })
    );
    expect(getDayDirectorState).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-b", actorId: "operator-2" })
    );
  });

  it("uses the dashboard zone when the caller does not pass one", async () => {
    const previous = process.env.ADMIN_DASHBOARD_TIMEZONE;
    process.env.ADMIN_DASHBOARD_TIMEZONE = "UTC";
    const planForDate = vi.fn(async () => ({
      ...storedPlan,
      outcome: {
        status: "no_plan" as const,
        reason: "CAMPAIGN_LIBRARY_EMPTY" as const,
        remedy: "Add a campaign.",
      },
    }));
    try {
      await readCurrentDayLine(
        {
          tenantId: "tenant-a",
          operatorId: "operator-1",
          now: new Date("2026-09-23T06:30:00.000Z"),
        },
        {
          planForDate,
          listCampaigns: async () => [],
          getDayDirectorState: async () => ({ ...directorState, commitments: [] }),
        }
      );
    } finally {
      if (previous === undefined) delete process.env.ADMIN_DASHBOARD_TIMEZONE;
      else process.env.ADMIN_DASHBOARD_TIMEZONE = previous;
    }
    expect(planForDate).toHaveBeenCalledWith(
      expect.objectContaining({ businessDate: "2026-09-23", timeZone: "UTC" })
    );
  });

  it("asks Mission Director for the operator zone's date, not UTC", async () => {
    const planForDate = vi.fn(async () => storedPlan);
    await readCurrentDayLine(
      {
        ...readerInput,
        timeZone: "America/Los_Angeles",
        now: new Date("2026-09-23T06:30:00.000Z"),
      },
      {
        planForDate,
        listCampaigns: async () => campaigns,
        getDayDirectorState: async () => ({ ...directorState, commitments: [] }),
      }
    );
    expect(planForDate).toHaveBeenCalledWith(
      expect.objectContaining({
        businessDate: "2026-09-22",
        timeZone: "America/Los_Angeles",
      })
    );
  });

  it("does not append an unranked Persistent Growth Objective to a legacy ranked list", async () => {
    const mockObjective = {
      id: "obj-growth-1001",
      tenantId: "tenant-a",
      goalRunId: "run-1",
      cycleId: "cycle-1",
      decisionId: "dec-1",
      canonicalOperatorId: "tenant:tenant-a:operator:driver-1",
      operatorUserId: "driver-1",
      title: "Commercial Acquisition: Tower Alpha",
      description: "Complete in-person commercial acquisition visit",
      executionType: "mission" as const,
      authority: "persisted_task" as const,
      status: "presented" as const,
      statusReason: null,
      actionTargetType: "commercial_mission",
      actionTargetId: "cm-9001",
      actionTargetDisplayName: "Tower Alpha",
      businessDate: "2026-09-23",
      windowStart: null,
      windowEnd: null,
      loadout: [],
      evidenceRefs: [],
      completedAt: null,
      createdAt: "2026-09-23T08:00:00.000Z",
      updatedAt: "2026-09-23T08:00:00.000Z",
    };
    const line = await readCurrentDayLine(readerInput, {
      planForDate: async () => storedPlan,
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => ({ ...directorState, commitments: [] }),
      listObjectives: async () => [mockObjective],
    });
    expect(line.items.map(item => item.id)).toEqual(["later-id", "earlier-id"]);
    expect(line.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "obj-growth-1001" })])
    );
  });

  it("returns unavailable for a zone that is not a real time zone", async () => {
    const planForDate = vi.fn();
    const line = await readCurrentDayLine(
      { ...readerInput, timeZone: "Not/AZone" },
      { planForDate }
    );
    expect(line.rankingStatus).toBe("unavailable");
    expect(line.items).toEqual([]);
    expect(planForDate).not.toHaveBeenCalled();
  });

  it("projects generic Mission Director work in authoritative order with Mission or Challenge type", async () => {
    const genericPlan = {
      ...storedPlan,
      outcome: {
        status: "no_plan" as const,
        reason: "NO_PREPARED_FALLBACK" as const,
        remedy: "Legacy campaign projection only.",
        workPlan: {
          status: "ranked" as const,
          primary: {
            workId: "wgc:tenant-a:followup:fu-1",
            title: "Call Dana",
            objective: "Call Dana about the property proposal",
            completionCondition: null,
            sourceKind: "commercial_follow_up" as const,
            sourceRefs: [
              {
                sourceKind: "commercial_follow_up" as const,
                sourceType: "commercial_follow_up",
                sourceId: "fu-1",
              },
            ],
            executionType: "challenge" as const,
            rankEvidence: {} as any,
          },
          ranking: [
            {
              workId: "wgc:tenant-a:followup:fu-1",
              title: "Call Dana",
              objective: "Call Dana about the property proposal",
              completionCondition: null,
              sourceKind: "commercial_follow_up" as const,
              sourceRefs: [],
              score: 300,
              confidence: "high" as const,
              executionType: "challenge" as const,
              eligible: true,
              blockedReasons: [],
              factors: [],
              warnings: [],
            },
            {
              workId: "wgc:tenant-a:campaign:field-1",
              title: "Visit Tower Alpha",
              objective: "Visit Tower Alpha in person",
              completionCondition: "Visit Tower Alpha in person.",
              sourceKind: "campaign_library" as const,
              sourceRefs: [],
              score: 200,
              confidence: "high" as const,
              executionType: "mission" as const,
              eligible: true,
              blockedReasons: [],
              factors: [],
              warnings: [],
            },
          ],
          reason: null,
        },
      },
    };
    const line = await readCurrentDayLine(readerInput, {
      planForDate: async () => genericPlan as any,
      listCampaigns: async () => campaigns,
      getDayDirectorState: async () => ({ ...directorState, commitments: [] }),
      listObjectives: async () => [],
    });
    expect(line.rankingStatus).toBe("ranked");
    expect(line.items.map(item => item.id)).toEqual([
      "wgc:tenant-a:followup:fu-1",
      "wgc:tenant-a:campaign:field-1",
    ]);
    expect(line.items.map(item => item.executionType)).toEqual([
      "challenge",
      "mission",
    ]);
    expect(line.items.every(item => item.lineage?.kind === "candidate")).toBe(true);
  });

});

