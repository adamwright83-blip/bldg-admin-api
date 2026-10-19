/**
 * Independent verification of Claire conversation reliability.
 *
 * Codex's repair and its 134-test patch were not on a branch, open pull
 * request, or recent commit when this file was added. These tests drive
 * `runClaireTurn` (the same handler the desk and the phone use), the real
 * Day Line commit, the real conversation-state store, and the real
 * sent/queued/scheduled/saved claim checks.
 *
 * No Anthropic, OpenAI, or xAI key was present in the environment. The model
 * HTTP boundary is stubbed so those handlers still run. Nothing is forwarded
 * to a model provider, Twilio, Stripe, or any database that is not
 * 127.0.0.1.
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    process.env.ANTHROPIC_API_KEY = "verification-transport-stub";
  }
  if (!process.env.ANTHROPIC_MODEL_CLAIRE?.trim()) {
    process.env.ANTHROPIC_MODEL_CLAIRE = "claude-sonnet-4-6";
  }
});
import { CLAIRE_DAILY_CALL_DEFAULTS } from "../../../shared/claireDailyCallDefaults";
import {
  DAILY_CLAIRE_CALLS,
  dailyCallAuthorizedNow,
  nextDailyCallWindowStart,
  type DailyCallAuthorization,
} from "../../../shared/dailyClaireCalls";
import { ensureDailyClaireAppointments } from "../../agents/persistentOperator/dailyCallAuthorization";
import { OperatorAppointmentStore } from "../../agents/persistentOperator/operatorAppointmentStore";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";
import {
  createDatabaseConversationStateStore,
  type ClaireConversationStateStore,
} from "../turn/conversationStateStore";

const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 3306;
const LOCAL_USER = "claire_verify";
const LOCAL_PASSWORD = "local-only";
const NOW = new Date("2026-10-16T16:00:00.000Z"); // 09:00 America/Los_Angeles
const ZONE = "America/Los_Angeles";
const SEVEN_AM = new Date("2026-10-16T14:00:00.000Z"); // 07:00 PDT
const MORNING_START = "2026-10-16T14:30:00.000Z"; // 07:30 PDT
const EVENING_START = "2026-10-17T01:30:00.000Z"; // 18:30 PDT

const inheritedDatabaseUrl = process.env.DATABASE_URL ?? "";
const modelKeyPresent = Boolean(
  process.env.ANTHROPIC_API_KEY?.trim() &&
    process.env.ANTHROPIC_API_KEY !== "verification-transport-stub"
);

type Captured = { url: string; tool: string | null; userText: string; system: string; responseText: string };

const captured: Captured[] = [];
let originalFetch: typeof fetch;
let admin: mysql.Connection;
let pool: mysql.Pool;
let databaseName = "";

function refuseRemote(url: string, label: string) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`${label} is not a URL this verification may use`);
  }
  if (host !== LOCAL_HOST && host !== "localhost") {
    throw new Error(`${label} points at ${host}; this verification refuses it`);
  }
}

function userTextFrom(body: { system?: unknown; messages?: Array<{ content?: unknown }> }): { userText: string; system: string } {
  const system = typeof body.system === "string" ? body.system : "";
  const messages = body.messages ?? [];
  const last = messages[messages.length - 1];
  const content = last?.content;
  const userText = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map(part => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "")).join("\n")
      : "";
  return { userText, system };
}

function brainFor(userText: string, system: string) {
  const pending = /"briefing"\s*:\s*true/.test(system);
  const base = {
    target: pending ? "pending_briefing" : "open_conversation",
    act: "narration" as const,
    workDisposition: "none" as const,
    dayLineDisposition: "none" as const,
    priorClaim: "none" as const,
    weeklyDisposition: "none" as const,
    identityTopic: "none" as const,
    broadBriefingRequest: false,
    canonicalWork: null as string | null,
    referent: null as string | null,
    rationale: "Transport stub labels the operator's act. Claire's handlers decide what is written.",
  };
  const text = userText.trim();
  if (pending && (/^(?:yes|yeah|yep)\b/i.test(text) || /\bput (?:that|it|the list) on the day line\b/i.test(text))) {
    return { ...base, act: "confirmation" as const, workDisposition: "commit" as const, dayLineDisposition: "accept" as const, rationale: "The operator confirmed the list Claire is holding." };
  }
  if (pending && /\b(?:change|make|move)\b/i.test(text)) {
    return { ...base, act: "correction" as const, canonicalWork: text, rationale: "The operator corrected work Claire is holding." };
  }
  if (/\b(?:add|call|pick up|drop off|remind me|i need to)\b/i.test(text)) {
    const commit = /\bday line\b/i.test(text);
    return {
      ...base,
      target: "open_conversation",
      act: "action_request" as const,
      workDisposition: commit ? "commit" as const : "propose" as const,
      dayLineDisposition: commit ? "reopen" as const : "none" as const,
      canonicalWork: text,
      rationale: "The operator stated work.",
    };
  }
  if (/\?|\bwhat\b|\bdid you\b/i.test(text)) {
    return { ...base, target: "open_conversation", act: "question" as const, rationale: "The operator asked a question." };
  }
  return base;
}

function anthropicMessage(model: string, content: unknown[], stop: string) {
  return {
    id: "msg_verification",
    type: "message",
    role: "assistant",
    model: model || "claude-sonnet-4-6",
    stop_reason: stop,
    stop_sequence: null,
    content,
    usage: { input_tokens: 12, output_tokens: 12 },
  };
}

/** Current-generation models receive the schema as structured output, not a tool. */
function jsonOutputSchemaName(body: { output_config?: { format?: { schema?: { required?: string[] } } } }): string | null {
  const required = body.output_config?.format?.schema?.required ?? null;
  if (!required) return null;
  if (required.includes("dayLineDisposition")) return "claire_brain_v3_turn";
  if (required.includes("questions") && required.includes("items")) return "claire_briefing";
  if (required.includes("assertsFact")) return "claire_claim_challenge";
  if (required.includes("isBusinessQuestion")) return "claire_business_query";
  if (required.includes("sql")) return "claire_business_investigation";
  if (required.includes("classification")) return "claire_work_classification";
  if (required.includes("target")) return "claire_conversation_target";
  return "structured_other";
}

