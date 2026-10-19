/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only (disposable-database tenant tables); canonical product is JOYSTICK. */
/**
 * Brain V2 PRIMARY acceptance — the real production processing path, no telephone.
 *
 * Phone: openAuthorizedInboundClaireConversation → runRelayAuthoritativeTurn →
 *        runAuthoritativeClaireVoiceTurn → runClaireV2PrimaryTurn, with the real
 *        operator gate (identity + membership read from MySQL), the real V2
 *        executive and readers, the real Day Line adapter and commitments table,
 *        real Daphne capture, real claim receipts, the real call ledger.
 * Desk:  weeklyMission.deskComms (OPEN COMMS) through its real tRPC middleware.
 *
 * The ONLY substitution is the model boundary (`server/_core/llm`): a scripted
 * model answers each schema so the run is free and deterministic. Every model
 * request is recorded with the model id it asked for, which is how this test
 * proves the newest models are requested. Legacy `runClaireTurn` is wrapped to
 * throw: if it ever answers a turn, the test fails.
 *
 *   docker run -d --name claire-v2-cutover-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=claire_v2_cutover -p 127.0.0.1:3471:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3471/claire_v2_cutover node scripts/migrate.mjs
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3471/claire_v2_cutover pnpm vitest run --config vitest.integration.config.ts server/claire/brain/tests/claireV2Primary.mysql.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type ModelCall = { kind: "structured" | "text"; schema: string | null; model: string | null };
const modelCalls: ModelCall[] = [];
const legacyCalls: string[] = [];

function lastUserPayload(messages: Array<{ role: string; content: unknown }>): string {
  const user = [...messages].reverse().find(message => message.role === "user");
  return typeof user?.content === "string" ? user.content : JSON.stringify(user?.content ?? "");
}

function perceptionFor(utterance: string) {
  const text = utterance.toLowerCase();
  const turnKind = /focus on|should i|grow|strategy/.test(text)
    ? "business_judgment_or_strategy"
    : /weekend|yourself|how are you/.test(text)
      ? "personal_question_to_claire"
      : /last five sales|sales/.test(text)
        ? "business_list_question"
        : /briefing|on my plate/.test(text)
          ? "daily_briefing_request"
          : /\bbye\b|that's everything/.test(text)
            ? "leave_taking"
            : /^yes/.test(text)
              ? "acknowledgement"
              : /shorter|from now on/.test(text)
                ? "correction"
                : /need to|add|remind/.test(text)
                  ? "work_instruction"
                  : /went|done|finished|late/.test(text)
                    ? "report_or_narration"
                    : "unclear";
  return { turnKind, endsConversation: /\bbye\b/.test(text) };
}

vi.mock("../../../_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../_core/llm")>();
  const structured = (content: unknown, model: string) => ({
    id: randomUUID(),
    created: Date.now(),
    model,
    choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(content) }, finish_reason: "tool_use" }],
  });
  return {
    ...actual,
    invokeLLM: vi.fn(async (params: Parameters<typeof actual.invokeLLM>[0]) => {
      const schema = params.outputSchema?.name ?? params.output_schema?.name ?? null;
      const model = params.model ?? null;
      modelCalls.push({ kind: "structured", schema, model });
      const payload = lastUserPayload(params.messages as never);
      if (schema === "claire_brain_v2_perception") {
        return structured(perceptionFor(JSON.parse(payload).utterance ?? ""), model ?? "");
      }
      if (schema === "claire_brain_v3_turn") {
        return structured({
          target: "open_conversation", act: "question", workDisposition: "none", dayLineDisposition: "none",
          priorClaim: "none", weeklyDisposition: "none", identityTopic: "none", broadBriefingRequest: false,
          canonicalWork: null, referent: null, rationale: "scripted legacy reading",
        }, model ?? "");
      }
      if (schema === "claire_showrunner_turn") {
        return structured({
          speak: "Noted. Anything else for today?", operatorIsDone: false, missionUpdates: [], developments: [],
          readinessNeeds: [], planEdits: [],
        }, model ?? "");
      }
      throw new Error(`unscripted structured call: ${schema}`);
    }),
    invokeTextLLM: vi.fn(async (params: Parameters<typeof actual.invokeTextLLM>[0]) => {
      // Biography verifier: one-word verdict.
      if ((params.maxTokens ?? params.max_tokens ?? 0) <= 16) {
        modelCalls.push({ kind: "text", schema: "biography_verifier", model: params.model ?? null });
        return "CLEAN";
      }
      modelCalls.push({ kind: "text", schema: null, model: params.model ?? null });
      return "Here's my read: put this week into your strongest repeat customers, and ask the newest ones for a second order.";
    }),
  };
});

vi.mock("../../turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("../../turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: vi.fn(async (input: { utterance: string }) => {
      legacyCalls.push(input.utterance);
      throw new Error("legacy Claire answered a Brain V2 primary turn");
    }),
  };
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;
const ZONE = "America/Los_Angeles";

describeMysql("Brain V2 primary — real phone and Desk processing path, disposable MySQL", () => {
  let sql: mysql.Connection;
  const operatorUserId = "adam-admin";
  const v2Lines: Array<Record<string, unknown>> = [];
  const infoSpy = vi.spyOn(console, "info");

  beforeAll(async () => {
    const parsed = new URL(DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      throw new Error(`This acceptance run writes; it refuses non-local DATABASE_URL host ${parsed.hostname}`);
    }
    Object.assign(process.env, {
      CLAIRE_BRAIN_V2_PRIMARY: "1",
      JWT_SECRET: process.env.JWT_SECRET || "acceptance-only-jwt-secret-not-production",
      OWNER_OPEN_ID: operatorUserId,
      ANTHROPIC_API_KEY: "scripted-model-boundary",
      DAPHNE_V2_CLAIRE_ENABLED: "true",
      DAPHNE_V2_CONVERSATION_INGESTION_ENABLED: "true",
      DAPHNE_V2_CONVERSATION_INGESTION_TENANTS: "default,laundry_farm",
    });
    delete process.env.CLAIRE_WORK_LEDGER;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_MODEL_CLAIRE;
    sql = await mysql.createConnection(DATABASE_URL!);
    for (const tenantId of ["default", "laundry_farm"]) {
      await sql.query(
        "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
        [tenantId, tenantId, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "acceptance@example.invalid", ZONE]
      );
      await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operatorUserId]);
    }
    await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES ('default',?,?,?,'admin','password')", [operatorUserId, "Adam", "acceptance@example.invalid"]);
    infoSpy.mockImplementation((...args: unknown[]) => {
      if (args[0] === "[ClaireBrainV2Primary]" && typeof args[1] === "string") v2Lines.push(JSON.parse(args[1]));
    });
  });

  afterAll(async () => {
    infoSpy.mockRestore();
    await sql?.end();
  });

  it("a full phone call: analytics, strategy, personal, correction, proposal, confirmation, interruption, goodbye — every answer from V2", async () => {
    const { resolveCanonicalOperatorIdentity } = await import("../../../agents/persistentOperator/identity");
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: "default", source: { type: "open_id", value: operatorUserId }, subsystem: "claire_v2_primary_acceptance" });
    if (!resolved.ok) throw new Error("operator fixture did not resolve");
    const dayDirectorActorId = resolved.identity.dayDirectorActorId;
    await sql.query("DELETE FROM day_director_commitments WHERE tenantId = 'default' AND actorId = ?", [dayDirectorActorId]);

    const { openAuthorizedInboundClaireConversation, runRelayAuthoritativeTurn } = await import("../../claireTwilio");
    const opened = await openAuthorizedInboundClaireConversation({
      tenantId: "default",
      operatorUserId,
      dayDirectorActorId,
      callSid: `CA${randomUUID().replace(/-/g, "").slice(0, 32)}`,
    });
    const say = async (utterance: string, previousSpeech?: { text: string; phase: string; heardCompletely?: boolean }) =>
      runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance, token: opened.token, previousSpeech: previousSpeech as never });

    const transcript: string[] = [];
    const before = v2Lines.length;

    const sales = await say("What were my last five sales?");
    transcript.push(sales.speak);
    // V2 answered from its authoritative reader against this tenant's real (empty) ledger:
    // it states what the reader returned and invents no customer.
    const salesLine = v2Lines.at(-1)!;
    expect(salesLine).toMatchObject({ origin: "brain_v2", composition: "deterministic" });
    expect(salesLine.evidenceReaders).toContain("runBusinessQuery");
    expect(sales.speak).toMatch(/paid orders|sales/i);

    const strategy = await say("What do you think I should focus on this week to grow revenue?");
    transcript.push(strategy.speak);
    expect(strategy.speak).toMatch(/Here's my read/);

    const personal = await say("How was your weekend?");
    transcript.push(personal.speak);
    expect(personal.speak.trim().length).toBeGreaterThan(0);

    const correction = await say("Keep your answers shorter from now on.");
    transcript.push(correction.speak);
    expect(correction.speak).toMatch(/shorter|preference/i);

    const proposal = await say("I need to call Dana on Tuesday.");
    transcript.push(proposal.speak);
    expect(proposal.speak).toMatch(/Dana/i);

    const confirm = await say("Yes, add it.");
    transcript.push(confirm.speak);
    expect(confirm.speak).not.toMatch(/won't claim/i);
    expect(confirm.speak).toMatch(/Dana/i);
    const [rows] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT title FROM day_director_commitments WHERE tenantId = 'default' AND actorId = ?",
      [dayDirectorActorId]
    );
    expect(rows.map(row => String(row.title)).join(" ")).toMatch(/Dana/i);

    // Barge-in: the previous answer was cut off; V2 still answers, and the
    // interrupted delivery is what the next generation sees.
    const interrupted = await say("Sorry, say that again?", { text: confirm.speak, phase: "interrupted" });
    transcript.push(interrupted.speak);
    expect(interrupted.speak.trim().length).toBeGreaterThan(0);

    const bye = await say("Okay, that's everything. Bye.");
    transcript.push(bye.speak);
    expect(bye.endCall).toBe(true);

    console.log(transcript.map((line, index) => `CLAIRE[${index + 1}]: ${line}`).join("\n"));

    // Every conversational turn was answered by Brain V2; legacy Claire never answered.
    const callLines = v2Lines.slice(before);
    expect(callLines).toHaveLength(8);
    expect(callLines.every(line => line.origin === "brain_v2" && line.legacyConsulted === false)).toBe(true);
    expect(callLines.map(line => line.composition)).toEqual(
      expect.arrayContaining(["deterministic", "composed", "preference", "action", "call_control"])
    );
    expect(legacyCalls).toEqual([]);

    // The newest models were requested: V2 perception on Haiku 5.5, Claire's speech on Sonnet 5.5.
    const perception = modelCalls.filter(call => call.schema === "claire_brain_v2_perception");
    expect(perception.length).toBeGreaterThanOrEqual(8);
    expect(new Set(perception.map(call => call.model))).toEqual(new Set(["claude-haiku-5-5"]));
    const speech = modelCalls.filter(call => call.kind === "text" && call.schema === null);
    expect(speech.length).toBeGreaterThan(0);
    expect(new Set(speech.map(call => call.model))).toEqual(new Set(["claude-sonnet-5-5"]));
    expect(modelCalls.some(call => /claude-(?:sonnet|haiku|opus)-4/.test(call.model ?? ""))).toBe(false);

    // Legacy Claire observed in the background, read-only, and its comparisons were recorded.
    await new Promise(resolve => setTimeout(resolve, 500));
    const [shadowRows] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM claire_generation_logs WHERE tenantId = 'default' AND answerPath = 'legacy_v1_shadow'"
    );
    expect(Number(shadowRows[0]!.n)).toBeGreaterThanOrEqual(8);

    // Daphne received the durable correction (consent-gated store).
    const [observations] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM daphne_observations WHERE tenantId = 'default'"
    );
    expect(Number(observations[0]!.n)).toBeGreaterThan(0);
  }, 120_000);

  it("Claire Desk OPEN COMMS in laundry_farm is answered by V2 for the same operator", async () => {
    const { weeklyMissionRouter } = await import("../../weeklyMission/weeklyMissionRouter");
    const [user] = (await sql.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE openId = ?", [operatorUserId]))[0];
    const caller = weeklyMissionRouter.createCaller({
      user: { id: Number(user!.id), openId: operatorUserId, role: "admin", name: "Adam", email: "acceptance@example.invalid" },
      tenantId: "laundry_farm",
    } as never);
    const sessionId = randomUUID().replace(/-/g, "");
    const before = v2Lines.length;
    await caller.deskComms({ sessionId });
    const strategy = await caller.deskComms({ sessionId, utterance: "What do you think I should focus on this week to grow revenue?" });
    expect(strategy.speak).toMatch(/Here's my read/);
    expect((strategy as { brainV2?: { origin: string } }).brainV2?.origin).toBe("brain_v2");
    const report = await caller.deskComms({ sessionId, utterance: "The Opus pickups went fine, just late." });
    expect((report as { brainV2?: { origin: string; composition: string } }).brainV2).toMatchObject({ origin: "brain_v2" });
    const lines = v2Lines.slice(before);
    expect(lines.length).toBe(2);
    expect(lines.every(line => line.origin === "brain_v2")).toBe(true);
    expect(legacyCalls).toEqual([]);
  }, 120_000);
});
