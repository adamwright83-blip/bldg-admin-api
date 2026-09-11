import { describe, expect, it } from "vitest";
import { selectMissionPlan } from "./planSelection";
import type { TimePocket } from "./missionDirectorTypes";
import { buildCampaign } from "./testFixtures";

const highPocket: TimePocket = {
  startsAt: "2026-09-12T15:00:00.000Z",
  endsAt: "2026-09-12T16:00:00.000Z",
  minutes: 60,
  kind: "between_stops",
  boundedBy: { before: "a", after: "b" },
  travelReserveMinutes: 15,
  usableMinutes: 45,
  confidence: "high",
  warnings: [],
};

const openEnded: TimePocket = {
  startsAt: null,
  endsAt: null,
  minutes: null,
  kind: "open_ended",
  boundedBy: { before: null, after: null },
  travelReserveMinutes: 15,
  usableMinutes: null,
  confidence: "low",
  warnings: [],
};

describe("selectMissionPlan", () => {
  it("plans a primary and fallback deterministically when both fit", () => {
    const primary = buildCampaign({
      campaignId: "aaa-campaign",
      pocketKind: "between_stops",
      pocketMinutesMin: 30,
    });
    const fallback = buildCampaign({
      campaignId: "bbb-campaign",
      pocketKind: "between_stops",
      pocketMinutesMin: 30,
      fallbackVariant: { title: "Quick version", completionCondition: "done quick", pocketMinutesMin: 10 },
    });
    const outcome = selectMissionPlan({
      eligible: [primary, fallback],
      pockets: [highPocket],
      libraryTotalCount: 2,
      libraryEnabledCount: 2,
    });
    expect(outcome.status).toBe("planned");
    if (outcome.status === "planned") {
      expect(outcome.primary.campaignId).toBe("aaa-campaign");
      expect(outcome.fallback.campaignId).toBe("bbb-campaign");
      expect(outcome.fallback.isFallbackVariant).toBe(true);
    }
  });

  it("falls back to the primary's own fallback variant when no other campaign has one", () => {
    const primary = buildCampaign({
      campaignId: "solo-campaign",
      pocketKind: "between_stops",
      pocketMinutesMin: 30,
      fallbackVariant: { title: "Quick version", completionCondition: "done quick", pocketMinutesMin: 10 },
    });
    const outcome = selectMissionPlan({
      eligible: [primary],
      pockets: [highPocket],
      libraryTotalCount: 1,
      libraryEnabledCount: 1,
    });
    expect(outcome.status).toBe("planned");
    if (outcome.status === "planned") {
      expect(outcome.primary.campaignId).toBe("solo-campaign");
      expect(outcome.fallback.campaignId).toBe("solo-campaign");
      expect(outcome.fallback.isFallbackVariant).toBe(true);
    }
  });

  it("returns fallback_only with NO_QUALIFYING_POCKET when nothing fits the full version but a fallback does", () => {
    const campaign = buildCampaign({
      campaignId: "big-campaign",
      pocketKind: "between_stops",
      pocketMinutesMin: 999,
      fallbackVariant: { title: "Quick version", completionCondition: "done quick", pocketMinutesMin: 10 },
    });
    const outcome = selectMissionPlan({
      eligible: [campaign],
      pockets: [highPocket],
      libraryTotalCount: 1,
      libraryEnabledCount: 1,
    });
    expect(outcome.status).toBe("fallback_only");
    if (outcome.status === "fallback_only") {
      expect(outcome.reason).toBe("NO_QUALIFYING_POCKET");
      expect(outcome.fallback.campaignId).toBe("big-campaign");
    }
  });

  it("returns no_plan NO_PREPARED_FALLBACK when nothing fits and nothing has a fallback", () => {
    const campaign = buildCampaign({
      campaignId: "impossible-campaign",
      pocketKind: "between_stops",
      pocketMinutesMin: 999,
      fallbackVariant: null,
    });
    const outcome = selectMissionPlan({
      eligible: [campaign],
      pockets: [highPocket],
      libraryTotalCount: 1,
      libraryEnabledCount: 1,
    });
    expect(outcome).toEqual({
      status: "no_plan",
      reason: "NO_PREPARED_FALLBACK",
      remedy: expect.any(String),
    });
  });

  it("returns no_plan CAMPAIGN_LIBRARY_EMPTY when there are no campaigns at all", () => {
    const outcome = selectMissionPlan({
      eligible: [],
      pockets: [highPocket],
      libraryTotalCount: 0,
      libraryEnabledCount: 0,
    });
    expect(outcome.status).toBe("no_plan");
    if (outcome.status === "no_plan") expect(outcome.reason).toBe("CAMPAIGN_LIBRARY_EMPTY");
  });

  it("returns no_plan ALL_CAMPAIGNS_DISABLED when campaigns exist but none are enabled", () => {
    const outcome = selectMissionPlan({
      eligible: [],
      pockets: [highPocket],
      libraryTotalCount: 3,
      libraryEnabledCount: 0,
    });
    expect(outcome.status).toBe("no_plan");
    if (outcome.status === "no_plan") expect(outcome.reason).toBe("ALL_CAMPAIGNS_DISABLED");
  });

  it("an open-ended low-confidence pocket never funds a full primary selection, only a fallback", () => {
    const campaign = buildCampaign({
      campaignId: "any-campaign",
      pocketKind: "any",
      pocketMinutesMin: 10,
      fallbackVariant: { title: "Quick version", completionCondition: "done quick", pocketMinutesMin: 5 },
    });
    const outcome = selectMissionPlan({
      eligible: [campaign],
      pockets: [openEnded],
      libraryTotalCount: 1,
      libraryEnabledCount: 1,
    });
    // usableMinutes is null on an open-ended pocket, so nothing "fits" it —
    // not even the fallback — proving the function never fabricates a
    // minute count to make a plan happen.
    expect(outcome.status).toBe("no_plan");
  });
});
