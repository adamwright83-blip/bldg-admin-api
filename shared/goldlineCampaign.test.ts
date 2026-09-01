import { describe, expect, it } from "vitest";
import type { GoldlineObjective } from "./goldlineAdventure";
import {
  campaignGameEventContract,
  campaignInputFingerprint,
  campaignStableKey,
  stableCampaignChapterId,
  type TerritoryCampaignHint,
} from "./goldlineCampaign";
import { CAMPAIGN_ARCHETYPES, selectCampaignArchetype } from "./goldlineCampaignArchetypes";
import { compileGoldlineCampaign } from "./goldlineCampaignCompiler";
import { campaignEndingTreatment } from "./goldlineCampaignEndings";
import { goldlineObjectivesFromFieldToday } from "./goldlineCampaignObjectives";
import { campaignPacingFor } from "./goldlineCampaignPacing";
import {
  explainCampaignRevision,
  markChapterCompleted,
  recompileCampaignFuture,
} from "./goldlineCampaignRevisions";
import { arcadeLossIsGameOnly } from "./goldlineCampaignSetbacks";
import { stubCampaignTravel, travelFingerprint } from "./goldlineTravelTruth";
import type { CampaignInstance } from "./goldlineCampaign";
import {
  arcadePressureAllowed,
  campaignWorldRemainsPlayable,
  hostForBinding,
  projectStopsOntoCampaign,
  surfaceForCampaignHost,
} from "./goldlineCampaignRuntime";
import { deriveCampaignChapterActionGrammar } from "./goldlineCampaignBindings";

const item = (
  overrides: Partial<GoldlineObjective> & Pick<GoldlineObjective, "id">
): GoldlineObjective => ({
  id: overrides.id,
  physicalEntityId: null,
  kind: "follow_up",
  authority: "persisted_task",
  status: "ready",
  latitude: 34.05,
  longitude: -118.3,
  windowStart: null,
  windowEnd: null,
  priority: 1,
  explanation: "Persisted follow-up is due",
  sourceEvidenceReference: `task:${overrides.id}`,
  ...overrides,
});

const compile = (
  objectives: GoldlineObjective[],
  territories: TerritoryCampaignHint[] = [],
  extra: { obligationDue?: boolean; priorCampaignTitle?: string | null } = {}
) =>
  compileGoldlineCampaign({
    tenantId: "default",
    operatorId: "driver-1",
    businessDate: "2026-09-01",
    objectives,
    territories,
    obligationDue: extra.obligationDue,
    priorCampaignTitle: extra.priorCampaignTitle,
  });

