import { z } from "zod";
import { PresidentAgentRuntimeCoordinator, PresidentAgentWakeClient } from "./agentRuntime";
import { presidentPool } from "./database";
import { MysqlPresidentIntelligenceStore } from "./intelligenceStore";
import { PresidentProgramService } from "./programService";
import { MysqlPresidentProgramStore } from "./programStore";

const targetSchema = z
  .object({
    actorId: z.string().min(1),
    url: z.string().url(),
    wakeToken: z.string().min(16),
    leaseMs: z.number().int().min(1000).max(24 * 60 * 60 * 1000).optional(),
  })
  .strict();

const targetsSchema = z.record(z.string().min(1), targetSchema);
const callbackTokensSchema = z.record(z.string().min(1), z.string().min(16));

function parseJson<T>(name: string, schema: z.ZodType<T>, fallback: T): T {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(name + " must be valid JSON");
  }
  return schema.parse(parsed);
}

export function presidentRuntimeConfig() {
  const targets = parseJson("PRESIDENT_AGENT_TARGETS_JSON", targetsSchema, {});
  const callbackTokens = parseJson(
    "PRESIDENT_AGENT_CALLBACK_TOKENS_JSON",
    callbackTokensSchema,
    {}
  );
  const callbackBaseUrl = process.env.PRESIDENT_CALLBACK_BASE_URL?.trim() || null;
  const actors = new Set(Object.values(targets).map(target => target.actorId));
  const missingCallbackActors = [...actors].filter(actor => !callbackTokens[actor]);
  const configured =
    Boolean(callbackBaseUrl) &&
    Object.keys(targets).length > 0 &&
    missingCallbackActors.length === 0;
  return {
    configured,
    callbackBaseUrl,
    targets,
    callbackTokens,
    missingCallbackActors,
  };
}

export function presidentRuntimeStatus() {
  const config = presidentRuntimeConfig();
  return {
    executionState: config.configured ? ("CONFIGURED" as const) : ("NOT_CONFIGURED" as const),
    executionCapabilities: Object.keys(config.targets).sort(),
    actors: [...new Set(Object.values(config.targets).map(target => target.actorId))].sort(),
    callbackBaseConfigured: Boolean(config.callbackBaseUrl),
    missingCallbackActors: config.missingCallbackActors,
  };
}

let singleton:
  | {
      programs: MysqlPresidentProgramStore;
      intelligence: MysqlPresidentIntelligenceStore;
      service: PresidentProgramService;
      coordinator: PresidentAgentRuntimeCoordinator;
    }
  | undefined;

export function getPresidentRuntime() {
  const config = presidentRuntimeConfig();
  if (!config.configured || !config.callbackBaseUrl)
    throw new Error(
      "President execution runtime is not configured with targets, callback URL, and actor callback tokens"
    );
  if (singleton) return singleton;
  const pool = presidentPool();
  const programs = new MysqlPresidentProgramStore(pool);
  const intelligence = new MysqlPresidentIntelligenceStore(pool);
  const service = new PresidentProgramService(pool, programs, intelligence);
  const wake = new PresidentAgentWakeClient(config.targets, config.callbackBaseUrl);
  singleton = {
    programs,
    intelligence,
    service,
    coordinator: new PresidentAgentRuntimeCoordinator(programs, service, wake),
  };
  return singleton;
}
