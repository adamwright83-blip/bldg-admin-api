import { describe, expect, it } from "vitest";
import { eligibleCampaigns } from "./eligibility";
import { buildCampaign } from "./testFixtures";

describe("eligibleCampaigns", () => {
  it("rejects a disabled campaign", () => {
    const campaign = buildCampaign({ campaignId: "disabled-one", enabled: false });
    const { eligible, rejected } = eligibleCampaigns({
      campaigns: [campaign],
      prepReady: {},
    });
    expect(eligible).toHaveLength(0);
    expect(rejected[0]).toMatchObject({ campaignId: "disabled-one", reason: "DISABLED" });
  });

  it("rejects a prep-requiring campaign with no recorded prep, naming the reason", () => {
    const campaign = buildCampaign({
      campaignId: "door-hanger-territory-operation",
      prepLeadDays: 3,
      prepCondition: "hangers printed",
    });
    const { eligible, rejected } = eligibleCampaigns({
      campaigns: [campaign],
      prepReady: { "door-hanger-territory-operation": false },
    });
    expect(eligible).toHaveLength(0);
    expect(rejected[0]).toMatchObject({
      campaignId: "door-hanger-territory-operation",
      reason: "PREP_NOT_READY",
    });
    expect(rejected[0].detail).toContain("3 day(s)");
  });

  it("admits a prep-requiring campaign once prep is ready", () => {
    const campaign = buildCampaign({ campaignId: "office-pitch", prepLeadDays: 2 });
    const { eligible } = eligibleCampaigns({
      campaigns: [campaign],
      prepReady: { "office-pitch": true },
    });
    expect(eligible).toHaveLength(1);
  });

  it("admits a zero-prep campaign without needing a readiness entry", () => {
    const campaign = buildCampaign({ campaignId: "referral-ask", prepLeadDays: 0 });
    const { eligible } = eligibleCampaigns({ campaigns: [campaign], prepReady: {} });
    expect(eligible).toHaveLength(1);
  });

  it("returns eligible campaigns in deterministic campaignId order", () => {
    const a = buildCampaign({ campaignId: "zzz" });
    const b = buildCampaign({ campaignId: "aaa" });
    const { eligible } = eligibleCampaigns({ campaigns: [a, b], prepReady: {} });
    expect(eligible.map(c => c.campaignId)).toEqual(["aaa", "zzz"]);
  });
});
