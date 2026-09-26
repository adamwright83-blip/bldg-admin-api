import {
  assertAllowedCandyBarRepository,
  authorityAllowsEngineer,
  canTransitionCandyBar,
  parseArchitectPlan,
  parseReviewCritique,
  type CandyBarAuthorityLevel,
  type CandyBarHumanGateReason,
  type CandyBarProviderId,
  type CandyBarRunRecord,
  type CandyBarRunState,
  type CandyBarStepKind,
  type CandyBarWorkflowPolicy,
  type ReconciledBrief,
} from "../../shared/candyBar";
import {
  buildArchitectPrompt,
  buildEngineerPrompt,
  buildReconciliationPrompt,
  buildRepairPrompt,
  buildReviewerPrompt,
} from "./prompts";
import {
  asArchitectPlan,
  asReviewCritique,
  parseReconciledBrief,
  type ArchitectAdapter,
  type CandyBarProviders,
  type EngineerAdapter,
  type ReviewerAdapter,
} from "./providers/types";
import type { CandyBarStore } from "./store";
import { logAgentEvent } from "../agents/agentEvents";
import type { EngineeringTerminalResult } from "../goldline/engineering/agentsClient";

export type CandyBarOrchestratorOptions = {
  store: CandyBarStore;
  providers: CandyBarProviders;
  /** Injected reconcile model (Architect seat). Prefer same provider as Architect. */
  reconcileInvoke?: (prompt: string) => Promise<Record<string, unknown>>;
  leaseOwner?: string;
  leaseMs?: number;
  now?: () => Date;
  /** When true, skip agent event DB writes (tests). */
  silentEvents?: boolean;
};

function log(event: string, fields: Record<string, unknown>) {
  console.info(`[CandyBar] ${event}`, JSON.stringify(fields));
}

export class CandyBarOrchestrator {
  private readonly store: CandyBarStore;
  private readonly providers: CandyBarProviders;
  private readonly reconcileInvoke?: (prompt: string) => Promise<Record<string, unknown>>;
  private readonly leaseOwner: string;
  private readonly leaseMs: number;
  private readonly now: () => Date;
  private readonly silentEvents: boolean;
  /** In-process dedupe for duplicate provider/GitHub callbacks. */
  private readonly processedEventKeys = new Set<string>();

  constructor(opts: CandyBarOrchestratorOptions) {
    this.store = opts.store;
    this.providers = opts.providers;
    this.reconcileInvoke = opts.reconcileInvoke;
    this.leaseOwner = opts.leaseOwner ?? `candy-bar-${process.pid}`;
    this.leaseMs = opts.leaseMs ?? 60_000;
    this.now = opts.now ?? (() => new Date());
    this.silentEvents = opts.silentEvents ?? false;
  }

  /** Hard policy: Candy Bar never merges. */
  attemptMerge(): never {
    throw new Error("Candy Bar V0 refuses merge");
  }

  /** Hard policy: Candy Bar never deploys. */
  attemptDeploy(): never {
    throw new Error("Candy Bar V0 refuses deploy");
  }

  /** Hard policy: Candy Bar never applies production migrations. */
  attemptProductionMigration(): never {
    throw new Error("Candy Bar V0 refuses production migrations");
  }

  async createRun(input: {
    tenantId: string;
    operatorUserId: string;
    currentGoal?: string;
    policy?: Partial<CandyBarWorkflowPolicy>;
    repository?: string;
  }): Promise<CandyBarRunRecord> {
    const repository = input.repository ?? "adamwright83-blip/bldg-admin-api";
    assertAllowedCandyBarRepository(repository);
    let workflow = await this.store.getWorkflow({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      repository,
    });
    if (!workflow) {
      if (!input.currentGoal?.trim()) {
        throw new Error("currentGoal_required");
      }
      workflow = await this.store.upsertWorkflow({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        repository,
        currentGoal: input.currentGoal.trim(),
        policy: input.policy,
        actorUserId: input.operatorUserId,
      });
    } else if (input.currentGoal?.trim() && input.currentGoal.trim() !== workflow.currentGoal) {
      workflow = await this.store.upsertWorkflow({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        repository,
        currentGoal: input.currentGoal.trim(),
        policy: input.policy ?? {
          autoPlanNext: workflow.autoPlanNext,
          providerFallbackPolicy: workflow.providerFallbackPolicy,
          roadmapContext: workflow.roadmapContext,
          protectedAreas: workflow.protectedAreas,
          knownParallelWork: workflow.knownParallelWork,
          nonGoals: workflow.nonGoals,
        },
        actorUserId: input.operatorUserId,
      });
    } else if (input.policy) {
      workflow = await this.store.upsertWorkflow({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        repository,
        currentGoal: workflow.currentGoal,
        policy: input.policy,
        actorUserId: input.operatorUserId,
      });
    }
    const baseSha = await this.providers.github.getMainSha(repository, "main");
    const run = await this.store.createRun({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      workflowId: workflow.id,
      baseSha,
    });
    log("run_created", { runId: run.id, tenantId: run.tenantId, goalVersion: run.goalSnapshot.goalVersion });
    await this.emitEvent(run, "candy_bar.run_created", { state: run.state });
    return run;
  }

  async setCurrentGoal(input: {
    tenantId: string;
    operatorUserId: string;
    actorUserId: string;
    currentGoal: string;
    repository?: string;
    policy?: Partial<CandyBarWorkflowPolicy>;
  }) {
    if (input.actorUserId !== input.operatorUserId) {
      throw new Error("forbidden_goal_update");
    }
    // Provider output path must never call this — only human API.
    return this.store.upsertWorkflow({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      repository: input.repository,
      currentGoal: input.currentGoal,
      policy: input.policy,
      actorUserId: input.actorUserId,
    });
  }

  async cancelRun(input: {
    tenantId: string;
    operatorUserId: string;
    runId: string;
    actorUserId: string;
    reason?: string;
  }) {
    const run = await this.store.getRun({
      tenantId: input.tenantId,
      id: input.runId,
      operatorUserId: input.operatorUserId,
    });
    if (!run) return null;
    if (run.state === "CANCELLED" || run.state === "COMPLETED") return run;
    await this.store.createApproval({
      runId: run.id,
      tenantId: run.tenantId,
      operatorUserId: run.operatorUserId,
      action: "cancel",
      reason: input.reason ?? null,
      actorUserId: input.actorUserId,
    });
    const from = run.state;
    if (canTransitionCandyBar(from, "CANCELLED")) {
      return this.store.transitionRun({ runId: run.id, from, to: "CANCELLED" });
    }
    return this.store.updateRun(run.id, {
      state: "CANCELLED",
      completedAt: this.now().toISOString(),
    });
  }

