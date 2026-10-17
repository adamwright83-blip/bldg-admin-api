import { describe, expect, it } from "vitest";
import type { BehavioralLedgerEvent } from "../../drizzle/schema";
import type { CampaignChapter, CampaignChapterKind, CampaignInstance } from "../../shared/goldlineCampaign";
import { deriveCampaignChapterActionGrammar } from "../../shared/goldlineCampaignBindings";
import { behavioralSubjectFromGrammar } from "../../shared/behavioralSubject";
import { BEHAVIORAL_EXPERIMENT_POLICY_V1 } from "../../shared/behavioralExperimentPolicy";
import { freezeExperimentalOptionSet } from "../../shared/behavioralExperimentAssignment";
import { FICTION_ELIGIBILITY_CATALOG } from "../../shared/fictionEligibilityCatalog";
import { STANDARD_PRESENTATION } from "../../shared/behavioralInterventionMapping";
import type { BehavioralLedgerStore } from "../behavioralLedger/behavioralLedger";
import { expireUnfinishedPresentedChapters, recordPresentedChapterCompletions } from "./campaignChapterOutcomes";
import { assignAuthorizedPresentation, type PresentationRuntimePorts } from "./presentationRuntime";
import { loadPresentationAssignmentOutcomes, loadPresentationExperimentReport } from "./presentationOutcomes";

function memoryStore() {
  const rows: BehavioralLedgerEvent[] = [];
  const store: BehavioralLedgerStore = {
    async insertIfAbsent(input) {
      const prior = rows.find(row => row.tenantId === input.tenantId && row.idempotencyKey === input.idempotencyKey);
      if (prior) return prior;
      const row = { ...input, id: rows.length + 1, createdAt: new Date() } as BehavioralLedgerEvent;
      rows.push(row);
      return row;
    },
    async listByCorrelation(tenant, subject) { return rows.filter(row => row.tenantId === tenant && row.correlationId === subject); },
    async listByDecisionPoint(tenant, point) { return rows.filter(row => row.tenantId === tenant && row.decisionPointId === point); },
    async listByOperatorBounded(tenant, operators) { return rows.filter(row => row.tenantId === tenant && operators.includes(row.operatorUserId)).reverse(); },
  };
  return { rows, store };
}

function chapter(id: string, kind: CampaignChapterKind = "follow_up_branch", objective = `follow-up:${id}`): CampaignChapter {
  return { stableChapterId: id, chapterKind: kind, objectiveIds: [objective], required: false, hardAnchor: false,
    campaignPhase: "opening" as CampaignChapter["campaignPhase"], eligibleGameplayBindings: [],
    selectedGameplayBinding: "overland" as CampaignChapter["selectedGameplayBinding"], territoryId: null,
    fictionalTreatment: "", fictionTemplateId: null, physicalAnchors: [] };
}
function campaign(businessDate: string, chapters: CampaignChapter[], completedChapterIds: string[] = []): CampaignInstance {
  return { id: `campaign-${businessDate}`, tenantId: "t1", operatorId: "op1", businessDate, chapters, completedChapterIds,
    currentChapterId: chapters[0]?.stableChapterId ?? null } as CampaignInstance;
}

const at = (day: number, hour = 16) => new Date(Date.UTC(2026, 9, day, hour));

function runtime(store: BehavioralLedgerStore, chapters: Map<string, CampaignChapter>): PresentationRuntimePorts {
  return {
    store, randomInt: () => 1, policy: { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: true },
    loadConsent: async () => ({ adaptationAllowed: true, experimentationAllowed: true, evidenceRefs: ["consent"] }),
    loadDeclaredPlainPresentation: async () => null,
    loadGrammar: async scope => {
      const found = scope.occasionId ? chapters.get(scope.occasionId) : undefined;
      return found ? deriveCampaignChapterActionGrammar(found) : null;
    },
  };
}
async function present(ports: PresentationRuntimePorts, item: CampaignChapter, now: Date) {
  const grammar = deriveCampaignChapterActionGrammar(item)!;
  return assignAuthorizedPresentation({ tenantId: "t1", operatorUserId: "op1",
    correlationId: behavioralSubjectFromGrammar(grammar), occasionId: item.stableChapterId, now }, ports);
}

