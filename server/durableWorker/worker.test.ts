import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  DurableWorker,
  type DurableWorkStore,
  type DurableWorkerOptions,
} from "./worker";

type Item = {
  id: string;
  kind: string;
  attemptCount: number;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(check: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met in time");
    await wait(5);
  }
}

function fakeStore(items: Item[], failWrite?: () => Promise<unknown>) {
  const queue = [...items];
  const calls = { claims: 0, completed: [] as string[], failures: 0 };
  const store: DurableWorkStore<Item> = {
    async sweepExpired() { return 0; },
    async claimNext() {
      calls.claims += 1;
      return queue.shift() ?? null;
    },
    async markRunning() { return true; },
    async heartbeat() { return true; },
    async complete(item) {
      calls.completed.push(item.id);
      return true;
    },
    async fail() {
      calls.failures += 1;
      if (failWrite) return failWrite();
      return "retry_scheduled";
    },
  };
  return { store, calls };
}

const OPTIONS: DurableWorkerOptions = {
  leaseOwner: "worker-a",
  leaseMs: 60_000,
  pollMs: 10,
  concurrency: 1,
  retryBaseMs: 100,
};

const workers: DurableWorker<Item>[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.stop()));
  vi.restoreAllMocks();
});

describe("DurableWorker", () => {
  it("is domain-neutral and routes work by the supplied type resolver", async () => {
    const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/procurement|macro_goal|campaign|laundry/i);

    const { store, calls } = fakeStore([{ id: "1", kind: "fixture", attemptCount: 1 }]);
    const worker = new DurableWorker(
      store,
      new Map([["fixture", async () => "ok"]]),
      OPTIONS,
      item => item.kind,
    );
    workers.push(worker);
    void worker.start();

    await until(() => calls.completed.length === 1);
    expect(calls.completed).toEqual(["1"]);
  });

  it("does not die when failure persistence throws and exposes degraded health", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { store, calls } = fakeStore(
      [{ id: "1", kind: "fixture", attemptCount: 1 }],
      async () => { throw new Error("DB unavailable while recording failure"); },
    );
    const worker = new DurableWorker(
      store,
      new Map([["fixture", async () => { throw new Error("handler failed"); }]]),
      { ...OPTIONS, pollMs: 5 },
      item => item.kind,
    );
    workers.push(worker);
    void worker.start();

    await until(() => worker.health.degraded);
    const claimsAfterFailure = calls.claims;
    await until(() => calls.claims > claimsAfterFailure);
    expect(worker.health).toMatchObject({
      ok: false,
      degraded: true,
      lastError: "DB unavailable while recording failure",
    });
    expect(calls.failures).toBe(1);
  });
});
