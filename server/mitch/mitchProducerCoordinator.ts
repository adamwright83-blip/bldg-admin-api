import { eventContract } from "../../shared/mitchEvents";
import type { MitchProducerDesignReview } from "../../shared/mitchProducerBus";

import {
  designReviewRequestMarker,
  designReviewResponseMarker,
} from "../../shared/mitchProducerBus";
import type { MitchBuild, MitchIssue, MitchMilestone, MitchWorkOrder } from "../../shared/mitchContracts";
import { GitHubProducerBus } from "./githubProducerBus";
import { MitchGameDispatcher } from "./mitchDispatcher";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import { MitchProductionService } from "./mitchService";
import { MitchQaService } from "./mitchQaService";
import type { IMitchProductionStore } from "./mitchStore";
import type { IMitchAgentWakeProvider } from "./mitchAgentWake";
import {
  SMALL_COMFORTS_GAME_ID,
  SMALL_COMFORTS_PROPRIETOR_MILESTONE,
  seedSmallComfortsProducerWork,
} from "./smallComfortsProduction";

export type MitchProducerCoordinatorResult =
  | { action: "dispatch_sent"; workOrderId: string }
  | { action: "dispatched"; workOrderId: string; buildId: string }
  | { action: "design_review_requested"; buildId: string }
  | { action: "design_review_fix_needed"; buildId: string; issueId: string }
  | { action: "design_review_waiting"; buildId: string }
  | { action: "human_play_requested"; buildId: string }
  | { action: "creative_acceptance_requested"; buildId: string }
  | { action: "fix_order_created"; workOrderId: string; issueId: string }
  | { action: "fix_submitted"; issueId: string; buildId: string }
  | { action: "idle"; reason: string };

export class MitchProducerCoordinator {
  constructor(
    private readonly deps: {
      tenantId: string;
      store: IMitchProductionStore;
      service: MitchProductionService;
      dispatcher: MitchGameDispatcher;
      reasoning: MitchProductionReasoningService;
      qa: MitchQaService;
      bus: GitHubProducerBus;
      wakeProvider?: IMitchAgentWakeProvider;
      eventDriven?: boolean;
      reviewerId?: string;
      initialBaseBranch?: string;
      initialBaseSha?: string;
    }
  ) {}

  async runOnce(): Promise<MitchProducerCoordinatorResult> {
    const seeded = await seedSmallComfortsProducerWork({
      tenantId: this.deps.tenantId,
      store: this.deps.store,
      service: this.deps.service,
      baseBranch: this.deps.initialBaseBranch,
      baseSha: this.deps.initialBaseSha,
    });

    await this.reconcileReturnedFixes();

    const orders = await this.deps.store.listWorkOrders(this.deps.tenantId, SMALL_COMFORTS_GAME_ID);
    const pending = orders
      .filter(order => order.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    const beforeDispatch = await this.deps.reasoning.inspectProductionState(this.deps.tenantId, SMALL_COMFORTS_GAME_ID);
    if (beforeDispatch.blockers.isHumanCreativeBlocker) return { action: "idle", reason: "HUMAN CREATIVE DECISION REQUIRED" };
    if (pending) {
      if (this.deps.eventDriven) {
        const order = await this.deps.dispatcher.startAutonomous({ tenantId: this.deps.tenantId, workOrderId: pending.id });
        return { action: "dispatch_sent", workOrderId: order.id };
      }
      const result = await this.deps.dispatcher.dispatchAutonomous({
        tenantId: this.deps.tenantId,
        workOrderId: pending.id,
      });
      return {
        action: "dispatched",
        workOrderId: pending.id,
        buildId: result.build.id,
      };
    }

    const inspection = await this.deps.reasoning.inspectProductionState(
      this.deps.tenantId,
      SMALL_COMFORTS_GAME_ID
    );

    if (inspection.nextBoundedOutcome.recommendedAction === "dispatch_fix") {
      const existingActive = orders.find(order =>
        ["pending", "claimed", "executing"].includes(order.status)
      );
      if (existingActive) {
        return { action: "idle", reason: "Fix work is already in flight." };
      }
      const issue = (await this.deps.store.listIssues(this.deps.tenantId, SMALL_COMFORTS_GAME_ID, "open"))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!issue) return { action: "idle", reason: "Reasoner requested a fix but no open issue exists." };
      const order = await this.createFixOrder(issue);
      return { action: "fix_order_created", workOrderId: order.id, issueId: issue.id };
    }

    if (
      inspection.nextBoundedOutcome.recommendedAction === "perform_gameplay_qa" ||
      inspection.nextBoundedOutcome.recommendedAction === "retest_fix"
    ) {
      const milestone = inspection.incompleteMilestone;
      const buildId =
        inspection.nextBoundedOutcome.recommendedAction === "retest_fix"
          ? (await this.latestFixBuildId())
          : milestone?.currentAvailableBuildId;
      if (!milestone || !buildId) {
        return { action: "idle", reason: "QA routing requested without a concrete milestone/build." };
      }
      return this.routeDesignReview(milestone, buildId);
    }

    if (inspection.nextBoundedOutcome.recommendedAction === "ready_for_creative_acceptance") {
      const buildId = inspection.lastVerifiedBuildId ?? inspection.currentAvailableBuildId;
      if (!buildId) return { action: "idle", reason: "Creative acceptance requested without a build." };
      await this.requestAdamDecision(buildId, "Formal gameplay QA passed. Final creative acceptance remains Adam's decision.");
      return { action: "creative_acceptance_requested", buildId };
    }

    const failed = orders
      .filter(order => order.status === "failed" && order.attemptCount < order.maxAttempts)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (failed && orders.filter(order => order.milestoneId === failed.milestoneId && order.status === "failed").length < failed.maxAttempts) {
      const retry = await this.retryFailedOrder(failed);
      return { action: "fix_order_created", workOrderId: retry.id, issueId: "execution_retry" };
    }

    return {
      action: "idle",
      reason: inspection.nextBoundedOutcome.description || seeded.state.lifecycleState,
    };
  }

