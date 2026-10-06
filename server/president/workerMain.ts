import "dotenv/config";
import http from "node:http";
import { AppPresidentJudgmentProvider } from "./appProvider";
import { getPresidentRuntime, presidentRuntimeStatus } from "./runtime";
import { runPresidentCycleWorkerTick } from "./cycle/runtime";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(name + " must be a positive number");
  return value;
}

const pollMs = numberEnv("PRESIDENT_WORKER_POLL_MS", 15_000);
const port = numberEnv("PORT", 8083);
let inFlight = false;
let stopped = false;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let lastCycleTick: Awaited<ReturnType<typeof runPresidentCycleWorkerTick>> | null =
  null;

async function runLegacyTick() {
  if (process.env.PRESIDENT_LEGACY_RUNTIME_ENABLED !== "1") return false;
  const status = presidentRuntimeStatus();
  if (status.executionState !== "CONFIGURED") return false;
  const runtime = getPresidentRuntime();
  await runtime.coordinator.recover();
  await runtime.service.finalizeVerifiedMeasurements();
  await runtime.service.advanceObjectives(new AppPresidentJudgmentProvider());
  return true;
}

async function tick() {
  if (stopped || inFlight) return;
  inFlight = true;
  lastRunAt = new Date().toISOString();
  try {
    const legacyRan = await runLegacyTick();
    let cycleRan = false;
    if (process.env.PRESIDENT_EXECUTION_ENABLED === "1") {
      lastCycleTick = await runPresidentCycleWorkerTick();
      cycleRan = true;
    } else {
      lastCycleTick = null;
    }
    if (!legacyRan && !cycleRan)
      throw new Error(
        "No President execution path is enabled: legacy agent targets are not configured and PRESIDENT_EXECUTION_ENABLED is not 1"
      );
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
  const legacyRuntimeEnabled =
    process.env.PRESIDENT_LEGACY_RUNTIME_ENABLED === "1";
  let legacyRuntime: ReturnType<typeof presidentRuntimeStatus> | null = null;
  let legacyRuntimeError: string | null = null;
  if (legacyRuntimeEnabled) {
    try {
      legacyRuntime = presidentRuntimeStatus();
    } catch (error) {
      legacyRuntimeError =
        error instanceof Error ? error.message : String(error);
    }
  }
  // This is a liveness endpoint, not a model/provider readiness probe.
  // A slow deliberation or transient provider failure must not make Railway
  // kill a healthy durable worker and strand its mission state.
  const ok = !legacyRuntimeEnabled || legacyRuntimeError === null;
  response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ok,
      runtime: legacyRuntime,
      legacyRuntimeError,
      autonomousCycleExecutionEnabled:
        process.env.PRESIDENT_EXECUTION_ENABLED === "1",
      autonomousExecutionMode:
        process.env.PRESIDENT_EXECUTION_MODE || "github_actions",
      legacyRuntimeEnabled,
      worker: {
        inFlight,
        lastRunAt,
        lastSuccessAt,
        lastError,
        lastCycleTick,
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
