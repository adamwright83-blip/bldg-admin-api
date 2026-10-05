import "dotenv/config";
import http from "node:http";
import { AppPresidentJudgmentProvider } from "./appProvider";
import { getPresidentRuntime, presidentRuntimeStatus } from "./runtime";
import { presidentPool } from "./database";
import { MysqlPresidentProgramStore } from "./programStore";
import { MysqlPresidentIntelligenceStore } from "./intelligenceStore";
import { PresidentProgramService } from "./programService";
import { getPresidentCycleRuntime } from "./cycle/runtime";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(name + " must be a positive number");
  return value;
}

const status = presidentRuntimeStatus();
const legacyRuntime =
  status.executionState === "CONFIGURED" ? getPresidentRuntime() : null;
const pool = presidentPool();
const programs = legacyRuntime?.programs ?? new MysqlPresidentProgramStore(pool);
const intelligence =
  legacyRuntime?.intelligence ?? new MysqlPresidentIntelligenceStore(pool);
const service =
  legacyRuntime?.service ??
  new PresidentProgramService(pool, programs, intelligence);
const cycleRuntime = getPresidentCycleRuntime();
const pollMs = numberEnv("PRESIDENT_WORKER_POLL_MS", 15_000);
const port = numberEnv("PORT", 8083);
let inFlight = false;
let stopped = false;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let lastCycleError: string | null = null;

async function tick() {
  if (stopped || inFlight) return;
  inFlight = true;
  lastRunAt = new Date().toISOString();
  try {
    if (legacyRuntime) await legacyRuntime.coordinator.recover();
    await service.finalizeVerifiedMeasurements();
    await service.advanceObjectives(new AppPresidentJudgmentProvider());

    try {
      let cycle = await cycleRuntime.store.latestCycle();
      if (!cycle || ["COMPLETED", "BLOCKED", "READY_FOR_HUMAN"].includes(cycle.state)) {
        const started = await cycleRuntime.service.maybeStartScheduledCycle();
        if (started) cycle = started;
      }
      if (cycle && ["ADAM_APPROVED", "EXECUTING"].includes(cycle.state))
        await cycleRuntime.runner.runOne(cycle.id);
      lastCycleError = null;
    } catch (cycleError) {
      lastCycleError =
        cycleError instanceof Error ? cycleError.message : String(cycleError);
      console.error("[PresidentWorker] cycle tick failed", cycleError);
    }

    lastSuccessAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("[PresidentWorker] tick failed", error);
  } finally {
    inFlight = false;
  }
}

const server = http.createServer((request, response) => {
  if (request.url !== "/healthz") {
    response.writeHead(404).end();
    return;
  }
  const ok = lastError === null && lastSuccessAt !== null;
  response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ok,
      runtime: presidentRuntimeStatus(),
      worker: {
        inFlight,
        lastRunAt,
        lastSuccessAt,
        lastError,
        lastCycleError,
      },
    })
  );
});

server.listen(port, () =>
  console.log("[PresidentWorker] health listening on", port)
);
void tick();
const timer = setInterval(() => void tick(), pollMs);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopped = true;
  clearInterval(timer);
  console.log("[PresidentWorker] received", signal, "draining");
  await new Promise<void>(resolve => server.close(() => resolve()));
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal).then(
      () => process.exit(0),
      error => {
        console.error("[PresidentWorker] shutdown failed", error);
        process.exit(1);
      }
    );
  });
}