describe("compileGoldlineCampaign", () => {
  it("does not invent objectives and excludes completed work", () => {
    const draft = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
      item({ id: "done", status: "completed", kind: "commercial_visit" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a" }),
    ]);
    const ids = draft.chapters.flatMap(chapter => chapter.objectiveIds);
    expect(ids).toContain("pickup");
    expect(ids).toContain("visit");
    expect(ids).not.toContain("done");
    expect(ids.every(id => ["pickup", "visit"].includes(id))).toBe(true);
  });

  it("is deterministic for the same operator/day inputs", () => {
    const objectives = [
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a" }),
    ];
    const a = compile(objectives);
    const b = compile(objectives);
    expect(a.stableKey).toBe(b.stableKey);
    expect(a.campaignArchetypeId).toBe(b.campaignArchetypeId);
    expect(a.chapters.map(chapter => chapter.selectedGameplayBinding)).toEqual(
      b.chapters.map(chapter => chapter.selectedGameplayBinding)
    );
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
  });

  it("names chapters from real membership, never array index", () => {
    const draft = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a" }),
    ]);
    expect(draft.chapters.length).toBeGreaterThan(0);
    for (const [index, chapter] of draft.chapters.entries()) {
      expect(chapter.stableChapterId).toBe(
        stableCampaignChapterId({
          businessDate: draft.businessDate,
          chapterKind: chapter.chapterKind,
          objectiveIds: chapter.objectiveIds,
          territoryId: chapter.territoryId,
        })
      );
      expect(chapter.stableChapterId).not.toBe(`${draft.businessDate}:${chapter.chapterKind}:${index}`);
    }
  });

  it("uses one stable key per tenant/day", () => {
    expect(
      campaignStableKey({ tenantId: "default", operatorId: "driver-1", businessDate: "2026-09-01" })
    ).toBe("campaign:default:2026-09-01:v1");
  });

  it("does not change fingerprint for camera or HUD noise", () => {
    const objectives = [item({ id: "pickup", authority: "fixed_commitment", kind: "pickup" })];
    const a = campaignInputFingerprint({
      tenantId: "default",
      operatorId: "driver-1",
      businessDate: "2026-09-01",
      objectives,
    });
    const b = campaignInputFingerprint({
      tenantId: "default",
      operatorId: "driver-1",
      businessDate: "2026-09-01",
      objectives,
    });
    expect(a).toBe(b);
  });

  it("honors fixed commitments as hard-anchor / expedition bindings", () => {
    const draft = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
    ]);
    expect(draft.chapters[0]?.hardAnchor).toBe(true);
    expect(draft.chapters[0]?.required).toBe(true);
    expect(draft.chapters[0]?.selectedGameplayBinding).toBe("expedition");
  });

  it("marks optional branches as skippable", () => {
    const draft = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a", latitude: 34.2, longitude: -118.2 }),
    ]);
    const optional = draft.chapters.find(chapter => !chapter.hardAnchor);
    expect(optional).toBeTruthy();
    expect(optional?.required).toBe(false);
  });

  it("does not fabricate a guardian finale before derived readiness", () => {
    const draft = compile(
      [item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a" })],
      [
        {
          territoryId: "t1",
          memberPhysicalEntityIds: ["p-a", "p-b"],
          confrontationReady: false,
          cleared: false,
        },
      ]
    );
    expect(draft.chapters.some(chapter => chapter.chapterKind === "guardian_finale")).toBe(false);
  });

  it("binds guardian finale only when confrontation-ready, without replacing the visit", () => {
    const draft = compile(
      [item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a" })],
      [
        {
          territoryId: "t1",
          memberPhysicalEntityIds: ["p-a"],
          confrontationReady: true,
          cleared: false,
        },
      ]
    );
    expect(draft.chapters.some(chapter => chapter.chapterKind === "guardian_finale")).toBe(true);
    expect(draft.chapters.some(chapter => chapter.objectiveIds.includes("visit"))).toBe(true);
    expect(
      draft.chapters.find(chapter => chapter.chapterKind === "guardian_finale")?.selectedGameplayBinding
    ).toBe("guardian_finale");
  });

  it("yields a quiet campaign when there is no ready work", () => {
    const draft = compile([item({ id: "done", status: "completed" })]);
    expect(draft.status).toBe("quiet");
    expect(draft.chapters).toEqual([]);
    expect(draft.title).toBe("OPEN SKY");
  });

  it("does not mark a Guardian-only campaign quiet", () => {
    const draft = compile(
      [],
      [
        {
          territoryId: "t1",
          memberPhysicalEntityIds: ["p-a"],
          confrontationReady: true,
          cleared: false,
        },
      ]
    );
    expect(draft.chapters.some(chapter => chapter.chapterKind === "guardian_finale")).toBe(true);
    expect(draft.status).not.toBe("quiet");
    expect(draft.status).toBe("authored");
    expect(draft.campaignArchetypeId).toBe("six_doors");
    expect(draft.title).not.toBe("OPEN SKY");
    expect(draft.currentChapterId).toBe(draft.chapters[0]!.stableChapterId);
  });

  it("carries yesterday's crown forward only when history supports it", () => {
    const draft = compile(
      [
        item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
        item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a" }),
      ],
      [],
      { priorCampaignTitle: "THE BROKEN CROWN" }
    );
    expect(draft.title).toBe("AFTER THE CROWN");
  });
});

