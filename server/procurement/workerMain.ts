import "dotenv/config";

import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import mysql from "mysql2/promise";
import { ProcurementWorker, type ProcurementStepHandler } from "./worker";
import { ProcurementWorkflowStore } from "./workflowStore";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the procurement worker");

const numberFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
};

const pool = mysql.createPool({
  uri: databaseUrl,
  connectionLimit: numberFromEnv("PROCUREMENT_WORKER_POOL_SIZE", 8),
  supportBigNumbers: true,
  bigNumberStrings: true,
});
const store = new ProcurementWorkflowStore(pool);
const handlers = new Map<string, ProcurementStepHandler>([
  ["foundation.noop", async ({ step }) => ({ acknowledged: true, stepId: step.id })],
]);
const leaseOwner =
  process.env.PROCUREMENT_WORKER_ID ??
  process.env.RAILWAY_REPLICA_ID ??
  `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const worker = new ProcurementWorker(store, handlers, {
  leaseOwner,
  leaseMs: numberFromEnv("PROCUREMENT_WORKER_LEASE_MS", 60_000),
  pollMs: numberFromEnv("PROCUREMENT_WORKER_POLL_MS", 1_000),
  concurrency: numberFromEnv("PROCUREMENT_WORKER_CONCURRENCY", 4),
  retryBaseMs: numberFromEnv("PROCUREMENT_WORKER_RETRY_BASE_MS", 5_000),
});

const port = numberFromEnv("PORT", 8081);
const server = http.createServer((request, response) => {
  if (request.url !== "/healthz") {
    response.writeHead(404).end();
    return;
  }
  const health = worker.health;
  response.writeHead(health.ok ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify(health));
});

server.listen(port, () => console.log(`[ProcurementWorker] health listening on ${port}`));
void worker.start();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ProcurementWorker] received ${signal}; draining`);
  await worker.stop();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal).then(() => process.exit(0), error => {
      console.error("[ProcurementWorker] shutdown failed", error);
      process.exit(1);
    });
  });
}
