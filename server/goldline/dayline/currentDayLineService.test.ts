import { describe, expect, it, vi } from "vitest";
import type { MissionPlanOutcome } from "../../../shared/missionDirector";
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

describe("readCurrentDayLine", () => {
  it("projects Mission Director order without rescoring", async () => {
    const planForDate = vi.fn(async () => ({
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
    }));
    const line = await readCurrentDayLine(
      {
        tenantId: "tenant-a",
        operatorId: "operator-1",
        timeZone: "UTC",
        now: new Date("2026-09-23T15:00:00.000Z"),
      },
      {
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
  });
});