function stubBody(raw: string) {
  const body = JSON.parse(raw) as { model?: string; tools?: Array<{ name?: string }>; output_config?: { format?: { schema?: { required?: string[] } } }; system?: unknown; messages?: Array<{ content?: unknown }> };
  const jsonOutput = jsonOutputSchemaName(body);
  const tool = jsonOutput ?? body.tools?.[0]?.name ?? null;
  const { userText, system } = userTextFrom(body);
  let response: ReturnType<typeof anthropicMessage>;
  if (tool === "claire_brain_v3_turn") {
    response = anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_brain", name: tool, input: brainFor(userText, system) }], "tool_use");
  } else if (tool === "claire_briefing") {
    response = anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_brief", name: tool, input: { items: [], context: [], questions: [] } }], "tool_use");
  } else   if (tool === "claire_claim_challenge") {
    response = anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_claim", name: tool, input: { act: "other", receiptId: "", ambiguous: false, assertsFact: false } }], "tool_use");
  } else if (tool === "claire_business_investigation" || tool === "claire_business_query") {
    const input = tool === "claire_business_investigation"
      ? { kind: "not_business", sql: "", answer: "" }
      : {
          isBusinessQuestion: false,
          metric: "revenue",
          periodKind: "today",
          trailingDays: 0,
          startDate: "",
          endDate: "",
          compareToPrevious: false,
          serviceType: "any",
          minOrders: 0,
          limit: 0,
          customerName: "",
          listMembers: false,
          scopeChange: "unchanged",
          businessLines: [],
          processors: [],
          sources: [],
          includeBuildings: [],
          excludeBuildings: [],
          addressText: "",
          rank: "none",
          groupBy: "none",
        };
    response = anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_business", name: tool, input }], "tool_use");
  } else if (tool === "claire_work_classification") {
    response = anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_work", name: tool, input: { classification: "new_work", reason: "The operator stated work." } }], "tool_use");
  } else if (tool === "claire_conversation_target") {
    response = anthropicMessage(body.model ?? "", [{
      type: "tool_use",
      id: "toolu_target",
      name: tool,
      input: { target: /"briefing"\s*:\s*true/.test(system) ? "pending_briefing" : "open_conversation", rationale: "Follow the live pending list when one is open." },
    }], "tool_use");
  } else if (tool) {
    response = anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_other", name: tool, input: { unavailable: true } }], "tool_use");
  } else {
    const text = /already save|send it/i.test(userText)
      ? "I've saved the pickup and I've sent the reminder."
      : "I only have what you said in this conversation. I have not written a task.";
    response = anthropicMessage(body.model ?? "", [{ type: "text", text }], "end_turn");
  }
  if (jsonOutput) {
    // Structured outputs deliver the same scripted answer as JSON text.
    const block = (response.content as Array<{ type: string; input?: unknown }>)[0]!;
    response = anthropicMessage(body.model ?? "", [{ type: "text", text: JSON.stringify(block.input ?? {}) }], "end_turn");
  }
  const responseText = JSON.stringify(response.content);
  captured.push({ url: "https://api.anthropic.com/v1/messages", tool, userText, system, responseText });
  return response;
}