describe("campaign archetypes", () => {
  it("ships six named archetypes", () => {
    expect(Object.keys(CAMPAIGN_ARCHETYPES)).toHaveLength(6);
    expect(CAMPAIGN_ARCHETYPES.broken_crown.name).toBe("THE BROKEN CROWN");
    expect(CAMPAIGN_ARCHETYPES.golden_circuit.name).toBe("GOLDEN CIRCUIT");
    expect(CAMPAIGN_ARCHETYPES.ghost_signal.name).toBe("GHOST SIGNAL");
    expect(CAMPAIGN_ARCHETYPES.six_doors.name).toBe("SIX DOORS");
    expect(CAMPAIGN_ARCHETYPES.last_window.name).toBe("LAST WINDOW");
    expect(CAMPAIGN_ARCHETYPES.open_sky.name).toBe("OPEN SKY");
  });

  it("selects LAST WINDOW for two real timed commitments", () => {
    expect(
      selectCampaignArchetype({
        objectives: [
          item({ id: "a", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
          item({ id: "b", authority: "fixed_commitment", kind: "delivery", windowStart: "2026-09-01T15:00:00Z" }),
        ],
      })
    ).toBe("last_window");
  });

  it("selects GHOST SIGNAL for recovery-heavy days", () => {
    expect(
      selectCampaignArchetype({
        objectives: [item({ id: "r", kind: "recovery" })],
      })
    ).toBe("ghost_signal");
  });
});

describe("campaign revisions", () => {
  const asInstance = (draft: ReturnType<typeof compile>): CampaignInstance => ({
    ...draft,
    id: "camp-1",
    revision: 1,
    createdAt: "2026-09-01T07:00:00Z",
    startedAt: null,
    completedAt: null,
  });

  it("does not revise when the fingerprint is unchanged", () => {
    const instance = asInstance(
      compile([item({ id: "pickup", authority: "fixed_commitment", kind: "pickup" })])
    );
    const { diff } = recompileCampaignFuture({
      instance,
      next: compile([item({ id: "pickup", authority: "fixed_commitment", kind: "pickup" })]),
    });
    expect(diff).toBeNull();
  });

  it("locks completed past and pins the active chapter while future changes", () => {
    const morning = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a", latitude: 34.2, longitude: -118.2 }),
      item({ id: "recover", kind: "recovery", physicalEntityId: "p-c", latitude: 34.3, longitude: -118.3 }),
    ]);
    let instance = asInstance(morning);
    const first = instance.chapters[0]!;
    instance = markChapterCompleted(instance, first.stableChapterId);
    const noon = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z", status: "completed" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a", latitude: 34.2, longitude: -118.2 }),
      item({ id: "recover", kind: "recovery", physicalEntityId: "p-c", latitude: 34.3, longitude: -118.3 }),
      item({
        id: "new-delivery",
        authority: "fixed_commitment",
        kind: "delivery",
        windowStart: "2026-09-01T15:00:00Z",
      }),
    ]);
    const { instance: revised, diff } = recompileCampaignFuture({ instance, next: noon });
    expect(revised.completedChapterIds).toContain(first.stableChapterId);
    expect(revised.chapters.some(chapter => chapter.stableChapterId === first.stableChapterId)).toBe(true);
    expect(revised.currentChapterId).toBe(instance.currentChapterId);
    expect(revised.campaignArchetypeId).toBe(instance.campaignArchetypeId);
    expect(revised.title).toBe(instance.title);
    expect(diff?.reasonCodes).toContain("NEW_FIXED_COMMITMENT");
    expect(revised.chapters.some(chapter => chapter.objectiveIds.includes("new-delivery"))).toBe(true);
    expect(explainCampaignRevision(diff)).toMatch(/fixed commitment/i);
  });

  it("absorbs a finished real chapter as history even without an explicit game complete", () => {
    const morning = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a", latitude: 34.2, longitude: -118.2 }),
    ]);
    const instance = asInstance(morning);
    const first = instance.chapters[0]!;
    const noon = compile([
      item({ id: "pickup", authority: "fixed_commitment", kind: "pickup", windowStart: "2026-09-01T09:00:00Z", status: "completed" }),
      item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a", latitude: 34.2, longitude: -118.2 }),
      item({
        id: "new-delivery",
        authority: "fixed_commitment",
        kind: "delivery",
        windowStart: "2026-09-01T15:00:00Z",
      }),
    ]);
    const { instance: revised, diff } = recompileCampaignFuture({ instance, next: noon });
    expect(revised.completedChapterIds).toContain(first.stableChapterId);
    expect(revised.chapters.some(chapter => chapter.stableChapterId === first.stableChapterId)).toBe(true);
    expect(revised.currentChapterId).not.toBe(first.stableChapterId);
    expect(revised.id).toBe(instance.id);
    expect(revised.title).toBe(instance.title);
    expect(diff?.reasonCodes).toEqual(
      expect.arrayContaining(["NEW_FIXED_COMMITMENT", "AUTHORITATIVE_ACTION_COMPLETED"])
    );
  });
});

