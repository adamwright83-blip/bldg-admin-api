import type { ClaimedWorkflowStep, ProcurementWorkflowStore } from "./workflowStore";

export type ProcurementStepHandler = (
  input: { step: ClaimedWorkflowStep; signal: AbortSignal },
) => Promise<unknown>;

export type ProcurementWorkerOptions = {
  leaseOwner: string;
  leaseMs: number;
  pollMs: number;
  concurrency: number;
  retryBaseMs: number;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

export class ProcurementWorker {
  private readonly controller = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();
  private loopPromise: Promise<void> | null = null;
  private lastPollAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly store: ProcurementWorkflowStore,
    private readonly handlers: ReadonlyMap<string, ProcurementStepHandler>,
    private readonly options: ProcurementWorkerOptions,
  ) {}

  get health() {
    return {
      ok: !this.controller.signal.aborted,
      draining: this.controller.signal.aborted,
      leaseOwner: this.options.leaseOwner,
      inFlight: this.inFlight.size,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  start() {
    if (!this.loopPromise) this.loopPromise = this.loop();
    return this.loopPromise;
  }

  async stop() {
    this.controller.abort();
    await this.loopPromise;
    await Promise.allSettled(Array.from(this.inFlight));
  }

  private async loop() {
    while (!this.controller.signal.aborted) {
      try {
        this.lastPollAt = new Date();
        await this.store.deadLetterExpiredSteps();
        while (!this.controller.signal.aborted && this.inFlight.size < this.options.concurrency) {
          const step = await this.store.claimNextStep({
            leaseOwner: this.options.leaseOwner,
            leaseMs: this.options.leaseMs,
          });
          if (!step) break;
          const promise = this.execute(step).finally(() => this.inFlight.delete(promise));
          this.inFlight.add(promise);
        }
        this.lastError = null;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        console.error("[ProcurementWorker] poll failed", error);
      }
      if (this.inFlight.size >= this.options.concurrency) {
        await Promise.race(this.inFlight);
      } else {
        await sleep(this.options.pollMs, this.controller.signal);
      }
    }
  }

  private async execute(step: ClaimedWorkflowStep) {
    const handler = this.handlers.get(step.stepType);
    const heartbeat = setInterval(() => {
      void this.store.heartbeat(step, this.options.leaseMs).catch(error => {
        console.error(`[ProcurementWorker] heartbeat failed for step ${step.id}`, error);
      });
    }, Math.max(100, Math.floor(this.options.leaseMs / 3)));
    try {
      if (!(await this.store.markRunning(step))) return;
      if (!handler) throw new Error(`No handler registered for step type ${step.stepType}`);
      const result = await handler({ step, signal: this.controller.signal });
      await this.store.completeStep(step, result);
    } catch (error) {
      const retryDelay = this.options.retryBaseMs * 2 ** Math.max(0, step.attemptCount - 1);
      await this.store.failStep(step, error, retryDelay);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
