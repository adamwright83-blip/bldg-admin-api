import { describe, expect, it } from "vitest";
import {
  assembleStrategicDiagnosis,
  type DiagnosisInput,
} from "./strategicDiagnosis";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
import { validateStrategicDiagnosis } from "./strategyDoctrine";
import { territoryForPoint } from "./marketContext";
import { diagnosisCandidates } from "./strategicCandidateAdapter";
import { rankMissionDirectorWork } from "../planning/missionDirector/rankableWork";
import { isClaireRoleFeedback } from "../../shared/claireRoleFeedback";
import { safeClaireBrainV3Fallback } from "../claire/turn/brainV3";
import { detectExplicitDaphnePreferenceCorrections } from "../agents/daphne/explicitPreferenceCorrection";
import {
  strategicCallAuthorizedNow,
  WEEKDAY_STRATEGIC_PLANNING_ACTION,
} from "../../shared/strategicCallAuthorization";
import {
  strategicScenarios,
  runStrategicScenario,
} from "./strategicStressScenarios";
import { sequenceDailyMissions } from "./missionSequencer";
import { deriveMatureRepeatCohort } from "./verticalTemplates/laundryCohortReader";
import type { PaidOrderEvent } from "../analytics/paidOrderLedger";

for (const scenario of strategicScenarios)
  it(`strategic stress: ${scenario.id}`, () => {
    const result = runStrategicScenario(scenario);
    expect(result.failures).toEqual([]);
  });
