
import "dotenv/config";

import http from "node:http";
import mysql from "mysql2/promise";
import { MysqlMitchEventInbox } from "./mitchEventInbox";
import { MitchEventService } from "./mitchEventService";
import {
  createMitchEventIngress,
  isGithubActorAuthorized,
  type MitchGithubActorRule,
} from "./mitchEventIngress";
import {
  HttpMitchAgentWakeProvider,
  type MitchAgentWakeTarget,
} from "./mitchAgentWake";
import { GitHubActionsMitchWakeProvider } from "./githubActionsWakeProvider";
import { registerMitchGithubAgentRoutes } from "./mitchGithubAgentRoutes";
import { parseMitchComment, MITCH_EVENT_MARKER } from "../../shared/mitchEvents";
import { createMitchProducerPlan } from "./mitchProducerPlans";
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

function jsonEnv<T>(name: string): T {
  try {
    return JSON.parse(required(name)) as T;
  } catch (error) {
    throw new Error(name + " must contain valid JSON: " + String(error));
  }
}

const tenantId = required("MITCH_TENANT_ID");
const gameId = process.env.MITCH_GAME_ID?.trim() || "kingdom.boreslay";
const gameTitle =
  gameId === "kingdom.boreslay"
    ? "Boreslay"
    : gameId === SMALL_COMFORTS_GAME_ID
      ? "Small Comforts"
      : gameId;
const executorEnabled = process.env.MITCH_EXECUTOR_ENABLED === "true";
const token = process.env.MITCH_GITHUB_TOKEN?.trim() || "";
if (executorEnabled && !token)
  throw new Error("MITCH_GITHUB_TOKEN is required when MITCH_EXECUTOR_ENABLED=true");
const repoFullName = process.env.MITCH_GITHUB_REPO?.trim() || "adamwright83-blip/bldg-admin-api";
const issueNumber = numberEnv("MITCH_GITHUB_ISSUE_NUMBER", 370);
const recoveryMs = numberEnv("MITCH_PRODUCER_RECOVERY_MS", 60 * 60 * 1000);
const handbackPollMs = numberEnv("MITCH_HANDBACK_POLL_MS", 15_000);
const handbackTimeoutMs = numberEnv("MITCH_HANDBACK_TIMEOUT_MS", 45 * 60 * 1000);
const port = numberEnv("PORT", 8082);
const reviewerId = process.env.MITCH_REVIEWER_ACTOR_ID?.trim() || "claude_independent_review";
const githubActorRules = jsonEnv<MitchGithubActorRule[]>("MITCH_GITHUB_ACTOR_RULES");
const callbackActorTokens = jsonEnv<Record<string, string>>("MITCH_CALLBACK_ACTOR_TOKENS");
const wakeMode = process.env.MITCH_AGENT_WAKE_MODE?.trim() || "github_actions";
const gameId = process.env.MITCH_GAME_ID?.trim() || "kingdom.boreslay";
const wakeProvider =
  wakeMode === "github_actions"
    ? token
      ? new GitHubActionsMitchWakeProvider({
          token,
          repoFullName,
          ref: process.env.MITCH_GITHUB_ACTIONS_REF?.trim() || "main",
          controlPlaneBaseUrl:
            process.env.MITCH_PRODUCER_PUBLIC_BASE_URL?.trim() ||
            (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
              ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN.trim()
              : undefined),
        })
      : new HttpMitchAgentWakeProvider({})
    : new HttpMitchAgentWakeProvider(
        jsonEnv<Record<string, MitchAgentWakeTarget>>("MITCH_AGENT_WAKE_ENDPOINTS")
      );

const store = new MitchProductionStore(false, true);
const service = new MitchProductionService(store);
const dispatcher = new MitchGameDispatcher(store);
const reasoning = new MitchProductionReasoningService(store);
const qa = new MitchQaService(store);
const unavailableBus = {
  listComments: async () => [],
  hasMarker: async () => false,
  postComment: async () => {
    throw new Error("MITCH_GITHUB_TOKEN is required for producer-bus writes");
  },
  readDesignReview: async () => null,
  verifyImplementationIdentity: async () => {
    throw new Error("MITCH_GITHUB_TOKEN is required to verify implementation identity");
  },
} as unknown as GitHubProducerBus;
const bus = token
  ? new GitHubProducerBus({ token, repoFullName, issueNumber })
  : unavailableBus;

if (executorEnabled) {
  const provider = new GitHubProducerExecutionProvider(bus, {
    pollMs: handbackPollMs,
    timeoutMs: handbackTimeoutMs,
    wakeProvider,
  });
  dispatcher.registerExecutionProvider(provider);
}

const plan = createMitchProducerPlan({
  gameId,
  tenantId,
  store,
  service,
  baseBranch:
    process.env.MITCH_GAME_BASE_BRANCH?.trim() ||
    process.env.MITCH_SMALL_COMFORTS_BASE_BRANCH?.trim() ||
    undefined,
  baseSha:
    process.env.MITCH_GAME_BASE_SHA?.trim() ||
    process.env.MITCH_SMALL_COMFORTS_BASE_SHA?.trim() ||
    undefined,
});

const coordinator = new MitchProducerCoordinator({
  tenantId,
  eventDriven: true,
  store,
  service,
  dispatcher,
  reasoning,
  qa,
  bus,
  wakeProvider,
  reviewerId,
  gameId: plan.gameId,
  gameTitle: plan.gameTitle,
  seedProductionWork: plan.seed,
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
    // Recovery only: recover structured comments whose webhook never reached the inbox.
    // A disabled/bootstrap service may intentionally have no GitHub credential yet.
    for (const comment of token ? await bus.listComments() : []) {
      if (!comment.body.includes(MITCH_EVENT_MARKER)) continue;
      let event;
      try { event = parseMitchComment(comment.body); } catch { continue; }
      if (
        event.tenantId !== tenantId ||
        event.gameId !== plan.gameId ||
        !isGithubActorAuthorized(githubActorRules, {
          login: comment.user?.login ?? "",
          app: comment.performed_via_github_app ?? null,
          actorId: event.actorId,
        })
      ) continue;
      await events.receive(event);
    }
    await events.drain();
    await coordinator.advance();
    lastResult = { action: "idle", reason: "Waiting for structured handback events" };
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

const pool = mysql.createPool(required("DATABASE_URL"));
const events = new MitchEventService({ tenantId, gameId: plan.gameId, humanActorId: "adam",
  inbox: new MysqlMitchEventInbox(pool), store, dispatcher, coordinator, service,
  verifyImplementation: (branch, commitSha) => bus.verifyImplementationIdentity(branch, commitSha) });
const app = createMitchEventIngress({
  events,
  repoFullName,
  issueNumber,
  githubActorRules,
  callbackActorTokens,
  webhookSecret: required("MITCH_GITHUB_WEBHOOK_SECRET"),
});
registerMitchGithubAgentRoutes(app, { events });
app.get("/healthz", (_request, response) => {
  response.status(lastError ? 503 : 200).json({ ok: !lastError, producer: {
    tenantId, gameId: plan.gameId, gameTitle: plan.gameTitle, repoFullName, issueNumber,
    executorEnabled, githubAuthenticated: Boolean(token), inFlight, lastRunAt, lastSuccessAt, lastError, lastResult,
    mode: "event_driven", wakeMode, recoveryMs,
  } });
});
const server = http.createServer(app);

server.listen(port, () => {
  console.log("[MitchProducer] health listening on", port);
});

void tick();
const timer = setInterval(() => void tick(), recoveryMs);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopped = true;
  clearInterval(timer);
  console.log("[MitchProducer] received", signal, "draining");
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
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
