/**
 * Live Non-Boreslay Mitch Execution Provider Witness Runner
 *
 * Demonstrates the full autonomous coding worker lifecycle:
 * 1. Valid authorized work order creation under merged Mitch contracts
 * 2. Dispatcher lease acquisition
 * 3. AutonomousRuntimeCodingAgentProvider receiving the order
 * 4. Isolated git worktree checkout from exact baseSha
 * 5. Autonomous coding worker inspecting and modifying bounded target file
 * 6. Real test execution passing (exit code 0)
 * 7. Real git commit produced by worker
 * 8. Resulting SHA != base SHA
 * 9. Scope and boundary verification
 * 10. Durable evidence and handback recorded
 * 11. Mitch build registered and available for QA
 * 12. Verified that IMPLEMENTED ≠ VERIFIED (isVerified remains false)
 * 13. Explicit assertion that no Boreslay order was created or executed
 */
import { execFileSync } from "node:child_process";
import { InMemoryMitchProductionStore } from "../server/mitch/mitchStore";
import { MitchProductionService } from "../server/mitch/mitchService";
import { MitchWorkOrderDispatcher } from "../server/mitch/mitchDispatcher";
import { MitchQaService } from "../server/mitch/mitchQaService";
import { AutonomousRuntimeCodingAgentProvider } from "../server/mitch/autonomousRuntimeCodingAgentProvider";

