import { describe, expect, it } from "vitest";
import { canonicalActionFromDescriptor } from "./goldlineActionContract";
import {
  assessAmbiguity,
  assessPictureCompleteness,
  claireOperatorKey,
  classifyIntentHeuristics,
  deriveStaleness,
  extractConversationalFieldOutcome,
  isTechnicalTestTitle,
  parseScheduleFromUtterance,
  permissionSpeak,
  prioritizeCategory,
  wrapClaireAction,
} from "./claireRuntime";

describe("Claire V1 truth/action seams", () => {
  it("wraps a canonical action with NEEDS_DETAILS without inventing numbers", () => {
    const action = wrapClaireAction(
      canonicalActionFromDescriptor({
        descriptor: { kind: "REVIEW", mode: "write", missionId: null, label: "Research Zeely" },
        reason: "operator asked to evaluate a channel",
      }),
      { detailState: "NEEDS_DETAILS", missingDetails: ["comparison criteria", "desired timing"] }
    );
    expect(action.authority).toBe("AUTO");
    expect(action.detailState).toBe("NEEDS_DETAILS");
    expect(action.lifecycle).toBe("planned");
    expect(action.inputs).not.toHaveProperty("expectedValue");
  });

  it("speaks permission levels in operator language", () => {
    expect(permissionSpeak("HUMAN_EXECUTION")).toBe("That one needs you physically.");
    expect(permissionSpeak("APPROVAL_REQUIRED", "NEEDS_DETAILS")).toBe(
      "I can add that and flag the missing details."
    );
    expect(permissionSpeak("APPROVAL_REQUIRED")).toBe(
      "I can prepare that, but you'll need to approve it."
    );
  });

  it("classifies staleness without asking the model to subtract dates", () => {
    const now = new Date("2026-09-15T03:00:00.000Z");
    expect(deriveStaleness({ now, scheduledAt: now.toISOString(), createdAt: now.toISOString(), status: "open" }).band).toBe("due_today");
    expect(
      deriveStaleness({
        now,
        scheduledAt: "2026-08-07T16:00:00.000Z",
        createdAt: "2026-08-07T16:00:00.000Z",
        status: "open",
        urgency: "overdue",
      }).band
    ).toBe("very_old");
    expect(
      deriveStaleness({
        now,
        scheduledAt: "2026-09-14T20:00:00.000Z",
        createdAt: "2026-09-14T20:00:00.000Z",
        status: "open",
        urgency: "overdue",
      }).band
    ).toBe("overdue");
    expect(deriveStaleness({ now, scheduledAt: null, createdAt: now.toISOString(), status: "completed" }).band).toBe("closed");
  });

  it("does not call a fresh item stale", () => {
    const now = new Date("2026-09-15T03:00:00.000Z");
    expect(
      deriveStaleness({
        now,
        scheduledAt: null,
        createdAt: "2026-09-15T01:00:00.000Z",
        status: "open",
      }).band
    ).toBe("fresh");
  });

  it("detects incomplete pictures without hardcoded account names", () => {
    expect(
      assessPictureCompleteness({
        items: [{ title: "CODEX DRIVER MOBILE E2E — SAFE TO ARCHIVE", staleness: "very_old", category: "follow_up" }],
        campaignRemaining: 0,
        macroGoalKnown: true,
      }).reason
    ).toBe("technical_test_only");
    expect(
      assessPictureCompleteness({
        items: [{ title: "Email the laundry manager", staleness: "very_old", category: "follow_up" }],
        campaignRemaining: 0,
        macroGoalKnown: true,
      }).reason
    ).toBe("stale_only");
    expect(isTechnicalTestTitle("Maybourne Beverly hills")).toBe(false);
  });

  it("parses flexible vs exact vs unscheduled timing", () => {
    const now = new Date("2026-09-15T03:00:00.000Z");
    expect(parseScheduleFromUtterance("Tomorrow at 10 AM", now).kind).toBe("EXACT_TIME");
    expect(parseScheduleFromUtterance("Tuesday.", now).kind).toBe("DAY");
    expect(parseScheduleFromUtterance("Not tonight. This week when convenient.", now).kind).toBe(
      "FLEXIBLE_WINDOW"
    );
    expect(parseScheduleFromUtterance("I need to research Zeely.", now).kind).toBe("UNSCHEDULED");
  });

  it("blocks consequential money sends and allows incomplete research", () => {
    const critical = assessAmbiguity("Send her the money.");
    expect(critical.kind).toBe("critical");
    expect(critical.blocksExecution).toBe(true);
    expect(critical.missingDetails).toEqual(expect.arrayContaining(["recipient", "amount"]));
    const research = assessAmbiguity("I need to research Zeely and the other options.");
    expect(research.kind).toBe("non_critical");
    expect(research.blocksExecution).toBe(false);
    expect(research.missingDetails.length).toBeGreaterThan(0);
  });

  it("heuristically distinguishes update vs fyi without freezing new work", () => {
    expect(classifyIntentHeuristics("Move the Greystar visits to sometime this week.")).toBe(
      "update_existing_work"
    );
    expect(classifyIntentHeuristics("Russell is frustrated about growth.")).toBe("fyi_context");
    expect(classifyIntentHeuristics("I need to research Zeely.")).toBe("new_work");
  });

  it("ranks overdue follow-up ahead of optional improvement", () => {
    expect(
      prioritizeCategory({
        category: "overdue_commitment",
        staleness: "very_old",
        permissionLevel: "APPROVAL_REQUIRED",
      })
    ).toBeLessThan(
      prioritizeCategory({
        category: "optional_improvement",
        staleness: "fresh",
        permissionLevel: "AUTO",
      })
    );
  });

  it("extracts operator-attested field outcomes without promoting hearsay", () => {
    const outcome = extractConversationalFieldOutcome(
      "Dana wasn't there. Front desk said she's usually in later than ten. I left the flyer."
    );
    expect(outcome?.visitOccurred).toBe(true);
    expect(outcome?.decisionMakerReached).toBe(false);
    expect(outcome?.collateralDelivered).toBe(true);
    expect(outcome?.hearsay.join(" ")).toMatch(/front desk said/i);
    expect(outcome?.attestedFacts.join(" ")).not.toMatch(/confirmed schedule/i);
  });

  it("mobile and desktop share one operator key", () => {
    expect(claireOperatorKey("default", "adam-admin")).toBe("default:adam-admin");
  });
});
