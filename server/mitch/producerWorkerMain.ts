
import "dotenv/config";

import http from "node:http";
import { GitHubProducerBus } from "./githubProducerBus";
import { GitHubProducerExecutionProvider } from "./githubProducerExecutionProvider";
import { MitchGameDispatcher } from "./mitchDispatcher";
import { MitchProducerCoordinator, type MitchProducerCoordinatorResult } from "./mitchProducerCoordinator";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import { MitchQaService } from "./mitchQaService";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for the Mitch producer worker");
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(name + " must be a positive number");
  return value;
}

const tenantId = required("MITCH_TENANT_ID");
const token = required("MITCH_GITHUB_TOKEN");
const repoFullName = process.env.MITCH_GITHUB_REPO?.trim() || "adamwright83-blip/bldg-admin-api";
const issueNumber = numberEnv("MITCH_GITHUB_ISSUE_NUMBER", 370);
const pollMs = numberEnv("MITCH_PRODUCER_POLL_MS", 30_000);
const handbackPollMs = numberEnv("MITCH_HANDBACK_POLL_MS", 15_000);
const handbackTimeoutMs = numberEnv("MITCH_HANDBACK_TIMEOUT_MS", 45 * 60 * 1000);
const port = numberEnv("PORT", 8082);

const store = new MitchProductionStore(false, true);
const service = new MitchProductionService(store);
const dispatcher = new MitchGameDispatcher(store);
const reasoning = new MitchProductionReasoningService(store);
const qa = new MitchQaService(store);
const bus = new GitHubProducerBus({ token, repoFullName, issueNumber });
const provider = new GitHubProducerExecutionProvider(bus, {
  pollMs: handbackPollMs,
  timeoutMs: handbackTimeoutMs,
});
dispatcher.registerExecutionProvider(provider);

const coordinator = new MitchProducerCoordinator({
  tenantId,
  store,
  service,
  dispatcher,
  reasoning,
  qa,
  bus,
  initialBaseBranch: process.env.MITCH_SMALL_COMFORTS_BASE_BRANCH?.trim() || undefined,
  initialBaseSha: process.env.MITCH_SMALL_COMFORTS_BASE_SHA?.trim() || undefined,
});

let stopped = false;
let inFlight = false;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let lastResult: MitchProducerCoordinatorResult | null = null;

async function tick(): Promise<void> {
  if (stopped || inFlight) return;
  inFlight = true;
  lastRunAt = new Date().toISOString();
  try {
    lastResult = await coordinator.runOnce();
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    console.log("[MitchProducer]", JSON.stringify(lastResult));
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("[MitchProducer] tick failed", error);
  } finally {
    inFlight = false;
  }
}

const server = http.createServer((request, response) => {
  if (request.url !== "/healthz") {
    response.writeHead(404).end();
    return;
  }
  const ok = !lastError || Boolean(lastSuccessAt);
  response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ok,
      producer: {
        tenantId,
        repoFullName,
        issueNumber,
        inFlight,
        lastRunAt,
        lastSuccessAt,
        lastError,
        lastResult,
      },
    })
  );
});

server.listen(port, () => {
  console.log("[MitchProducer] health listening on", port);
});

void tick();
const timer = setInterval(() => void tick(), pollMs);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopped = true;
  clearInterval(timer);
  console.log("[MitchProducer] received", signal, "draining");
  await new Promise<void>(resolve => server.close(() => resolve()));
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal).then(
      () => process.exit(0),
      error => {
        console.error("[MitchProducer] shutdown failed", error);
        process.exit(1);
      }
    );
  });
}