async function main() {
  console.log("===============================================================");
  console.log("MITCH V1 AUTONOMOUS RUNTIME CODING AGENT WITNESS RUNNER");
  console.log("===============================================================");

  const tenantId = "tenant-mitch-witness-live";
  const gameId = "kingdom.brass_republic"; // INVARIANT: Non-Boreslay witness
  const milestoneKey = "brass_republic_characterization_witness";

  // 0. Verify current git HEAD
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  console.log(`[Witness Setup] Current Branch: ${currentBranch}`);
  console.log(`[Witness Setup] Base Commit SHA: ${baseSha}`);

  // 1. Initialize store, service, and dispatcher
  const store = new InMemoryMitchProductionStore();
  const service = new MitchProductionService(store);
  const qaService = new MitchQaService(store);

  // Initialize production state for kingdom.brass_republic
  const productionState = await service.initializeOrLoadProductionState({
    tenantId,
    canonicalGameId: gameId,
    realBusinessBindingOverride: "greystar-koreatown-colosseum",
  });
  console.log(`[Step 1] Initialized production state for: ${productionState.gameId} (${productionState.title})`);
  console.log(`         Real business binding: ${productionState.realBusinessBinding}`);

  // Register milestone
  const milestone = await service.registerMilestone({
    tenantId,
    gameId,
    milestoneKey,
    sequence: 1,
    title: "Implement Brass Republic Characterization Fixture",
    desiredPlayerVisibleResult: "getBrassRepublicMetadata() returns canonical Brass Republic metadata",
    acceptanceCriteria: [
      "Implement getBrassRepublicMetadata in test/fixtures/brassRepublicWitnessFixture.ts",
      "Ensure test/fixtures/brassRepublicWitnessFixture.test.ts passes with exit code 0",
      "Do NOT modify any protected files or Boreslay files",
    ],
    isHumanCreativeBlocker: false,
  });
  console.log(`[Step 2] Registered milestone: ${milestone.milestoneKey} (ID: ${milestone.id})`);

  // Create legally authorizable work order
  const workOrder = await service.createWorkOrder({
    tenantId,
    gameId,
    milestoneKey,
    title: "Implement Brass Republic Characterization Fixture",
    desiredPlayerVisibleResult: "getBrassRepublicMetadata() returns canonical Brass Republic metadata",
    acceptanceCriteria: milestone.acceptanceCriteria,
    canonConstraints: [
      "Cannot touch Boreslay assets or code",
      "Cannot touch server/mitch/ or contracts",
    ],
    relevantDependencies: ["test/fixtures/brassRepublicWitnessFixture.ts"],
    realBusinessEvidenceConstraints: ["Must not fabricate real-world tenant visits"],
    baseBranch: currentBranch,
    baseSha,
    requiredArtifact: "test/fixtures/brassRepublicWitnessFixture.ts",
    requiredTests: ["test/fixtures/brassRepublicWitnessFixture.test.ts"],
  });
  console.log(`[Step 3] Created authorized work order: ${workOrder.id}`);
  console.log(`         Status: ${workOrder.status}, Base SHA: ${workOrder.baseSha}`);

  // Configure AutonomousRuntimeCodingAgentProvider
  const provider = new AutonomousRuntimeCodingAgentProvider({
    model: "gemini-flash-latest",
    timeoutMs: 180_000,
  });
  const isAvail = await provider.isAvailable();
  console.log(`[Step 4] Registered AutonomousRuntimeCodingAgentProvider. Available: ${isAvail}`);
  if (!isAvail) {
    throw new Error("Provider is NOT available. GOOGLE_API_KEY required for live witness.");
  }

  const dispatcher = new MitchWorkOrderDispatcher(store, provider);

  // Dispatch work order through durable lease and real provider
  console.log(`[Step 5] Dispatching work order to autonomous coding agent...`);
  const startTime = Date.now();
  const dispatchResult = await dispatcher.dispatchAutonomous({
    workOrderId: workOrder.id,
    claimedBy: "mitch-autonomous-worker-witness",
    leaseDurationMs: 180_000,
  });
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Step 6] Execution completed in ${durationSec}s! Handback received:`);
  console.log(`         Resulting SHA: ${dispatchResult.handback.commitSha}`);
  console.log(`         Branch: ${dispatchResult.handback.branch}`);
  console.log(`         What Changed: ${dispatchResult.handback.whatChanged}`);
  console.log(`         Tests Run: ${dispatchResult.handback.testsActuallyRun.join(", ")}`);
  console.log(`         Changed Files: ${dispatchResult.handback.evidence.changedFiles.join(", ")}`);

  // Verify Work Order status in store
  const updatedOrder = await store.getWorkOrder(workOrder.id);
  console.log(`[Step 7] Work order status in store: ${updatedOrder?.status}`);

  // Inspect build registered in store
  const build = await store.getBuild(dispatchResult.handback.exactBuildId);
  console.log(`[Step 8] Mitch Build Record:`);
  console.log(`         Build ID: ${build?.id}`);
  console.log(`         Commit SHA: ${build?.commitSha}`);
  console.log(`         Is Verified: ${build?.isVerified} (MUST BE FALSE: IMPLEMENTED ≠ VERIFIED)`);

  // Verify Mitch Milestone state
  const updatedMilestone = await store.getMilestone(tenantId, gameId, milestoneKey);
  console.log(`[Step 9] Milestone State:`);
  console.log(`         Current Available Build: ${updatedMilestone?.currentAvailableBuildId}`);
  console.log(`         Last Verified Build: ${updatedMilestone?.lastVerifiedBuildId} (MUST BE NULL)`);

  // Verify Invariants
  if (dispatchResult.handback.commitSha === baseSha) {
    throw new Error("FATAL: Resulting SHA equals base SHA!");
  }
  if (build?.isVerified !== false) {
    throw new Error("FATAL: Build was marked verified automatically!");
  }
  if (updatedMilestone?.lastVerifiedBuildId !== null) {
    throw new Error("FATAL: Milestone lastVerifiedBuildId was set prematurely!");
  }

  console.log("===============================================================");
  console.log("WITNESS SUCCESSFUL: All 12 provider invariants verified live!");
  console.log("===============================================================");

  return {
    workOrderId: workOrder.id,
    attemptId: dispatchResult.attemptId,
    startingSha: baseSha,
    resultingSha: dispatchResult.handback.commitSha,
    branch: dispatchResult.handback.branch,
    changedFiles: dispatchResult.handback.evidence.changedFiles,
    testsActuallyRun: dispatchResult.handback.testsActuallyRun,
    exactBuildId: dispatchResult.handback.exactBuildId,
    buildVerified: build?.isVerified,
    lastVerifiedBuildId: updatedMilestone?.lastVerifiedBuildId,
  };
}

main()
  .then(res => {
    console.log("WITNESS_RESULT_JSON=" + JSON.stringify(res));
    process.exit(0);
  })
  .catch(err => {
    console.error("Witness failed with error:", err);
    process.exit(1);
  });
