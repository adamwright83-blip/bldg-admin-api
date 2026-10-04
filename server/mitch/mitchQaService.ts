/**
 * Mitch v1 — Independent Gameplay QA & Issue/Retest Lifecycle Service
 *
 * NON-NEGOTIABLE PRINCIPLES:
 * 1. Implementation completion makes a build eligible for QA; it NEVER marks the milestone verified.
 * 2. Mitch strictly distinguishes:
 *    - source code exists
 *    - source compiles
 *    - automated unit tests pass
 *    - preview/build exists
 *    - game was actually exercised
 *    - acceptance behavior passed
 * 3. A successful TypeScript build is not gameplay QA.
 *    A screenshot is not gameplay QA.
 *    Inspecting source is not gameplay QA.
 * 4. QA references the exact build identity it tested.
 * 5. QA pass advances the verified build pointer.
 *    QA failure CANNOT advance the verified build pointer.
 * 6. Failed QA creates a durable issue.
 * 7. Fix/retest invariant:
 *    A code fix does NOT close an issue.
 *    An issue closes ONLY after:
 *    - a newer exact build exists,
 *    - the failed path is independently rerun against that build,
 *    - and the acceptance behavior passes.
 */
import { randomUUID } from "node:crypto";
import type {
  MitchBuild,
  MitchIssue,
  MitchQaRun,
  MitchQaStatus,
} from "../../shared/mitchContracts";
import {
  assertValidBuildIdentity,
  mitchIssueSchema,
  mitchQaResultSchema,
} from "../../shared/mitchContracts";
import type { IMitchProductionStore } from "./mitchStore";

export class InvalidQaPassAttestationError extends Error {
  constructor(reason: string) {
    super(
      `Invalid QA pass attestation: ${reason}. A build cannot pass gameplay QA without the game actually being exercised and acceptance criteria passing.`
    );
    this.name = "InvalidQaPassAttestationError";
  }
}

export class BuildMismatchError extends Error {
  constructor(expectedBuildId: string, providedBuildId: string) {
    super(
      `Build identity mismatch: QA was dispatched for build "${expectedBuildId}" but received results for "${providedBuildId}". QA must reference the exact build tested.`
    );
    this.name = "BuildMismatchError";
  }
}

export class IssueRetestRequirementError extends Error {
  constructor(issueId: string) {
    super(
      `Issue "${issueId}" cannot be closed by a code fix alone. An issue closes only after an independent retest against a newer exact build passes.`
    );
    this.name = "IssueRetestRequirementError";
  }
}

export class MitchQaService {
  constructor(private readonly store: IMitchProductionStore) {}

