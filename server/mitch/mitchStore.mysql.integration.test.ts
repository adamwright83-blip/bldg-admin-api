
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MitchGameDispatcher } from "./mitchDispatcher";
import { MitchQaService } from "./mitchQaService";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

describe("Mitch native producer MySQL durability", () => {
  it("survives a fresh store across work order, execution, build, QA issue, and audit state", async () => {
    const tenantId = `tenant-mitch-${randomUUID().slice(0, 8)}`;
    const gameId = "game.small_comforts";
    const milestoneKey = "mysql_durable_producer_proof";
    const baseSha = "cf9e4166e566e691f16598bfada5f5ffbe0cc04e";
    const returnedSha = "abcdef1234567890abcdef1234567890abcdef12";

    const storeA = new MitchProductionStore(false, true);
    const serviceA = new MitchProductionService(storeA);
    const dispatcherA = new MitchGameDispatcher(storeA);
    const qaA = new MitchQaService(storeA);

    await serviceA.initializeOrLoadProductionState({
      tenantId,
      canonicalGameId: gameId,
      titleOverride: "Small Comforts",
    });
    const milestone = await serviceA.registerMilestone({
      tenantId,
      gameId,
      milestoneKey,
      sequence: 99,
      title: "Durable producer proof",
      desiredPlayerVisibleResult: "A real Mitch work order survives process restart.",
      acceptanceCriteria: ["Durable state reloads from MySQL."],
    });
    const order = await serviceA.createWorkOrder({
      tenantId,
      gameId,
      milestoneKey,
      title: "Execute durable producer proof",
      desiredPlayerVisibleResult: "A real Mitch work order survives process restart.",
      acceptanceCriteria: ["Durable state reloads from MySQL."],
      canonConstraints: ["No merge required."],
      relevantDependencies: [],
      realBusinessEvidenceConstraints: ["No real business evidence is created."],
      baseBranch: "main",
      baseSha,
      requiredArtifact: "server/mitch/mitchStore.ts",
      requiredTests: ["server/mitch/mitchStore.mysql.integration.test.ts"],
      requiredEvidence: ["Exact returned SHA"],
    });

    const claimed = await dispatcherA.claimWorkOrder({
      tenantId,
      workOrderId: order.id,
      executorId: "mysql-proof-executor",
      leaseMs: 60_000,
    });
    expect(claimed?.claimedBy).toBe("mysql-proof-executor");

    const submitted = await dispatcherA.submitHandback({
      tenantId,
      workOrderId: order.id,
      executorId: "mysql-proof-executor",
      handback: {
        branch: "feat/mitch-mysql-proof",
        commitSha: returnedSha,
        exactBuildId: returnedSha,
        whatChanged: "Durability proof handback.",
        testsActuallyRun: ["server/mitch/mitchStore.mysql.integration.test.ts"],
        testsNotRun: [],
        previewLaunchInstructions: "No UI; integration proof only.",
        evidence: { kind: "mysql_durability_proof" },
        knownLimitations: "",
      },
    });

    const failedQa = await qaA.recordGameplayQaRun({
      tenantId,
      gameId,
      milestoneId: milestone.id,
      buildId: returnedSha,
      testerId: "mysql-proof-reviewer",
      scenario: "Durable QA failure survives restart",
      expectedBehavior: "A durable issue is created.",
      observedBehavior: "Intentional proof failure.",
      gameActuallyExercised: false,
      acceptancePassed: false,
      status: "failed",
      evidenceArtifact: "artifact-mitch-mysql-proof-12345678",
    });
    expect(failedQa.issue?.id).toBeTruthy();

    const storeB = new MitchProductionStore(false, true);

    const reloadedState = await storeB.getProductionState(tenantId, gameId);
    const reloadedOrder = await storeB.getWorkOrder(tenantId, order.id);
    const reloadedRun = await storeB.getExecutionRun(tenantId, submitted.executionRun.id);
    const reloadedBuild = await storeB.getBuild(tenantId, returnedSha);
    const reloadedQaRuns = await storeB.listQaRuns(tenantId, gameId);
    const reloadedIssues = await storeB.listIssues(tenantId, gameId);
    const reloadedAudit = await storeB.listAuditEvents(tenantId, gameId);

    expect(reloadedState?.lifecycleState).toBe("fix_needed");
    expect(reloadedOrder?.status).toBe("implementation_returned");
    expect(reloadedOrder?.claimedBy).toBe("mysql-proof-executor");
    expect(reloadedRun?.returnedCommitSha).toBe(returnedSha);
    expect(reloadedBuild?.commitSha).toBe(returnedSha);
    expect(reloadedBuild?.isVerified).toBe(false);
    expect(reloadedQaRuns.some(run => run.status === "failed" && run.buildId === returnedSha)).toBe(true);
    expect(reloadedIssues.some(issue => issue.id === failedQa.issue?.id && issue.status === "open")).toBe(true);
    expect(reloadedAudit.some(event => event.eventType === "mitch_implementation_returned")).toBe(true);
    expect(reloadedAudit.some(event => event.eventType === "mitch_gameplay_qa_failed")).toBe(true);
  }, 30_000);
});
