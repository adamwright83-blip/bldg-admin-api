import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MitchExecutionHandback } from "../../shared/mitchContracts";
import { MitchGameDispatcher } from "./mitchDispatcher";
import {
  InvalidQaPassAttestationError,
  MitchQaService,
} from "./mitchQaService";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

const mockKingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
}));

vi.mock("../goldlineKingdoms/kingdomService", () => ({
  getKingdom: mockKingdoms.getKingdom,
}));

describe("Mitch v1 — PR3: Exact Builds, Gameplay QA, Issue/Retest & Production Reasoning Loop", () => {
  let store: MitchProductionStore;
  let productionService: MitchProductionService;
  let dispatcher: MitchGameDispatcher;
  let qaService: MitchQaService;
  let reasoningService: MitchProductionReasoningService;

  const tenantId = "tenant-qa-1";
  const gameId = "kingdom.boreslay";
  const milestoneKey = "k2_entry_handshake";
  const build1Sha = "fa7123456789abcdef0123456789abcdef012345";
  const fixBuildSha = "bb998877665544332211aabbccddeeff00112233";

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new MitchProductionStore(true);
    productionService = new MitchProductionService(store);
    dispatcher = new MitchGameDispatcher(store);
    qaService = new MitchQaService(store);
    reasoningService = new MitchProductionReasoningService(store);

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

    await productionService.initializeOrLoadProductionState({
      tenantId,
      canonicalGameId: gameId,
    });

    await productionService.registerMilestone({
      tenantId,
      gameId,
      milestoneKey,
      sequence: 1,
      title: "Kingdom Two Canonical Entry",
      desiredPlayerVisibleResult: "Player enters Boreslay Duel safely",
      acceptanceCriteria: ["Validates unlock status before match rendering"],
    });
  });

  async function simulateImplementedBuild(buildId: string): Promise<string> {
    const order = await productionService.createWorkOrder({
      tenantId,
      gameId,
      milestoneKey,
      title: "Implement canonical entry",
      desiredPlayerVisibleResult: "Enter chapter",
      acceptanceCriteria: ["Validates unlock status"],
      canonConstraints: [],
      relevantDependencies: [],
      realBusinessEvidenceConstraints: [],
      baseBranch: "main",
      baseSha: "a38db7c86632d122795e621d9d81b1ea3c049382",
      requiredArtifact: "client/src/pages/GoldlineChapterHost.tsx",
      requiredTests: ["test.ts"],
    });

    await dispatcher.claimWorkOrder({
      tenantId,
      workOrderId: order.id,
      executorId: "test-executor",
    });

    const handback: MitchExecutionHandback = {
      branch: "feat/k2-entry",
      commitSha: buildId,
      exactBuildId: buildId,
      whatChanged: "Wired entry gate",
      testsActuallyRun: ["test.ts"],
      testsNotRun: [],
      previewLaunchInstructions: "Launch /goldline-chapter",
      evidence: {
        sourceCompiled: true,
        unitTestsPassed: true,
        buildCommitSha: buildId,
      },
      knownLimitations: "",
    };

    const result = await dispatcher.submitHandback({
      tenantId,
      workOrderId: order.id,
      executorId: "test-executor",
      handback,
    });

    return result.build.id;
  }

  describe("Gameplay QA Verification Gating", () => {
    it("ensures an implemented build is eligible for QA but NOT verified", async () => {
      const buildId = await simulateImplementedBuild(build1Sha);

      const gameState = await store.getProductionState(tenantId, gameId);
      expect(gameState?.currentAvailableBuildId).toBe(buildId);
      expect(gameState?.lastVerifiedBuildId).toBeNull(); // NOT VERIFIED!

      const milestone = await store.getMilestone(tenantId, gameId, milestoneKey);
      expect(milestone?.status).toBe("implemented");
      expect(milestone?.lastVerifiedBuildId).toBeNull();
    });

    it("rejects false QA pass attestations if game was not actually exercised", async () => {
      const buildId = await simulateImplementedBuild(build1Sha);
      const milestone = (await store.getMilestone(tenantId, gameId, milestoneKey))!;

      await expect(
        qaService.recordGameplayQaRun({
          tenantId,
          gameId,
          milestoneId: milestone.id,
          buildId,
          testerId: "qa-runner-1",
          scenario: "Open chapter page",
          expectedBehavior: "Render host",
          observedBehavior: "Rendered host",
          gameActuallyExercised: false, // Invariant: Cannot pass if not exercised!
          acceptancePassed: true,
          status: "passed",
          evidenceArtifact: "artifacts/test.log",
        })
      ).rejects.toThrow(InvalidQaPassAttestationError);
    });

    it("creates a durable issue on QA failure and refuses to advance verified build", async () => {
      const buildId = await simulateImplementedBuild(build1Sha);
      const milestone = (await store.getMilestone(tenantId, gameId, milestoneKey))!;

      const result = await qaService.recordGameplayQaRun({
        tenantId,
        gameId,
        milestoneId: milestone.id,
        buildId,
        testerId: "qa-runner-1",
        scenario: "Enter /goldline-chapter when kingdom-2 is locked",
        expectedBehavior: "Redirects back to /play safely",
        observedBehavior: "Hung indefinitely on white screen",
        gameActuallyExercised: true,
        acceptancePassed: false,
        status: "failed",
        evidenceArtifact: "artifacts/repro-hang.png",
      });

      expect(result.qaRun.status).toBe("failed");
      expect(result.issue).toBeDefined();
      expect(result.issue?.status).toBe("open");

      // Invariant: Verified build does NOT advance!
      const gameState = await store.getProductionState(tenantId, gameId);
      expect(gameState?.lastVerifiedBuildId).toBeNull();
      expect(gameState?.lifecycleState).toBe("fix_needed");
    });

    it("advances verified build pointer on independent QA pass", async () => {
      const buildId = await simulateImplementedBuild(build1Sha);
      const milestone = (await store.getMilestone(tenantId, gameId, milestoneKey))!;

      const result = await qaService.recordGameplayQaRun({
        tenantId,
        gameId,
        milestoneId: milestone.id,
        buildId,
        testerId: "qa-runner-1",
        scenario: "Full entry verification under active Kingdom Two",
        expectedBehavior: "Renders FirstChapter component with 2.5D controls",
        observedBehavior: "Verified full 3-room loop with responsive controls",
        gameActuallyExercised: true,
        acceptancePassed: true,
        status: "passed",
        evidenceArtifact: "artifacts/playwright-trace.zip",
      });

      expect(result.qaRun.status).toBe("passed");
      expect(result.verifiedBuild?.isVerified).toBe(true);

      // Invariant: Verified build advances!
      const gameState = await store.getProductionState(tenantId, gameId);
      expect(gameState?.lastVerifiedBuildId).toBe(buildId);
      expect(gameState?.lifecycleState).toBe("playable_candidate");

      const updatedMilestone = await store.getMilestone(tenantId, gameId, milestoneKey);
      expect(updatedMilestone?.status).toBe("verified");
      expect(updatedMilestone?.lastVerifiedBuildId).toBe(buildId);
    });
  });

  describe("Fix / Retest Invariant", () => {
    it("submitting a code fix does NOT close the issue until an independent retest passes", async () => {
      const buildId = await simulateImplementedBuild(build1Sha);
      const milestone = (await store.getMilestone(tenantId, gameId, milestoneKey))!;

      // 1. Fail QA
      const { issue } = await qaService.recordGameplayQaRun({
        tenantId,
        gameId,
        milestoneId: milestone.id,
        buildId,
        testerId: "qa-runner-1",
        scenario: "Redirect on locked",
        expectedBehavior: "Redirect to /play",
        observedBehavior: "Threw 500 error",
        gameActuallyExercised: true,
        acceptancePassed: false,
        status: "failed",
        evidenceArtifact: "artifacts/error.log",
      });

      expect(issue?.status).toBe("open");

      // 2. Submit code fix
      // Register fix build first
      await store.recordBuild({
        id: fixBuildSha,
        tenantId,
        gameId,
        workOrderId: "fix-order-uuid-1",
        executionRunId: "fix-run-uuid-1",
        commitSha: fixBuildSha,
        branch: "fix/k2-redirect-repair",
        buildArtifactType: "git_commit",
        buildArtifactId: fixBuildSha,
        sourceCompiled: true,
        unitTestsPassed: true,
        isVerified: false,
        verifiedAt: null,
        createdAt: new Date().toISOString(),
      });

      const fixSubmittedIssue = await qaService.submitCodeFix({
        tenantId,
        issueId: issue!.id,
        fixWorkOrderId: "fix-order-uuid-1",
        fixBuildId: fixBuildSha,
      });

      // INVARIANT: Code fix alone DOES NOT close the issue!
      expect(fixSubmittedIssue.status).toBe("fix_submitted");
      expect(fixSubmittedIssue.closedAt).toBeNull();

      const stateBeforeRetest = await store.getProductionState(tenantId, gameId);
      expect(stateBeforeRetest?.lastVerifiedBuildId).toBeNull(); // Still unverified!

      // 3. Independent retest against the new exact fix build
      const retestResult = await qaService.recordGameplayQaRun({
        tenantId,
        gameId,
        milestoneId: milestone.id,
        buildId: fixBuildSha, // Exact newer build!
        testerId: "qa-runner-2", // Independent tester
        scenario: "Retest locked redirect on new build",
        expectedBehavior: "Redirects to /play",
        observedBehavior: "Successfully redirected",
        gameActuallyExercised: true,
        acceptancePassed: true,
        status: "passed",
        evidenceArtifact: "artifacts/retest-passed.zip",
        issueId: issue!.id,
        previousFailedQaRunId: issue!.originatingQaRunId,
      });

      // INVARIANT: Issue closes ONLY after independent retest passes!
      expect(retestResult.closedIssue).toBeDefined();
      expect(retestResult.closedIssue?.status).toBe("closed");
      expect(retestResult.closedIssue?.closedAt).not.toBeNull();

      // Verified build now advances to the fix build!
      const stateAfterRetest = await store.getProductionState(tenantId, gameId);
      expect(stateAfterRetest?.lastVerifiedBuildId).toBe(fixBuildSha);
    });
  });

  describe("Mitch Production Reasoning Loop (The 10 Questions)", () => {
    it("answers all 10 core production questions deterministically", async () => {
      // 1. Initial state: incomplete milestone ready to dispatch
      const inspection1 = await reasoningService.inspectProductionState(tenantId, gameId);
      expect(inspection1.gameId).toBe(gameId);
      expect(inspection1.incompleteMilestone?.milestoneKey).toBe(milestoneKey);
      expect(inspection1.nextBoundedOutcome.recommendedAction).toBe("dispatch_implementation");

      // 2. Implementation returned: recommended action switches to perform_gameplay_qa!
      const buildId = await simulateImplementedBuild(build1Sha);
      const inspection2 = await reasoningService.inspectProductionState(tenantId, gameId);
      expect(inspection2.currentAvailableBuildId).toBe(buildId);
      expect(inspection2.lastVerifiedBuildId).toBeNull();
      expect(inspection2.nextBoundedOutcome.recommendedAction).toBe("perform_gameplay_qa");

      // 3. QA fails: recommended action switches to dispatch_fix before new work!
      const milestone = (await store.getMilestone(tenantId, gameId, milestoneKey))!;
      const { issue } = await qaService.recordGameplayQaRun({
        tenantId,
        gameId,
        milestoneId: milestone.id,
        buildId,
        testerId: "qa-1",
        scenario: "Entry test",
        expectedBehavior: "Pass",
        observedBehavior: "Fail",
        gameActuallyExercised: true,
        acceptancePassed: false,
        status: "failed",
        evidenceArtifact: "art.png",
      });

      const inspection3 = await reasoningService.inspectProductionState(tenantId, gameId);
      expect(inspection3.nextBoundedOutcome.recommendedAction).toBe("dispatch_fix");
      expect(inspection3.openIssues.length).toBe(1);

      // 4. Fix submitted: recommended action switches to retest_fix!
      await store.recordBuild({
        id: fixBuildSha,
        tenantId,
        gameId,
        workOrderId: "fix-wo",
        executionRunId: "fix-run",
        commitSha: fixBuildSha,
        branch: "fix/repair",
        buildArtifactType: "git_commit",
        buildArtifactId: fixBuildSha,
        sourceCompiled: true,
        unitTestsPassed: true,
        isVerified: false,
        verifiedAt: null,
        createdAt: new Date().toISOString(),
      });
      await qaService.submitCodeFix({
        tenantId,
        issueId: issue!.id,
        fixWorkOrderId: "fix-wo",
        fixBuildId: fixBuildSha,
      });

      const inspection4 = await reasoningService.inspectProductionState(tenantId, gameId);
      expect(inspection4.nextBoundedOutcome.recommendedAction).toBe("retest_fix");

      // 5. Retest passes: recommended action moves to game_complete / creative acceptance!
      await qaService.recordGameplayQaRun({
        tenantId,
        gameId,
        milestoneId: milestone.id,
        buildId: fixBuildSha,
        testerId: "qa-2",
        scenario: "Retest",
        expectedBehavior: "Pass",
        observedBehavior: "Pass",
        gameActuallyExercised: true,
        acceptancePassed: true,
        status: "passed",
        evidenceArtifact: "art.zip",
        issueId: issue!.id,
      });

      const inspection5 = await reasoningService.inspectProductionState(tenantId, gameId);
      expect(inspection5.lastVerifiedBuildId).toBe(fixBuildSha);
      expect(inspection5.nextBoundedOutcome.recommendedAction).toBe("ready_for_creative_acceptance");
    });

    it("stops and reports HUMAN CREATIVE DECISION REQUIRED when milestone is blocked by creative choice", async () => {
      // Add a milestone blocked by creative decision
      await productionService.registerMilestone({
        tenantId,
        gameId,
        milestoneKey: "k2_soundtrack_choice",
        sequence: 2,
        title: "Artistic Music Score Decision",
        desiredPlayerVisibleResult: "Orchestral audio theme",
        acceptanceCriteria: ["Score composed and accepted"],
        isHumanCreativeBlocker: true,
      });

      const milestone1 = (await store.getMilestone(tenantId, gameId, milestoneKey))!;
      // Mark milestone 1 verified so milestone 2 is the active incomplete one
      await store.saveMilestone({ ...milestone1, status: "verified" });

      const inspection = await reasoningService.inspectProductionState(tenantId, gameId);
      expect(inspection.blockers.isHumanCreativeBlocker).toBe(true);
      expect(inspection.blockers.reason).toBe("HUMAN CREATIVE DECISION REQUIRED");
      expect(inspection.nextBoundedOutcome.recommendedAction).toBe("stop_human_creative_decision");
      expect(inspection.nextBoundedOutcome.readyToDispatch).toBe(false);
    });
  });
});
