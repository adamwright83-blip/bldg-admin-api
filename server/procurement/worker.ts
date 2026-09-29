import type { ClaimedWorkflowStep, ProcurementWorkflowStore } from "./workflowStore";
import {
  DurableWorker,
  type DurableWorkHandler,
  type DurableWorkStore,
  type DurableWorkerOptions,
} from "../durableWorker/worker";

export type ProcurementStepHandler = (
  input: { step: ClaimedWorkflowStep; signal: AbortSignal },
) => Promise<unknown>;

export type ProcurementWorkerOptions = DurableWorkerOptions;

export class ProcurementWorker {
  private readonly durable: DurableWorker<ClaimedWorkflowStep>;

  constructor(
    store: ProcurementWorkflowStore,
    handlers: ReadonlyMap<string, ProcurementStepHandler>,
    options: ProcurementWorkerOptions,
  ) {
    const durableStore: DurableWorkStore<ClaimedWorkflowStep> = {
      sweepExpired: () => store.deadLetterExpiredSteps(),
      claimNext: input => store.claimNextStep(input),
      markRunning: step => store.markRunning(step),
      heartbeat: (step, leaseMs) => store.heartbeat(step, leaseMs),
      complete: (step, result) => store.completeStep(step, result),
      fail: (step, error, retryDelayMs) => store.failStep(step, error, retryDelayMs),
    };
    const durableHandlers = new Map<string, DurableWorkHandler<ClaimedWorkflowStep>>();
    for (const [stepType, handler] of handlers) {
      durableHandlers.set(stepType, ({ item, signal }) => handler({ step: item, signal }));
    }
    this.durable = new DurableWorker(
      durableStore,
      durableHandlers,
      options,
      step => step.stepType,
    );
  }

  get health() {
    return this.durable.health;
  }

  start() {
    return this.durable.start();
  }

  stop() {
    return this.durable.stop();
  }
}
