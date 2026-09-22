import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { WeeklyGrowthCandidate } from "../../../shared/weeklyGrowthCandidates";
import { remainingWeekHorizon, type WeeklyDossierFact } from "../../../shared/weeklyMissionReadiness";
import { draftFromDossier, loadWeeklyDossier } from "./dossier";
import { acceptPlanningDecision } from "./planningDecision";
import { newWeeklySession } from "./session";

describe("loadWeeklyDossier", () => {
  it("includes a known Tuesday window and writes nothing", async () => {
    const writes: string[] = [];
    const horizon = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "15:10" });
    const tuesday: WeeklyDossierFact = {
      id: "day-director:jetro",
      class: "fixed_window",
      businessDate: "2026-09-22",
      title: "JETRO",
      scheduleLabel: "14:00",
      weekday: null,
      provenance: {
        reader: "dayDirector.getDayDirectorState",
        sourceType: "day_director",
        sourceIds: ["jetro"],
        quote: "JETRO Monday is wrong — this is Tuesday 14:00",
      },
    };
    const rule: WeeklyDossierFact = {
      id: "recurrence-rule:r1",
      class: "recurrence_rule",
      businessDate: null,
      title: "Plant print run",
      scheduleLabel: "09:00–10:00",
      weekday: "Thursday",
      provenance: {
        reader: "workdayRecurrence.listActiveRecurrenceRules",
        sourceType: "recurrence_rule",
        sourceIds: ["r1"],
        quote: "Thursdays at the plant",
      },
    };
    const factsForDates = vi.fn(async () => {
      writes.push("read");
      return [tuesday, rule];
    });
    const dossier = await loadWeeklyDossier({ horizon }, { factsForDates });
    expect(writes).toEqual(["read"]);
    expect(factsForDates).toHaveBeenCalledWith(horizon.remainingDates);
    expect(dossier.writesBusinessTruth).toBe(false);
    expect(dossier.fixedConstraints).toEqual([
      { sourceRef: "day-director:jetro", title: "JETRO", businessDate: "2026-09-22", scheduleLabel: "14:00" },
      {
        sourceRef: "recurrence-rule:r1:2026-09-24",
        title: "Plant print run",
        businessDate: "2026-09-24",
        scheduleLabel: "09:00–10:00",
      },
    ]);
    expect(dossier.facts.find(fact => fact.id === "recurrence-rule:r1")?.businessDate).toBeNull();
    expect(dossier.facts.find(fact => fact.id === "recurrence-rule:r1:2026-09-24")?.businessDate).toBe("2026-09-24");
    expect(dossier.growthCandidates).toBeUndefined();
  });

  it("keeps a canonical growth option in the private hypothesis and off the draft", async () => {
    const horizon = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "15:10" });
    const candidate: WeeklyGrowthCandidate = {
      id: "growth-1",
      sourceKind: "unfinished_growth_work",
      motion: "account_acquisition",
      title: "Account Acquisition",
      objective: "Continue the acquisition motion already recorded",
      alreadyInFlight: false,
      observedDueDate: null,
      sourceRefs: [{ sourceKind: "unfinished_growth_work", sourceType: "growth_work", sourceId: "goal-1" }],
      provenance: {
        reader: "weeklyGrowthCandidates",
        sourceType: "growth_work",
        sourceIds: ["goal-1"],
        observedAt: "2026-09-21T15:10:00.000Z",
      },
      prep: { leadDays: 0, condition: null, feasibleWithinHorizon: true },
      fit: { pocketKind: "any", minimumMinutes: null },
      observedSignals: [],
      assumptions: [],
      confidence: "low",
      rankReasons: ["MACRO_GOAL_ALIGNED"],
    };
    const dossier = await loadWeeklyDossier(
      { horizon },
      { factsForDates: async () => [], growthCandidates: async () => [candidate] }
    );
    const { deriveInternalHypothesis } = await import("./dossier");
    const hypothesis = deriveInternalHypothesis(dossier);
    const draft = draftFromDossier(dossier);
    expect(hypothesis.summary).toMatch(/Account Acquisition/);
    expect(hypothesis.summary).toMatch(/not primaries/);
    expect(hypothesis.uncertainties.some(item => item.id === "growth-options")).toBe(true);
    expect(draft.days.every(day => day.primary == null)).toBe(true);
    expect(JSON.stringify(draft)).not.toContain("Account Acquisition");
    const session = newWeeklySession({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      dayDirectorActorId: "actor-1",
      weekStart: horizon.weekStart,
      draft,
    });
    const kept = acceptPlanningDecision(
      {
        act: "ASK",
        speech: "Account Acquisition is only an option. What owns Thursday?",
        draftDays: null,
      },
      { dossier, session, utterance: "The week is still open." }
    );
    expect(kept?.act).toBe("ASK");
    expect(kept?.speech).toMatch(/Account Acquisition/);
    const rejected = acceptPlanningDecision(
      {
        act: "ASK",
        speech: "What owns Thursday?",
        draftDays: [{ businessDate: horizon.remainingDates[0], primaryText: "Account Acquisition" }],
      },
      { dossier, session, utterance: "The week is still open." }
    );
    expect(rejected).toBeNull();
  });

  it("does not call a reader that projects recurrence", () => {
    const dossier = readFileSync(new URL("./dossier.ts", import.meta.url), "utf8");
    const readers = readFileSync(new URL("./productionReaders.ts", import.meta.url), "utf8");
    const planning = readFileSync(new URL("./planningDecision.ts", import.meta.url), "utf8");
    for (const source of [dossier, readers]) {
      expect(source).not.toMatch(/projectRecurrenceForDate\s*\(/);
      expect(source).not.toMatch(/loadDailyCommand\s*\(/);
      expect(source).not.toMatch(/\.insert\(/);
      expect(source).not.toMatch(/\.update\(/);
    }
    expect(readers).toMatch(/listActiveRecurrenceRules/);
    expect(readers).not.toMatch(/projectRecurrenceForDate/);
    expect(readers).toContain("loadWeeklyGrowthCandidates");
    expect(readers).not.toMatch(/ER_NO_SUCH_TABLE/);
    const weeklyModel = readFileSync(new URL("./weeklyModel.ts", import.meta.url), "utf8");
    const contracts = readFileSync(new URL("../../../shared/weeklyMissionReadiness.ts", import.meta.url), "utf8");
    for (const source of [dossier, readers, weeklyModel, contracts]) {
      expect(source).not.toMatch(/snapshotBuilder|missionSequencer/);
      expect(source).not.toMatch(/type WeeklyGrowthCandidate|growthCandidateBuilder/);
    }
    expect(dossier).toContain('from "../../../shared/weeklyGrowthCandidates"');
    expect(weeklyModel).toContain("growthCandidates: input.dossier.growthCandidates ?? []");
    const planningBody = planning.slice(planning.indexOf("function planningCorpus"), planning.indexOf("export function hypothesisCorpus"));
    expect(planningBody).not.toContain("growthCandidates");
    expect(planning).toContain("candidate.title");
  });
});
