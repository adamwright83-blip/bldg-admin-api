/**
 * Mitch v1 — Game Development Work-Order Dispatcher
 *
 * Game-development-specific dispatcher, completely separate from:
 * - Night Shift (which authors Day Line work from business state)
 * - Claire (who runs the customer's business and workday)
 * - Persistent Growth Operator (business-work queue)
 *
 * Intended execution contract:
 * Mitch creates bounded work order
 * → authorized executor claims it with a durable lease
 * → executor works from the exact base branch and SHA
 * → executor returns real branch + commit + build evidence
 * → Mitch records implementation and exact build
 * → Gameplay QA becomes eligible
 *
 * HARD EXECUTION-PROVIDER RULE:
 * If no real runtime coding-agent provider exists in the repo capable of:
 * 1. claiming a Mitch work order,
 * 2. modifying the repository,
 * 3. creating a real branch,
 * 4. producing a real commit,
 * 5. returning that branch/commit/build result to Mitch,
 * stop at that boundary and name the missing provider explicitly.
 */
import { randomUUID } from "node:crypto";
import type {
  MitchBuild,
  MitchExecutionHandback,
  MitchExecutionRun,
  MitchWorkOrder,
} from "../../shared/mitchContracts";
import { assertValidBuildIdentity, mitchExecutionHandbackSchema } from "../../shared/mitchContracts";
import type { IMitchProductionStore } from "./mitchStore";
import {
  AutonomousRuntimeCodingAgentProvider,
  type AutonomousRuntimeCodingAgentProviderOptions,
} from "./autonomousRuntimeCodingAgentProvider";

export class MissingExecutionProviderError extends Error {
  public readonly missingProviderName = "AutonomousRuntimeCodingAgentProvider";
  public readonly requiredInterface = "IMitchExecutionProvider";
  public readonly requiredCapabilities = [
    "Claim durable Mitch work order with atomic lease",
    "Checkout and operate from exact work-order base branch and base SHA",
    "Inspect repository and apply code changes within tenant boundaries",
    "Run unit/integration tests and compile verification",
    "Create a real git branch and generate a real git commit",
    "Build or preview real implementation artifact (immutable preview or commit build)",
    "Return structured handback with branch, commit SHA, exact build identity, and test results",
  ];

  constructor(customMessage?: string) {
    super(
      customMessage ??
        "No autonomous runtime coding-agent provider is currently available to claim and execute Mitch game-development work orders. Mitch v1 cannot truthfully claim autonomous runtime execution until a provider satisfying IMitchExecutionProvider is deployed."
    );
    this.name = "MissingExecutionProviderError";
  }
}

export class StaleWorkerOverwrittenViolationError extends Error {
  constructor(workOrderId: string, attemptingWorker: string, activeClaimant: string | null) {
    super(
      `Stale worker "${attemptingWorker}" rejected for work order "${workOrderId}". The active claimant is "${activeClaimant ?? "none"}" or the lease has expired.`
    );
    this.name = "StaleWorkerOverwrittenViolationError";
  }
}

export interface IMitchExecutionProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  executeWorkOrder(order: MitchWorkOrder): Promise<MitchExecutionHandback>;
}

export class MitchGameDispatcher {
  private executionProviders: IMitchExecutionProvider[] = [];

  constructor(private readonly store: IMitchProductionStore) {}

  registerExecutionProvider(provider: IMitchExecutionProvider): void {
    this.executionProviders.push(provider);
  }

  getRegisteredProviders(): readonly IMitchExecutionProvider[] {
    return this.executionProviders;
  }