  /**
   * Records an independent gameplay QA run.
   * Enforces that QA pass requires game actually exercised and acceptance criteria passed.
   * If failed: creates durable issue, does NOT advance verified build.
   * If passed: marks build verified, advances verified build pointer, closes issue if retest.
   */
  async recordGameplayQaRun(input: {
    tenantId: string;
    gameId: string;
    milestoneId: string;
    buildId: string;
    testerId: string;
    scenario: string;
    expectedBehavior: string;
    observedBehavior: string;
    gameActuallyExercised: boolean;
    acceptancePassed: boolean;
    status: MitchQaStatus;
    evidenceArtifact: string;
    issueId?: string | null;
    previousFailedQaRunId?: string | null;
  }): Promise<{
    qaRun: MitchQaRun;
    issue?: MitchIssue;
    verifiedBuild?: MitchBuild;
    closedIssue?: MitchIssue;
  }> {
    assertValidBuildIdentity(input.buildId);

    // Verify build exists
    const build = await this.store.getBuild(input.tenantId, input.buildId);
    if (!build) {
      throw new Error(`Build "${input.buildId}" not found in store.`);
    }

    const milestonesForIdentity = await this.store.listMilestones(input.tenantId, input.gameId);
    const identityMilestone = milestonesForIdentity.find(m => m.id === input.milestoneId);
    const buildOrder = await this.store.getWorkOrder(input.tenantId, build.workOrderId);
    if (build.gameId !== input.gameId || !identityMilestone || (buildOrder && buildOrder.milestoneId !== input.milestoneId)) {
      throw new Error("QA game/milestone/build identity mismatch");
    }
    if (input.issueId) {
      const issue = await this.store.getIssue(input.tenantId, input.issueId);
      const previous = issue && await this.store.getQaRun(input.tenantId, issue.originatingQaRunId);
      if (!issue || !previous || issue.gameId !== input.gameId || issue.milestoneId !== input.milestoneId ||
          issue.status !== "fix_submitted" || issue.fixBuildId !== input.buildId || previous.buildId === input.buildId ||
          (input.previousFailedQaRunId && input.previousFailedQaRunId !== issue.originatingQaRunId)) {
        throw new IssueRetestRequirementError(input.issueId);
      }
    }

    // Integrity check: A pass requires game exercised and acceptance passed
    if (input.status === "passed" && (!input.gameActuallyExercised || !input.acceptancePassed)) {
      throw new InvalidQaPassAttestationError(
        "Status is 'passed' but game was not actually exercised or acceptance behavior did not pass"
      );
    }

    const isRetest = Boolean(input.previousFailedQaRunId || input.issueId);
    const nowIso = new Date().toISOString();

    if (input.status === "failed") {
      // Create durable issue
      const issueTitle = `Gameplay QA Failure on ${build.branch} (${build.id.slice(0, 10)})`;
      const issue = await this.store.createIssue({
        tenantId: input.tenantId,
        gameId: input.gameId,
        milestoneId: input.milestoneId,
        originatingQaRunId: randomUUID(), // Will be linked
        title: issueTitle,
        description: `Scenario: ${input.scenario}\nExpected: ${input.expectedBehavior}\nObserved: ${input.observedBehavior}\nEvidence: ${input.evidenceArtifact}`,
        status: "open",
        fixWorkOrderId: null,
        fixBuildId: null,
        closingQaRunId: null,
        closedAt: null,
      });

      // Record QA run
      const qaRun = await this.store.recordQaRun({
        tenantId: input.tenantId,
        gameId: input.gameId,
        milestoneId: input.milestoneId,
        buildId: input.buildId,
        testerId: input.testerId,
        scenario: input.scenario,
        expectedBehavior: input.expectedBehavior,
        observedBehavior: input.observedBehavior,
        gameActuallyExercised: input.gameActuallyExercised,
        acceptancePassed: input.acceptancePassed,
        status: "failed",
        evidenceArtifact: input.evidenceArtifact,
        issueId: issue.id,
        previousFailedQaRunId: input.previousFailedQaRunId ?? null,
        isRetest,
        completedAt: nowIso,
      });

      // Update issue originating QA run id
      const updatedIssue = await this.store.updateIssue({
        ...issue,
        originatingQaRunId: qaRun.id,
      });

      // Milestone enters blocked/fix_needed
      const milestone = await this.store.getMilestone(input.tenantId, input.gameId, "k2_entry_handshake");
      const milestones = await this.store.listMilestones(input.tenantId, input.gameId);
      const targetMilestone = milestones.find(m => m.id === input.milestoneId);
      if (targetMilestone) {
        await this.store.saveMilestone({
          ...targetMilestone,
          status: "in_progress",
          blockedReason: `QA failure: Issue ${issue.id}`,
          // Invariant: lastVerifiedBuildId stays untouched!
        });
      }

      // Game state enters fix_needed
      const gameState = await this.store.getProductionState(input.tenantId, input.gameId);
      if (gameState) {
        await this.store.saveProductionState({
          ...gameState,
          lifecycleState: "fix_needed",
          // Invariant: lastVerifiedBuildId stays untouched!
        });
      }

      await this.store.recordAuditEvent({
        tenantId: input.tenantId,
        gameId: input.gameId,
        eventType: "mitch_gameplay_qa_failed",
        actorId: input.testerId,
        details: {
          buildId: input.buildId,
          issueId: issue.id,
          scenario: input.scenario,
        },
      });

      return { qaRun, issue: updatedIssue };
    }

    // --- QA Passed ---
    const qaRun = await this.store.recordQaRun({
      tenantId: input.tenantId,
      gameId: input.gameId,
      milestoneId: input.milestoneId,
      buildId: input.buildId,
      testerId: input.testerId,
      scenario: input.scenario,
      expectedBehavior: input.expectedBehavior,
      observedBehavior: input.observedBehavior,
      gameActuallyExercised: input.gameActuallyExercised,
      acceptancePassed: input.acceptancePassed,
      status: "passed",
      evidenceArtifact: input.evidenceArtifact,
      issueId: input.issueId ?? null,
      previousFailedQaRunId: input.previousFailedQaRunId ?? null,
      isRetest,
      completedAt: nowIso,
    });

    // Advance verified build pointer on build record
    const verifiedBuild = await this.store.markBuildVerified(input.tenantId, input.buildId);

    // Advance verified pointer on milestone
    const milestones = await this.store.listMilestones(input.tenantId, input.gameId);
    const targetMilestone = milestones.find(m => m.id === input.milestoneId);
    if (targetMilestone) {
      await this.store.saveMilestone({
        ...targetMilestone,
        status: "verified",
        lastVerifiedBuildId: input.buildId,
        blockedReason: null,
      });
    }

    // Advance verified pointer on game state
    const gameState = await this.store.getProductionState(input.tenantId, input.gameId);
    if (gameState) {
      await this.store.saveProductionState({
        ...gameState,
        lifecycleState: "playable_candidate",
        lastVerifiedBuildId: input.buildId,
      });
    }

    // If retest of an issue: Close the issue!
    let closedIssue: MitchIssue | undefined;
    if (input.issueId) {
      const issue = await this.store.getIssue(input.tenantId, input.issueId);
      if (issue) {
        closedIssue = await this.store.updateIssue({
          ...issue,
          status: "closed",
          closingQaRunId: qaRun.id,
          closedAt: nowIso,
        });
      }
    }

    await this.store.recordAuditEvent({
      tenantId: input.tenantId,
      gameId: input.gameId,
      eventType: "mitch_gameplay_qa_passed",
      actorId: input.testerId,
      details: {
        buildId: input.buildId,
        milestoneId: input.milestoneId,
        isRetest,
        closedIssueId: closedIssue?.id,
      },
    });

    return { qaRun, verifiedBuild, closedIssue };
  }

