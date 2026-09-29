import {
  DurableWorker,
  type DurableStepHandler,
} from "../durableExecution/worker";
import {
  type ClaimedGoalCycle,
  type GoalCycleStore,
} from "./goalCycleStore";

export type GoalCycleWorkerOptions = {
  leaseOwner: string;
  leaseMs: number;
  pollMs: number;
  concurrency: number;
  retryBaseMs: number;
};

export type GoalCycleEvaluator = (input: {
  tenantId: string;
  runId: string;
}) => Promise<unknown>;

/**
 * Slice B worker. It does not mint authority or execute business actions; PR3
 * owns that boundary. PR2 durably wakes and reevaluates the macro-goal run.
 */
export class GoalCycleWorker {
  private readonly worker: DurableWorker<ClaimedGoalCycle>;

  constructor(
    store: GoalCycleStore,
    options: GoalCycleWorkerOptions,
    evaluator: GoalCycleEvaluator
  ) {
    const handler: DurableStepHandler<ClaimedGoalCycle> = async ({ step }) =>
      evaluator({ tenantId: step.tenantId, runId: step.goalRunId });
    this.worker = new DurableWorker(
      store,
      new Map([["goal_cycle.evaluate", handler]]),
      {
        ...options,
        getHandlerKey: () => "goal_cycle.evaluate",
        logPrefix: "GoalCycleWorker",
      }
    );
  }

  get health() {
    return this.worker.health;
  }

  start() {
    return this.worker.start();
  }

  stop() {
    return this.worker.stop();
  }
}

