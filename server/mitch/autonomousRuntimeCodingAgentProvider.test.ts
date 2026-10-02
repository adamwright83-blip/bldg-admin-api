import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MitchWorkOrder } from "../../shared/mitchContracts";
import {
  assertValidBuildIdentity,
  isValidBuildIdentity,
} from "../../shared/mitchContracts";
import {
  AutonomousProviderUnavailableError,
  AutonomousRuntimeCodingAgentProvider,
  AutonomousRuntimeCodingAgentProviderOptions,
  BaseCommitShaMismatchError,
  ExecutionTimeoutError,
  isPathProtected,
  NoCommitProducedError,
  ScopeViolationError,
  TestExecutionFailedError,
} from "./autonomousRuntimeCodingAgentProvider";
import {
  MitchGameDispatcher,
  MissingExecutionProviderError,
  StaleWorkerOverwrittenViolationError,
} from "./mitchDispatcher";
import { MitchQaService } from "./mitchQaService";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

const mockKingdoms = vi.hoisted(() => ({
  getKingdom: vi.fn(),
}));

vi.mock("../goldlineKingdoms/kingdomService", () => ({
  getKingdom: mockKingdoms.getKingdom,
}));

describe("Mitch v1 — Autonomous Runtime Coding Agent Provider & Boundary Enforcement", () => {
  let store: MitchProductionStore;
  let service: MitchProductionService;
  let qaService: MitchQaService;
  let dispatcher: MitchGameDispatcher;
  const tenantId = "tenant-provider-test";
  const gameId = "kingdom.brass_republic"; // Canonical non-Boreslay game!
  const milestoneKey = "brass_republic_fixture";
  let currentHeadSha: string;

  const defaultTestRunner = async (target: string) => {
    if (target.includes("failing") || target.includes("nonexistent")) {
      return { exitCode: 1, stdout: "", stderr: "Test execution failed" };
    }
    return { exitCode: 0, stdout: "✓ test passed in 5ms", stderr: "" };
  };

  function createTestProvider(options: Partial<AutonomousRuntimeCodingAgentProviderOptions> = {}): AutonomousRuntimeCodingAgentProvider {
    return new AutonomousRuntimeCodingAgentProvider({
      testCommandRunner: defaultTestRunner,
      ...options,
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new MitchProductionStore(true);
    service = new MitchProductionService(store);
    qaService = new MitchQaService(store);
    dispatcher = new MitchGameDispatcher(store);

    currentHeadSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    mockKingdoms.getKingdom.mockResolvedValue(null);

    // Initialize canonical non-Boreslay production state
    await service.initializeOrLoadProductionState({
      tenantId,
      canonicalGameId: gameId,
    });

    // Register test milestone
    await service.registerMilestone({
      tenantId,
      gameId,
      milestoneKey,
      sequence: 1,
      title: "Brass Republic Characterization Fixture",
      desiredPlayerVisibleResult: "Fixture provides verified kingdom metadata",
      acceptanceCriteria: ["Brass Republic fixture exports getBrassRepublicMetadata()"],
      isHumanCreativeBlocker: false,
    });
  });

  async function createTestWorkOrder(overrides: Partial<Parameters<typeof service.createWorkOrder>[0]> = {}): Promise<MitchWorkOrder> {
    return service.createWorkOrder({
      tenantId,
      gameId,
      milestoneKey,
      title: "Implement Brass Republic characterization fixture",
      desiredPlayerVisibleResult: "Fixture returns canonical kingdom metadata",
      acceptanceCriteria: ["Fixture exports getBrassRepublicMetadata()"],
      canonConstraints: ["Preserve canonical kingdom.brass_republic identity"],
      relevantDependencies: ["docs/JOYSTICK_SYSTEM_MAP.md"],
      realBusinessEvidenceConstraints: ["Never fabricate customer visits"],
      baseBranch: "feat/test",
      baseSha: currentHeadSha,
      requiredArtifact: "test/fixtures/brassRepublicWitnessFixture.ts",
      requiredTests: ["test/fixtures/brassRepublicWitnessFixture.test.ts"],
      ...overrides,
    });
  }

  describe("Section 13: Required Characterization Suite", { timeout: 60_000 }, () => {
    // 1. configured provider dispatch
    it("1. dispatches successfully when an authorized runtime provider is configured", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile(
            "test/fixtures/brassRepublicWitnessFixture.ts",
            'export function getBrassRepublicMetadata() { return { gameId: "kingdom.brass_republic" }; }'
          );
          await ctx.commit("feat: add brass republic witness fixture");
          return { status: "succeeded", whatChanged: "Added witness fixture" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      const result = await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });

      expect(result.workOrder.status).toBe("implementation_returned");
      expect(result.build.commitSha).toMatch(/^[0-9a-f]{40}$/i);
      expect(result.build.commitSha).not.toBe(order.baseSha);
      expect(result.build.isVerified).toBe(false); // IMPLEMENTED ≠ VERIFIED
      expect(result.executionRun.status).toBe("succeeded");
    });

    // 2. missing-provider fail closed
    it("2. fails closed with MissingExecutionProviderError when no provider exists or provider is unavailable", async () => {
      const order = await createTestWorkOrder();

      // Dispatcher without provider
      await expect(
        dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id })
      ).rejects.toThrow(MissingExecutionProviderError);

      // Provider with no API key and no runner
      const emptyProvider = new AutonomousRuntimeCodingAgentProvider({ apiKey: "" });
      expect(await emptyProvider.isAvailable()).toBe(false);
    });

    // 3. exact base SHA checkout
    it("3. verifies that isolated worktree is created from exact authorized baseSha", async () => {
      const order = await createTestWorkOrder();

      let inspectedWorktreeHead = "";
      const provider = createTestProvider({
        workerRunner: async ctx => {
          const { stdout } = await ctx.runCommand("git", ["rev-parse", "HEAD"]);
          inspectedWorktreeHead = stdout.trim();
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const v = 1;");
          await ctx.commit("feat: test checkout");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });

      expect(inspectedWorktreeHead.toLowerCase()).toBe(order.baseSha.toLowerCase());
    });

    // 4. isolated workspace creation
    it("4. executes exclusively in isolated worktree and leaves primary checkout untouched", async () => {
      const order = await createTestWorkOrder();

      const preHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const preStatus = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          expect(ctx.worktreeDir).not.toBe(ctx.repoRoot);
          expect(ctx.worktreeDir).toContain(".mitch-worktrees");
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const iso = true;");
          await ctx.commit("feat: isolated edit");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });

      const postHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const postStatus = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();

      // Primary checkout HEAD and status were never modified!
      expect(postHead).toBe(preHead);
      expect(postStatus).toBe(preStatus);
    });

    // 5. actual resulting SHA validation
    it("5. validates that resulting SHA is a real immutable git commit in repository history", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const shaTest = 1;");
          await ctx.commit("feat: test commit SHA validity");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      const result = await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });

      const resultingSha = result.build.commitSha;
      expect(isValidBuildIdentity(resultingSha)).toBe(true);

      // Verify git object actually exists in the local git repository
      const catFile = execFileSync("git", ["cat-file", "-t", resultingSha], { encoding: "utf8" }).trim();
      expect(catFile).toBe("commit");
    });

    // 6. resulting SHA must differ from base for successful implementation
    it("6. rejects execution if resulting SHA is identical to base SHA", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async () => {
          // Worker creates NO commit
          return { status: "succeeded", whatChanged: "I said I did it but created no commit" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      await expect(
        dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id })
      ).rejects.toThrow(NoCommitProducedError);

      const failedOrder = await store.getWorkOrder(tenantId, order.id);
      expect(failedOrder?.status).toBe("failed");
    });

    // 7. changed-file capture
    it("7. captures exact changed files in execution handback evidence", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const f = 1;");
          await ctx.commit("feat: fixture added");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      const result = await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });

      const evidence = result.executionRun.evidence as { changedFiles?: string[] };
      expect(evidence.changedFiles).toBeDefined();
      expect(evidence.changedFiles).toContain("test/fixtures/brassRepublicWitnessFixture.ts");
    });

    // 8. command/test evidence capture
    it("8. captures command and test exit outcomes in execution evidence", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const t = 1;");
          await ctx.commit("feat: test evidence");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      const result = await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });

      expect(result.executionRun.testsActuallyRun).toEqual(["test/fixtures/brassRepublicWitnessFixture.test.ts"]);
      const evidence = result.executionRun.evidence as { testResults?: Array<{ command: string; exitCode: number }> };
      expect(evidence.testResults?.[0]?.exitCode).toBe(0);
      expect(evidence.testResults?.[0]?.command).toContain("vitest run");
    });

    // 9. worker nonzero exit
    it("9. fails closed if required test command exits with nonzero exit code", async () => {
      const order = await createTestWorkOrder({
        requiredTests: ["nonexistent/failingTestFile.test.ts"],
      });

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const f = 1;");
          await ctx.commit("feat: bad tests");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      await expect(
        dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id })
      ).rejects.toThrow(TestExecutionFailedError);

      const failedOrder = await store.getWorkOrder(tenantId, order.id);
      expect(failedOrder?.status).toBe("failed");
    });

    // 10. timeout
    it("10. rejects execution when worker exceeds configured timeout", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        timeoutMs: 50, // 50ms timeout for test
        workerRunner: async () => {
          await new Promise(r => setTimeout(r, 200));
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      await expect(
        dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id })
      ).rejects.toThrow(ExecutionTimeoutError);
    });

    // 11. no resulting commit
    it("11. rejects execution when worker modifies workspace but produces no git commit", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const uncommitted = true;");
          // Deliberately do NOT commit
          return { status: "succeeded", whatChanged: "forgot to commit" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      await expect(
        dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id })
      ).rejects.toThrow(NoCommitProducedError);
    });

    // 12. unauthorized/out-of-scope diff
    it("12. rejects execution if worker modifies protected Mitch files or contracts", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          // Attempting to write to protected path
          await ctx.writeFile("server/mitch/mitchService.ts", "// malicious edit");
          await ctx.commit("hack: modified mitch service");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      await expect(
        dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id })
      ).rejects.toThrow(ScopeViolationError);
    });

    // 13. lease expiry
    it("13. rejects submission if worker lease has expired", async () => {
      const order = await createTestWorkOrder();
      const claimed = await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-slow",
        leaseMs: 1, // 1ms lease
      });
      expect(claimed).not.toBeNull();

      // Wait 10ms for lease to expire
      await new Promise(r => setTimeout(r, 10));

      await expect(
        dispatcher.submitHandback({
          tenantId,
          workOrderId: order.id,
          executorId: "worker-slow",
          handback: {
            branch: "mitch/wo-expired",
            commitSha: currentHeadSha,
            exactBuildId: currentHeadSha,
            whatChanged: "Late submission",
            testsActuallyRun: ["test.ts"],
            testsNotRun: [],
            previewLaunchInstructions: "pnpm test",
            evidence: {},
            knownLimitations: "",
          },
        })
      ).rejects.toThrow(StaleWorkerOverwrittenViolationError);
    });

    // 14. duplicate completion
    it("14. safely rejects duplicate completion of the same work order", async () => {
      const order = await createTestWorkOrder();
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-first",
        leaseMs: 60_000,
      });

      const handback = {
        branch: "mitch/wo-first",
        commitSha: currentHeadSha,
        exactBuildId: currentHeadSha,
        whatChanged: "Initial completion",
        testsActuallyRun: ["test.ts"],
        testsNotRun: [],
        previewLaunchInstructions: "pnpm test",
        evidence: {},
        knownLimitations: "",
      };

      await dispatcher.submitHandback({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-first",
        handback,
      });

      // Second attempt to complete should fail (no longer claimed by worker-first)
      await expect(
        dispatcher.submitHandback({
          tenantId,
          workOrderId: order.id,
          executorId: "worker-first",
          handback,
        })
      ).rejects.toThrow(StaleWorkerOverwrittenViolationError);
    });

    // 15. stale worker attempting to complete
    it("15. rejects stale worker when another claimant has acquired the lease", async () => {
      const order = await createTestWorkOrder();
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-old",
        leaseMs: 1,
      });

      await new Promise(r => setTimeout(r, 10));

      // New worker acquires lease
      await dispatcher.claimWorkOrder({
        tenantId,
        workOrderId: order.id,
        executorId: "worker-new",
        leaseMs: 60_000,
      });

      // Worker-old attempts to submit
      await expect(
        dispatcher.submitHandback({
          tenantId,
          workOrderId: order.id,
          executorId: "worker-old",
          handback: {
            branch: "mitch/wo-old",
            commitSha: currentHeadSha,
            exactBuildId: currentHeadSha,
            whatChanged: "Old worker submission",
            testsActuallyRun: ["test.ts"],
            testsNotRun: [],
            previewLaunchInstructions: "pnpm test",
            evidence: {},
            knownLimitations: "",
          },
        })
      ).rejects.toThrow(StaleWorkerOverwrittenViolationError);
    });

    // 16. retry attempt separation
    it("16. separates retry attempts with distinct attempt identities and branches", async () => {
      const order = await createTestWorkOrder();

      const branchesUsed: string[] = [];
      let callCount = 0;

      const provider = createTestProvider({
        workerRunner: async ctx => {
          branchesUsed.push(ctx.branchName);
          callCount++;
          if (callCount === 1) {
            // First attempt fails
            throw new Error("First attempt crashed");
          }
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const r = 2;");
          await ctx.commit("feat: retry succeeded");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);

      // Attempt 1 fails
      await expect(
        dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id })
      ).rejects.toThrow("First attempt crashed");

      const failedOrder = await store.getWorkOrder(tenantId, order.id);
      expect(failedOrder?.attemptCount).toBe(1);

      // Attempt 2 succeeds with new attempt count and distinct branch
      const result2 = await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });
      expect(result2.workOrder.status).toBe("implementation_returned");
      expect(branchesUsed.length).toBe(2);
      expect(branchesUsed[0]).toBe(`mitch/wo-${order.id}-att-1`);
      expect(branchesUsed[1]).toBe(`mitch/wo-${order.id}-att-2`);
      expect(branchesUsed[0]).not.toBe(branchesUsed[1]);
    });

    // 17. human creative blocker prevents provider invocation
    it("17. halts and rejects work order creation when milestone is blocked by human creative decision", async () => {
      await service.registerMilestone({
        tenantId,
        gameId,
        milestoneKey: "creative_blocked_milestone",
        sequence: 2,
        title: "Artistic Direction Needed",
        desiredPlayerVisibleResult: "Art style defined",
        acceptanceCriteria: ["Human creative approval"],
        isHumanCreativeBlocker: true,
      });

      await expect(
        service.createWorkOrder({
          tenantId,
          gameId,
          milestoneKey: "creative_blocked_milestone",
          title: "Implement art direction",
          desiredPlayerVisibleResult: "Art style applied",
          acceptanceCriteria: ["Approval"],
          canonConstraints: [],
          relevantDependencies: [],
          realBusinessEvidenceConstraints: [],
          baseBranch: "main",
          baseSha: currentHeadSha,
          requiredArtifact: "art.ts",
          requiredTests: ["art.test.ts"],
        })
      ).rejects.toThrow(/human creative decision is required/i);
    });

    // 18. implementation success does not imply gameplay verification
    it("18. asserts that implementation success does not mark build verified or creatively accepted", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const ver = false;");
          await ctx.commit("feat: implementation done");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      const result = await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });

      // Core rule: IMPLEMENTED ≠ VERIFIED ≠ CREATIVE-ACCEPTED
      expect(result.build.isVerified).toBe(false);
      expect(result.build.verifiedAt).toBeNull();

      const milestone = await store.getMilestone(tenantId, gameId, milestoneKey);
      expect(milestone?.currentAvailableBuildId).toBe(result.build.id);
      expect(milestone?.lastVerifiedBuildId).toBeNull();

      const gameState = await store.getProductionState(tenantId, gameId);
      expect(gameState?.currentAvailableBuildId).toBe(result.build.id);
      expect(gameState?.lastVerifiedBuildId).toBeNull();
      expect(gameState?.creativeAcceptanceState).toBe("pending");
      expect(gameState?.releaseState).toBe("unreleased");
    });

    // 19. QA points to exact produced build
    it("19. enables gameplay QA to point to and test the exact produced build ID", async () => {
      const order = await createTestWorkOrder();

      const provider = createTestProvider({
        workerRunner: async ctx => {
          await ctx.writeFile("test/fixtures/brassRepublicWitnessFixture.ts", "export const qaTest = true;");
          await ctx.commit("feat: build for QA");
          return { status: "succeeded" };
        },
      });

      dispatcher.registerExecutionProvider(provider);
      const result = await dispatcher.dispatchAutonomous({ tenantId, workOrderId: order.id });
      const producedBuildId = result.build.id;

      // Milestone registered in store
      const milestone = await store.getMilestone(tenantId, gameId, milestoneKey);
      expect(milestone).not.toBeNull();

      // Independent gameplay QA tests the exact build
      const { qaRun } = await qaService.recordGameplayQaRun({
        tenantId,
        gameId,
        milestoneId: milestone!.id,
        buildId: producedBuildId,
        testerId: "qa-tester-carol",
        scenario: "Verify Brass Republic characterization fixture",
        expectedBehavior: "Fixture provides verified metadata",
        observedBehavior: "Fixture behaved as expected",
        gameActuallyExercised: true,
        acceptancePassed: true,
        status: "passed",
        evidenceArtifact: "qa-artifact-screenshot-12345",
      });

      expect(qaRun.buildId).toBe(producedBuildId);
      expect(qaRun.acceptancePassed).toBe(true);

      // Now verified pointer advances to this exact build
      const verifiedBuild = await store.getBuild(tenantId, producedBuildId);
      expect(verifiedBuild?.isVerified).toBe(true);
      const updatedMilestone = await store.getMilestone(tenantId, gameId, milestoneKey);
      expect(updatedMilestone?.lastVerifiedBuildId).toBe(producedBuildId);
    });

    // 20. no fabricated artifact/preview identifiers
    it("20. rejects fabricated version strings like K2-0.8.14", () => {
      expect(isValidBuildIdentity("K2-0.8.14")).toBe(false);
      expect(isValidBuildIdentity("v1.0.0")).toBe(false);
      expect(isValidBuildIdentity("1.0.0")).toBe(false);
      expect(isValidBuildIdentity("BORESLAY-0.9.1")).toBe(false);
      expect(isValidBuildIdentity("short")).toBe(false);

      expect(() => assertValidBuildIdentity("K2-0.8.14")).toThrow(/Synthetic version strings like K2-0.8.14 are forbidden/);

      // Real git SHA is accepted
      expect(isValidBuildIdentity("a38db7c86632d122795e621d9d81b1ea3c049382")).toBe(true);
      expect(isValidBuildIdentity("ed985932a4d4c3529c289d59eebc5f36f401b100")).toBe(true);
    });
  });
});