describe("campaign game-event contract", () => {
  it("allows only game-projection campaign history", () => {
    expect(
      campaignGameEventContract({
        eventType: "campaign_published",
        classification: "game_projection",
        provenanceClass: "generated_game_fiction",
      })
    ).toBe(true);
    expect(
      campaignGameEventContract({
        eventType: "visited",
        classification: "action",
        provenanceClass: "operator_observed",
      })
    ).toBe(false);
    expect(
      campaignGameEventContract({
        eventType: "campaign_completed",
        classification: "outcome",
        provenanceClass: "generated_game_fiction",
      })
    ).toBe(false);
  });
});

describe("campaign supporting grammar", () => {
  it("maps FieldToday kinds without inventing rows", () => {
    const objectives = goldlineObjectivesFromFieldToday([
      {
        id: "pickup:1",
        kind: "pickup",
        status: "new",
        scheduledAt: "2026-09-01T16:00:00Z",
        source: { sourceReference: "orders:1" },
        destination: { latitude: 34.05, longitude: -118.3 },
      },
      {
        id: "noise",
        kind: "payment_blocker",
        status: "blocked",
        scheduledAt: null,
        source: { sourceReference: "orders:2" },
      },
    ]);
    expect(objectives.map(item => item.id)).toEqual(["pickup:1"]);
    expect(objectives[0]?.authority).toBe("fixed_commitment");
  });

  it("keeps arcade loss off the business clock", () => {
    expect(arcadeLossIsGameOnly().mutatesBusiness).toBe(false);
  });

  it("names a truthful ending without claiming a sale", () => {
    const ending = campaignEndingTreatment({
      draft: compile([item({ id: "done", status: "completed" })]),
      unresolvedFollowUp: true,
    });
    expect(ending.id).toBe("signal_continues");
    expect(ending.copy.toLowerCase()).not.toContain("won");
  });

  it("paces without adding work", () => {
    expect(campaignPacingFor(compile([item({ id: "done", status: "completed" })]))).toBe("quiet");
  });

  it("fingerprints travel without claiming unconfigured certainty", () => {
    const truth = stubCampaignTravel([
      {
        fromObjectiveId: "a",
        toObjectiveId: "b",
        durationSeconds: 900,
        distanceMeters: 4000,
        providerState: "test_stub",
        source: "test_stub",
      },
    ]);
    expect(travelFingerprint(truth)).toContain("test_stub");
    expect(truth.providerState).toBe("test_stub");
  });
});

