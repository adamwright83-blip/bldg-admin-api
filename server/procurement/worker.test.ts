/**
 * Characterization tests for the procurement durable worker loop.
 *
 * These pin down what `ProcurementWorker` does TODAY, before Persistent Growth
 * Slice B extracts its lease mechanics into a domain-neutral module. The spec
 * for that slice says procurement must keep working unchanged; these tests are
 * how that claim gets checked. They use an in-memory fake store; the SQL
 * semantics are covered against real MySQL in
 * workflowStore.mysql.integration.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimedWorkflowStep, ProcurementWorkflowStore } from "./workflowStore";
import { ProcurementWorker, type ProcurementStepHandler, type ProcurementWorkerOptions } from "./worker";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(check: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met in time");
    await wait(5);
  }
}

function step(id: string, over: Partial<ClaimedWorkflowStep> = {}): ClaimedWorkflowStep {
  return {
    id,
    workflowId: `wf-${id}`,
    stepKey: `key-${id}`,
    stepType: "test.step",
    payload: { id },
    attemptCount: 1,
    maxAttempts: 5,
    deadlineAt: null,
    leaseOwner: "worker-a",
    ...over,
  };
}

type FakeStore = ProcurementWorkflowStore & {
  queue: ClaimedWorkflowStep[];
  calls: {
    claim: number;
    deadLetterSweep: number;
    markRunning: string[];
    heartbeat: Array<{ id: string; leaseMs: number }>;
    complete: Array<{ id: string; result: unknown }>;
    fail: Array<{ id: string; message: string; retryDelayMs: number }>;
  };
};

function fakeStore(over: {
  steps?: ClaimedWorkflowStep[];
  markRunning?: (s: ClaimedWorkflowStep) => Promise<boolean>;
  claimNextStep?: () => Promise<ClaimedWorkflowStep | null>;
  heartbeat?: (s: ClaimedWorkflowStep, leaseMs: number) => Promise<boolean>;
  completeStep?: (s: ClaimedWorkflowStep, result: unknown) => Promise<boolean>;
  failStep?: (s: ClaimedWorkflowStep, error: unknown, retryDelayMs: number) => Promise<unknown>;
} = {}): FakeStore {
  const queue = [...(over.steps ?? [])];
  const calls: FakeStore["calls"] = {
    claim: 0,
    deadLetterSweep: 0,
    markRunning: [],
    heartbeat: [],
    complete: [],
    fail: [],
  };
  const store = {
    queue,
    calls,
    async deadLetterExpiredSteps() {
      calls.deadLetterSweep += 1;
      return 0;
    },
    async claimNextStep() {
      calls.claim += 1;
      if (over.claimNextStep) return over.claimNextStep();
      return queue.shift() ?? null;
    },
    async markRunning(s: ClaimedWorkflowStep) {
      calls.markRunning.push(s.id);
      return over.markRunning ? over.markRunning(s) : true;
    },
    async heartbeat(s: ClaimedWorkflowStep, leaseMs: number) {
      calls.heartbeat.push({ id: s.id, leaseMs });
      return over.heartbeat ? over.heartbeat(s, leaseMs) : true;
    },
    async completeStep(s: ClaimedWorkflowStep, result: unknown) {
      if (over.completeStep) return over.completeStep(s, result);
      calls.complete.push({ id: s.id, result });
      return true;
    },
    async failStep(s: ClaimedWorkflowStep, error: unknown, retryDelayMs: number) {
      calls.fail.push({
        id: s.id,
        message: error instanceof Error ? error.message : String(error),
        retryDelayMs,
      });
      if (over.failStep) return over.failStep(s, error, retryDelayMs);
      return "retry_scheduled" as const;
    },
  };
  return store as unknown as FakeStore;
}

const OPTIONS: ProcurementWorkerOptions = {
  leaseOwner: "worker-a",
  leaseMs: 60_000,
  pollMs: 10,
  concurrency: 2,
  retryBaseMs: 1_000,
};

const workers: ProcurementWorker[] = [];
function startWorker(
  store: FakeStore,
  handlers: Record<string, ProcurementStepHandler>,
  options: Partial<ProcurementWorkerOptions> = {}
) {
  const worker = new ProcurementWorker(store, new Map(Object.entries(handlers)), { ...OPTIONS, ...options });
  workers.push(worker);
  void worker.start();
  return worker;
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.stop()));
  vi.restoreAllMocks();
});

describe("ProcurementWorker — step lifecycle", () => {
  it("marks a claimed step running, runs its handler, and completes it with the handler's result", async () => {
    const store = fakeStore({ steps: [step("1")] });
    const handler = vi.fn(async ({ step: s }: { step: ClaimedWorkflowStep }) => ({ handled: s.id }));
    startWorker(store, { "test.step": handler });

    await until(() => store.calls.complete.length === 1);
    expect(store.calls.markRunning).toEqual(["1"]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.calls.complete).toEqual([{ id: "1", result: { handled: "1" } }]);
    expect(store.calls.fail).toEqual([]);
  });

  it("does not run the handler when the lease was lost before it could start", async () => {
    const store = fakeStore({ steps: [step("1")], markRunning: async () => false });
    const handler = vi.fn(async () => "ran");
    startWorker(store, { "test.step": handler });

    await until(() => store.calls.markRunning.length === 1);
    await wait(40);
    expect(handler).not.toHaveBeenCalled();
    expect(store.calls.complete).toEqual([]);
    expect(store.calls.fail).toEqual([]);
  });

  it("fails a step whose type has no registered handler, so it retries and eventually dead-letters", async () => {
    const store = fakeStore({ steps: [step("1", { stepType: "unknown.type" })] });
    startWorker(store, {});

    await until(() => store.calls.fail.length === 1);
    expect(store.calls.fail[0].message).toBe("No handler registered for step type unknown.type");
    expect(store.calls.complete).toEqual([]);
  });

  it("retries a failed handler with exponential backoff: retryBaseMs × 2^(attempt − 1)", async () => {
    const store = fakeStore({
      steps: [step("a1", { attemptCount: 1 }), step("a2", { attemptCount: 2 }), step("a4", { attemptCount: 4 })],
    });
    startWorker(store, { "test.step": async () => { throw new Error("provider down"); } }, { concurrency: 1 });

    await until(() => store.calls.fail.length === 3);
    expect(store.calls.fail.map(f => [f.id, f.retryDelayMs])).toEqual([
      ["a1", 1_000],
      ["a2", 2_000],
      ["a4", 8_000],
    ]);
    expect(store.calls.fail.every(f => f.message === "provider down")).toBe(true);
  });

  it("CURRENT BEHAVIOR: if completeStep throws after a successful handler, the step is failed and will run again", async () => {
    // Handlers must therefore be idempotent. Slice B should keep this visible.
    const store = fakeStore({
      steps: [step("1")],
      completeStep: async () => { throw new Error("db blip on complete"); },
    });
    const handler = vi.fn(async () => "done");
    startWorker(store, { "test.step": handler });

    await until(() => store.calls.fail.length === 1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.calls.fail[0].message).toBe("db blip on complete");
  });

  it("contains a failStep persistence error, stays alive, and exposes degraded health", async () => {
    const store = fakeStore({
      steps: [step("1")],
      failStep: async () => {
        throw new Error("DB unavailable while recording the failure");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const worker = startWorker(store, {
      "test.step": async () => {
        throw new Error("provider down");
      },
    });

    await until(() => worker.health.degraded && worker.health.lastError !== null);
    const claimsAfterFailure = store.calls.claim;
    await until(() => store.calls.claim > claimsAfterFailure);

    expect(worker.health).toMatchObject({
      ok: false,
      degraded: true,
      draining: false,
      lastError: "DB unavailable while recording the failure",
    });
  });
});

describe("ProcurementWorker — leases and heartbeats", () => {
  it("aborts the handler and refuses stale acknowledgement when a heartbeat loses the lease", async () => {
    const store = fakeStore({
      steps: [step("lost")],
      heartbeat: async () => false,
    });
    let observedSignal: AbortSignal | null = null;
    const worker = startWorker(
      store,
      {
        "test.step": async ({ signal }) => {
          observedSignal = signal;
          await new Promise<void>(resolve => {
            if (signal.aborted) return resolve();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return "must-not-ack";
        },
      },
      { leaseMs: 300, concurrency: 1 }
    );

    await until(() => observedSignal?.aborted === true, 3_000);
    await until(() => worker.health.degraded, 3_000);

    expect(store.calls.heartbeat.length).toBeGreaterThanOrEqual(1);
    expect(store.calls.complete).toEqual([]);
    expect(store.calls.fail).toEqual([]);
    expect(worker.health.lastError).toBe(
      "Lease lost during execution for step lost"
    );
  });

  it("treats a rejected completion fence as lease loss instead of success or retry", async () => {
    let completionAttempts = 0;
    const store = fakeStore({
      steps: [step("completion-fence")],
      completeStep: async () => {
        completionAttempts += 1;
        return false;
      },
    });
    const worker = startWorker(store, {
      "test.step": async () => "done",
    });

    await until(() => completionAttempts === 1);
    await until(() => worker.health.degraded);

    expect(store.calls.fail).toEqual([]);
    expect(worker.health.lastError).toBe(
      "Lease lost before durable completion for step completion-fence"
    );
  });

  it("heartbeats a long-running step about every leaseMs / 3 and stops once it finishes", async () => {
    const store = fakeStore({ steps: [step("1")] });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    startWorker(store, { "test.step": async () => { await gate; return "ok"; } }, { leaseMs: 300 });

    await until(() => store.calls.heartbeat.length >= 3, 3_000);
    expect(store.calls.heartbeat.every(call => call.id === "1" && call.leaseMs === 300)).toBe(true);
    release();
    await until(() => store.calls.complete.length === 1);
    const afterFinish = store.calls.heartbeat.length;
    await wait(250);
    expect(store.calls.heartbeat.length).toBe(afterFinish);
  });

  it("never heartbeats faster than every 100ms, whatever the lease", async () => {
    const store = fakeStore({ steps: [step("1")] });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    startWorker(store, { "test.step": async () => { await gate; } }, { leaseMs: 30 });

    await wait(260);
    release();
    await until(() => store.calls.complete.length === 1);
    // 30ms / 3 would be 10ms; the floor is 100ms, so ~2 beats in 260ms, never ~25.
    expect(store.calls.heartbeat.length).toBeLessThanOrEqual(3);
    expect(store.calls.heartbeat.length).toBeGreaterThanOrEqual(1);
    expect(store.calls.heartbeat.every(call => call.id === "1" && call.leaseMs === 30)).toBe(true);
  });
});

describe("ProcurementWorker — polling, concurrency and shutdown", () => {
  it("sweeps deadline-expired steps on every poll, even when there is no work", async () => {
    const store = fakeStore();
    startWorker(store, {});
    await until(() => store.calls.deadLetterSweep >= 3);
    expect(store.calls.claim).toBeGreaterThanOrEqual(3);
  });

  it("never runs more steps at once than its concurrency", async () => {
    const store = fakeStore({ steps: ["1", "2", "3", "4", "5", "6"].map(id => step(id)) });
    let active = 0;
    let peak = 0;
    startWorker(
      store,
      {
        "test.step": async () => {
          active += 1;
          peak = Math.max(peak, active);
          await wait(30);
          active -= 1;
        },
      },
      { concurrency: 2 }
    );

    await until(() => store.calls.complete.length === 6, 3_000);
    expect(peak).toBe(2);
  });

  it("records a poll failure in health and keeps polling", async () => {
    let calls = 0;
    const store = fakeStore({
      claimNextStep: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection reset");
        return null;
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const worker = startWorker(store, {});

    await until(() => worker.health.lastError === "connection reset");
    await until(() => worker.health.lastError === null);
    expect(store.calls.claim).toBeGreaterThanOrEqual(2);
  });

  it("stop() stops claiming, waits for in-flight work, and signals the handler to abort", async () => {
    const store = fakeStore({ steps: [step("1"), step("2"), step("3")] });
    const signals: AbortSignal[] = [];
    let finished = 0;
    const worker = startWorker(
      store,
      {
        "test.step": async ({ signal }) => {
          signals.push(signal);
          await wait(60);
          finished += 1;
        },
      },
      { concurrency: 1 }
    );

    await until(() => signals.length === 1);
    await worker.stop();
    workers.splice(workers.indexOf(worker), 1);

    expect(signals[0].aborted).toBe(true);
    expect(finished).toBe(1);
    expect(store.calls.complete.map(c => c.id)).toEqual(["1"]);
    expect(store.queue.map(s => s.id)).toEqual(["2", "3"]);
    expect(worker.health).toMatchObject({ ok: false, draining: true, inFlight: 0 });
  });

  it("reports a healthy snapshot while running", async () => {
    const store = fakeStore();
    const worker = startWorker(store, {}, { leaseOwner: "worker-z" });
    await until(() => worker.health.lastPollAt !== null);
    expect(worker.health).toMatchObject({ ok: true, draining: false, leaseOwner: "worker-z", inFlight: 0, lastError: null });
  });
});