  async acceptReview(
    milestone: MitchMilestone,
    buildId: string,
    review: MitchProducerDesignReview,
    reviewerId: string
  ): Promise<MitchProducerCoordinatorResult> {
    return this.routeDesignReview(milestone, buildId, review, reviewerId);
  }

  /** Drain bounded immediate transitions until waiting on an external actor. */
  async advance(): Promise<void> {
    for (let step = 0; step < 8; step++) {
      const result = await this.runOnce();
      if (!["dispatched", "fix_order_created", "design_review_fix_needed", "fix_submitted"].includes(result.action)) return;
    }
    throw new Error("Producer exceeded bounded immediate transition limit");
  }

  private async routeDesignReview(
    milestone: MitchMilestone,
    buildId: string,
    suppliedReview?: MitchProducerDesignReview,
    suppliedReviewerId?: string
  ): Promise<MitchProducerCoordinatorResult> {
    const build = await this.deps.store.getBuild(this.deps.tenantId, buildId);
    const reviewerId = suppliedReview
      ? suppliedReviewerId
      : (this.deps.reviewerId ?? "chatgpt_design_review");
    if (!reviewerId) throw new Error("Authenticated reviewer identity is required");
    if (!build) return { action: "idle", reason: `Build ${buildId} is not durable in Mitch store.` };

    const reopenCount = (await this.deps.store.listAuditEvents(this.deps.tenantId, milestone.gameId))
      .filter(a => a.eventType === "mitch_review_reopened" && a.details.buildId === buildId).length;
    const requestMarker = designReviewRequestMarker(milestone.id, buildId) + (reopenCount ? ":reopen:" + reopenCount : "");
    const responseMarker = designReviewResponseMarker(milestone.id, buildId);
    const fixIssue = (await this.deps.store.listIssues(this.deps.tenantId, SMALL_COMFORTS_GAME_ID))
      .find(issue => issue.status === "fix_submitted" && issue.fixBuildId === buildId);
    const response = suppliedReview ? { review: suppliedReview, comment: { html_url: suppliedReview.evidenceArtifact } } :
      this.deps.eventDriven ? null : await this.deps.bus.readDesignReview({ marker: responseMarker });

    if (!response) {
      if (!(await this.deps.bus.hasMarker(requestMarker))) {
        const run = await this.deps.store.getExecutionRun(this.deps.tenantId, build.executionRunId);
        const order = await this.deps.store.getWorkOrder(this.deps.tenantId, build.workOrderId);
        if (!order) throw new Error("Review build has no work order");
        const body = [
          "## MITCH → CHATGPT",
          "<!-- " + requestMarker + " -->",
          "",
          "**Independent design/QA review requested.**",
          "",
          "**Game:** Small Comforts",
          "**Milestone:** " + milestone.title,
          "**Exact build:** " + build.id,
          "**Branch:** " + build.branch,
          "**Commit:** " + build.commitSha,
          "",
          "### Acceptance criteria",
          ...milestone.acceptanceCriteria.map(item => "- " + item),
          "",
          "### Executor handback",
          run?.whatChanged ?? "No implementation summary was recorded.",
          "",
          "### Evidence",
          run ? JSON.stringify(run.evidence, null, 2) : "No evidence payload recorded.",
          "",
          "### Known limitations",
          run?.knownLimitations ?? "None recorded.",
          "",
          "Review the exact branch/SHA and available evidence. Do not invent hands-on play.",
          "If a concrete design/UX defect is visible from code/captures, use verdict fix_needed.",
          "If nothing blocking is visible but you did not personally exercise the build, use human_play_required.",
          "Only use no_blocking_issue with gameActuallyExercised=true when the exact build was actually exercised.",
          "",
          eventContract(order, reviewerId, "design_review_handback", {
            buildId: build.id, branch: build.branch, commitSha: build.commitSha,
            review: { verdict: "fix_needed", observedBehavior: "observed result", evidenceArtifact: "capture/code/preview reference",
              recommendedNextProof: "one bounded next proof", gameActuallyExercised: false, acceptancePassed: false }
          }),
        ].join("\n");
        await this.deps.store.recordAuditEvent({ tenantId: this.deps.tenantId, gameId: order.gameId,
          eventType: "mitch_review_requested", actorId: reviewerId,
          details: { workOrderId: order.id, milestoneId: milestone.id, buildId: build.id, branch: build.branch, commitSha: build.commitSha } });
        const comment = await this.deps.bus.postComment(body);
        if (!this.deps.wakeProvider || !this.deps.wakeProvider.hasTarget(reviewerId)) {
          throw new Error(`No immediate outbound wake target configured for reviewer "${reviewerId}"`);
        }
        await this.deps.wakeProvider.wake({
          wakeId: `review:${milestone.id}:${build.id}:${reopenCount}`,
          actorId: reviewerId,
          kind: fixIssue ? "retest_request" : "design_review_request",
          tenantId: this.deps.tenantId,
          gameId: order.gameId,
          milestoneId: milestone.id,
          workOrderId: order.id,
          buildId: build.id,
          issueCommentUrl: comment.html_url ?? null,
        });
        return { action: "design_review_requested", buildId };
      }
      return { action: "design_review_waiting", buildId };
    }

    const review = response.review;
    const retest = fixIssue ? { issueId: fixIssue.id, previousFailedQaRunId: fixIssue.originatingQaRunId } : {};

    if (review.verdict === "fix_needed") {
      const qa = await this.deps.qa.recordGameplayQaRun({
        ...retest,
        tenantId: this.deps.tenantId,
        gameId: SMALL_COMFORTS_GAME_ID,
        milestoneId: milestone.id,
        buildId,
        testerId: reviewerId,
        scenario: "Independent producer-bus review of the proprietor fun proof",
        expectedBehavior: milestone.desiredPlayerVisibleResult,
        observedBehavior: review.observedBehavior,
        gameActuallyExercised: review.gameActuallyExercised,
        acceptancePassed: false,
        status: "failed",
        evidenceArtifact: response.comment.html_url || review.evidenceArtifact,
      });
      return {
        action: "design_review_fix_needed",
        buildId,
        issueId: qa.issue?.id ?? "unknown",
      };
    }

    if (
      review.verdict === "no_blocking_issue" &&
      review.gameActuallyExercised &&
      review.acceptancePassed
    ) {
      await this.deps.qa.recordGameplayQaRun({
        ...retest,
        tenantId: this.deps.tenantId,
        gameId: SMALL_COMFORTS_GAME_ID,
        milestoneId: milestone.id,
        buildId,
        testerId: reviewerId,
        scenario: "Independent producer-bus gameplay QA of the proprietor fun proof",
        expectedBehavior: milestone.desiredPlayerVisibleResult,
        observedBehavior: review.observedBehavior,
        gameActuallyExercised: true,
        acceptancePassed: true,
        status: "passed",
        evidenceArtifact: response.comment.html_url || review.evidenceArtifact,
      });
      await this.requestAdamDecision(
        buildId,
        "Independent gameplay QA passed. Creative acceptance is still yours."
      );
      return { action: "creative_acceptance_requested", buildId };
    }

    await this.deps.store.saveMilestone({ ...milestone, isHumanCreativeBlocker: true, status: "blocked", blockedReason: "HUMAN CREATIVE DECISION REQUIRED" });
    await this.requestAdamDecision(
      buildId,
      "The implementation/design review found no automatic blocking decision it can truthfully close. Please play the exact build and decide whether controlling the proprietor is actually fun."
    );
    return { action: "human_play_requested", buildId };
  }