describe("campaign runtime hosts", () => {
  it("binds chapters to existing engines instead of a second expedition", () => {
    expect(hostForBinding("expedition")).toBe("expedition");
    expect(hostForBinding("authoritative_visit_route")).toBe("authoritative_visit_route");
    expect(hostForBinding("local_target_run")).toBe("local_target_run");
    expect(hostForBinding("guardian_finale")).toBe("guardian_encounter");
  });

  it("keeps the world playable when the campaign is quiet", () => {
    expect(campaignWorldRemainsPlayable("quiet")).toBe(true);
    expect(campaignWorldRemainsPlayable("completed")).toBe(true);
  });

  it("silences arcade pressure while driving or in conversation sanctuary", () => {
    expect(arcadePressureAllowed({ driving: true, conversationSanctuary: false, binding: "guardian_finale" })).toBe(false);
    expect(arcadePressureAllowed({ driving: false, conversationSanctuary: true, binding: "encounter" })).toBe(false);
    expect(arcadePressureAllowed({ driving: false, conversationSanctuary: false, binding: "guardian_finale" })).toBe(true);
  });

  it("orders Day Plan stops from campaign chapters without inventing work", () => {
    const ordered = projectStopsOntoCampaign(
      [{ id: "living-world-visit" }, { id: "native-pickup-1" }, { id: "unrelated" }],
      [
        { objectiveIds: ["pickup:1"] },
        { objectiveIds: ["visit"] },
      ]
    );
    expect(ordered.map(item => item.id)).toEqual([
      "native-pickup-1",
      "living-world-visit",
      "unrelated",
    ]);
  });

  it("routes each binding to an existing driver surface instead of one operations dump", () => {
    expect(surfaceForCampaignHost("expedition")).toBe("operations");
    expect(surfaceForCampaignHost("recovery")).toBe("operations");
    expect(surfaceForCampaignHost("local_target_run")).toBe("open_channel");
    expect(surfaceForCampaignHost("field_journal")).toBe("field_journal");
    expect(surfaceForCampaignHost("guardian_finale")).toBe("guardian_encounter");
    expect(surfaceForCampaignHost("world_exploration")).toBe("overland");
    expect(surfaceForCampaignHost("territory_push")).toBe("overland");
  });
});

describe("campaign chapter action grammar", () => {
  it("describes recovery as RECOVER_FAILED_CONTACT so ghost-echo can bind", () => {
    const draft = compile([item({ id: "recovery:1", kind: "recovery" })]);
    const chapter = draft.chapters.find(entry => entry.chapterKind === "recovery_branch");
    expect(chapter?.fictionTemplateId).toBe("ghost-echo-v1");
    expect(deriveCampaignChapterActionGrammar(chapter!).kind).toBe("RECOVER_FAILED_CONTACT");
  });

  it("describes follow-up as FOLLOW_UP_PERSON so held-breath can bind", () => {
    const draft = compile([item({ id: "follow-up:88", kind: "follow_up" })]);
    const chapter = draft.chapters.find(entry => entry.chapterKind === "follow_up_branch");
    expect(chapter?.fictionTemplateId).toBe("held-breath-v1");
    expect(deriveCampaignChapterActionGrammar(chapter!).kind).toBe("FOLLOW_UP_PERSON");
  });

  it("describes a visit chapter as VISIT_LOCATION without requiring a frozen route", () => {
    const draft = compile([item({ id: "visit", kind: "commercial_visit", physicalEntityId: "p-a" })]);
    const chapter = draft.chapters.find(
      entry => entry.chapterKind === "visit_hunt" || entry.chapterKind === "opportunity_corridor"
    );
    expect(chapter?.fictionTemplateId).toBe("beacon-walk-v1");
    const grammar = deriveCampaignChapterActionGrammar(chapter!);
    expect(grammar?.kind).toBe("VISIT_LOCATION");
    expect(grammar?.sensitiveConversation).toBe(true);
  });

  it("does not invent WAIT_FOR_EVENT fiction over actionable field captures", () => {
    const draft = compile([item({ id: "capture:1", kind: "field_capture" })]);
    const chapter = draft.chapters.find(entry => entry.chapterKind === "open_channel");
    expect(chapter).toBeTruthy();
    expect(deriveCampaignChapterActionGrammar(chapter!)).toBeNull();
  });

  it("does not invent grammar for courier expeditions", () => {
    const draft = compile([
      item({
        id: "pickup:1",
        kind: "pickup",
        authority: "fixed_commitment",
        windowStart: "2026-09-01T09:00:00Z",
      }),
    ]);
    const chapter = draft.chapters.find(entry => entry.chapterKind === "expedition");
    expect(chapter).toBeTruthy();
    expect(deriveCampaignChapterActionGrammar(chapter!)).toBeNull();
  });
});