  async findAvailableExecutionProvider(): Promise<IMitchExecutionProvider | null> {
    for (const provider of this.executionProviders) {
      if (await provider.isAvailable()) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Claim a work order with a durable lease.
   * Ensures atomic claiming, preventing competing workers from executing same work.
   */
  async claimWorkOrder(input: {
    tenantId: string;
    workOrderId: string;
    executorId: string;
    leaseMs?: number;
  }): Promise<MitchWorkOrder | null> {
    const leaseMs = input.leaseMs ?? 5 * 60 * 1000; // 5 minute default lease
    const claimed = await this.store.claimWorkOrder({
      tenantId: input.tenantId,
      workOrderId: input.workOrderId,
      claimedBy: input.executorId,
      leaseMs,
    });

    if (claimed) {
      await this.store.recordAuditEvent({
        tenantId: input.tenantId,
        gameId: claimed.gameId,
        eventType: "mitch_work_order_claimed",
        actorId: input.executorId,
        details: {
          workOrderId: claimed.id,
          leaseExpiresAt: claimed.leaseExpiresAt,
          attemptCount: claimed.attemptCount,
        },
      });
    }

    return claimed;
  }

  /**
   * Heartbeat to extend lease on long-running work.
   */
  async renewLease(input: {
    tenantId: string;
    workOrderId: string;
    executorId: string;
    leaseMs?: number;
  }): Promise<boolean> {
    const leaseMs = input.leaseMs ?? 5 * 60 * 1000;
    return this.store.renewWorkOrderLease({
      tenantId: input.tenantId,
      workOrderId: input.workOrderId,
      claimedBy: input.executorId,
      leaseMs,
    });
  }

  /**
   * Submit an execution handback.
   * INVARIANT: Rejects stale workers whose lease expired or who do not match the active claim.
   * INVARIANT: Handback must contain real branch, commit SHA, exact build identity, and tests run.
   */
  async submitHandback(input: {
    tenantId: string;
    workOrderId: string;
    executorId: string;
    handback: MitchExecutionHandback;
  }): Promise<{
    workOrder: MitchWorkOrder;
    build: MitchBuild;
    executionRun: MitchExecutionRun;
  }> {
    const existing = await this.store.getWorkOrder(input.tenantId, input.workOrderId);
    if (!existing) {
      throw new Error(`Work order not found: ${input.workOrderId}`);
    }

    // Verify claimant identity
    if (existing.claimedBy !== input.executorId) {
      throw new StaleWorkerOverwrittenViolationError(
        input.workOrderId,
        input.executorId,
        existing.claimedBy
      );
    }

    // Verify work order is in active execution state (reject duplicate completion or canceled/failed)
    if (existing.status !== "claimed" && existing.status !== "executing") {
      throw new StaleWorkerOverwrittenViolationError(
        input.workOrderId,
        input.executorId,
        existing.status
      );
    }

    // Verify lease has not expired
    const now = new Date();
    if (existing.leaseExpiresAt && new Date(existing.leaseExpiresAt).getTime() < now.getTime()) {
      throw new StaleWorkerOverwrittenViolationError(
        input.workOrderId,
        input.executorId,
        "LEASE_EXPIRED"
      );
    }

    // Validate handback schema
    mitchExecutionHandbackSchema.parse(input.handback);
    assertValidBuildIdentity(input.handback.exactBuildId);

    // Record execution run
    const executionRun = await this.store.recordExecutionRun({
      tenantId: input.tenantId,
      workOrderId: existing.id,
      executorId: input.executorId,
      startedAt: existing.claimedAt ?? now.toISOString(),
      completedAt: now.toISOString(),
      status: "succeeded",
      returnedBranch: input.handback.branch,
      returnedCommitSha: input.handback.commitSha,
      exactBuildId: input.handback.exactBuildId,
      whatChanged: input.handback.whatChanged,
      testsActuallyRun: input.handback.testsActuallyRun,
      testsNotRun: input.handback.testsNotRun,
      previewLaunchInstructions: input.handback.previewLaunchInstructions,
      evidence: input.handback.evidence,
      knownLimitations: input.handback.knownLimitations,
      errorMessage: null,
    });

    // Complete the work order and record build
    const { workOrder, build } = await this.store.completeWorkOrderImplementation({
      tenantId: input.tenantId,
      workOrderId: existing.id,
      handback: input.handback,
      executionRunId: executionRun.id,
    });

    await this.store.recordAuditEvent({
      tenantId: input.tenantId,
      gameId: existing.gameId,
      eventType: "mitch_implementation_returned",
      actorId: input.executorId,
      details: {
        workOrderId: existing.id,
        exactBuildId: build.id,
        commitSha: input.handback.commitSha,
        branch: input.handback.branch,
        testsRunCount: input.handback.testsActuallyRun.length,
      },
    });

    return { workOrder, build, executionRun };
  }

  /**
   * Autonomous dispatch: Attempts to dispatch a pending work order using an available provider.
   * If no provider exists, enforces HARD EXECUTION-PROVIDER RULE and throws MissingExecutionProviderError.
   */
  async dispatchAutonomous(input: {
    tenantId: string;
    workOrderId: string;
  }): Promise<{
    workOrder: MitchWorkOrder;
    build: MitchBuild;
    executionRun: MitchExecutionRun;
  }> {
    const provider = await this.findAvailableExecutionProvider();
    if (!provider) {
      throw new MissingExecutionProviderError();
    }

    const claimed = await this.claimWorkOrder({
      tenantId: input.tenantId,
      workOrderId: input.workOrderId,
      executorId: provider.id,
    });

    if (!claimed) {
      throw new Error(`Could not claim work order "${input.workOrderId}". It may already be in flight.`);
    }

    try {
      const handback = await provider.executeWorkOrder(claimed);
      return this.submitHandback({
        tenantId: input.tenantId,
        workOrderId: claimed.id,
        executorId: provider.id,
        handback,
      });
    } catch (err) {
      await this.store.failWorkOrder({
        tenantId: input.tenantId,
        workOrderId: claimed.id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

export { AutonomousRuntimeCodingAgentProvider } from "./autonomousRuntimeCodingAgentProvider";
export type { AutonomousRuntimeCodingAgentProviderOptions } from "./autonomousRuntimeCodingAgentProvider";

export function createAutonomousDispatcher(
  store: IMitchProductionStore,
  providerOptions?: AutonomousRuntimeCodingAgentProviderOptions
): MitchGameDispatcher {
  const dispatcher = new MitchGameDispatcher(store);
  const provider = new AutonomousRuntimeCodingAgentProvider(providerOptions);
  dispatcher.registerExecutionProvider(provider);
  return dispatcher;
}