  private async requestAdamDecision(buildId: string, reason: string): Promise<void> {
    const build = await this.deps.store.getBuild(this.deps.tenantId, buildId);
    const order = build && await this.deps.store.getWorkOrder(this.deps.tenantId, build.workOrderId);
    if (!build || !order) throw new Error("Human decision requires an exact build/work order");
    const reopenCount = (await this.deps.store.listAuditEvents(this.deps.tenantId, order.gameId))
      .filter(a => a.eventType === "mitch_review_reopened" && a.details.buildId === buildId).length;
    const marker = "mitch-human-decision:" + buildId + (reopenCount ? ":reopen:" + reopenCount : "");
    if (await this.deps.bus.hasMarker(marker)) return;
    await this.deps.bus.postComment(
      [
        "## MITCH → ADAM",
        "<!-- " + marker + " -->",
        "",
        "**Exact build:** " + buildId,
        "",
        reason,
        eventContract(order, "adam", "human_decision", { buildId: build.id, branch: build.branch, commitSha: build.commitSha,
          decision: build.isVerified ? "accept" : "resolve_blocker", note: "Your decision and reason" }),
        "",
        "Mitch is intentionally stopped here. IMPLEMENTED/VERIFIED is not creative acceptance.",
      ].join("\n")
    );
  }