  /**
   * Fix / Retest Step 1: Submit code fix for an open issue.
   * INVARIANT: Submitting a code fix DOES NOT close the issue.
   * It transitions issue to 'fix_submitted', records the fix build, and requires independent retest.
   */
  async submitCodeFix(input: {
    tenantId: string;
    issueId: string;
    fixWorkOrderId: string;
    fixBuildId: string;
  }): Promise<MitchIssue> {
    assertValidBuildIdentity(input.fixBuildId);

    const issue = await this.store.getIssue(input.tenantId, input.issueId);
    if (!issue) {
      throw new Error(`Issue "${input.issueId}" not found.`);
    }

    const updatedIssue = await this.store.updateIssue({
      ...issue,
      status: "fix_submitted",
      fixWorkOrderId: input.fixWorkOrderId,
      fixBuildId: input.fixBuildId,
    });

    // Milestone and game state move from fix_needed to exact_build_available (ready for retest)
    const gameState = await this.store.getProductionState(input.tenantId, issue.gameId);
    if (gameState) {
      await this.store.saveProductionState({
        ...gameState,
        lifecycleState: "exact_build_available",
        currentAvailableBuildId: input.fixBuildId,
        // Invariant: lastVerifiedBuildId remains untouched until retest passes!
      });
    }

    await this.store.recordAuditEvent({
      tenantId: input.tenantId,
      gameId: issue.gameId,
      eventType: "mitch_code_fix_submitted",
      actorId: "executor",
      details: {
        issueId: issue.id,
        fixBuildId: input.fixBuildId,
        note: "Code fix submitted; awaiting independent gameplay retest",
      },
    });

    return updatedIssue;
  }
}
