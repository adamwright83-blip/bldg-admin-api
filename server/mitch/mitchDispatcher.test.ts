import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MitchExecutionHandback, MitchWorkOrder } from "../../shared/mitchContracts";
import {
  IMitchExecutionProvider,
  MitchGameDispatcher,
  MissingExecutionProviderError,
  StaleWorkerOverwrittenViolationError,
} from "./mitchDispatcher";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

const mockKingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
}));

vi.mock("../goldlineKingdoms/kingdomService", () => ({
  getKingdom: mockKingdoms.getKingdom,
}));

describe("Mitch v1 — PR2: Work-Order Dispatcher & Execution Runs / Leases", () => {
  let store: MitchProductionStore;
  let service: MitchProductionService;
  let dispatcher: MitchGameDispatcher;
  const tenantId = "tenant-dispatch-1";
  const gameId = "kingdom.boreslay";
  const milestoneKey = "k2_entry_handshake";

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new MitchProductionStore(true);
    service = new MitchProductionService(store);
    dispatcher = new MitchGameDispatcher(store);

    mockKingdoms.getKingdom.mockResolvedValue({
      id: "row-k2",
      tenantId,
      kingdomId: "kingdom-2-the-last-valet",
      sequence: 2,
      // Legacy stored title remains "The Last Valet" per docs/JOYSTICK_SYSTEM_MAP.md
      title: "The Last Valet",
      realCampaignId: "the-last-valet-recurring-account-pitch",
      fictionalFieldMission: "the-last-valet",
      lanternCityStatus: "active",
      driverDayRelevance: "Relevance",
      companionEarnedId: null,
      enablesKingdomId: "kingdom-3",
      capabilityRequirement: null,
      selectedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await service.initializeOrLoadProductionState({
      tenantId,
      canonicalGameId: gameId,
    });

    await service.registerMilestone({
      tenantId,
      gameId,
      milestoneKey,
      sequence: 1,
      title: "Kingdom Two Canonical Entry",
      desiredPlayerVisibleResult: "Player enters Boreslay Duel safely",
      acceptanceCriteria: ["Validates unlock status before match rendering"],
    });
  });

  async function createTestWorkOrder(): Promise<MitchWorkOrder> {
    return service.createWorkOrder({
      tenantId,
      gameId,
      milestoneKey,
      title: "Wire canonical entry check to Kingdom Two chapter host",
      desiredPlayerVisibleResult: "Driver can enter chapter when active",
      acceptanceCriteria: ["Validates canonical kingdom status before rendering host"],
      canonConstraints: ["Preserve single-URL driver constraint"],
      relevantDependencies: ["goldlineKingdoms.list"],
      realBusinessEvidenceConstraints: ["Never fabricate Greystar visit outcomes"],
      baseBranch: "main",
      baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
      requiredArtifact: "client/src/pages/GoldlineChapterHost.tsx",
      requiredTests: ["client/src/pages/driver/kingdomTwoEntry.test.ts"],
    });
  }

  describe("Durable Claim and Lease Semantics", () => {
    it("claims pending work order with an atomic lease", async () => {
      const order = await createTestWorkOrder();
      const claimed = await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-alice",
        leaseMs: 60_000,
      });

      expect(claimed).not.toBeNull();
      expect(claimed?.status).toBe("claimed");
      expect(claimed?.claimedBy).toBe("worker-alice");
      expect(claimed?.leaseExpiresAt).not.toBeNull();
      expect(claimed?.attemptCount).toBe(1);
    });

    it("prevents competing workers from claiming an already active leased order", async () => {
      const order = await createTestWorkOrder();
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-alice",
        leaseMs: 60_000,
      });

      // Worker Bob attempts to claim active unexpired order
      const bobClaim = await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-bob",
        leaseMs: 60_000,
      });

      expect(bobClaim).toBeNull();
    });

    it("allows renewal of an active lease before expiration", async () => {
      const order = await createTestWorkOrder();
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-alice",
        leaseMs: 10_000,
      });

      const renewed = await dispatcher.renewLease({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-alice",
        leaseMs: 60_000,
      });

      expect(renewed).toBe(true);
    });
  });

  describe("Safe Recovery and Stale Worker Overwrite Prevention", () => {
    it("allows a new worker to safely recover an expired claim", async () => {
      const order = await createTestWorkOrder();
      // Alice claims with expired lease (-10ms)
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-alice",
        leaseMs: -10,
      });

      // Bob claims expired order
      const bobClaim = await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-bob",
        leaseMs: 60_000,
      });

      expect(bobClaim).not.toBeNull();
      expect(bobClaim?.claimedBy).toBe("worker-bob");
      expect(bobClaim?.attemptCount).toBe(2);
    });

    it("rejects stale workers from overwriting work after lease expiry", async () => {
      const order = await createTestWorkOrder();
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-alice",
        leaseMs: -10, // expired
      });

      // Bob claims after Alice's lease expired
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-bob",
        leaseMs: 60_000,
      });

      // Stale Alice attempts to submit handback
      const handback: MitchExecutionHandback = {
        branch: "feat/k2-entry-alice",
        commitSha: "112233445566778899aabbccddeeff0011223344",
        exactBuildId: "112233445566778899aabbccddeeff0011223344",
        whatChanged: "Alice's stale changes",
        testsActuallyRun: ["test.ts"],
        testsNotRun: [],
        previewLaunchInstructions: "pnpm test",
        evidence: {},
        knownLimitations: "none",
      };

      await expect(
        dispatcher.submitHandback({
          tenantId,
          workOrderId: order.id,
          executorId: "worker-alice",
          handback,
        })
      ).rejects.toThrow(StaleWorkerOverwrittenViolationError);
    });
  });

  describe("Execution Handback & State Progression", () => {
    it("transitions work order to implementation_returned and records exact build", async () => {
      const order = await createTestWorkOrder();
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-bob",
        leaseMs: 60_000,
      });

      const handback: MitchExecutionHandback = {
        branch: "feat/k2-canonical-entry",
        commitSha: "998877665544332211aabbccddeeff0011223344",
        exactBuildId: "998877665544332211aabbccddeeff0011223344",
        whatChanged: "Wired canonical Kingdom Two check in GoldlineChapterHost",
        testsActuallyRun: ["client/src/pages/driver/kingdomTwoEntry.test.ts"],
        testsNotRun: [],
        previewLaunchInstructions: "Navigate to /goldline-chapter",
        evidence: { verifiedOnDisk: true },
        knownLimitations: "Requires unlocked kingdom in db",
      };

      const result = await dispatcher.submitHandback({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-bob",
        handback,
      });

      expect(result.workOrder.status).toBe("implementation_returned");
      expect(result.build.id).toBe("998877665544332211aabbccddeeff0011223344");
      expect(result.build.isVerified).toBe(false); // IMPLEMENTED ≠ VERIFIED!

      // Milestone updated with available build, verified build stays null
      const milestone = await store.getMilestone(tenantId, gameId, milestoneKey);
      expect(milestone?.currentAvailableBuildId).toBe(result.build.id);
      expect(milestone?.lastVerifiedBuildId).toBeNull();

      // Game state updated with available build, verified build stays null
      const gameState = await store.getProductionState(tenantId, gameId);
      expect(gameState?.currentAvailableBuildId).toBe(result.build.id);
      expect(gameState?.lastVerifiedBuildId).toBeNull();
      expect(gameState?.lifecycleState).toBe("exact_build_available");
    });
  });

  describe("Hard Execution-Provider Rule", () => {
    it("fails closed with MissingExecutionProviderError naming missing capabilities when no provider exists", async () => {
      const order = await createTestWorkOrder();

      await expect(
        dispatcher.dispatchAutonomous({
          tenantId,
          workOrderId: order.id,
        })
      ).rejects.toThrow(MissingExecutionProviderError);

      try {
        await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });
      } catch (err) {
        const error = err as MissingExecutionProviderError;
        expect(error.missingProviderName).toBe("AutonomousRuntimeCodingAgentProvider");
        expect(error.requiredInterface).toBe("IMitchExecutionProvider");
        expect(error.requiredCapabilities.length).toBeGreaterThanOrEqual(5);
      }
    });

    it("dispatches successfully when an authorized runtime provider is registered", async () => {
      const order = await createTestWorkOrder();

      const mockProvider: IMitchExecutionProvider = {
        id: "mock-runtime-agent",
        name: "MockRuntimeAgentProvider",
        isAvailable: async () => true,
        executeWorkOrder: async (wo: MitchWorkOrder) => ({
          branch: "codex/k2-agent-branch",
          commitSha: "aabbccddeeff00112233445566778899aabbccdd",
          exactBuildId: "aabbccddeeff00112233445566778899aabbccdd",
          whatChanged: "Autonomous agent implemented milestone",
          testsActuallyRun: wo.requiredTests,
          testsNotRun: [],
          previewLaunchInstructions: "pnpm test",
          evidence: {},
          knownLimitations: "",
        }),
      };

      dispatcher.registerExecutionProvider(mockProvider);
      const result = await dispatcher.dispatchAutonomous({
        tenantId,
        workOrderId: order.id,
      });

      expect(result.workOrder.status).toBe("implementation_returned");
      expect(result.build.id).toBe("aabbccddeeff00112233445566778899aabbccdd");
    });
  });
});
