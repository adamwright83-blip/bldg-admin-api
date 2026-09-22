import { describe, expect, it } from "vitest";
import {
  WEEKLY_GROWTH_CAPS,
  WEEKLY_GROWTH_MOTIONS,
  WEEKLY_GROWTH_RANK_REASONS,
  WEEKLY_GROWTH_SOURCE_KINDS,
  addCalendarDays,
  canonicalWeeklyGrowthFeed,
  motionAlignsWithMacroGoal,
  prepFeasibleWithinHorizon,
  type WeeklyGrowthCandidateFeed,
} from "./weeklyGrowthCandidates";

describe("weekly growth candidate contract", () => {
  it("is one shared vocabulary with hard caps and machine rank reasons", () => {
    expect(WEEKLY_GROWTH_SOURCE_KINDS).toEqual([
      "unfinished_growth_work",
      "commercial_follow_up",
      "proactive_obligation",
      "customer_recovery",
      "campaign_library",
    ]);
    expect(WEEKLY_GROWTH_MOTIONS).toContain("continue_existing");
    expect(WEEKLY_GROWTH_MOTIONS).toContain("reputation");
    expect(WEEKLY_GROWTH_CAPS).toEqual({ total: 15, followUp: 5, recovery: 3, campaign: 8 });
    expect(WEEKLY_GROWTH_RANK_REASONS).toContain("INSUFFICIENT_PREP");
    expect(WEEKLY_GROWTH_RANK_REASONS).toContain("MACRO_GOAL_ALIGNED");
  });

  it("aligns acquisition goals with acquisition and retention, not reputation", () => {
    expect(motionAlignsWithMacroGoal("new_paying_customers", "account_acquisition")).toBe(true);
    expect(motionAlignsWithMacroGoal("active_customers", "retention")).toBe(true);
    expect(motionAlignsWithMacroGoal("new_paying_customers", "reputation")).toBe(false);
    expect(motionAlignsWithMacroGoal("active_customers", "digital_presence")).toBe(false);
    expect(motionAlignsWithMacroGoal("unknown_metric", "account_acquisition")).toBe(false);
  });

  it("judges prep against the horizon without choosing a date", () => {
    expect(prepFeasibleWithinHorizon({
      leadDays: 14,
      today: "2026-09-21",
      remainingDates: ["2026-09-21", "2026-09-25"],
      alreadyInFlight: false,
    })).toBe(false);
    expect(prepFeasibleWithinHorizon({
      leadDays: 14,
      today: "2026-09-21",
      remainingDates: ["2026-09-21"],
      alreadyInFlight: true,
    })).toBe(true);
    expect(addCalendarDays("2026-09-21", 14)).toBe("2026-10-05");
  });

  it("canonicalizes key order and ignores generatedAt", () => {
    const feed = sample();
    const rearranged = {
      fingerprint: "different",
      generatedAt: "2099-01-01T00:00:00.000Z",
      caps: feed.caps,
      sources: feed.sources,
      candidates: feed.candidates.map(candidate => ({
        rankReasons: candidate.rankReasons,
        confidence: candidate.confidence,
        assumptions: candidate.assumptions,
        observedSignals: candidate.observedSignals,
        fit: candidate.fit,
        prep: candidate.prep,
        provenance: { ...candidate.provenance, observedAt: "2099-01-01T00:00:00.000Z" },
        sourceRefs: candidate.sourceRefs,
        observedDueDate: candidate.observedDueDate,
        alreadyInFlight: candidate.alreadyInFlight,
        objective: candidate.objective,
        title: candidate.title,
        motion: candidate.motion,
        sourceKind: candidate.sourceKind,
        id: candidate.id,
      })),
      dayDirectorActorId: feed.dayDirectorActorId,
      operatorUserId: feed.operatorUserId,
      tenantId: feed.tenantId,
    };
    expect(canonicalWeeklyGrowthFeed(rearranged)).toEqual(canonicalWeeklyGrowthFeed(feed));
  });
});

function sample(): WeeklyGrowthCandidateFeed {
  return {
    tenantId: "tenant-a",
    operatorUserId: "operator-a",
    dayDirectorActorId: "actor-a",
    generatedAt: "2026-09-21T18:00:00.000Z",
    fingerprint: "abc",
    caps: WEEKLY_GROWTH_CAPS,
    sources: {
      unfinished_growth_work: { status: "available", observedCount: 0, eligibleCount: 0, rankedCount: 0, shownCount: 0 },
      commercial_follow_up: { status: "available", observedCount: 0, eligibleCount: 0, rankedCount: 0, shownCount: 0 },
      proactive_obligation: { status: "available", observedCount: 0, eligibleCount: 0, rankedCount: 0, shownCount: 0 },
      customer_recovery: { status: "unavailable", reason: "no_churn_scan" },
      campaign_library: { status: "available", observedCount: 0, eligibleCount: 0, rankedCount: 0, shownCount: 0 },
      macro_goal: { status: "available", observedCount: 0, eligibleCount: 0, rankedCount: 0, shownCount: 0 },
    },
    candidates: [],
  };
}