  private async createFixOrder(issue: MitchIssue): Promise<MitchWorkOrder> {
    const milestone = (await this.deps.store.listMilestones(this.deps.tenantId, SMALL_COMFORTS_GAME_ID))
      .find(item => item.id === issue.milestoneId);
    if (!milestone) throw new Error(`Milestone ${issue.milestoneId} for issue ${issue.id} was not found.`);

    const builds = await this.deps.store.listBuilds(this.deps.tenantId, SMALL_COMFORTS_GAME_ID);
    const base = builds.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!base) throw new Error("Cannot create fix work order without an exact prior build.");

    const order = await this.deps.service.createWorkOrder({
      tenantId: this.deps.tenantId,
      gameId: SMALL_COMFORTS_GAME_ID,
      milestoneKey: milestone.milestoneKey,
      title: "Fix producer-review issue: " + issue.title,
      desiredPlayerVisibleResult: milestone.desiredPlayerVisibleResult,
      acceptanceCriteria: [
        ...milestone.acceptanceCriteria,
        "Resolve the specific observed issue: " + issue.description,
      ],
      canonConstraints: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.canonConstraints],
      relevantDependencies: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.relevantDependencies],
      realBusinessEvidenceConstraints: [
        "Game-development work only; never manufacture or mutate real business evidence.",
      ],
      baseBranch: base.branch,
      baseSha: base.commitSha,
      requiredArtifact: "client/src/components/admin/control-room/SmallComforts/game/game.ts",
      requiredTests: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.requiredTests],
      requiredEvidence: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.requiredEvidence],
    });

    await this.deps.store.updateIssue({ ...issue, fixWorkOrderId: order.id });
    return order;
  }

  private async retryFailedOrder(failed: MitchWorkOrder): Promise<MitchWorkOrder> {
    return this.deps.service.createWorkOrder({
      tenantId: failed.tenantId,
      gameId: failed.gameId,
      milestoneKey: failed.milestoneKey,
      title: failed.title + " (retry)",
      desiredPlayerVisibleResult: failed.desiredPlayerVisibleResult,
      acceptanceCriteria: failed.acceptanceCriteria,
      canonConstraints: failed.canonConstraints,
      relevantDependencies: failed.relevantDependencies,
      realBusinessEvidenceConstraints: failed.realBusinessEvidenceConstraints,
      baseBranch: failed.baseBranch,
      baseSha: failed.baseSha,
      requiredArtifact: failed.requiredArtifact,
      requiredTests: failed.requiredTests,
      requiredEvidence: failed.requiredEvidence,
    });
  }

  private async reconcileReturnedFixes(): Promise<void> {
    const issues = await this.deps.store.listIssues(this.deps.tenantId, SMALL_COMFORTS_GAME_ID);
    for (const issue of issues) {
      if (issue.status !== "open" || !issue.fixWorkOrderId) continue;
      const order = await this.deps.store.getWorkOrder(this.deps.tenantId, issue.fixWorkOrderId);
      if (!order || order.status !== "implementation_returned") continue;
      const builds = await this.deps.store.listBuilds(this.deps.tenantId, SMALL_COMFORTS_GAME_ID);
      const build = builds.find(item => item.workOrderId === order.id);
      if (!build) continue;
      await this.deps.qa.submitCodeFix({
        tenantId: this.deps.tenantId,
        issueId: issue.id,
        fixWorkOrderId: order.id,
        fixBuildId: build.id,
      });
    }
  }

  private async latestFixBuildId(): Promise<string | null> {
    const issues = await this.deps.store.listIssues(this.deps.tenantId, SMALL_COMFORTS_GAME_ID);
    const fix = issues
      .filter(issue => issue.status === "fix_submitted" && issue.fixBuildId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return fix?.fixBuildId ?? null;
  }
}