describe("which campaign chapters can enter the presentation experiment", () => {
  it("randomizes follow-up and recovery chapters with a baseline arm, and never a driving chapter", () => {
    const frozen = (kind: CampaignChapterKind) => freezeExperimentalOptionSet({
      grammar: deriveCampaignChapterActionGrammar(chapter("c", kind))!,
      registry: FICTION_ELIGIBILITY_CATALOG, policy: { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: true } });
    expect(frozen("follow_up_branch").distribution?.options).toEqual([STANDARD_PRESENTATION, "held-breath-v1", "spirit-human-rescue-v1"]);
    expect(frozen("recovery_branch").distribution?.options).toEqual([STANDARD_PRESENTATION, "ghost-echo-v1"]);
    for (const kind of ["visit_hunt", "territory_push", "opportunity_corridor"] as const)
      expect(frozen(kind)).toEqual({ distribution: null, skipReason: "driving_excluded" });
  });
});

describe("campaign chapter outcomes joined to presentation assignments", () => {
  it("records completion only for a presented chapter, carrying its frozen decision point", async () => {
    const { rows, store } = memoryStore();
    const presented = chapter("a");
    const unpresented = chapter("b");
    const ports = runtime(store, new Map([["a", presented]]));
    const chosen = await present(ports, presented, at(12));
    expect(chosen.usedExperiment).toBe(true);

    const before = campaign("2026-10-12", [presented, unpresented]);
    const after = campaign("2026-10-12", [presented, unpresented], ["a", "b"]);
    const written = await recordPresentedChapterCompletions({ before, after, observedAt: at(12, 17), store });
    await recordPresentedChapterCompletions({ before, after, observedAt: at(12, 18), store });
    expect(written).toHaveLength(1);
    expect(rows.filter(row => row.eventType === "COMPLETED")).toHaveLength(1);
    expect(written[0]).toMatchObject({ eventType: "COMPLETED", sourceSystem: "campaign_run", verificationClass: "CLAIMED",
      decisionPointId: chosen.assignment!.decisionPointId, assignedOption: chosen.assignment!.assignedOption });

    const [joined] = await loadPresentationAssignmentOutcomes({ tenantId: "t1", operatorUserId: "op1" }, store);
    expect(joined).toMatchObject({ decisionPointId: chosen.assignment!.decisionPointId, outcome: "completed" });
  });

  it("expires presented chapters of an earlier business day left unfinished, never today's or completed ones", async () => {
    const { store } = memoryStore();
    const done = chapter("done");
    const left = chapter("left");
    const today = chapter("today");
    const ports = runtime(store, new Map([["done", done], ["left", left], ["today", today]]));
    for (const item of [done, left, today]) await present(ports, item, at(12));
    const written = await expireUnfinishedPresentedChapters({
      priorCampaigns: [campaign("2026-10-12", [done, left], ["done"]), campaign("2026-10-13", [today])],
      today: "2026-10-13", observedAt: at(13, 9), store,
    });
    expect(written.map(row => row.sourceEntityId)).toEqual(["campaign-2026-10-12:left"]);
    expect(written[0]).toMatchObject({ eventType: "EXPIRED", provenance: "campaign_chapter_business_day_ended_unfinished" });
    const outcomes = await loadPresentationAssignmentOutcomes({ tenantId: "t1", operatorUserId: "op1" }, store);
    expect(outcomes.find(o => o.correlationId.endsWith("follow-up:left"))?.outcome).toBe("skipped");
    expect(outcomes.find(o => o.correlationId.endsWith("follow-up:today"))?.outcome).toBe("unknown");
  });

  it("closes the loop: two expired story chapters throttle the next chapter to a recorded baseline", async () => {
    const { rows, store } = memoryStore();
    const days = [chapter("d1"), chapter("d2"), chapter("d3", "recovery_branch", "recovery:d3")];
    const ports = runtime(store, new Map(days.map(item => [item.stableChapterId, item])));
    await present(ports, days[0], at(12));
    await present(ports, days[1], at(13));
    await expireUnfinishedPresentedChapters({ store, today: "2026-10-14", observedAt: at(14, 8), priorCampaigns: [
      campaign("2026-10-12", [days[0]]), campaign("2026-10-13", [days[1]]) ] });
    const third = await present(ports, days[2], at(14, 9));
    expect(third).toMatchObject({ usedExperiment: true, assignment: { availability: false,
      assignmentMechanism: "fatigue_throttle", assignedOption: STANDARD_PRESENTATION } });
    expect(rows.filter(row => row.eventType === "ASSIGNED").at(-1)?.provenance).toContain("burden_skip_threshold_exceeded");

    const report = await loadPresentationExperimentReport({ tenantId: "t1", operatorUserId: "op1", minSamplePerArm: 20 }, store);
    expect(report).toMatchObject({ kind: "observed_randomized_outcomes_by_arm", insufficientSample: true,
      causalProductClaim: "insufficient_evidence_for_a_causal_product_claim", unavailableDecisionCount: 1, assignmentCount: 2 });
  });
});
