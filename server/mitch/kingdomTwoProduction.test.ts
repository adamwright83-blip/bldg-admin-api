import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  characterizeKingdomTwoCurrentState,
  KINGDOM_TWO_MILESTONE_AUTHOR_BUSINESS_BINDING,
  KINGDOM_TWO_MILESTONE_INSTALL_DUEL,
  seedKingdomTwoProductionState,
} from "./kingdomTwoProduction";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

const mockKingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
}));

vi.mock("../goldlineKingdoms/kingdomService", () => ({
  getKingdom: mockKingdoms.getKingdom,
}));

describe("Mitch v1 — Kingdom Two Production Characterization & Truth Bounds", () => {
  let store: MitchProductionStore;
  let service: MitchProductionService;
  let reasoningService: MitchProductionReasoningService;

  const tenantId = "tenant-k2-truth";
  const canonicalGameId = "kingdom.boreslay";
  const exactBaseSha = "a".repeat(40);

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MitchProductionStore(true);
    service = new MitchProductionService(store);
    reasoningService = new MitchProductionReasoningService(store);

    mockKingdoms.getKingdom.mockImplementation(async ({ tenantId: t, kingdomId: k }) => {
      if (k === "kingdom-2-the-last-valet") {
        return {
          id: "row-k2",
          tenantId: t,
          kingdomId: "kingdom-2-the-last-valet",
          sequence: 2,
          title: "The Last Valet",
          realCampaignId: "the-last-valet-recurring-account-pitch",
          fictionalFieldMission: "the-last-valet",
          lanternCityStatus: "active",
          driverDayRelevance: "Relevance note",
          companionEarnedId: null,
          enablesKingdomId: "kingdom-3",
          capabilityRequirement: null,
          selectedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      return null;
    });
  });

  it("characterizes Kingdom Two as kingdom.boreslay with playable minigame.boreslay_duel", () => {
    const char = characterizeKingdomTwoCurrentState();

    expect(char.canonicalGameId).toBe("kingdom.boreslay");
    expect(char.canonicalTitle).toBe("Boreslay");
    expect(char.playableMinigame).toBe("minigame.boreslay_duel");
    expect(char.storedRowId).toBeNull();
    expect(char.chapterContentRelation.chapterId).toBe("the-last-valet");
    expect(char.chapterContentRelation.status).toContain("NOT the storage target");
    expect(char.playableGameLocations.duelEngine).toContain("rallyEngine.ts");
    expect(char.playableGameLocations.rallyComponent).toContain("RallyDemo.tsx");
    expect(char.realCampaignBindingStatus.hasAuthoredBindingInCode).toBe(false);
  });

  it("keeps business binding null while making technical installation independently executable", async () => {
    const state = await seedKingdomTwoProductionState({ tenantId, store, service });

    expect(state.gameId).toBe(canonicalGameId);
    expect(state.storedRowId).toBeNull();
    expect(state.title).toBe("Boreslay");
    expect(state.realBusinessBinding).toBeNull();
    expect(state.currentAvailableBuildId).toBeNull();
    expect(state.lastVerifiedBuildId).toBeNull();

    const install = await store.getMilestone(
      tenantId,
      canonicalGameId,
      KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
    );
    expect(install?.status).toBe("pending");
    expect(install?.isHumanCreativeBlocker).toBe(false);
    expect(install?.blockedReason).toBeNull();

    const binding = await store.getMilestone(
      tenantId,
      canonicalGameId,
      KINGDOM_TWO_MILESTONE_AUTHOR_BUSINESS_BINDING.milestoneKey
    );
    expect(binding?.status).toBe("blocked");
    expect(binding?.isHumanCreativeBlocker).toBe(true);
    expect(binding?.blockedReason).toContain("HUMAN CREATIVE DECISION REQUIRED");
  });

  it("dispatches the bounded install before stopping for the separate creative binding decision", async () => {
    await seedKingdomTwoProductionState({ tenantId, store, service });

    const before = await reasoningService.inspectProductionState(tenantId, canonicalGameId);
    expect(before.incompleteMilestone?.milestoneKey).toBe(
      KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
    );
    expect(before.blockers.isBlocked).toBe(false);
    expect(before.nextBoundedOutcome.recommendedAction).toBe("dispatch_implementation");
    expect(before.nextBoundedOutcome.readyToDispatch).toBe(true);

    const order = await service.createWorkOrder({
      tenantId,
      gameId: canonicalGameId,
      milestoneKey: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey,
      title: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.title,
      desiredPlayerVisibleResult: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.desiredPlayerVisibleResult,
      acceptanceCriteria: [...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.acceptanceCriteria],
      canonConstraints: [...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.canonConstraints],
      relevantDependencies: [...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.relevantDependencies],
      realBusinessEvidenceConstraints: [
        ...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.realBusinessEvidenceConstraints,
      ],
      baseBranch: "main",
      baseSha: exactBaseSha,
      requiredArtifact: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.requiredArtifact,
      requiredTests: [...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.requiredTests],
    });

    expect(order.status).toBe("pending");
    expect(order.baseSha).toBe(exactBaseSha);
    expect((await store.getProductionState(tenantId, canonicalGameId))?.realBusinessBinding).toBeNull();

    const install = await store.getMilestone(
      tenantId,
      canonicalGameId,
      KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
    );
    if (!install) throw new Error("install milestone missing");
    await store.saveMilestone({ ...install, status: "verified" });

    // Complete the synthetic active work-order state so reasoning can advance
    // to the next authored milestone in this isolated unit test.
    await store.failWorkOrder({
      tenantId,
      workOrderId: order.id,
      error: "test-only terminalization after verified milestone",
    });

    const after = await reasoningService.inspectProductionState(tenantId, canonicalGameId);
    expect(after.incompleteMilestone?.milestoneKey).toBe(
      KINGDOM_TWO_MILESTONE_AUTHOR_BUSINESS_BINDING.milestoneKey
    );
    expect(after.blockers.isHumanCreativeBlocker).toBe(true);
    expect(after.nextBoundedOutcome.recommendedAction).toBe(
      "stop_human_creative_decision"
    );
    expect(after.nextBoundedOutcome.readyToDispatch).toBe(false);
  });

  it("reclassifies only the exact legacy install blocker and preserves an audit trail", async () => {
    await service.initializeOrLoadProductionState({
      tenantId,
      canonicalGameId,
      titleOverride: "Boreslay",
      realBusinessBindingOverride: null,
    });
    await service.registerMilestone({
      tenantId,
      gameId: canonicalGameId,
      milestoneKey: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey,
      sequence: 1,
      title: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.title,
      desiredPlayerVisibleResult: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.desiredPlayerVisibleResult,
      acceptanceCriteria: [...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.acceptanceCriteria],
      blockedReason:
        "HUMAN CREATIVE DECISION REQUIRED: Real-business growth campaign binding for kingdom.boreslay / minigame.boreslay_duel must be decided by human creative authority (Adam).",
      isHumanCreativeBlocker: true,
    });

    await seedKingdomTwoProductionState({ tenantId, store, service });

    const install = await store.getMilestone(
      tenantId,
      canonicalGameId,
      KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
    );
    expect(install?.status).toBe("pending");
    expect(install?.isHumanCreativeBlocker).toBe(false);
    expect(install?.blockedReason).toBeNull();

    const audit = await store.listAuditEvents(tenantId, canonicalGameId);
    expect(
      audit.some(event => event.eventType === "mitch_legacy_blocker_reclassified")
    ).toBe(true);
  });
});
