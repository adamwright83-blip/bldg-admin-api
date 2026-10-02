import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  characterizeKingdomTwoCurrentState,
  KINGDOM_TWO_MILESTONE_INSTALL_DUEL,
  seedKingdomTwoProductionState,
} from "./kingdomTwoProduction";
import { MitchGameDispatcher } from "./mitchDispatcher";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import {
  HumanCreativeBlockerUnresolvedError,
  MitchProductionService,
} from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

// Mock kingdomService to supply canonical kingdoms
const mockKingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
}));

vi.mock("../goldlineKingdoms/kingdomService", () => ({
  getKingdom: mockKingdoms.getKingdom,
}));

describe("Mitch v1 — Kingdom Two Production Characterization & Truth Bounds", () => {
  let store: MitchProductionStore;
  let service: MitchProductionService;
  let dispatcher: MitchGameDispatcher;
  let reasoningService: MitchProductionReasoningService;

  const tenantId = "tenant-k2-truth";
  const canonicalGameId = "kingdom.boreslay";

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MitchProductionStore(true);
    service = new MitchProductionService(store);
    dispatcher = new MitchGameDispatcher(store);
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
          companionEarnedId: null, // Rook is first Companion from Colosseum, not Kingdom Two identity
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

  describe("Ontology & Naming Integrity (JOYSTICK_SYSTEM_MAP)", () => {
    it("characterizes Kingdom Two as kingdom.boreslay with playable minigame.boreslay_duel", () => {
      const char = characterizeKingdomTwoCurrentState();

      expect(char.canonicalGameId).toBe("kingdom.boreslay");
      expect(char.canonicalTitle).toBe("Boreslay");
      expect(char.playableMinigame).toBe("minigame.boreslay_duel");
      expect(char.storedRowId).toBeNull(); // Not kingdom-2-the-last-valet!

      // The Last Valet remains chapter content, not the Kingdom Two production record
      expect(char.chapterContentRelation.chapterId).toBe("the-last-valet");
      expect(char.chapterContentRelation.status).toContain("NOT the storage target");

      // Boreslay duel locations are mapped
      expect(char.playableGameLocations.duelEngine).toContain("rallyEngine.ts");
      expect(char.playableGameLocations.rallyComponent).toContain("RallyDemo.tsx");
      expect(char.playableGameLocations.publicBossDemo).toContain("PublicBoreslayDemo.tsx");

      // Flags that real campaign binding is not authored in code for Boreslay Duel
      expect(char.realCampaignBindingStatus.hasAuthoredBindingInCode).toBe(false);
    });

    it("attaches Mitch durable production state to kingdom.boreslay with title Boreslay, null business binding, and null build pointers", async () => {
      const state = await seedKingdomTwoProductionState({
        tenantId,
        store,
        service,
      });

      expect(state.gameId).toBe("kingdom.boreslay");
      expect(state.storedRowId).toBeNull(); // Must NOT link to kingdom-2-the-last-valet!
      expect(state.title).toBe("Boreslay");
      expect(state.realBusinessBinding).toBeNull();
      expect(state.companionDependency).toBeNull(); // NOT Rook
      // INVARIANT: No fake builds! Both pointers remain null!
      expect(state.currentAvailableBuildId).toBeNull();
      expect(state.lastVerifiedBuildId).toBeNull();

      const milestone = await store.getMilestone(
        tenantId,
        canonicalGameId,
        KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
      );
      expect(milestone?.status).toBe("blocked");
      expect(milestone?.currentAvailableBuildId).toBeNull();
      expect(milestone?.lastVerifiedBuildId).toBeNull();

      // Audit event regression check
      const auditEvents = await store.listAuditEvents(tenantId, canonicalGameId);
      const initEvent = auditEvents.find(e => e.eventType === "mitch_game_production_state_initialized");
      expect(initEvent?.gameId).toBe("kingdom.boreslay");
      expect(initEvent?.details.canonicalGameId).toBe("kingdom.boreslay");
      expect(initEvent?.details.storedRowId).toBeNull();
      expect(initEvent?.details.title).toBe("Boreslay");
      expect(initEvent?.details.realCampaignId).toBeNull();
    });
  });

  describe("Human Boundary & Missing Business Binding Stop Condition", () => {
    it("stops production reasoning at HUMAN CREATIVE DECISION REQUIRED without faking progress", async () => {
      await seedKingdomTwoProductionState({
        tenantId,
        store,
        service,
      });

      const inspection = await reasoningService.inspectProductionState(tenantId, canonicalGameId);

      expect(inspection.blockers.isHumanCreativeBlocker).toBe(true);
      expect(inspection.blockers.isBlocked).toBe(true);
      expect(inspection.blockers.reason).toBe("HUMAN CREATIVE DECISION REQUIRED");
      expect(inspection.nextBoundedOutcome.recommendedAction).toBe("stop_human_creative_decision");
      expect(inspection.nextBoundedOutcome.readyToDispatch).toBe(false);
      expect(inspection.nextBoundedOutcome.description).toContain("HUMAN CREATIVE DECISION REQUIRED");

      // Pointers remain unverified
      expect(inspection.currentAvailableBuildId).toBeNull();
      expect(inspection.lastVerifiedBuildId).toBeNull();
    });

    it("rejects work-order creation when human creative decision is required and leaves state un-dispatched", async () => {
      await seedKingdomTwoProductionState({
        tenantId,
        store,
        service,
      });

      // Attempting to create work order for a creatively blocked milestone must throw HumanCreativeBlockerUnresolvedError
      await expect(
        service.createWorkOrder({
          tenantId,
          gameId: canonicalGameId,
          milestoneKey: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey,
          title: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.title,
          desiredPlayerVisibleResult: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.desiredPlayerVisibleResult,
          acceptanceCriteria: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.acceptanceCriteria,
          canonConstraints: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.canonConstraints,
          relevantDependencies: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.relevantDependencies,
          realBusinessEvidenceConstraints: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.realBusinessEvidenceConstraints,
          baseBranch: "main",
          baseSha: "0000000000000000000000000000000000000000",
          requiredArtifact: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.requiredArtifact,
          requiredTests: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.requiredTests,
        })
      ).rejects.toThrow(HumanCreativeBlockerUnresolvedError);

      // Verify no work orders were created
      const workOrders = await store.listWorkOrders(tenantId, canonicalGameId);
      expect(workOrders).toHaveLength(0);

      // Verify milestone status remains blocked (not in_progress)
      const milestone = await store.getMilestone(
        tenantId,
        canonicalGameId,
        KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
      );
      expect(milestone?.status).toBe("blocked");

      // Verify game lifecycle state remains concept (not implementing)
      const gameState = await store.getProductionState(tenantId, canonicalGameId);
      expect(gameState?.lifecycleState).toBe("concept");
      expect(gameState?.currentAvailableBuildId).toBeNull();
      expect(gameState?.lastVerifiedBuildId).toBeNull();
    });
  });
});
