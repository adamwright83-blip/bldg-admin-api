export type DurableWorkerOptions = {
  leaseOwner: string;
  leaseMs: number;
  pollMs: number;
  concurrency: number;
  retryBaseMs: number;
};

export type DurableWorkHandler<T> = (
  input: { item: T; signal: AbortSignal },
) => Promise<unknown>;

export interface DurableWorkStore<T> {
  sweepExpired(): Promise<number>;
  claimNext(input: { leaseOwner: string; leaseMs: number }): Promise<T | null>;
  markRunning(item: T): Promise<boolean>;
  heartbeat(item: T, leaseMs: number): Promise<boolean>;
  complete(item: T, result: unknown): Promise<boolean>;
  fail(item: T, error: unknown, retryDelayMs: number): Promise<unknown>;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Domain-neutral lease worker.
 *
 * Persistence owns claim/lease/dead-letter semantics; this loop owns polling,
 * heartbeats, bounded concurrency, retry timing, degraded health and graceful
 * shutdown. It deliberately imports no business domain.
 */
export class DurableWorker<T> {
  private readonly controller = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();
  private loopPromise: Promise<void> | null = null;
  private lastPollAt: Date | null = null;
  private lastPollError: string | null = null;
  private lastExecutionError: string | null = null;

  constructor(
    private readonly store: DurableWorkStore<T>,
    private readonly handlers: ReadonlyMap<string, DurableWorkHandler<T>>,
    private readonly options: DurableWorkerOptions,
    private readonly workType: (item: T) => string,
  ) {}

  get health() {
    const lastError = this.lastExecutionError ?? this.lastPollError;
    return {
      ok: !this.controller.signal.aborted && !lastError,
      degraded: Boolean(lastError),
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
        await this.store.sweepExpired();
        while (!this.controller.signal.aborted && this.inFlight.size < this.options.concurrency) {
          const item = await this.store.claimNext({
            leaseOwner: this.options.leaseOwner,
            leaseMs: this.options.leaseMs,
          });
          if (!item) break;
          const promise = this.execute(item).finally(() => this.inFlight.delete(promise));
          this.inFlight.add(promise);
        }
        this.lastPollError = null;
      } catch (error) {
        this.lastPollError = message(error);
        console.error("[DurableWorker] poll failed", error);
      }

      if (this.inFlight.size >= this.options.concurrency) {
        // execute() is deliberately non-throwing, but allSettled semantics here
        // make the loop robust if that contract is ever accidentally weakened.
        await Promise.race(
          Array.from(this.inFlight, promise => promise.catch(() => undefined))
        );
      } else {
        await sleep(this.options.pollMs, this.controller.signal);
      }
    }
  }

  private async execute(item: T) {
    const handler = this.handlers.get(this.workType(item));
    const heartbeat = setInterval(() => {
      void this.store.heartbeat(item, this.options.leaseMs).then(ok => {
        if (!ok) return;
      }).catch(error => {
        this.lastExecutionError = `heartbeat persistence failed: ${message(error)}`;
        console.error("[DurableWorker] heartbeat failed", error);
      });
    }, Math.max(100, Math.floor(this.options.leaseMs / 3)));

    try {
      if (!(await this.store.markRunning(item))) return;
      if (!handler) throw new Error(`No handler registered for work type ${this.workType(item)}`);
      const result = await handler({ item, signal: this.controller.signal });
      await this.store.complete(item, result);
      this.lastExecutionError = null;
    } catch (error) {
      const attemptCount = Number((item as { attemptCount?: unknown }).attemptCount ?? 1);
      const retryDelay = this.options.retryBaseMs * 2 ** Math.max(0, attemptCount - 1);
      try {
        await this.store.fail(item, error, retryDelay);
      } catch (failure) {
        this.lastExecutionError = message(failure);
        console.error("[DurableWorker] failure persistence failed; worker remains alive", failure);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}