  async approveContinuation(input: {
    tenantId: string;
    operatorUserId: string;
    runId: string;
    actorUserId: string;
  }) {
    const run = await this.store.getRun({
      tenantId: input.tenantId,
      id: input.runId,
      operatorUserId: input.operatorUserId,
    });
    if (!run) return null;
    await this.store.createApproval({
      runId: run.id,
      tenantId: run.tenantId,
      operatorUserId: run.operatorUserId,
      action: "approve_continuation",
      reason: null,
      actorUserId: input.actorUserId,
    });
    // Human approval only — provider cannot self-approve.
    if (run.state === "NEEDS_HUMAN" && run.authorityLevel && authorityAllowsEngineer(run.authorityLevel)) {
      return this.store.transitionRun({
        runId: run.id,
        from: "NEEDS_HUMAN",
        to: "ENGINEER_RUNNING",
        patch: { humanGateReason: null, blocker: null },
      });
    }
    return run;
  }

  /**
   * Advance one run by one orchestration tick. Idempotent under lease.
   */
  async tickRun(runId: string): Promise<CandyBarRunRecord | null> {
    let run = await this.getRunAnyTenant(runId);
    if (!run) return null;
    if (run.state === "CANCELLED" || run.state === "COMPLETED") return run;

    const now = this.now();
    const leaseExpired =
      !run.leaseExpiresAt || new Date(run.leaseExpiresAt).getTime() <= now.getTime();
    if (run.leaseOwner && run.leaseOwner !== this.leaseOwner && !leaseExpired) {
      return run; // another worker holds the lease
    }

    const lease = await this.store.updateRun(run.id, {
      leaseOwner: this.leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + this.leaseMs).toISOString(),
    });
    run = lease ?? run;

    if (this.exceededLimits(run)) {
      const policy = run.goalSnapshot.policy;
      let reason: CandyBarHumanGateReason = "MAX_STEPS";
      if (
        policy.budgetCents != null &&
        run.spendKnown &&
        run.estimatedSpendCents != null &&
        run.estimatedSpendCents >= policy.budgetCents
      ) {
        reason = "BUDGET_EXCEEDED";
      } else if (run.startedAt) {
        const age = this.now().getTime() - new Date(run.startedAt).getTime();
        if (age > policy.maxWallClockMs) reason = "MAX_AGE";
      }
      return this.enterHumanGate(run, reason, "Run limits exceeded");
    }

