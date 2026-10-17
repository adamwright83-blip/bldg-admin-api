/**
 * PR #606: the paid "explain the plan" call happens only when a new plan
 * revision will actually be stored. Production 2026-10-16 paid for it on every
 * goal-cycle re-plan (bursts of four calls every few minutes) and threw the
 * result away when nothing had changed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  explain: vi.fn(async () => ({ explanation: "Model explanation.", intelligence: "anthropic" as const })),
  candidateFingerprint: "candidates-v1",
  workPlan: { status: "ranked", primary: { sourceRefs: [{ sourceKind: "campaign_library", sourceId: "campaign-1" }] }, ranking: [], reason: null } as Record<string, unknown>,
  selected: { status: "planned", primary: { title: "Walk Greystar" }, fallback: { title: "Call two lapsed customers" }, ranking: [], explanation: "" } as Record<string, unknown>,
}));

vi.mock("./explainPlan", () => ({ explainMissionPlan: hoisted.explain }));
vi.mock("../../campaignLibrary/campaignLibraryService", () => ({ listCampaigns: async () => [] }));
vi.mock("../../field/fieldTodayService", () => ({ getFieldToday: async () => ({ timeline: [] }) }));
vi.mock("../../claire/dailyCommandContract", () => ({ loadDailyCommand: async () => null }));
vi.mock("../../claire/macroGoalService", () => ({ getActiveMacroGoalForOperators: async () => null }));
vi.mock("./prepReadiness", () => ({ computePrepReadiness: async () => ({}) }));
vi.mock("../../weeklyGrowthCandidates/loadWeeklyGrowthCandidates", () => ({
  loadWeeklyGrowthCandidates: async () => ({ candidates: [], fingerprint: hoisted.candidateFingerprint }),
}));
vi.mock("./rankableWork", () => ({ rankMissionDirectorWork: () => hoisted.workPlan }));
vi.mock("./planSelection", () => ({ selectMissionPlan: () => hoisted.selected }));

import { computeMissionPlan } from "./missionDirectorService";

const input = { tenantId: "tenant-1", operatorId: "1", operatorUserId: "operator-1", businessDate: "2026-10-16", timeZone: "America/Los_Angeles" };

describe("Mission Director explanation spend", () => {
  beforeEach(() => {
    hoisted.explain.mockClear();
    hoisted.candidateFingerprint = "candidates-v1";
    hoisted.workPlan = { status: "ranked", primary: { sourceRefs: [{ sourceKind: "campaign_library", sourceId: "campaign-1" }] }, ranking: [], reason: null };
  });

  it("makes zero explanation calls when the stored plan has the same input fingerprint", async () => {
    const first = await computeMissionPlan(input);
    expect(hoisted.explain).toHaveBeenCalledTimes(1);
    hoisted.explain.mockClear();
    const again = await computeMissionPlan(input, { needsExplanation: async fp => fp !== first.inputFingerprint });
    expect(again.unchanged).toBe(true);
    expect(again.inputFingerprint).toBe(first.inputFingerprint);
    expect(hoisted.explain).not.toHaveBeenCalled();
  });

  it("still explains a plan whose inputs genuinely changed", async () => {
    const first = await computeMissionPlan(input);
    hoisted.explain.mockClear();
    hoisted.candidateFingerprint = "candidates-v2";
    const changed = await computeMissionPlan(input, { needsExplanation: async fp => fp !== first.inputFingerprint });
    expect(changed.unchanged).toBeUndefined();
    expect(changed.inputFingerprint).not.toBe(first.inputFingerprint);
    expect(hoisted.explain).toHaveBeenCalledTimes(1);
    expect(changed.outcome).toMatchObject({ status: "planned", explanation: "Model explanation.", intelligence: "anthropic" });
  });

  it("makes zero explanation calls for a no_plan outcome", async () => {
    hoisted.workPlan = { status: "no_eligible_work", primary: null, ranking: [], reason: "blocked" };
    const result = await computeMissionPlan(input);
    expect(result.outcome.status).toBe("no_plan");
    expect(hoisted.explain).not.toHaveBeenCalled();
  });

  it("makes zero explanation calls when authoritative work is not a campaign (also no_plan)", async () => {
    hoisted.workPlan = { status: "ranked", primary: { sourceRefs: [{ sourceKind: "commercial_follow_up", sourceId: "f-1" }] }, ranking: [], reason: null };
    const result = await computeMissionPlan(input);
    expect(result.outcome).toMatchObject({ status: "no_plan", reason: "AUTHORITATIVE_WORK_NOT_CAMPAIGN" });
    expect(hoisted.explain).not.toHaveBeenCalled();
  });

  it("keeps the fingerprint independent of whether an explanation was paid for", async () => {
    const explained = await computeMissionPlan(input);
    const skipped = await computeMissionPlan(input, { needsExplanation: async () => false });
    expect(skipped.inputFingerprint).toBe(explained.inputFingerprint);
  });
});
