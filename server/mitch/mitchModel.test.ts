import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertValidBuildIdentity,
  isValidBuildIdentity,
  MITCH_LIFECYCLE_STATES,
} from "../../shared/mitchContracts";
import {
  AutonomousCustomerReleaseForbiddenError,
  AutonomousMainMergeForbiddenError,
  BlockedMilestoneWorkForbiddenError,
  CompetingWorkOrderError,
  HumanCreativeBlockerUnresolvedError,
  MitchProductionService,
  NonCanonicalGameError,
} from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

// Mock kingdomService to supply canonical kingdoms
const mockKingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
}));

vi.mock("../goldlineKingdoms/kingdomService", () => ({
  getKingdom: mockKingdoms.getKingdom,
}));

describe("Mitch v1 — PR1: Durable Production Model & Lifecycle Contracts", () => {
  let store: MitchProductionStore;
  let service: MitchProductionService;
  const tenantId = "tenant-proof-1";
  const canonicalKingdomId = "kingdom.boreslay";

  beforeEach(() => {
    vi.clearAllMocks();
    // Use forceMemoryMode so tests run fast, isolated and without network/DB dependencies
    store = new MitchProductionStore(true);
    service = new MitchProductionService(store);

    mockKingdoms.getKingdom.mockImplementation(async ({ tenantId: t, kingdomId: k }) => {
      if (k === "kingdom-2-the-last-valet") {
        return {
          id: "row-k2-123",
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

  describe("Foundational Rule: IMPLEMENTED ≠ VERIFIED ≠ CREATIVE-ACCEPTED ≠ RELEASED", () => {
    it("defines distinct non-overlapping lifecycle states across the pipeline", () => {
      expect(MITCH_LIFECYCLE_STATES).toContain("implementing");
      expect(MITCH_LIFECYCLE_STATES).toContain("exact_build_available");
      expect(MITCH_LIFECYCLE_STATES).toContain("qa_in_progress");
      expect(MITCH_LIFECYCLE_STATES).toContain("playable_candidate");
      expect(MITCH_LIFECYCLE_STATES).toContain("creatively_accepted");
      expect(MITCH_LIFECYCLE_STATES).toContain("released");
    });

    it("strictly separates current available build from last verified build", async () => {
      const state = await service.initializeOrLoadProductionState({
        tenantId,
        canonicalGameId: canonicalKingdomId,
      });

      expect(state.currentAvailableBuildId).toBeNull();
      expect(state.lastVerifiedBuildId).toBeNull();

      // Advancing available build must NOT advance verified build
      const updated = await store.saveProductionState({
        ...state,
        currentAvailableBuildId: "c4f6912891d4e082877a5b1fe59df4e565989182",
      });

      expect(updated.currentAvailableBuildId).toBe("c4f6912891d4e082877a5b1fe59df4e565989182");
      expect(updated.lastVerifiedBuildId).toBeNull(); // Still unverified!
    });
  });

  describe("Canonical Game Identity Integrity", () => {
    it("attaches production state to existing canonical Kingdom Two without duplicating the entity", async () => {
      const state = await service.initializeOrLoadProductionState({
        tenantId,
        canonicalGameId: canonicalKingdomId,
        realBusinessBindingOverride: null,
      });

      expect(state.gameId).toBe("kingdom.boreslay");
      expect(state.storedRowId).toBeNull();
      expect(state.title).toBe("Boreslay");
      expect(state.realBusinessBinding).toBeNull();

      // Second load returns the same production state record
      const reloaded = await service.initializeOrLoadProductionState({
        tenantId,
        canonicalGameId: canonicalKingdomId,
      });

      expect(reloaded.id).toBe(state.id);
      expect(reloaded.realBusinessBinding).toBeNull();

      // Regression: audit event preserves semantic gameId and records storedRowId in details
      const auditEvents = await store.listAuditEvents(tenantId, canonicalKingdomId);
      expect(auditEvents).toHaveLength(1);
      const initEvent = auditEvents[0];
      expect(initEvent.eventType).toBe("mitch_game_production_state_initialized");
      expect(initEvent.gameId).toBe("kingdom.boreslay");
      expect(initEvent.details.canonicalGameId).toBe("kingdom.boreslay");
      expect(initEvent.details.storedRowId).toBeNull();
      expect(initEvent.details.title).toBe("Boreslay");
      expect(initEvent.details.realCampaignId).toBeNull();
    });

    it("fails closed when attempting to attach to a non-canonical game", async () => {
      await expect(
        service.initializeOrLoadProductionState({
          tenantId,
          canonicalGameId: "invented-fake-kingdom-99",
        })
      ).rejects.toThrow(NonCanonicalGameError);
    });
  });

  describe("Build Identity Rule", () => {
    it("rejects synthetic semver strings like K2-0.8.14 or v1.0.0", () => {
      expect(isValidBuildIdentity("K2-0.8.14")).toBe(false);
      expect(isValidBuildIdentity("v1.0.0")).toBe(false);
      expect(isValidBuildIdentity("2.0.1")).toBe(false);
      expect(() => assertValidBuildIdentity("K2-0.8.14")).toThrow(/Invalid build identity/);
    });

    it("accepts real commit SHAs, preview URLs, and artifact IDs", () => {
      expect(isValidBuildIdentity("a38db7c86632d122795e621d9d81b1ea3c049382")).toBe(true);
      expect(isValidBuildIdentity("a38db7c")).toBe(true);
      expect(isValidBuildIdentity("https://preview-k2.bldg.chat/launch/xyz123")).toBe(true);
      expect(isValidBuildIdentity("artifact-k2-build-8899aabbcc")).toBe(true);
    });
  });

  describe("Work-Order Contract Integrity", () => {
    beforeEach(async () => {
      await service.initializeOrLoadProductionState({
        tenantId,
        canonicalGameId: canonicalKingdomId,
      });

      await service.registerMilestone({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_entry_handshake",
        sequence: 1,
        title: "Kingdom Two Canonical Entry Handshake",
        desiredPlayerVisibleResult: "Player can access Boreslay Duel when Kingdom Two is unlocked in goldlineKingdoms",
        acceptanceCriteria: [
          "Accessing Boreslay Duel succeeds when kingdom.boreslay is active",
          "Accessing Boreslay Duel is rejected when kingdom.boreslay is locked",
        ],
      });
    });

    it("records exact base branch, base SHA, and explicit acceptance criteria", async () => {
      const order = await service.createWorkOrder({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_entry_handshake",
        title: "Wire canonical entry check to Kingdom Two chapter host",
        desiredPlayerVisibleResult: "Driver can enter chapter when active",
        acceptanceCriteria: ["Validates canonical kingdom status before rendering host"],
        canonConstraints: ["Preserve single-URL driver constraint", "No fake local storage auth"],
        relevantDependencies: ["goldlineKingdoms.list", "GoldlineChapterHost.tsx"],
        realBusinessEvidenceConstraints: ["Never fabricate Greystar visit outcomes"],
        baseBranch: "main",
        baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
        requiredArtifact: "client/src/pages/GoldlineChapterHost.tsx",
        requiredTests: ["client/src/pages/driver/kingdomTwoEntry.test.ts"],
      });

      expect(order.baseBranch).toBe("main");
      expect(order.baseSha).toBe("a38db7c86632d122795e621d9d81b1ea3c049382");
      expect(order.status).toBe("pending");
      expect(order.acceptanceCriteria.length).toBeGreaterThan(0);
    });

    it("prevents competing active work orders for the same milestone", async () => {
      await service.createWorkOrder({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_entry_handshake",
        title: "Order 1",
        desiredPlayerVisibleResult: "Result 1",
        acceptanceCriteria: ["Criterion 1"],
        canonConstraints: [],
        relevantDependencies: [],
        realBusinessEvidenceConstraints: [],
        baseBranch: "main",
        baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
        requiredArtifact: "test-art",
        requiredTests: ["test.ts"],
      });

      // Competing second order for the same milestone must throw CompetingWorkOrderError
      await expect(
        service.createWorkOrder({
          tenantId,
          gameId: canonicalKingdomId,
          milestoneKey: "k2_entry_handshake",
          title: "Order 2 (Competing)",
          desiredPlayerVisibleResult: "Result 2",
          acceptanceCriteria: ["Criterion 2"],
          canonConstraints: [],
          relevantDependencies: [],
          realBusinessEvidenceConstraints: [],
          baseBranch: "main",
          baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
          requiredArtifact: "test-art-2",
          requiredTests: ["test2.ts"],
        })
      ).rejects.toThrow(CompetingWorkOrderError);
    });

    it("rejects work order creation when milestone has isHumanCreativeBlocker", async () => {
      await service.registerMilestone({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_blocked_creative",
        sequence: 2,
        title: "Creative Blocked Milestone",
        desiredPlayerVisibleResult: "Something",
        acceptanceCriteria: ["Criteria"],
        isHumanCreativeBlocker: true,
        blockedReason: "HUMAN CREATIVE DECISION REQUIRED",
      });

      await expect(
        service.createWorkOrder({
          tenantId,
          gameId: canonicalKingdomId,
          milestoneKey: "k2_blocked_creative",
          title: "Order for Creative Blocked Milestone",
          desiredPlayerVisibleResult: "Something",
          acceptanceCriteria: ["Criteria"],
          canonConstraints: [],
          relevantDependencies: [],
          realBusinessEvidenceConstraints: [],
          baseBranch: "main",
          baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
          requiredArtifact: "art",
          requiredTests: ["test.ts"],
        })
      ).rejects.toThrow(HumanCreativeBlockerUnresolvedError);
    });

    it("rejects work order creation when milestone status is blocked and allows creation once explicitly resolved", async () => {
      await service.registerMilestone({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_blocked_operational",
        sequence: 3,
        title: "Operationally Blocked Milestone",
        desiredPlayerVisibleResult: "Something",
        acceptanceCriteria: ["Criteria"],
        isHumanCreativeBlocker: false,
        blockedReason: "Waiting on external dependency",
      });

      // Force status to blocked to test BlockedMilestoneWorkForbiddenError
      const m = await store.getMilestone(tenantId, canonicalKingdomId, "k2_blocked_operational");
      await store.saveMilestone({ ...m!, status: "blocked" });

      await expect(
        service.createWorkOrder({
          tenantId,
          gameId: canonicalKingdomId,
          milestoneKey: "k2_blocked_operational",
          title: "Order for Blocked Milestone",
          desiredPlayerVisibleResult: "Something",
          acceptanceCriteria: ["Criteria"],
          canonConstraints: [],
          relevantDependencies: [],
          realBusinessEvidenceConstraints: [],
          baseBranch: "main",
          baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
          requiredArtifact: "art",
          requiredTests: ["test.ts"],
        })
      ).rejects.toThrow(BlockedMilestoneWorkForbiddenError);

      // Now resolve the blocker explicitly
      await service.resolveMilestoneBlocker({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_blocked_operational",
        resolvedBy: "creative-director-adam",
        resolutionNote: "External dependency provided",
      });

      // Now work order creation succeeds!
      const order = await service.createWorkOrder({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_blocked_operational",
        title: "Order for Resolved Milestone",
        desiredPlayerVisibleResult: "Something",
        acceptanceCriteria: ["Criteria"],
        canonConstraints: [],
        relevantDependencies: [],
        realBusinessEvidenceConstraints: [],
        baseBranch: "main",
        baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
        requiredArtifact: "art",
        requiredTests: ["test.ts"],
      });

      expect(order.status).toBe("pending");
    });
  });

  describe("Interruption / Restart Durability", () => {
    it("preserves state across simulated store reload", async () => {
      await service.initializeOrLoadProductionState({
        tenantId,
        canonicalGameId: canonicalKingdomId,
      });

      await service.registerMilestone({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_m1",
        sequence: 1,
        title: "Milestone 1",
        desiredPlayerVisibleResult: "Visible result",
        acceptanceCriteria: ["Criteria 1"],
      });

      const milestones = await store.listMilestones(tenantId, canonicalKingdomId);
      expect(milestones).toHaveLength(1);
      expect(milestones[0].milestoneKey).toBe("k2_m1");

      const loadedState = await store.getProductionState(tenantId, canonicalKingdomId);
      expect(loadedState?.title).toBe("Boreslay");
    });
  });

  describe("Human Boundary & Evidence Invariants", () => {
    it("marks human creative blockers without inventing decisions", async () => {
      const milestone = await service.registerMilestone({
        tenantId,
        gameId: canonicalKingdomId,
        milestoneKey: "k2_m_creative",
        sequence: 2,
        title: "Artistic Music Score Decision",
        desiredPlayerVisibleResult: "Orchestral audio theme",
        acceptanceCriteria: ["Score composed and accepted"],
        isHumanCreativeBlocker: true,
      });

      expect(milestone.status).toBe("blocked");
      expect(milestone.isHumanCreativeBlocker).toBe(true);
      expect(milestone.blockedReason).toBe("HUMAN CREATIVE DECISION REQUIRED");
    });

    it("strictly forbids autonomous main merge", () => {
      expect(() => service.assertNoAutonomousMerge()).toThrow(AutonomousMainMergeForbiddenError);
    });

    it("strictly forbids autonomous customer release", () => {
      expect(() => service.assertNoAutonomousRelease()).toThrow(AutonomousCustomerReleaseForbiddenError);
    });
  });
});
