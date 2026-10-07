import { emitServerLog } from "../_core/posthogLogs";

export type DurableLeasedStep = {
  id: string;
  attemptCount: number;
  leaseOwner: string;
};

export type DurableExecutionStore<TStep extends DurableLeasedStep> = {
  deadLetterExpiredSteps(): Promise<number>;
  claimNextStep(input: { leaseOwner: string; leaseMs: number }): Promise<TStep | null>;
  markRunning(step: TStep): Promise<boolean>;
  heartbeat(step: TStep, leaseMs: number): Promise<boolean>;
  completeStep(step: TStep, result: unknown): Promise<boolean>;
  failStep(step: TStep, error: unknown, retryDelayMs: number): Promise<unknown>;
};

export type DurableStepHandler<TStep extends DurableLeasedStep> = (
  input: { step: TStep; signal: AbortSignal },
) => Promise<unknown>;

export type DurableWorkerOptions<TStep extends DurableLeasedStep> = {
  leaseOwner: string;
  leaseMs: number;
  pollMs: number;
  concurrency: number;
  retryBaseMs: number;
  getHandlerKey: (step: TStep) => string;
  logPrefix?: string;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Domain-neutral durable leased-work runner.
 *
 * The store owns persistence, lease/fairness semantics, idempotency and history.
 * This engine owns polling, handler concurrency, heartbeats, retry timing,
 * graceful shutdown and process-safe error containment.
 */
export class DurableWorker<TStep extends DurableLeasedStep> {
  private readonly controller = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();
  private loopPromise: Promise<void> | null = null;
  private lastPollAt: Date | null = null;
  private lastPollError: string | null = null;
  private lastExecutionError: string | null = null;

  constructor(
    private readonly store: DurableExecutionStore<TStep>,
    private readonly handlers: ReadonlyMap<string, DurableStepHandler<TStep>>,
    private readonly options: DurableWorkerOptions<TStep>
  ) {}

  get health() {
    const lastError = this.lastExecutionError ?? this.lastPollError;
    return {
      ok: !this.controller.signal.aborted && lastError === null,
      degraded: !this.controller.signal.aborted && lastError !== null,
      draining: this.controller.signal.aborted,
      leaseOwner: this.options.leaseOwner,
      inFlight: this.inFlight.size,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      lastError,
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
        this.lastPollError = null;
      } catch (error) {
        this.lastPollError = errorMessage(error);
        console.error(`[${this.options.logPrefix ?? "DurableWorker"}] poll failed`, error);
        emitServerLog("error", "Durable worker poll failed", {
          worker: this.options.logPrefix ?? "DurableWorker",
          error_message: this.lastPollError.slice(0, 500),
        });
      }

      if (this.inFlight.size >= this.options.concurrency) {
        await Promise.race(this.inFlight);
      } else {
        await sleep(this.options.pollMs, this.controller.signal);
      }
    }
  }

  private async execute(step: TStep) {
    const handlerKey = this.options.getHandlerKey(step);
    const handler = this.handlers.get(handlerKey);
    const prefix = this.options.logPrefix ?? "DurableWorker";
    const executionController = new AbortController();
    const propagateWorkerAbort = () =>
      executionController.abort(this.controller.signal.reason);
    if (this.controller.signal.aborted) {
      propagateWorkerAbort();
    } else {
      this.controller.signal.addEventListener("abort", propagateWorkerAbort, {
        once: true,
      });
    }

    let executionFinished = false;
    let leaseLost = false;
    let heartbeatError: unknown = null;

    const recordLeaseLoss = (reason: string) => {
      if (executionFinished || leaseLost) return;
      leaseLost = true;
      this.lastExecutionError = reason;
      executionController.abort(new Error(reason));
      emitServerLog("error", "Durable worker execution lease lost", {
        worker: prefix,
        step_id: step.id,
        handler: handlerKey,
        error_message: reason.slice(0, 500),
      });
    };

    const heartbeat = setInterval(() => {
      void this.store
        .heartbeat(step, this.options.leaseMs)
        .then(held => {
          if (!held) {
            recordLeaseLoss(
              `Lease lost during execution for step ${step.id}`
            );
          }
        })
        .catch(error => {
          const message = errorMessage(error);
          // A heartbeat persistence failure is not proof that the lease has
          // already been lost. Signal the handler to stop doing new work, then
          // route through failStep so the store's lease fence decides whether
          // this execution may be retried. Never complete after this abort.
          if (!executionFinished) {
            heartbeatError = error;
          }
          if (!executionFinished && !executionController.signal.aborted) {
            executionController.abort(error);
          }
          console.error(
            `[${prefix}] heartbeat failed for step ${step.id}`,
            error
          );
          emitServerLog("error", "Durable worker heartbeat failed", {
            worker: prefix,
            step_id: step.id,
            handler: handlerKey,
            error_message: message.slice(0, 500),
          });
        });
    }, Math.max(100, Math.floor(this.options.leaseMs / 3)));

    try {
      if (!(await this.store.markRunning(step))) {
        this.lastExecutionError = null;
        return;
      }
      if (leaseLost) return;
      if (heartbeatError) throw heartbeatError;
      if (!handler) {
        throw new Error(`No handler registered for step type ${handlerKey}`);
      }
      const result = await handler({ step, signal: executionController.signal });

      if (leaseLost) return;
      if (heartbeatError) throw heartbeatError;

      const completed = await this.store.completeStep(step, result);
      if (!completed) {
        recordLeaseLoss(
          `Lease lost before durable completion for step ${step.id}`
        );
        return;
      }
      this.lastExecutionError = null;
    } catch (error) {
      if (leaseLost) return;

      const retryDelay =
        this.options.retryBaseMs * 2 ** Math.max(0, step.attemptCount - 1);
      emitServerLog("error", "Durable worker step failed", {
        worker: prefix,
        step_id: step.id,
        handler: handlerKey,
        error_message: errorMessage(error).slice(0, 500),
      });
      try {
        const failureState = await this.store.failStep(
          step,
          error,
          retryDelay
        );
        if (failureState === "lease_lost") {
          recordLeaseLoss(
            `Lease lost before failure acknowledgement for step ${step.id}`
          );
          return;
        }
        this.lastExecutionError = null;
      } catch (failure) {
        // A failure while durably recording failure must never reject the
        // in-flight promise. The lease remains recoverable by the store.
        this.lastExecutionError = errorMessage(failure);
        console.error(
          `[${prefix}] failed to record step ${step.id} failure`,
          failure
        );
        emitServerLog("error", "Durable worker failed to record step failure", {
          worker: prefix,
          step_id: step.id,
          handler: handlerKey,
          error_message: this.lastExecutionError.slice(0, 500),
        });
      }
    } finally {
      executionFinished = true;
      clearInterval(heartbeat);
      this.controller.signal.removeEventListener("abort", propagateWorkerAbort);
    }
  }
}
