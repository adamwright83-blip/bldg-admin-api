import {
  DurableWorker,
  type DurableStepHandler,
} from "../durableExecution/worker";
import type { ClaimedWorkflowStep, ProcurementWorkflowStore } from "./workflowStore";

export type ProcurementStepHandler = DurableStepHandler<ClaimedWorkflowStep>;

export type ProcurementWorkerOptions = {
  leaseOwner: string;
  leaseMs: number;
  pollMs: number;
  concurrency: number;
  retryBaseMs: number;
};

/**
 * Procurement-compatible facade over the domain-neutral durable worker.
 * Existing callers intentionally keep the same constructor and handler shape.
 */
export class ProcurementWorker {
  private readonly worker: DurableWorker<ClaimedWorkflowStep>;

  constructor(
    store: ProcurementWorkflowStore,
    handlers: ReadonlyMap<string, ProcurementStepHandler>,
    options: ProcurementWorkerOptions
  ) {
    this.worker = new DurableWorker(store, handlers, {
      ...options,
      getHandlerKey: step => step.stepType,
      logPrefix: "ProcurementWorker",
    });
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