    switch (run.state) {
      case "CREATED":
        return this.beginContext(run);
      case "ASSEMBLING_CONTEXT":
        return this.runContextAssembly(run);
      case "ARCHITECT_RUNNING":
        return this.runArchitect(run);
      case "ARCHITECT_COMPLETE":
        return this.startReviewer(run);
      case "REVIEWER_RUNNING":
        return this.runReviewer(run);
      case "REVIEW_COMPLETE":
        return this.startReconcile(run);
      case "RECONCILING":
        return this.runReconcile(run);
      case "BRIEF_READY":
        return this.classifyAuthority(run);
      case "AUTHORITY_CLASSIFIED":
        return this.dispatchEngineerOrGate(run);
      case "ENGINEER_RUNNING":
        return this.runEngineer(run);
      case "PR_OPEN":
        return this.observePr(run);
      case "CI_RUNNING":
        return this.observeCi(run);
      case "REPAIR_REQUIRED":
        return this.startRepair(run);
      case "ENGINEER_REPAIRING":
        return this.runRepair(run);
      case "READY_FOR_HUMAN":
        return this.maybeObserveMergeForNext(run);
      default:
        return run;
    }
  }

  async heartbeat(input?: { maxRuns?: number }): Promise<number> {
    const max = input?.maxRuns ?? 3;
    let processed = 0;
    for (let i = 0; i < max; i++) {
      const claimed = await this.store.claimRunnableRun({
        leaseOwner: this.leaseOwner,
        leaseMs: this.leaseMs,
        now: this.now(),
      });
      if (!claimed) break;
      await this.tickRun(claimed.id);
      processed += 1;
    }
    return processed;
  }

  async handleProviderCompletion(input: {
    runId: string;
    stepId: string;
    eventKey: string;
  }): Promise<CandyBarRunRecord | null> {
    if (this.processedEventKeys.has(input.eventKey)) {
      const run = await this.store.getRun({ tenantId: "default", id: input.runId });
      // tenant-agnostic lookup for tests
      return run ?? (await this.getRunAnyTenant(input.runId));
    }
    this.processedEventKeys.add(input.eventKey);
    return this.tickRun(input.runId);
  }

  async handleGithubStatusEvent(input: {
    runId: string;
    eventKey: string;
  }): Promise<CandyBarRunRecord | null> {
    if (this.processedEventKeys.has(input.eventKey)) {
      return this.getRunAnyTenant(input.runId);
    }
    this.processedEventKeys.add(input.eventKey);
    return this.tickRun(input.runId);
  }

  async handleMergedObservation(input: {
    runId: string;
    prNumber: number;
    headSha: string;
    eventKey: string;
  }): Promise<{ run: CandyBarRunRecord | null; nextRun: CandyBarRunRecord | null }> {
    if (this.processedEventKeys.has(input.eventKey)) {
      const run = await this.getRunAnyTenant(input.runId);
      return { run, nextRun: null };
    }
    this.processedEventKeys.add(input.eventKey);
    const run = await this.getRunAnyTenant(input.runId);
    if (!run) return { run: null, nextRun: null };
    if (run.candidatePrNumber !== input.prNumber) {
      return { run, nextRun: null };
    }
    if (run.candidateHeadSha && run.candidateHeadSha !== input.headSha) {
      return { run, nextRun: null };
    }
    let next = run;
    if (canTransitionCandyBar(run.state, "COMPLETED") || run.state === "READY_FOR_HUMAN") {
      next =
        (await this.store.transitionRun({
          runId: run.id,
          from: run.state === "READY_FOR_HUMAN" ? "READY_FOR_HUMAN" : run.state,
          to: "COMPLETED",
        })) ?? run;
    }
    const nextRun = await this.maybeSpawnNextPlan(next);
    return { run: next, nextRun };
  }

  // --- internals ---

  private async findTenant(runId: string): Promise<string | null> {
    const run = await this.getRunAnyTenant(runId);
    return run?.tenantId ?? null;
  }

  private async getRunAnyTenant(runId: string): Promise<CandyBarRunRecord | null> {
    // Memory store: scan via update no-op pattern — getRun needs tenant.
    // Tests use known tenants; production store should index by id.
    const probe = await this.store.getRun({ tenantId: "default", id: runId });
    if (probe) return probe;
    // Fallback: try listing is not available cross-tenant. Memory store exposes maps.
    const mem = this.store as unknown as { runs?: Map<string, CandyBarRunRecord> };
    if (mem.runs?.has(runId)) {
      const r = mem.runs.get(runId)!;
      return this.store.getRun({ tenantId: r.tenantId, id: runId });
    }
    return null;
  }

  private exceededLimits(run: CandyBarRunRecord): boolean {
    const policy = run.goalSnapshot.policy;
    if (run.stepCount >= policy.maxStepsPerRun) return true;
    if (run.providerFailureCount >= policy.maxProviderFailures) return true;
    if (run.startedAt) {
      const age = this.now().getTime() - new Date(run.startedAt).getTime();
      if (age > policy.maxWallClockMs) return true;
    }
    if (
      policy.budgetCents != null &&
      run.spendKnown &&
      run.estimatedSpendCents != null &&
      run.estimatedSpendCents >= policy.budgetCents
    ) {
      return true;
    }
    return false;
  }

  private budgetBlocksPaidDispatch(run: CandyBarRunRecord): boolean {
    const budget = run.goalSnapshot.policy.budgetCents;
    return (
      budget != null &&
      run.spendKnown &&
      run.estimatedSpendCents != null &&
      run.estimatedSpendCents >= budget
    );
  }

  private async enterHumanGate(
    run: CandyBarRunRecord,
    reason: CandyBarHumanGateReason,
    blocker: string
  ) {
    log("human_gate_entered", { runId: run.id, reason, blocker });
    const from = run.state;
    if (canTransitionCandyBar(from, "NEEDS_HUMAN")) {
      return this.store.transitionRun({
        runId: run.id,
        from,
        to: "NEEDS_HUMAN",
        patch: { humanGateReason: reason, blocker },
      });
    }
    if (canTransitionCandyBar(from, "BLOCKED")) {
      return this.store.transitionRun({
        runId: run.id,
        from,
        to: "BLOCKED",
        patch: { humanGateReason: reason, blocker },
      });
    }
    return this.store.updateRun(run.id, { humanGateReason: reason, blocker, state: "NEEDS_HUMAN" });
  }

  private async beginContext(run: CandyBarRunRecord) {
    return this.store.transitionRun({
      runId: run.id,
      from: "CREATED",
      to: "ASSEMBLING_CONTEXT",
      patch: { startedAt: this.now().toISOString() },
    });
  }

  private async createStep(run: CandyBarRunRecord, kind: CandyBarStepKind, suffix: string) {
    return this.store.createStep({
      runId: run.id,
      kind,
      idempotencyKey: `${run.id}:${kind}:${suffix}`,
    });
  }

  private async claimOrSkip(stepId: string) {
    return this.store.claimStep({
      stepId,
      leaseOwner: this.leaseOwner,
      leaseMs: this.leaseMs,
      now: this.now(),
    });
  }

  private async runContextAssembly(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "context_assembly", "v1");
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    await this.store.updateStep(claimed.id, { status: "running", provider: "github", startedAt: this.now().toISOString() });
    log("step_claimed", { runId: run.id, stepId: claimed.id, kind: "context_assembly" });

    const goal = run.goalSnapshot;
    const repo = await this.providers.github.getRepoContext({
      repository: run.repository,
      baseBranch: run.baseBranch,
      currentGoal: goal.currentGoal,
      goalVersion: goal.goalVersion,
      protectedAreas: goal.policy.protectedAreas,
      knownParallelWork: goal.policy.knownParallelWork,
      nonGoals: goal.policy.nonGoals,
    });

    const artifact = await this.store.createArtifact({
      runId: run.id,
      type: "REPO_CONTEXT",
      producer: "context_assembly",
      provider: "github",
      content: repo as unknown as Record<string, unknown>,
    });

    await this.store.updateStep(claimed.id, {
      status: "completed",
      completedAt: this.now().toISOString(),
      outputArtifactIds: [artifact.id],
    });

    return this.store.transitionRun({
      runId: run.id,
      from: "ASSEMBLING_CONTEXT",
      to: "ARCHITECT_RUNNING",
      patch: {
        baseSha: repo.mainSha,
        plannedAgainstSha: repo.mainSha,
      },
    });
  }

  private async resolveArchitect(run: CandyBarRunRecord): Promise<{
    adapter: ArchitectAdapter;
    provider: CandyBarProviderId;
  } | { gate: CandyBarHumanGateReason; message: string }> {
    const preferred = run.goalSnapshot.policy.preferredArchitect;
    const fallback = run.goalSnapshot.policy.providerFallbackPolicy;
    if (preferred === "fake" || this.providers.architect.providerId === "fake") {
      return { adapter: this.providers.architect, provider: this.providers.architect.providerId };
    }
    if (preferred === this.providers.architect.providerId) {
      return { adapter: this.providers.architect, provider: this.providers.architect.providerId };
    }
    if (preferred === "anthropic" && this.providers.architect.providerId === "anthropic") {
      return { adapter: this.providers.architect, provider: "anthropic" };
    }
    if (fallback.allowOpenAiForArchitect && this.providers.architect.providerId === "openai") {
      return { adapter: this.providers.architect, provider: "openai" };
    }
    if (fallback.allowOpenAiForArchitect) {
      // Prefer injected provider if it is openai
      if (this.providers.architect.providerId === "openai") {
        return { adapter: this.providers.architect, provider: "openai" };
      }
    }
    // If preferred unavailable, try fallback openai only when allowed
    if (preferred !== "openai" && !fallback.allowOpenAiForArchitect) {
      return {
        gate: "PROVIDER_UNAVAILABLE",
        message: `Preferred Architect ${preferred} unavailable and OpenAI fallback not configured`,
      };
    }
    return { adapter: this.providers.architect, provider: this.providers.architect.providerId };
  }

  private async resolveReviewer(run: CandyBarRunRecord): Promise<{
    adapter: ReviewerAdapter;
    provider: CandyBarProviderId;
  } | { gate: CandyBarHumanGateReason; message: string }> {
    const preferred = run.goalSnapshot.policy.preferredReviewer;
    const fallback = run.goalSnapshot.policy.providerFallbackPolicy;
    if (this.providers.reviewer.providerId === "fake") {
      return { adapter: this.providers.reviewer, provider: "fake" };
    }
    if (preferred === this.providers.reviewer.providerId) {
      return { adapter: this.providers.reviewer, provider: this.providers.reviewer.providerId };
    }
    if (fallback.allowOpenAiForReviewer && this.providers.reviewer.providerId === "openai") {
      return { adapter: this.providers.reviewer, provider: "openai" };
    }
    return {
      gate: "PROVIDER_UNAVAILABLE",
      message: `Preferred Reviewer ${preferred} unavailable and approved fallback not configured`,
    };
  }

  private async resolveEngineer(run: CandyBarRunRecord): Promise<{
    adapter: EngineerAdapter;
    provider: CandyBarProviderId;
  } | { gate: CandyBarHumanGateReason; message: string }> {
    const preferred = run.goalSnapshot.policy.preferredEngineer;
    const fallback = run.goalSnapshot.policy.providerFallbackPolicy;
    if (this.providers.engineer.providerId === "fake") {
      return { adapter: this.providers.engineer, provider: "fake" };
    }
    if (preferred === this.providers.engineer.providerId) {
      return { adapter: this.providers.engineer, provider: this.providers.engineer.providerId };
    }
    if (fallback.allowOpenAiForEngineer && this.providers.engineer.providerId === "openai") {
      return { adapter: this.providers.engineer, provider: "openai" };
    }
    // If preferred is cursor and engineer is openai with fallback — ok
    if (preferred === "cursor" && fallback.allowOpenAiForEngineer) {
      if (this.providers.engineer.providerId === "openai") {
        return { adapter: this.providers.engineer, provider: "openai" };
      }
    }
    return {
      gate: "PROVIDER_UNAVAILABLE",
      message: `Preferred Engineer ${preferred} unavailable and approved fallback not configured`,
    };
  }

  private async runArchitect(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "architect", String(run.iteration));
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run; // duplicate heartbeat

    if (this.budgetBlocksPaidDispatch(run)) {
      return this.enterHumanGate(run, "BUDGET_EXCEEDED", "Per-run budget prevents paid Architect dispatch");
    }

    const resolved = await this.resolveArchitect(run);
    if ("gate" in resolved) {
      return this.enterHumanGate(run, resolved.gate, resolved.message);
    }

    const repoArt = await this.store.latestArtifact(run.id, "REPO_CONTEXT");
    if (!repoArt) {
      return this.enterHumanGate(run, "MALFORMED_PROVIDER_OUTPUT", "Missing REPO_CONTEXT");
    }

    await this.store.updateStep(claimed.id, {
      status: "running",
      provider: resolved.provider,
      startedAt: this.now().toISOString(),
    });
    log("provider_dispatched", { runId: run.id, role: "architect", provider: resolved.provider });

    const prompt = buildArchitectPrompt({
      goal: run.goalSnapshot,
      repo: repoArt.content as unknown as Parameters<typeof buildArchitectPrompt>[0]["repo"],
      run,
    });
    const result = await resolved.adapter.plan({ prompt });

    if (!result.ok) {
      await this.store.updateStep(claimed.id, {
        status: "failed",
        error: result.message,
        completedAt: this.now().toISOString(),
      });
      const failures = run.providerFailureCount + 1;
      await this.store.updateRun(run.id, { providerFailureCount: failures });
      if (result.code === "AUTH_FAILURE") {
        return this.enterHumanGate(run, "AUTH_FAILURE", result.message);
      }
      if (!result.retryable) {
        return this.enterHumanGate(run, "PROVIDER_UNAVAILABLE", result.message);
      }
      await this.store.updateRun(run.id, {
        nextRetryAt: new Date(this.now().getTime() + 5_000).toISOString(),
        lastError: result.message,
      });
      return this.getRunAnyTenant(run.id);
    }

    log("provider_completed", { runId: run.id, role: "architect", provider: result.provider });
    const plan = parseArchitectPlan(result.content) ?? asArchitectPlan(result.content);
    if (!plan) {
      log("provider_malformed_result", { runId: run.id, role: "architect" });
      await this.store.updateStep(claimed.id, {
        status: "failed",
        error: "malformed_architect_plan",
        provider: result.provider,
        completedAt: this.now().toISOString(),
      });
      return this.enterHumanGate(run, "MALFORMED_PROVIDER_OUTPUT", "Architect plan failed validation");
    }

    // Standing goal cannot be changed by provider content — ignore any such fields.
    const artifact = await this.store.createArtifact({
      runId: run.id,
      type: "ARCHITECT_PLAN",
      producer: "architect",
      provider: result.provider,
      content: plan as unknown as Record<string, unknown>,
      metadata: { sessionId: result.sessionId },
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      provider: result.provider,
      providerSessionId: result.sessionId,
      outputArtifactIds: [artifact.id],
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostCents: result.estimatedCostCents,
      costKnown: result.costKnown,
      completedAt: this.now().toISOString(),
    });
    await this.applyCost(run.id, result);

    return this.store.transitionRun({
      runId: run.id,
      from: "ARCHITECT_RUNNING",
      to: "ARCHITECT_COMPLETE",
    });
  }

  private async startReviewer(run: CandyBarRunRecord) {
    return this.store.transitionRun({
      runId: run.id,
      from: "ARCHITECT_COMPLETE",
      to: "REVIEWER_RUNNING",
    });
  }

  private async runReviewer(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "reviewer", String(run.iteration));
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    if (this.budgetBlocksPaidDispatch(run)) {
      return this.enterHumanGate(run, "BUDGET_EXCEEDED", "Per-run budget prevents paid Reviewer dispatch");
    }

    const resolved = await this.resolveReviewer(run);
    if ("gate" in resolved) {
      return this.enterHumanGate(run, resolved.gate, resolved.message);
    }

    const planArt = await this.store.latestArtifact(run.id, "ARCHITECT_PLAN");
    const repoArt = await this.store.latestArtifact(run.id, "REPO_CONTEXT");
    if (!planArt || !repoArt) {
      return this.enterHumanGate(run, "MALFORMED_PROVIDER_OUTPUT", "Missing plan or context for review");
    }

    await this.store.updateStep(claimed.id, {
      status: "running",
      provider: resolved.provider,
      startedAt: this.now().toISOString(),
    });

    const plan = parseArchitectPlan(planArt.content)!;
    const prompt = buildReviewerPrompt({
      goal: run.goalSnapshot,
      repo: repoArt.content as unknown as Parameters<typeof buildReviewerPrompt>[0]["repo"],
      plan,
    });
    const result = await resolved.adapter.review({ prompt });
    if (!result.ok) {
      await this.store.updateStep(claimed.id, {
        status: "failed",
        error: result.message,
        completedAt: this.now().toISOString(),
      });
      await this.store.updateRun(run.id, { providerFailureCount: run.providerFailureCount + 1 });
      if (result.code === "AUTH_FAILURE") {
        return this.enterHumanGate(run, "AUTH_FAILURE", result.message);
      }
      return this.enterHumanGate(run, "PROVIDER_UNAVAILABLE", result.message);
    }

    const critique = parseReviewCritique(result.content) ?? asReviewCritique(result.content);
    if (!critique) {
      await this.store.updateStep(claimed.id, {
        status: "failed",
        error: "malformed_review",
        completedAt: this.now().toISOString(),
      });
      return this.enterHumanGate(run, "MALFORMED_PROVIDER_OUTPUT", "Review critique failed validation");
    }

    const artifact = await this.store.createArtifact({
      runId: run.id,
      type: "REVIEW_CRITIQUE",
      producer: "reviewer",
      provider: result.provider,
      content: critique as unknown as Record<string, unknown>,
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      provider: result.provider,
      outputArtifactIds: [artifact.id],
      completedAt: this.now().toISOString(),
    });
    await this.applyCost(run.id, result);

    if (critique.authorityOverride === "OBJECTIVE_REDEFINITION") {
      await this.store.createArtifact({
        runId: run.id,
        type: "OBJECTIVE_REDEFINITION_PROPOSAL",
        producer: "reviewer",
        provider: result.provider,
        content: { findings: critique.findings, evidence: critique.evidence },
      });
      return this.enterHumanGate(
        { ...run, state: "REVIEWER_RUNNING" },
        "OBJECTIVE_REDEFINITION",
        "Reviewer flagged objective redefinition"
      );
    }
    if (critique.authorityOverride === "HARD_HUMAN_GATE") {
      return this.enterHumanGate(
        { ...run, state: "REVIEWER_RUNNING" },
        "HARD_HUMAN_GATE",
        "Reviewer flagged hard human gate"
      );
    }
    if (critique.verdict === "REJECT") {
      return this.enterHumanGate(
        { ...run, state: "REVIEWER_RUNNING" },
        "OPERATOR_REQUEST",
        `Reviewer REJECT: ${critique.findings.join("; ")}`
      );
    }

    return this.store.transitionRun({
      runId: run.id,
      from: "REVIEWER_RUNNING",
      to: "REVIEW_COMPLETE",
    });
  }

  private async startReconcile(run: CandyBarRunRecord) {
    return this.store.transitionRun({
      runId: run.id,
      from: "REVIEW_COMPLETE",
      to: "RECONCILING",
    });
  }

  private async runReconcile(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "reconcile", String(run.reconcileRound));
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    const planArt = await this.store.latestArtifact(run.id, "ARCHITECT_PLAN");
    const reviewArt = await this.store.latestArtifact(run.id, "REVIEW_CRITIQUE");
    const repoArt = await this.store.latestArtifact(run.id, "REPO_CONTEXT");
    if (!planArt || !reviewArt || !repoArt) {
      return this.enterHumanGate(run, "MALFORMED_PROVIDER_OUTPUT", "Missing artifacts for reconcile");
    }

    const plan = parseArchitectPlan(planArt.content)!;
    const critique = parseReviewCritique(reviewArt.content)!;
    const prompt = buildReconciliationPrompt({
      goal: run.goalSnapshot,
      plan,
      critique,
      repo: repoArt.content as unknown as Parameters<typeof buildReconciliationPrompt>[0]["repo"],
    });

    await this.store.updateStep(claimed.id, {
      status: "running",
      provider: this.providers.architect.providerId,
      startedAt: this.now().toISOString(),
    });

    let raw: Record<string, unknown>;
    if (this.reconcileInvoke) {
      raw = await this.reconcileInvoke(prompt);
    } else if (critique.verdict === "ACCEPT") {
      raw = {
        decision: "ACCEPT",
        authorityLevel: plan.proposedAuthorityLevel,
        humanGateRequired: plan.humanGateRequired,
        humanGateReason: plan.humanGateRequired ? "HARD_HUMAN_GATE" : null,
        implementationBrief: plan.implementationBriefDraft,
        followOnCandidates: plan.followOnCandidates,
      };
    } else {
      // ACCEPT_WITH_CHANGES without invoke: fold required changes into brief
      raw = {
        decision: "ACCEPT_WITH_CHANGES",
        authorityLevel: plan.proposedAuthorityLevel,
        humanGateRequired: plan.humanGateRequired || critique.humanDecisionRequired,
        humanGateReason: critique.humanDecisionRequired ? "OPERATOR_REQUEST" : null,
        implementationBrief: [
          plan.implementationBriefDraft,
          "",
          "REQUIRED CHANGES FROM REVIEW:",
          ...critique.requiredChanges.map(c => `- ${c}`),
        ].join("\n"),
        followOnCandidates: plan.followOnCandidates,
      };
    }

    const brief = parseReconciledBrief(raw);
    if (!brief || brief.decision === "REJECT") {
      await this.store.updateStep(claimed.id, {
        status: "failed",
        error: "reconcile_rejected_or_malformed",
        completedAt: this.now().toISOString(),
      });
      return this.enterHumanGate(run, "OPERATOR_REQUEST", "Reconciliation rejected or malformed");
    }

    const artifact = await this.store.createArtifact({
      runId: run.id,
      type: "RECONCILED_IMPLEMENTATION_BRIEF",
      producer: "reconcile",
      provider: this.providers.architect.providerId,
      content: brief as unknown as Record<string, unknown>,
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      outputArtifactIds: [artifact.id],
      completedAt: this.now().toISOString(),
    });

    return this.store.transitionRun({
      runId: run.id,
      from: "RECONCILING",
      to: "BRIEF_READY",
      patch: { reconcileRound: run.reconcileRound + 1 },
    });
  }

  private async classifyAuthority(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "authority_classify", "v1");
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    const briefArt = await this.store.latestArtifact(run.id, "RECONCILED_IMPLEMENTATION_BRIEF");
    if (!briefArt) {
      return this.enterHumanGate(run, "MALFORMED_PROVIDER_OUTPUT", "Missing reconciled brief");
    }
    const brief = parseReconciledBrief(briefArt.content)!;
    const level = brief.authorityLevel;
    const classification = {
      level,
      rationale: `From reconciled brief decision=${brief.decision}`,
      humanGateReason: brief.humanGateReason,
    };
    const artifact = await this.store.createArtifact({
      runId: run.id,
      type: "AUTHORITY_CLASSIFICATION",
      producer: "authority_classify",
      provider: "system",
      content: classification as unknown as Record<string, unknown>,
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      provider: "system",
      outputArtifactIds: [artifact.id],
      completedAt: this.now().toISOString(),
    });
    log("authority_classified", { runId: run.id, level });

    return this.store.transitionRun({
      runId: run.id,
      from: "BRIEF_READY",
      to: "AUTHORITY_CLASSIFIED",
      patch: {
        authorityLevel: level,
        humanGateReason: brief.humanGateRequired ? brief.humanGateReason : null,
      },
    });
  }

  private async dispatchEngineerOrGate(run: CandyBarRunRecord) {
    const level = run.authorityLevel;
    if (!level || !authorityAllowsEngineer(level)) {
      const reason: CandyBarHumanGateReason =
        level === "PROPOSAL_AUTHORITY"
          ? "OBJECTIVE_REDEFINITION"
          : level === "HARD_HUMAN_GATE"
            ? "HARD_HUMAN_GATE"
            : "OBJECTIVE_REDEFINITION";
      if (level === "PROPOSAL_AUTHORITY") {
        await this.store.createArtifact({
          runId: run.id,
          type: "OBJECTIVE_REDEFINITION_PROPOSAL",
          producer: "authority_classify",
          provider: "system",
          content: {
            note: "Proposal authority — Engineer must not start as canonical production",
          },
        });
        log("objective_redefinition_proposed", { runId: run.id });
      }
      return this.enterHumanGate(
        run,
        reason,
        `Authority ${level} does not permit Engineer dispatch`
      );
    }
    // Re-check main before Engineer
    const currentMain = await this.providers.github.getMainSha(run.repository, run.baseBranch);
    if (run.plannedAgainstSha && run.plannedAgainstSha !== currentMain) {
      return this.enterHumanGate(
        run,
        "STALE_BASE",
        `Main moved ${run.plannedAgainstSha} -> ${currentMain}; revalidation required`
      );
    }
    return this.store.transitionRun({
      runId: run.id,
      from: "AUTHORITY_CLASSIFIED",
      to: "ENGINEER_RUNNING",
      patch: { baseSha: currentMain },
    });
  }

  private async runEngineer(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "engineer", String(run.iteration));
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    if (this.budgetBlocksPaidDispatch(run)) {
      return this.enterHumanGate(run, "BUDGET_EXCEEDED", "Per-run budget prevents paid Engineer dispatch");
    }

    const resolved = await this.resolveEngineer(run);
    if ("gate" in resolved) {
      return this.enterHumanGate(run, resolved.gate, resolved.message);
    }

    const briefArt = await this.store.latestArtifact(run.id, "RECONCILED_IMPLEMENTATION_BRIEF");
    if (!briefArt) {
      return this.enterHumanGate(run, "MALFORMED_PROVIDER_OUTPUT", "Engineer missing reconciled brief");
    }
    const brief = parseReconciledBrief(briefArt.content)!;
    // Engineer receives ONLY the reconciled brief
    const prompt = buildEngineerPrompt({
      goal: run.goalSnapshot,
      brief: brief.implementationBrief,
      mainSha: run.baseSha ?? "unknown",
      repository: run.repository,
      authorityLevel: run.authorityLevel ?? "AUTONOMOUS_EXECUTION",
    });

    await this.store.updateStep(claimed.id, {
      status: "running",
      provider: resolved.provider,
      startedAt: this.now().toISOString(),
      inputArtifactIds: [briefArt.id],
    });
    log("provider_dispatched", { runId: run.id, role: "engineer", provider: resolved.provider });

    const result = await resolved.adapter.implement({
      prompt,
      sessionId: run.engineerSessionId,
    });

    if (!result.ok) {
      await this.store.updateStep(claimed.id, {
        status: "failed",
        error: result.message,
        completedAt: this.now().toISOString(),
      });
      await this.store.updateRun(run.id, { providerFailureCount: run.providerFailureCount + 1 });
      if (result.code === "AUTH_FAILURE") {
        return this.enterHumanGate(run, "AUTH_FAILURE", result.message);
      }
      return this.enterHumanGate(run, "PROVIDER_UNAVAILABLE", result.message);
    }

    const terminal = result.content as unknown as EngineeringTerminalResult;
    const termArt = await this.store.createArtifact({
      runId: run.id,
      type: "ENGINEERING_TERMINAL_RESULT",
      producer: "engineer",
      provider: result.provider,
      content: terminal as unknown as Record<string, unknown>,
      metadata: { sessionId: result.sessionId },
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      provider: result.provider,
      providerSessionId: result.sessionId,
      outputArtifactIds: [termArt.id],
      completedAt: this.now().toISOString(),
    });
    await this.applyCost(run.id, result);

    await this.store.updateRun(run.id, {
      engineerSessionId: result.sessionId ?? run.engineerSessionId,
      candidateBranch: terminal.branch,
      candidatePrUrl: terminal.pr_url,
    });

    if (terminal.status === "NEEDS_HUMAN" || terminal.requires_human_approval) {
      const reason: CandyBarHumanGateReason = /migrat/i.test(terminal.blocker ?? terminal.summary)
        ? "MIGRATION_REQUIRED"
        : /secur/i.test(terminal.blocker ?? terminal.summary)
          ? "SECURITY_REQUIRED"
          : "OPERATOR_REQUEST";
      return this.enterHumanGate(run, reason, terminal.blocker ?? terminal.summary);
    }
    if (terminal.status === "BLOCKED") {
      const reason: CandyBarHumanGateReason = /secur/i.test(terminal.blocker ?? "")
        ? "SECURITY_REQUIRED"
        : "OPERATOR_REQUEST";
      return this.enterHumanGate(run, reason, terminal.blocker ?? "Engineer blocked");
    }
    if (terminal.status === "PR_READY" || terminal.status === "IMPLEMENTED_NO_PR") {
      if (terminal.pr_url) {
        return this.store.transitionRun({
          runId: run.id,
          from: "ENGINEER_RUNNING",
          to: "PR_OPEN",
          patch: {
            candidatePrUrl: terminal.pr_url,
            candidateBranch: terminal.branch,
            engineerSessionId: result.sessionId ?? run.engineerSessionId,
          },
        });
      }
      return this.store.transitionRun({
        runId: run.id,
        from: "ENGINEER_RUNNING",
        to: "READY_FOR_HUMAN",
        patch: { candidateBranch: terminal.branch },
      });
    }
    if (terminal.status === "ALREADY_SUPPORTED") {
      return this.store.transitionRun({
        runId: run.id,
        from: "ENGINEER_RUNNING",
        to: "READY_FOR_HUMAN",
        patch: { blocker: "ALREADY_SUPPORTED" },
      });
    }
    return this.enterHumanGate(run, "OPERATOR_REQUEST", `Unexpected terminal ${terminal.status}`);
  }

  private async observePr(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "pr_observation", run.candidatePrUrl ?? "none");
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    await this.store.updateStep(claimed.id, {
      status: "running",
      provider: "github",
      startedAt: this.now().toISOString(),
    });

    const pr = await this.providers.github.observePr({
      repository: run.repository,
      prUrl: run.candidatePrUrl,
      prNumber: run.candidatePrNumber,
    });
    const art = await this.store.createArtifact({
      runId: run.id,
      type: "PR_STATUS",
      producer: "pr_observation",
      provider: "github",
      content: pr as unknown as Record<string, unknown>,
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      outputArtifactIds: [art.id],
      completedAt: this.now().toISOString(),
    });
    log("pr_detected", { runId: run.id, exists: pr.exists, number: pr.number });

    if (!pr.exists || !pr.verified) {
      return this.enterHumanGate(
        run,
        "OPERATOR_REQUEST",
        "Engineer claimed PR_READY but GitHub could not verify the PR"
      );
    }

    await this.store.updateRun(run.id, {
      candidatePrNumber: pr.number,
      candidatePrUrl: pr.url,
      candidateHeadSha: pr.headSha,
    });

    return this.store.transitionRun({
      runId: run.id,
      from: "PR_OPEN",
      to: "CI_RUNNING",
      patch: {
        candidatePrNumber: pr.number,
        candidatePrUrl: pr.url,
        candidateHeadSha: pr.headSha,
      },
    });
  }

  private async observeCi(run: CandyBarRunRecord) {
    const headSha = run.candidateHeadSha;
    if (!headSha) {
      return this.enterHumanGate(run, "OPERATOR_REQUEST", "Missing candidate head SHA for CI");
    }
    const step = await this.createStep(
      run,
      "ci_observation",
      `${headSha}:r${run.repairIteration}:i${run.iteration}`
    );
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    const ci = await this.providers.github.observeCi({
      repository: run.repository,
      headSha,
    });
    const art = await this.store.createArtifact({
      runId: run.id,
      type: "CI_STATUS",
      producer: "ci_observation",
      provider: "github",
      content: ci as unknown as Record<string, unknown>,
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      provider: "github",
      outputArtifactIds: [art.id],
      completedAt: this.now().toISOString(),
    });
    log("ci_updated", { runId: run.id, status: ci.status, headSha });

    if (ci.status === "failure") {
      return this.store.transitionRun({
        runId: run.id,
        from: "CI_RUNNING",
        to: "REPAIR_REQUIRED",
      });
    }
    if (ci.status === "success") {
      return this.store.transitionRun({
        runId: run.id,
        from: "CI_RUNNING",
        to: "READY_FOR_HUMAN",
      });
    }
    // pending/unknown — stay in CI_RUNNING for heartbeat
    await this.store.updateRun(run.id, {
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: new Date(this.now().getTime() + 10_000).toISOString(),
    });
    return this.getRunAnyTenant(run.id);
  }

  private async startRepair(run: CandyBarRunRecord) {
    const max = run.goalSnapshot.policy.maxRepairIterations;
    if (run.repairIteration >= max) {
      return this.enterHumanGate(run, "REPAIR_LIMIT", `Repair iterations exceeded (${max})`);
    }
    return this.store.transitionRun({
      runId: run.id,
      from: "REPAIR_REQUIRED",
      to: "ENGINEER_REPAIRING",
      patch: { repairIteration: run.repairIteration + 1 },
    });
  }

  private async runRepair(run: CandyBarRunRecord) {
    const step = await this.createStep(run, "repair", String(run.repairIteration));
    const claimed = await this.claimOrSkip(step.id);
    if (!claimed) return run;

    if (this.budgetBlocksPaidDispatch(run)) {
      return this.enterHumanGate(run, "BUDGET_EXCEEDED", "Budget blocks repair dispatch");
    }

    const resolved = await this.resolveEngineer(run);
    if ("gate" in resolved) {
      return this.enterHumanGate(run, resolved.gate, resolved.message);
    }

    const ciArt = await this.store.latestArtifact(run.id, "CI_STATUS");
    const briefArt = await this.store.latestArtifact(run.id, "RECONCILED_IMPLEMENTATION_BRIEF");
    const failedChecks =
      ciArt && Array.isArray((ciArt.content as { failedChecks?: string[] }).failedChecks)
        ? ((ciArt.content as { failedChecks: string[] }).failedChecks)
        : [];
    const brief = parseReconciledBrief(briefArt?.content ?? {})!;
    const repairBrief = {
      failedChecks,
      headSha: run.candidateHeadSha,
      repairIteration: run.repairIteration,
      implementationBrief: brief.implementationBrief,
    };
    const repairArt = await this.store.createArtifact({
      runId: run.id,
      type: "REPAIR_BRIEF",
      producer: "repair",
      provider: "system",
      content: repairBrief,
    });

    const prompt = buildRepairPrompt({
      brief: brief.implementationBrief,
      failedChecks,
      headSha: run.candidateHeadSha ?? "unknown",
      repairIteration: run.repairIteration,
    });

    await this.store.updateStep(claimed.id, {
      status: "running",
      provider: resolved.provider,
      startedAt: this.now().toISOString(),
      inputArtifactIds: [repairArt.id],
    });
    log("repair_started", { runId: run.id, iteration: run.repairIteration });

    const result = await resolved.adapter.implement({
      prompt,
      sessionId: run.engineerSessionId,
    });
    if (!result.ok) {
      await this.store.updateStep(claimed.id, {
        status: "failed",
        error: result.message,
        completedAt: this.now().toISOString(),
      });
      if (result.code === "AUTH_FAILURE") {
        return this.enterHumanGate(run, "AUTH_FAILURE", result.message);
      }
      return this.enterHumanGate(run, "PROVIDER_UNAVAILABLE", result.message);
    }

    const terminal = result.content as unknown as EngineeringTerminalResult;
    await this.store.createArtifact({
      runId: run.id,
      type: "ENGINEERING_TERMINAL_RESULT",
      producer: "repair",
      provider: result.provider,
      content: terminal as unknown as Record<string, unknown>,
    });
    await this.store.updateStep(claimed.id, {
      status: "completed",
      provider: result.provider,
      providerSessionId: result.sessionId,
      completedAt: this.now().toISOString(),
    });

    // Expect updated head via PR observation on next CI tick — update head if provided in metadata
    const newHead =
      typeof (result.content as { head_sha?: string }).head_sha === "string"
        ? (result.content as { head_sha: string }).head_sha
        : run.candidateHeadSha;

    return this.store.transitionRun({
      runId: run.id,
      from: "ENGINEER_REPAIRING",
      to: "CI_RUNNING",
      patch: {
        candidateHeadSha: newHead,
        engineerSessionId: result.sessionId ?? run.engineerSessionId,
        candidateBranch: terminal.branch ?? run.candidateBranch,
        candidatePrUrl: terminal.pr_url ?? run.candidatePrUrl,
      },
    });
  }

  private async maybeObserveMergeForNext(run: CandyBarRunRecord) {
    log("run_ready_for_human", { runId: run.id, pr: run.candidatePrUrl });
    return run;
  }

  private async maybeSpawnNextPlan(run: CandyBarRunRecord): Promise<CandyBarRunRecord | null> {
    if (run.nextPlanSpawned) return null;
    const workflow = await this.store.getWorkflowById({
      tenantId: run.tenantId,
      id: run.workflowId,
      operatorUserId: run.operatorUserId,
    });
    if (!workflow?.autoPlanNext) return null;
    // AUTO_PLAN_NEXT reads LATEST standing goal, not stale snapshot
    await this.store.updateRun(run.id, { nextPlanSpawned: true });
    const next = await this.store.createRun({
      tenantId: run.tenantId,
      operatorUserId: run.operatorUserId,
      workflowId: workflow.id,
      parentRunId: run.id,
    });
    // Ensure goal snapshot is latest
    if (next.goalSnapshot.goalVersion !== workflow.goalVersion) {
      // createRun already snapshots latest workflow
    }
    log("auto_plan_next", {
      parentRunId: run.id,
      nextRunId: next.id,
      goalVersion: next.goalSnapshot.goalVersion,
    });
    return next;
  }

  private async applyCost(
    runId: string,
    result: { costKnown: boolean; estimatedCostCents: number | null }
  ) {
    const run = await this.getRunAnyTenant(runId);
    if (!run) return;
    if (!result.costKnown || result.estimatedCostCents == null) {
      // Unknown remains unknown — do not invent numbers
      if (!run.spendKnown) {
        await this.store.updateRun(runId, { spendKnown: false, estimatedSpendCents: null });
      }
      return;
    }
    const prev = run.spendKnown && run.estimatedSpendCents != null ? run.estimatedSpendCents : 0;
    await this.store.updateRun(runId, {
      spendKnown: true,
      estimatedSpendCents: prev + result.estimatedCostCents,
    });
  }

  private async emitEvent(run: CandyBarRunRecord, toolName: string, output: unknown) {
    if (this.silentEvents) return;
    try {
      await logAgentEvent({
        ctx: {
          tenantId: run.tenantId,
          agentType: "operator_task_agent",
          actorType: "system",
          actorId: "candy_bar",
          sessionId: run.id,
        },
        toolName,
        outputJson: output,
        status: "success",
        entityType: "candy_bar_run",
        entityId: run.id,
      });
    } catch {
      // Observability must not break orchestration
    }
  }

  /** Read model for API */
  async getReadModel(input: {
    tenantId: string;
    operatorUserId: string;
    runId: string;
  }) {
    const run = await this.store.getRun({
      tenantId: input.tenantId,
      id: input.runId,
      operatorUserId: input.operatorUserId,
    });
    if (!run) return null;
    const steps = await this.store.listSteps(run.id);
    const artifacts = await this.store.listArtifacts(run.id);
    const latestByType = Object.fromEntries(
      [...new Set(artifacts.map(a => a.type))].map(type => {
        const list = artifacts.filter(a => a.type === type);
        const last = list[list.length - 1]!;
        return [
          type,
          {
            id: last.id,
            provider: last.provider,
            createdAt: last.createdAt,
            summary: summarizeArtifact(last.type, last.content),
          },
        ];
      })
    );
    return {
      run,
      currentStep: steps.find(s => s.id === run.currentStepId) ?? steps[steps.length - 1] ?? null,
      latestArtifacts: latestByType,
      stepCount: steps.length,
      spend: run.spendKnown ? run.estimatedSpendCents : null,
      spendKnown: run.spendKnown,
    };
  }
}

function summarizeArtifact(type: string, content: Record<string, unknown>): string {
  if (type === "ARCHITECT_PLAN") return String(content.objective ?? "").slice(0, 200);
  if (type === "REVIEW_CRITIQUE") return String(content.verdict ?? "");
  if (type === "RECONCILED_IMPLEMENTATION_BRIEF")
    return String(content.implementationBrief ?? "").slice(0, 200);
  if (type === "PR_STATUS") return `exists=${content.exists} state=${content.state}`;
  if (type === "CI_STATUS") return String(content.status ?? "");
  if (type === "AUTHORITY_CLASSIFICATION") return String(content.level ?? "");
  return type;
}

export type { ReconciledBrief, CandyBarAuthorityLevel, CandyBarRunState };