describe("Authority and provenance adversaries", () => {
  const base = () => structuredClone(strategicScenarios[0]!.input);
  it("rejects invented evidence IDs and unmeasurable missions", () => {
    const d = assembleStrategicDiagnosis(base(), defaultVerticalRegistry);
    d.actions[0]!.evidenceRefs = ["invented-citation"];
    d.actions[0]!.completionCondition = "";
    expect(validateStrategicDiagnosis(d)).toContain(
      `action:${d.actions[0]!.id}: invalid evidence reference`
    );
    expect(validateStrategicDiagnosis(d)).toContain(
      `action:${d.actions[0]!.id}: not measurable`
    );
  });
  it("never reads cross-tenant, stale, estimated, or future metrics as verified constraints", () => {
    for (const mutate of [
      (e: DiagnosisInput["evidence"][number]) => {
        e.tenantId = "other";
      },
      (e: DiagnosisInput["evidence"][number]) => {
        e.quality = "stale";
      },
      (e: DiagnosisInput["evidence"][number]) => {
        e.classification = "estimate";
      },
      (e: DiagnosisInput["evidence"][number]) => {
        e.capturedAt = "2027-01-01T00:00:00Z";
      },
    ]) {
      const input = base();
      input.metrics.contribution_per_order_cents = "negative-margin";
      const e: DiagnosisInput["evidence"][number] = {
        id: "negative-margin",
        tenantId: input.tenantId,
        source: "cost-ledger",
        value: -500,
        unit: "cents",
        capturedAt: input.now.toISOString(),
        classification: "verified",
        quality: "complete",
        description: "contribution",
      };
      mutate(e);
      input.evidence.push(e);
      expect(
        assembleStrategicDiagnosis(input, defaultVerticalRegistry)
          .primaryConstraint
      ).not.toBe("contribution");
    }
  });
  it("withholds invalid territory and high-value out-of-radius prospects", () => {
    const market = base().market;
    expect(
      territoryForPoint(market.territories, { lat: 41.6, lng: -93.6 })
    ).toBeNull();
    expect(
      territoryForPoint([{ ...market.territories[0]!, radiusMiles: -1 }], {
        lat: 34.05,
        lng: -118.25,
      })
    ).toBeNull();
  });
  it("preserves overdue obligations while surfacing strategic work", () => {
    const d = assembleStrategicDiagnosis(base(), defaultVerticalRegistry);
    const strategies = diagnosisCandidates(d, base().now);
    const existing = {
      ...strategies[0]!,
      id: "existing-obligation",
      sourceKind: "unfinished_growth_work" as const,
      motion: "continue_existing" as const,
      title: "Email overdue filing to the accountant",
      objective: "Email the completed filing and record the submission receipt",
      alreadyInFlight: true,
      observedDueDate: "2026-10-12",
    };
    const ranked = rankMissionDirectorWork({
      candidates: [strategies[0]!, existing],
      campaigns: [],
      campaignPrepReady: {},
      context: { businessDate: "2026-10-13", macroGoal: null, openTasks: [] },
      pockets: [],
      protectDiscretionary: false,
    });
    expect(ranked.status).toBe("ranked");
    if (ranked.status === "ranked")
      expect(ranked.primary.workId).toBe("existing-obligation");
  });
  it("treats Claire responsibility feedback as a durable style correction without granting mutation", () => {
    const text =
      "You're supposed to be the one proactively preparing the work.";
    expect(isClaireRoleFeedback(text)).toBe(true);
    expect(safeClaireBrainV3Fallback(text)).toMatchObject({
      act: "correction",
      workDisposition: "none",
      canonicalWork: null,
    });
    expect(detectExplicitDaphnePreferenceCorrections(text)).toContainEqual({
      preferenceKey: "proactive_initiative",
      value: "high",
      evidenceText: text,
    });
  });
  it("revokes weekday permission and never accepts Sunday consent as weekday consent", () => {
    const a = {
      tenantId: "tenant",
      canonicalOperatorId: "canonical",
      operatorUserId: "operator",
      channel: "call",
      exactAction: WEEKDAY_STRATEGIC_PLANNING_ACTION,
      allowedWeekdaysJson: [2],
      allowedLocalStart: "09:00",
      allowedLocalEnd: "10:00",
      timeZone: "America/Los_Angeles",
      dailyLimit: 1,
      sourceReference: "authenticated_app:receipt",
      authorizedByUserId: "operator",
      revokedAt: null,
    };
    const now = new Date("2026-10-13T16:30:00Z");
    expect(strategicCallAuthorizedNow(a, now)).toBe(true);
    expect(
      strategicCallAuthorizedNow({ ...a, revokedAt: new Date() }, now)
    ).toBe(false);
    expect(
      strategicCallAuthorizedNow(
        { ...a, exactAction: "claire.weekly_planning.call" },
        now
      )
    ).toBe(false);
    expect(
      strategicCallAuthorizedNow({ ...a, allowedWeekdaysJson: null }, now)
    ).toBe(false);
    expect(strategicCallAuthorizedNow(a, now, "America/Chicago")).toBe(false);
  });
  it("does not create legacy commitments merely because a strategy was selected", async () => {
    const result = await sequenceDailyMissions({
      tenantId: "tenant",
      actorId: "operator",
      businessDate: "2026-10-13",
      snapshot: { payload: { detectedGaps: [] } } as any,
    });
    expect(result.receipt.verifiedInStorage).toBe(false);
    expect(result.growthMissions).toEqual([]);
    expect(result.supportMissions).toEqual([]);
  });
  it("hides later outcomes and gives entrants a full 30-day repeat observation window", () => {
    const now = new Date("2026-10-13T16:00:00Z");
    const event = (date: string): PaidOrderEvent => ({
      source: "laundry_butler",
      eventKey: date,
      occurredAt: new Date(`${date}T12:00:00Z`),
      businessDate: date,
      cents: 3000,
      serviceType: "wash_fold",
      customerName: "Test",
      identity: {
        customerId: "c-1",
        source: "laundry_butler",
        phone: "3105551000",
      } as any,
    });
    const mature = deriveMatureRepeatCohort(
      [event("2026-08-20"), event("2026-09-12"), event("2026-11-01")],
      { now, timeZone: "America/Los_Angeles" }
    );
    expect(mature).toMatchObject({ cohort: 1, repeated: 1 });
    const notMature = deriveMatureRepeatCohort([event("2026-10-12")], {
      now,
      timeZone: "America/Los_Angeles",
    });
    expect(notMature.cohort).toBe(0);
  });
});
