import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCampaign } from "./testFixtures";
import { rankCampaigns, whySelected, type RankingContext } from "./missionRank";
import { selectMissionPlan } from "./planSelection";
import { computePlanningFingerprint } from "./missionDirectorService";
import type { TimePocket } from "./missionDirectorTypes";

const pocket: TimePocket = {
  startsAt: "2026-09-12T15:00:00.000Z",
  endsAt: "2026-09-12T16:00:00.000Z",
  minutes: 60,
  kind: "between_stops",
  boundedBy: { before: "a", after: "b" },
  travelReserveMinutes: 15,
  unknownStopWorkReserveMinutes: 10,
  usableMinutes: 45,
  confidence: "high",
  warnings: [
    "Travel duration is unavailable; travelReserveMinutes is a named safety reserve, not verified travel time.",
    "Stop service duration is unknown; unknownStopWorkReserveMinutes is a named conservative assumption, not a measured duration.",
  ],
};

const sparseContext: RankingContext = {
  businessDate: "2026-09-15",
  macroGoal: null,
  openTasks: [],
};

function factor(evidence: ReturnType<typeof rankCampaigns>[number], name: string) {
  return evidence.factors.find(item => item.name === name);
}

describe("Mission Director grounded ranking", () => {
  it("does not let campaignId win when a stronger grounded priority exists", () => {
    const aaa = buildCampaign({
      campaignId: "aaa-campaign",
      opsTaskType: "referral_ask",
      missionCategory: "relationship_capital",
      fallbackVariant: { title: "Quick aaa", completionCondition: "done", pocketMinutesMin: 10 },
    });
    const zzz = buildCampaign({
      campaignId: "zzz-campaign",
      opsTaskType: "office_account_pitch",
      missionCategory: "account_acquisition",
      fallbackVariant: { title: "Quick zzz", completionCondition: "done", pocketMinutesMin: 10 },
    });
    const outcome = selectMissionPlan({
      eligible: [aaa, zzz],
      pockets: [pocket],
      libraryTotalCount: 2,
      libraryEnabledCount: 2,
      rankingContext: {
        ...sparseContext,
        openTasks: [
          {
            taskType: "office_account_pitch",
            status: "accepted",
            priority: "high",
            dueAt: "2026-09-14",
          },
        ],
      },
    });
    expect(outcome.status).toBe("planned");
    if (outcome.status === "planned") {
      expect(outcome.primary.campaignId).toBe("zzz-campaign");
      expect(outcome.primary.rankEvidence.score).toBeGreaterThan(
        outcome.ranking.find(item => item.campaignId === "aaa-campaign")!.score
      );
    }
  });

  it("produces the identical selection for the same inputs", () => {
    const campaigns = [
      buildCampaign({
        campaignId: "zzz-campaign",
        fallbackVariant: { title: "Quick zzz", completionCondition: "done", pocketMinutesMin: 10 },
      }),
      buildCampaign({
        campaignId: "aaa-campaign",
        fallbackVariant: { title: "Quick aaa", completionCondition: "done", pocketMinutesMin: 10 },
      }),
    ];
    const rankingContext: RankingContext = {
      ...sparseContext,
      macroGoal: { metricKey: "active_customers", targetValue: 50, objective: "50 active customers" },
      openTasks: [
        { taskType: "manual_operator_task", status: "in_progress", priority: "normal", dueAt: "2026-09-15" },
      ],
    };
    const first = selectMissionPlan({
      eligible: campaigns,
      pockets: [pocket],
      libraryTotalCount: 2,
      libraryEnabledCount: 2,
      rankingContext,
    });
    const second = selectMissionPlan({
      eligible: campaigns,
      pockets: [pocket],
      libraryTotalCount: 2,
      libraryEnabledCount: 2,
      rankingContext,
    });
    expect(first).toEqual(second);
  });

  it("cannot change the winner from LLM availability because ranking has no LLM input", () => {
    const source = readFileSync(resolve(import.meta.dirname, "missionRank.ts"), "utf8");
    expect(source).not.toMatch(/invokeLLM|anthropic|openai|grok/i);
    const campaigns = [
      buildCampaign({
        campaignId: "aaa-campaign",
        fallbackVariant: { title: "Quick", completionCondition: "done", pocketMinutesMin: 10 },
      }),
      buildCampaign({
        campaignId: "bbb-campaign",
        fallbackVariant: { title: "Quick", completionCondition: "done", pocketMinutesMin: 10 },
      }),
    ];
    const withFakeLlmHint = {
      ...sparseContext,
      llmPreferredCampaignId: "bbb-campaign",
    } as RankingContext;
    const outcome = selectMissionPlan({
      eligible: campaigns,
      pockets: [pocket],
      libraryTotalCount: 2,
      libraryEnabledCount: 2,
      rankingContext: withFakeLlmHint,
    });
    expect(outcome.status).toBe("planned");
    if (outcome.status === "planned") {
      expect(outcome.primary.campaignId).toBe("aaa-campaign");
    }
  });

  it("applies explicit operator campaign priority when present", () => {
    const ranked = rankCampaigns({
      campaigns: [
        buildCampaign({ campaignId: "aaa-campaign" }),
        buildCampaign({ campaignId: "zzz-campaign" }),
      ],
      context: {
        ...sparseContext,
        campaignPriorityById: { "zzz-campaign": 900, "aaa-campaign": 1 },
      },
      pockets: [pocket],
    });
    expect(ranked[0].campaignId).toBe("zzz-campaign");
    expect(factor(ranked[0], "explicit_operator_priority")?.effect).toBe(900);
  });

  it("lets legitimate macro-goal alignment affect ranking", () => {
    const ranked = rankCampaigns({
      campaigns: [
        buildCampaign({
          campaignId: "aaa-reputation",
          missionCategory: "reputation",
        }),
        buildCampaign({
          campaignId: "zzz-acquisition",
          missionCategory: "account_acquisition",
        }),
      ],
      context: {
        ...sparseContext,
        macroGoal: {
          metricKey: "active_customers",
          targetValue: 50,
          objective: "50 active customers",
        },
      },
      pockets: [pocket],
    });
    expect(ranked[0].campaignId).toBe("zzz-acquisition");
    expect(factor(ranked[0], "macro_goal_alignment")?.effect).toBe(150);
    expect(factor(ranked[1], "macro_goal_alignment")?.effect).toBe(0);
  });

  it("gives unfinished accepted work continuity over a later campaignId", () => {
    const ranked = rankCampaigns({
      campaigns: [
        buildCampaign({ campaignId: "aaa-campaign", opsTaskType: "referral_ask" }),
        buildCampaign({ campaignId: "zzz-campaign", opsTaskType: "office_account_pitch" }),
      ],
      context: {
        ...sparseContext,
        openTasks: [
          {
            taskType: "office_account_pitch",
            status: "accepted",
            priority: "normal",
            dueAt: null,
          },
        ],
      },
      pockets: [pocket],
    });
    expect(ranked[0].campaignId).toBe("zzz-campaign");
    expect(factor(ranked[0], "continuity_unfinished_work")?.effect).toBe(250);
    expect(factor(ranked[1], "continuity_unfinished_work")?.effect).toBe(0);
  });

  it("lets overdue open work affect ranking", () => {
    const ranked = rankCampaigns({
      campaigns: [
        buildCampaign({ campaignId: "aaa-campaign", opsTaskType: "referral_ask" }),
        buildCampaign({ campaignId: "zzz-campaign", opsTaskType: "stale_customer" }),
      ],
      context: {
        ...sparseContext,
        openTasks: [
          {
            taskType: "stale_customer",
            status: "open",
            priority: "normal",
            dueAt: "2026-09-10",
          },
        ],
      },
      pockets: [pocket],
    });
    expect(ranked[0].campaignId).toBe("zzz-campaign");
    expect(factor(ranked[0], "overdue_open_work")?.effect).toBe(200);
    expect(factor(ranked[1], "overdue_open_work")?.effect).toBe(0);
  });

  it("adds no invented economic value", () => {
    const [evidence] = rankCampaigns({
      campaigns: [buildCampaign({ campaignId: "aaa-campaign" })],
      context: sparseContext,
      pockets: [pocket],
    });
    const economics = factor(evidence, "invented_economics");
    expect(economics?.value).toBeNull();
    expect(economics?.effect).toBe(0);
    expect(economics?.confidence).toBe("unknown");
    expect(evidence.warnings.join(" ")).toMatch(/No expected revenue/);
  });

  it("does not treat the travel reserve as verified travel duration", () => {
    const [evidence] = rankCampaigns({
      campaigns: [buildCampaign({ campaignId: "aaa-campaign" })],
      context: sparseContext,
      pockets: [pocket],
    });
    expect(evidence.warnings.join(" ")).toMatch(/named safety reserve/);
    expect(evidence.warnings.join(" ")).not.toMatch(/travel time of \d+/);
  });

  it("exposes unknown service duration in confidence and warnings", () => {
    const [evidence] = rankCampaigns({
      campaigns: [buildCampaign({ campaignId: "aaa-campaign" })],
      context: sparseContext,
      pockets: [pocket],
    });
    expect(evidence.warnings.join(" ")).toMatch(/Unknown service duration/);
  });

  it("uses campaignId only as the final equal-score tie-break", () => {
    const ranked = rankCampaigns({
      campaigns: [
        buildCampaign({ campaignId: "zzz-campaign" }),
        buildCampaign({ campaignId: "aaa-campaign" }),
      ],
      context: sparseContext,
      pockets: [pocket],
    });
    expect(ranked[0].score).toBe(ranked[1].score);
    expect(ranked.map(item => item.campaignId)).toEqual(["aaa-campaign", "zzz-campaign"]);
  });

  it("still plans for a sparse-data tenant", () => {
    const outcome = selectMissionPlan({
      eligible: [
        buildCampaign({
          campaignId: "only-campaign",
          fallbackVariant: { title: "Quick", completionCondition: "done", pocketMinutesMin: 10 },
        }),
      ],
      pockets: [pocket],
      libraryTotalCount: 1,
      libraryEnabledCount: 1,
      rankingContext: sparseContext,
    });
    expect(outcome.status).toBe("planned");
    if (outcome.status === "planned") {
      expect(outcome.primary.campaignId).toBe("only-campaign");
      expect(outcome.primary.rankEvidence.factors.length).toBeGreaterThan(0);
      expect(factor(outcome.primary.rankEvidence, "macro_goal_alignment")?.confidence).toBe(
        "unknown"
      );
    }
  });

  it("explains why the winner won with inspectable factors", () => {
    const ranked = rankCampaigns({
      campaigns: [
        buildCampaign({ campaignId: "aaa-campaign", missionCategory: "reputation" }),
        buildCampaign({ campaignId: "zzz-campaign", missionCategory: "account_acquisition" }),
      ],
      context: {
        ...sparseContext,
        macroGoal: {
          metricKey: "active_customers",
          targetValue: 50,
          objective: "50 active customers",
        },
      },
      pockets: [pocket],
    });
    const why = whySelected(ranked[0]);
    expect(why.some(line => line.includes("macro_goal_alignment"))).toBe(true);
    expect(ranked[0].factors.every(item => "name" in item && "source" in item && "effect" in item)).toBe(
      true
    );
  });

  it("cannot let playable game state create business ranking truth", () => {
    const source = readFileSync(resolve(import.meta.dirname, "missionRank.ts"), "utf8");
    expect(source).not.toMatch(/game\/state\/MissionDirector/);
    const ranked = rankCampaigns({
      campaigns: [
        buildCampaign({ campaignId: "aaa-campaign" }),
        buildCampaign({ campaignId: "zzz-campaign" }),
      ],
      context: {
        ...sparseContext,
        gameSpotlightCampaignId: "zzz-campaign",
      } as RankingContext,
      pockets: [pocket],
    });
    expect(ranked[0].campaignId).toBe("aaa-campaign");
  });

  it("ranks fallback with the same grounded priorities, not campaignId-first", () => {
    const aaa = buildCampaign({
      campaignId: "aaa-campaign",
      opsTaskType: "referral_ask",
      pocketMinutesMin: 999,
      fallbackVariant: { title: "Quick aaa", completionCondition: "done", pocketMinutesMin: 10 },
    });
    const zzz = buildCampaign({
      campaignId: "zzz-campaign",
      opsTaskType: "office_account_pitch",
      pocketMinutesMin: 999,
      fallbackVariant: { title: "Quick zzz", completionCondition: "done", pocketMinutesMin: 10 },
    });
    const outcome = selectMissionPlan({
      eligible: [aaa, zzz],
      pockets: [pocket],
      libraryTotalCount: 2,
      libraryEnabledCount: 2,
      rankingContext: {
        ...sparseContext,
        openTasks: [
          {
            taskType: "office_account_pitch",
            status: "accepted",
            priority: "high",
            dueAt: null,
          },
        ],
      },
    });
    expect(outcome.status).toBe("fallback_only");
    if (outcome.status === "fallback_only") {
      expect(outcome.fallback.campaignId).toBe("zzz-campaign");
    }
  });
});

describe("Mission Director planning fingerprint", () => {
  const baseCampaign = buildCampaign({
    campaignId: "office-pitch",
    title: "Office pitch",
    objective: "Win one office",
  });
  const baseInput = {
    businessDate: "2026-09-15",
    fieldItemIds: ["pickup:1"],
    fieldScheduledAts: ["2026-09-15T15:00:00.000Z"] as (string | null)[],
    campaigns: [baseCampaign],
    prepReady: { "office-pitch": true },
    rankingContext: sparseContext,
  };

  it("invalidates when planning-relevant campaign content changes", () => {
    const before = computePlanningFingerprint(baseInput);
    const after = computePlanningFingerprint({
      ...baseInput,
      campaigns: [{ ...baseCampaign, objective: "Win three offices" }],
    });
    expect(before).not.toBe(after);
  });

  it("does not invalidate when only presentation title changes", () => {
    const before = computePlanningFingerprint(baseInput);
    const after = computePlanningFingerprint({
      ...baseInput,
      campaigns: [{ ...baseCampaign, title: "A prettier office pitch label" }],
    });
    expect(before).toBe(after);
  });
});
