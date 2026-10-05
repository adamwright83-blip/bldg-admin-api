import "dotenv/config";
import http from "node:http";
import { AppPresidentJudgmentProvider } from "./appProvider";
import { getPresidentRuntime, presidentRuntimeStatus } from "./runtime";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(name + " must be a positive number");
  return value;
}

const status = presidentRuntimeStatus();
if (status.executionState !== "CONFIGURED")
  throw new Error(
    "President worker requires configured agent targets, callback URL, and callback tokens"
  );

const runtime = getPresidentRuntime();
const pollMs = numberEnv("PRESIDENT_WORKER_POLL_MS", 15_000);
const port = numberEnv("PORT", 8083);
let inFlight = false;
let stopped = false;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;

async function tick() {
  if (stopped || inFlight) return;
  inFlight = true;
  lastRunAt = new Date().toISOString();
  try {
    await runtime.coordinator.recover();
    await runtime.service.finalizeVerifiedMeasurements();
    await runtime.service.advanceObjectives(new AppPresidentJudgmentProvider());
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
      worker: { inFlight, lastRunAt, lastSuccessAt, lastError },
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