function installTransportStub() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/twilio\.com|api\.stripe\.com/i.test(url)) {
      throw new Error(`Refusing live provider call during verification: ${new URL(url).host}`);
    }
    if (url.startsWith("https://api.anthropic.com/")) {
      if (modelKeyPresent) return originalFetch(input, init);
      const raw = typeof init?.body === "string" ? init.body : "{}";
      return new Response(JSON.stringify(stubBody(raw)), { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

async function applySchema() {
  const statements = [
    `CREATE TABLE day_director_processing_locations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
      name VARCHAR(191) NOT NULL,
      locality VARCHAR(191) NULL,
      address VARCHAR(512) NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_day_director_processing_tenant (tenantId)
    )`,
    `CREATE TABLE day_director_commitments (
      id VARCHAR(36) PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
      actorId VARCHAR(128) NOT NULL,
      businessDate VARCHAR(10) NOT NULL,
      idempotencyKey VARCHAR(191) NOT NULL,
      title VARCHAR(255) NOT NULL,
      kind ENUM('growth','prep','operations') NOT NULL,
      quantity INT NULL,
      provenance ENUM('user_reported','manual') NOT NULL,
      status ENUM('open','completed') NOT NULL DEFAULT 'open',
      sourceText TEXT NULL,
      metadataJson JSON NULL,
      completedAt TIMESTAMP NULL DEFAULT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_day_director_commitment_key (tenantId, actorId, businessDate, idempotencyKey)
    )`,
    `CREATE TABLE day_director_prompt_states (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
      actorId VARCHAR(128) NOT NULL,
      businessDate VARCHAR(10) NOT NULL,
      promptKey VARCHAR(191) NOT NULL,
      state ENUM('accepted','dismissed') NOT NULL,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_day_director_prompt_state (tenantId, actorId, businessDate, promptKey)
    )`,
    `CREATE TABLE claire_conversation_states (
      id VARCHAR(191) PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL,
      operatorUserId VARCHAR(128) NOT NULL,
      surface VARCHAR(16) NOT NULL,
      stateJson JSON NOT NULL,
      version INT NOT NULL DEFAULT 1,
      expiresAt TIMESTAMP NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE tenant_ai_usage (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
      month VARCHAR(7) NOT NULL,
      inputTokens INT NOT NULL DEFAULT 0,
      outputTokens INT NOT NULL DEFAULT 0,
      estimatedCostCents INT NOT NULL DEFAULT 0,
      requestCount INT NOT NULL DEFAULT 0,
      warningLimitCents INT NOT NULL DEFAULT 5000,
      hardLimitCents INT NOT NULL DEFAULT 10000,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_tenant_ai_usage_tenant_month (tenantId, month)
    )`,
    `CREATE TABLE tenant_provider_usage (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL,
      month VARCHAR(7) NOT NULL,
      provider VARCHAR(64) NOT NULL,
      category VARCHAR(64) NOT NULL,
      usageUnit VARCHAR(32) NOT NULL,
      usageQuantity INT NOT NULL DEFAULT 0,
      estimatedCostCents INT NOT NULL DEFAULT 0,
      requestCount INT NOT NULL DEFAULT 0,
      warningLimitCents INT NULL,
      hardLimitCents INT NULL,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_tenant_provider_usage (tenantId, month, provider, category)
    )`,
    `CREATE TABLE dayforge_saas_subscriptions ( -- legacy compatibility: exact historical table the usage reader still queries
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL,
      planKey VARCHAR(96) NOT NULL
    )`,
    `CREATE TABLE tenant_standing_authorizations (
      id VARCHAR(36) PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL,
      canonicalOperatorId VARCHAR(191) NOT NULL,
      operatorUserId VARCHAR(128) NOT NULL,
      channel VARCHAR(32) NOT NULL,
      recipientClass VARCHAR(64) NOT NULL,
      exactAction VARCHAR(128) NOT NULL,
      dailyLimit INT NOT NULL DEFAULT 1,
      allowedWeekdaysJson JSON NULL,
      allowedLocalStart VARCHAR(5) NULL,
      allowedLocalEnd VARCHAR(5) NULL,
      timeZone VARCHAR(64) NOT NULL,
      version INT NOT NULL DEFAULT 1,
      sourceReference VARCHAR(191) NOT NULL,
      authorizedByUserId VARCHAR(128) NOT NULL,
      createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      revokedAt TIMESTAMP(3) NULL,
      UNIQUE KEY uq_tenant_standing_authorizations_version (tenantId, canonicalOperatorId, exactAction, version)
    )`,
    `CREATE TABLE operator_appointments (
      id VARCHAR(36) PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL,
      canonicalOperatorId VARCHAR(191) NOT NULL,
      operatorUserId VARCHAR(128) NOT NULL,
      appointmentKind ENUM('sunday_weekly_planning','weekly_planning_callback','weekday_strategic_planning','daily_morning_readiness','daily_evening_debrief') NOT NULL,
      weekStart VARCHAR(10) NOT NULL,
      scheduledFor TIMESTAMP(3) NOT NULL,
      timeZone VARCHAR(64) NOT NULL,
      source ENUM('standing_weekly_authorization','explicit_operator_request') NOT NULL,
      sourceReference VARCHAR(191) NOT NULL,
      standingAuthorizationId VARCHAR(36) NULL,
      unprompted BOOLEAN NOT NULL DEFAULT FALSE,
      idempotencyKey VARCHAR(191) NOT NULL,
      status ENUM('scheduled','leased','running','retry_scheduled','completed','missed','cancelled','dead_letter') NOT NULL DEFAULT 'scheduled',
      leaseOwner VARCHAR(191) NULL,
      leaseExpiresAt TIMESTAMP(3) NULL,
      heartbeatAt TIMESTAMP(3) NULL,
      attemptCount INT NOT NULL DEFAULT 0,
      maxAttempts INT NOT NULL DEFAULT 3,
      callDispatchStartedAt TIMESTAMP(3) NULL,
      callSid VARCHAR(64) NULL,
      calendarEventId VARCHAR(191) NULL,
      calendarStatus VARCHAR(32) NULL,
      followupTextSentAt TIMESTAMP(3) NULL,
      lastError TEXT NULL,
      resultJson JSON NULL,
      completedAt TIMESTAMP(3) NULL,
      createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_operator_appointments_tenant_idempotency (tenantId, idempotencyKey),
      UNIQUE KEY uq_operator_appointments_call_sid (callSid)
    )`,
  ];
  for (const statement of statements) await pool.query(statement);
}

const harness: Partial<ClaireTurnDeps> = {
  now: () => NOW,
  timeZone: () => ZONE,
  operatorContextShadowEnabled: () => false,
  doctrineTurn: async () => null,
  campaign: (async () => null) as ClaireTurnDeps["campaign"],
  watchBoard: async () => ({ brief: "", conciseBrief: "", salesArtifacts: [], recoveryAccounts: [] }),
  recoveryObligations: (async () => []) as ClaireTurnDeps["recoveryObligations"],
  vocabulary: (async () => []) as ClaireTurnDeps["vocabulary"],
  accounts: (async () => []) as ClaireTurnDeps["accounts"],
  encyclopedia: null,
  weeklyPicture: (async () => null) as ClaireTurnDeps["weeklyPicture"],
  beginWeekly: (async () => null) as ClaireTurnDeps["beginWeekly"],
};

function scope(label: string) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  return {
    tenantId: `claire-verify-${label}-${suffix}`,
    operatorUserId: `op-${suffix}`,
    dayDirectorActorId: `actor-${suffix}`,
    conversationKey: `claire-desk:verify:${label}:${suffix}`,
  };
}

async function titles(tenantId: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT title, sourceText, metadataJson, status FROM day_director_commitments WHERE tenantId = ? ORDER BY title",
    [tenantId]
  );
  return rows;
}

async function persist(store: ClaireConversationStateStore, key: string, owner: { tenantId: string; operatorUserId: string; surface: "voice" | "text" }, state: ClaireTurnState) {
  await store.save(key, owner, state, 60 * 60 * 1000, Date.now());
}

async function turn(input: {
  scope: ReturnType<typeof scope>;
  state: ClaireTurnState;
  utterance: string;
  surface?: "text" | "voice";
  allowFragmentWait?: boolean;
  store: ClaireConversationStateStore;
}) {
  const surface = input.surface ?? "text";
  const result = await runClaireTurn(
    {
      tenantId: input.scope.tenantId,
      operatorUserId: input.scope.operatorUserId,
      dayDirectorActorId: input.scope.dayDirectorActorId,
      surface,
      utterance: input.utterance,
      state: input.state,
      conversationKey: input.scope.conversationKey,
      brief: null,
      context: {
        businessDate: "2026-10-16",
        actorId: input.scope.operatorUserId,
        blockers: [],
        relevantTimeline: [],
        macroGoalKnown: false,
        clock: { localTime: "9:00 AM", weekday: "Friday", businessDate: "2026-10-16", timeZone: ZONE },
      } as never,
    },
    { ...harness }
  );
  await persist(input.store, input.scope.conversationKey, {
    tenantId: input.scope.tenantId,
    operatorUserId: input.scope.operatorUserId,
    surface,
  }, input.state);
  return result;
}

function confirmsExecution(speech: string) {
  return /\bDone\./.test(speech)
    || /\bI(?:'ve|\s+have)?\s+(?:saved|sent|scheduled|queued)\b/i.test(speech)
    || /\bI\s+(?:saved|sent|scheduled|queued)\b/i.test(speech);
}

describe("Claire reliability verification on disposable MariaDB", () => {
  beforeAll(async () => {
    if (inheritedDatabaseUrl) refuseRemote(inheritedDatabaseUrl, "DATABASE_URL");
    if (!modelKeyPresent) process.env.ANTHROPIC_API_KEY = "verification-transport-stub";
    process.env.ANTHROPIC_MODEL_CLAIRE ||= "claude-sonnet-4-6";
    process.env.ALLOW_TEST_DB = "1";
    databaseName = `claire_reliability_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    admin = await mysql.createConnection({
      host: LOCAL_HOST,
      port: LOCAL_PORT,
      user: LOCAL_USER,
      password: LOCAL_PASSWORD,
      multipleStatements: false,
    });
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    const localUrl = `mysql://${LOCAL_USER}:${LOCAL_PASSWORD}@${LOCAL_HOST}:${LOCAL_PORT}/${databaseName}`;
    refuseRemote(localUrl, "verification database");
    process.env.DATABASE_URL = localUrl;
    pool = mysql.createPool({ uri: localUrl, connectionLimit: 8 });
    await applySchema();
    installTransportStub();
  }, 60_000);

  afterAll(async () => {
    if (originalFetch) globalThis.fetch = originalFetch;
    await pool?.end();
    if (admin && databaseName) await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin?.end();
  });

  it("keeps two named stops across a restart, then saves both only when the operator confirms", async () => {
    const who = scope("context");
    const state: ClaireTurnState = {};
    const store = createDatabaseConversationStateStore();
    const proposed = await turn({
      scope: who,
      state,
      store,
      utterance: "I need to call Todd, pick up Rebecca, and drop off the OPUS towels.",
    });
    expect(proposed.kind).not.toBe("briefing_saved");
    expect(await titles(who.tenantId)).toEqual([]);
    const restarted = createDatabaseConversationStateStore();
    const loaded = await restarted.load<ClaireTurnState>(who.conversationKey);
    expect(loaded?.persistence).toBe("durable");
    expect(loaded?.state.history?.map(entry => entry.text).join(" ")).toMatch(/Todd/);
    expect(loaded?.state.history?.map(entry => entry.text).join(" ")).toMatch(/OPUS/);
    expect(loaded?.state.pendingBriefing?.parsed.items.length).toBeGreaterThanOrEqual(2);

    const resumed = loaded!.state;
    const asked = await turn({
      scope: who,
      state: resumed,
      store: restarted,
      utterance: "What two stops did I just give you?",
    });
    const brainCall = captured.find(call => call.tool === "claire_brain_v3_turn" && call.userText.includes("What two stops"));
    expect(brainCall?.system).toMatch(/Todd/);
    expect(brainCall?.system).toMatch(/OPUS/);
    expect(confirmsExecution(asked.speak)).toBe(false);
    expect(await titles(who.tenantId)).toEqual([]);

    const saved = await turn({
      scope: who,
      state: resumed,
      store: restarted,
      utterance: "Yes, put that on the day line.",
    });
    const rows = await titles(who.tenantId);
    expect(saved.kind).toBe("briefing_saved");
    expect(saved.mutationReceipts?.length).toBeGreaterThanOrEqual(2);
    expect(saved.speak).toMatch(/Done\./);
    expect(rows.map(row => row.title).join(" ")).toMatch(/Todd/);
    expect(rows.map(row => row.title).join(" ")).toMatch(/OPUS|Rebecca/);
    expect(rows).toHaveLength(saved.mutationReceipts?.length ?? rows.length);
  }, 60_000);

  it("saves every instruction given in one turn as its own task", async () => {
    const who = scope("multi");
    const saved = await turn({
      scope: who,
      state: {},
      store: createDatabaseConversationStateStore(),
      utterance: "Add call Todd, pick up Rebecca, and drop off the OPUS towels to the day line.",
    });
    const rows = await titles(who.tenantId);
    expect({
      speak: saved.speak,
      titles: rows.map(row => row.title),
    }).toEqual({
      speak: expect.stringMatching(/3 on today's line/),
      titles: [
        expect.stringMatching(/Todd/),
        expect.stringMatching(/Rebecca/),
        expect.stringMatching(/OPUS/),
      ],
    });
    expect(saved.mutationReceipts).toHaveLength(3);
    for (const receipt of saved.mutationReceipts ?? []) {
      const [match] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id FROM day_director_commitments WHERE tenantId = ? AND id = ?",
        [who.tenantId, receipt.entityId]
      );
      expect(match).toHaveLength(1);
    }
  }, 60_000);

  it("does not confirm a save the database rejected", async () => {
    await pool.query(`CREATE TRIGGER claire_reliability_fail_save BEFORE INSERT ON day_director_commitments
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'disposable save failure'`);
    try {
      const who = scope("fail");
      const state: ClaireTurnState = {};
      const store = createDatabaseConversationStateStore();
      await turn({
        scope: who,
        state,
        store,
        utterance: "I need to call Todd, pick up Rebecca, and drop off the OPUS towels.",
      });
      const failed = await turn({
        scope: who,
        state,
        store,
        utterance: "Yes, put that on the day line.",
      });
      expect(await titles(who.tenantId)).toEqual([]);
      expect(confirmsExecution(failed.speak)).toBe(false);
      expect(failed.mutationReceipts ?? []).toEqual([]);
      expect(failed.kind).not.toBe("briefing_saved");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS claire_reliability_fail_save");
    }
  }, 60_000);

  it("applies a timing correction before anything is saved", async () => {
    const who = scope("time");
    const state: ClaireTurnState = {};
    const store = createDatabaseConversationStateStore();
    await turn({
      scope: who,
      state,
      store,
      utterance: "I need to pick up from Coast 1hr Dry Cleaners and drop off towels at OPUS LA.",
    });
    expect(await titles(who.tenantId)).toEqual([]);
    const corrected = await turn({
      scope: who,
      state,
      store,
      utterance: "Make the Coast pickup at 3 PM.",
    });
    expect(await titles(who.tenantId)).toEqual([]);
    expect(corrected.speak.toLowerCase()).toMatch(/3 pm|15:00/);
    const saved = await turn({
      scope: who,
      state,
      store,
      utterance: "Yes, put that on the day line.",
    });
    const rows = await titles(who.tenantId);
    expect(saved.kind).toBe("briefing_saved");
    const coast = rows.find(row => /coast/i.test(String(row.title)));
    expect(coast).toBeTruthy();
    expect(JSON.stringify(coast?.metadataJson)).toMatch(/15:00|3 PM/);
  }, 60_000);

  it("replaces a held task when the operator corrects what the task is", async () => {
    const who = scope("replace");
    const state: ClaireTurnState = {};
    const store = createDatabaseConversationStateStore();
    await turn({
      scope: who,
      state,
      store,
      utterance: "I need to pick up from Coast 1hr Dry Cleaners and drop off towels at OPUS LA.",
    });
    await turn({
      scope: who,
      state,
      store,
      utterance: "Change that Coast pickup to pick up KITH TREATS aprons on Rodeo Drive.",
    });
    const saved = await turn({
      scope: who,
      state,
      store,
      utterance: "Yes, put that on the day line.",
    });
    const joined = (await titles(who.tenantId)).map(row => row.title).join(" | ");
    expect(saved.kind).toBe("briefing_saved");
    expect(joined).toMatch(/KITH/);
    expect(joined).not.toMatch(/Coast/);
    expect(joined).toMatch(/OPUS/);
  }, 60_000);

  it("does not save an interrupted voice fragment, and saves the finished thought after a restart", async () => {
    const who = scope("interrupt");
    const state: ClaireTurnState = {};
    const store = createDatabaseConversationStateStore();
    const held = await turn({
      scope: who,
      state,
      store,
      surface: "voice",
      utterance: "Pick up from Coast and",
    });
    expect(held).toMatchObject({ kind: "listening", listenOnly: true, speak: "" });
    expect(await titles(who.tenantId)).toEqual([]);
    const restarted = createDatabaseConversationStateStore();
    const loaded = await restarted.load<ClaireTurnState>(who.conversationKey);
    expect(loaded?.state.pendingFragment).toMatch(/Pick up from Coast and/);
    const finished = await runClaireTurn(
      {
        tenantId: who.tenantId,
        operatorUserId: who.operatorUserId,
        dayDirectorActorId: who.dayDirectorActorId,
        surface: "voice",
        utterance: "drop off the OPUS towels to the day line.",
        state: loaded!.state,
        conversationKey: who.conversationKey,
        allowFragmentWait: false,
        brief: null,
        context: {
          businessDate: "2026-10-16",
          actorId: who.operatorUserId,
          blockers: [],
          relevantTimeline: [],
        } as never,
      },
      { ...harness }
    );
    const rows = await titles(who.tenantId);
    expect(finished.kind).not.toBe("listening");
    expect(rows.map(row => `${row.title} ${row.sourceText}`).join(" ")).toMatch(/OPUS/);
    expect(rows.map(row => row.title).join(" ")).not.toBe("Pick up from Coast and");
    expect(finished.mutationReceipts?.length ?? 0).toBeGreaterThan(0);
    expect(confirmsExecution(finished.speak)).toBe(true);
  }, 60_000);

  it("does not speak a model's saved or sent claim unless a receipt exists", async () => {
    const who = scope("truth");
    const state: ClaireTurnState = {};
    const before = captured.length;
    const result = await turn({
      scope: who,
      state,
      store: createDatabaseConversationStateStore(),
      utterance: "Did you already save that and send it?",
    });
    const textCalls = captured.slice(before).filter(call => call.tool === null);
    expect(textCalls.some(call => call.responseText.includes("I've saved the pickup and I've sent the reminder."))).toBe(true);
    expect(result.speak).not.toMatch(/I've saved the pickup/);
    expect(result.speak).not.toMatch(/I've sent the reminder/);
    expect(confirmsExecution(result.speak)).toBe(false);
    expect(await titles(who.tenantId)).toEqual([]);
    expect(result.mutationReceipts ?? []).toEqual([]);
  }, 60_000);

  it("schedules the existing 7:30 AM and 6:30 PM Los Angeles briefings without placing a call", async () => {
    expect(CLAIRE_DAILY_CALL_DEFAULTS.morning_readiness).toMatchObject({
      start: "07:30",
      end: "08:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(CLAIRE_DAILY_CALL_DEFAULTS.evening_debrief).toMatchObject({
      start: "18:30",
      end: "19:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    });
    const tenantId = `claire-verify-brief-${randomUUID().slice(0, 8)}`;
    const operator = "op-brief";
    const canonical = `tenant:${tenantId}:operator:${operator}`;
    const grant = (purpose: "morning_readiness" | "evening_debrief", start: string, end: string): DailyCallAuthorization => ({
      tenantId,
      canonicalOperatorId: canonical,
      operatorUserId: operator,
      channel: "call",
      exactAction: DAILY_CLAIRE_CALLS[purpose].exactAction,
      allowedWeekdaysJson: [1, 2, 3, 4, 5, 6, 7],
      allowedLocalStart: start,
      allowedLocalEnd: end,
      timeZone: ZONE,
      dailyLimit: 1,
      sourceReference: `verification:${purpose}`,
      authorizedByUserId: operator,
      revokedAt: null,
    });
    const morning = grant("morning_readiness", "07:30", "08:00");
    const evening = grant("evening_debrief", "18:30", "19:00");
    expect(nextDailyCallWindowStart(morning, "morning_readiness", SEVEN_AM)?.toISOString()).toBe(MORNING_START);
    expect(nextDailyCallWindowStart(evening, "evening_debrief", SEVEN_AM)?.toISOString()).toBe(EVENING_START);
    expect(dailyCallAuthorizedNow(morning, "morning_readiness", new Date(MORNING_START), ZONE)).toBe(true);
    expect(dailyCallAuthorizedNow(evening, "evening_debrief", new Date(EVENING_START), ZONE)).toBe(true);
    expect(dailyCallAuthorizedNow(morning, "morning_readiness", new Date(EVENING_START), ZONE)).toBe(false);

    for (const row of [morning, evening]) {
      await pool.query(
        `INSERT INTO tenant_standing_authorizations
          (id, tenantId, canonicalOperatorId, operatorUserId, channel, recipientClass, exactAction, dailyLimit,
           allowedWeekdaysJson, allowedLocalStart, allowedLocalEnd, timeZone, version, sourceReference, authorizedByUserId)
         VALUES (?, ?, ?, ?, 'call', 'operator', ?, 1, ?, ?, ?, ?, 1, ?, ?)`,
        [
          randomUUID(),
          row.tenantId,
          row.canonicalOperatorId,
          row.operatorUserId,
          row.exactAction,
          JSON.stringify(row.allowedWeekdaysJson),
          row.allowedLocalStart,
          row.allowedLocalEnd,
          row.timeZone,
          row.sourceReference,
          row.authorizedByUserId,
        ]
      );
    }
    const store = new OperatorAppointmentStore(pool);
    const seeded = await ensureDailyClaireAppointments({ store, now: SEVEN_AM, tenantId });
    expect(seeded.seeded).toBe(2);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT appointmentKind, status, callSid, callDispatchStartedAt, scheduledFor FROM operator_appointments WHERE tenantId = ? ORDER BY scheduledFor",
      [tenantId]
    );
    expect(rows.map(row => row.appointmentKind)).toEqual(["daily_morning_readiness", "daily_evening_debrief"]);
    expect(rows.every(row => row.status === "scheduled" && row.callSid == null && row.callDispatchStartedAt == null)).toBe(true);
    expect(new Date(rows[0]!.scheduledFor).toISOString()).toBe(MORNING_START);
    expect(new Date(rows[1]!.scheduledFor).toISOString()).toBe(EVENING_START);
    expect(captured.some(call => /twilio/i.test(call.url))).toBe(false);
  }, 60_000);
});
