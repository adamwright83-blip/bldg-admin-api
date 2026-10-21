/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only (disposable-database tenant tables); canonical product is JOYSTICK. */
/**
 * W9 — the JOYSTICK loop, end to end, for two operators on one tenant (repair plan §12).
 *
 * The honest name: until a second experience exists per work kind (W8), operators A and B
 * get different PRESENTATIONS of Kingdom 1 (the Colosseum), not different games. Both run
 * the same five Greystar targets under the same evidence rules.
 *
 * Seeded through the production writers wherever one exists:
 *   macro goal         setActiveMacroGoal ("Get to 50 active customers") + a macro_goal_runs row (baseline 23)
 *   Kingdoms           seedGoldlineKingdoms
 *   Day 1 Ten Doors    getOrCreateDay1TenDoorsMission + recordDay1TenDoorsOutcome (3 of the 5 Greystar targets)
 *   Day Line           acceptProposalWithReceipt: one building twice today, "Call Dana" open on three past dates
 *   standing rule      captureStandingInstructions (the real 2026-10-19 encouragement request)
 *   promise            reconcileSpokenPromises at 20:00 last night (the real 2026-10-19 property-visit promise)
 *   dimension          ingestDaphneConversation (A states suspense, B states comfort); no experimentation consent
 *
 * Then, per operator, through the production seams the scheduled-call executor uses:
 *   buildShowrunnerBriefing → showrunnerOpening → prepareDaphneCallDecision
 *   → openPreparedClaireConversationWithoutDialing → runRelayAuthoritativeTurn → runClaireV2PrimaryTurn
 *   (→ runShowrunnerTurn only for turns V2 hands the conductor).
 *
 * The ONLY substitution is the model boundary (`server/_core/llm`). The scripted speaking
 * model is a faithful phraser: it returns the plan V2 handed it, so what is asserted about
 * speech is what V2 decided and licensed, not what a script invented.
 *
 *   docker run -d --name joystick-loop-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=joystick_loop -p 127.0.0.1:3481:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3481/joystick_loop node scripts/migrate.mjs
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3481/joystick_loop pnpm vitest run --config vitest.integration.config.ts server/claire/brain/tests/joystickLoop.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { formatInTimeZone } from "date-fns-tz";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type ModelCall = { kind: "structured" | "text"; schema: string | null; prompt: string };
const modelCalls: ModelCall[] = [];
const legacyCalls: string[] = [];

function lastUserPayload(messages: Array<{ role: string; content: unknown }>): string {
  const user = [...messages].reverse().find(message => message.role === "user");
  return typeof user?.content === "string" ? user.content : JSON.stringify(user?.content ?? "");
}

function allText(messages: Array<{ role: string; content: unknown }>): string {
  return messages.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
}

/** What a perception model would read. The deterministic organs still run on top of it. */
function perceptionFor(utterance: string) {
  const text = utterance.toLowerCase();
  const turnKind = /what did you say|say that again/.test(text)
    ? "repeat_request"
    : /i love you/.test(text)
      ? "romantic_or_personal_advance"
      : /what do you want me to do|what should i do/.test(text)
        ? "daily_briefing_request"
        : /\bbye\b/.test(text)
          ? "leave_taking"
          : "unclear";
  return { turnKind, endsConversation: /\bbye\b/.test(text), disputesContent: false };
}

/** Each operator's own words about what kind of experience they enjoy. */
const DIMENSION_UTTERANCE: Record<string, { utterance: string; dimension: string }> = {
  suspense: { utterance: "I like it when it feels like a heist, keep the suspense on.", dimension: "suspense" },
  comfort: { utterance: "I like it calm and cozy, keep it comfortable for me.", dimension: "comfort" },
};

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
      const model = params.model ?? "";
      const payload = lastUserPayload(params.messages as never);
      modelCalls.push({ kind: "structured", schema, prompt: allText(params.messages as never) });
      if (schema === "claire_brain_v2_perception") return structured(perceptionFor(JSON.parse(payload).utterance ?? ""), model);
      if (schema === "daphne_conversation_ingestion") {
        const utterance = String(JSON.parse(payload).utterance ?? "");
        const stated = Object.values(DIMENSION_UTTERANCE).find(entry => entry.utterance === utterance);
        return structured(stated ? { kinds: ["motivational_preference"], dimension: stated.dimension } : { kinds: [], dimension: "none" }, model);
      }
      if (schema === "claire_brain_v3_turn") {
        return structured({
          target: "open_conversation", act: "question", workDisposition: "none", dayLineDisposition: "none",
          priorClaim: "none", weeklyDisposition: "none", identityTopic: "none", broadBriefingRequest: false,
          canonicalWork: null, referent: null, rationale: "scripted legacy reading",
        }, model);
      }
      if (schema === "claire_showrunner_turn") {
        return structured({
          speak: "Noted. Anything else before you head out?", operatorIsDone: false, missionUpdates: [], developments: [],
          readinessNeeds: [], planEdits: [],
        }, model);
      }
      throw new Error(`unscripted structured call: ${schema}`);
    }),
    invokeTextLLM: vi.fn(async (params: Parameters<typeof actual.invokeTextLLM>[0]) => {
      const prompt = allText(params.messages as never);
      if ((params.maxTokens ?? params.max_tokens ?? 0) <= 16) {
        modelCalls.push({ kind: "text", schema: "biography_verifier", prompt });
        return "CLEAN";
      }
      modelCalls.push({ kind: "text", schema: null, prompt });
      // Faithful phraser: say the lead plan V2 licensed (goal first, then the first move), nothing else.
      const plan = /(The goal is to[^\n"]*?first move is[^\n"]*)/.exec(prompt)?.[1];
      return plan ?? "Here's my read: start with the first open item on your line.";
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
const TENANT = "default";
const GREYSTAR_PITCHED = ["rise-koreatown", "avana-on-wilshire", "the-pearl-on-wilshire"] as const;
const GREYSTAR_REMAINING = ["wilshire-vermont", "the-chadwick"] as const;
/** Any sentence that says one framing, presentation or dimension CAUSES a behaviour. */
const CAUSAL_CLAIM =
  /\b(?:because (?:you like|of (?:the|your) (?:suspense|comfort|framing))|(?:framing|presentation|suspense|comfort|dimension) (?:causes|caused|makes you|made you|increases|improves|drives|works better)|proven to|more likely to (?:start|finish|complete))\b/i;

type OperatorFixture = { key: "A" | "B"; openId: string; name: string; dimension: "suspense" | "comfort" };
const OPERATORS: OperatorFixture[] = [
  { key: "A", openId: "loop-operator-a", name: "Operator A", dimension: "suspense" },
  { key: "B", openId: "loop-operator-b", name: "Operator B", dimension: "comfort" },
];

describeMysql("JOYSTICK loop — two operators get different presentations of Kingdom 1, not different games (disposable MySQL)", () => {
  let sql: mysql.Connection;
  const v2Lines: Array<Record<string, unknown>> = [];
  const infoSpy = vi.spyOn(console, "info");
  const now = new Date();
  const today = formatInTimeZone(now, ZONE, "yyyy-MM-dd");
  const results = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    const parsed = new URL(DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      throw new Error(`This loop test writes; it refuses non-local DATABASE_URL host ${parsed.hostname}`);
    }
    Object.assign(process.env, {
      CLAIRE_BRAIN_V2_PRIMARY: "1",
      DAPHNE_V2_DECISION_POINTS: "1",
      JWT_SECRET: process.env.JWT_SECRET || "loop-only-jwt-secret-not-production",
      OWNER_OPEN_ID: OPERATORS[0]!.openId,
      // Brain V2 primary answers only allowlisted operators; a second operator is onboarded here.
      CLAIRE_BRAIN_V2_OPERATOR_IDS: OPERATORS.map(op => op.openId).join(","),
      ANTHROPIC_API_KEY: "scripted-model-boundary",
      DAPHNE_V2_CLAIRE_ENABLED: "true",
      DAPHNE_V2_CONVERSATION_INGESTION_ENABLED: "true",
      DAPHNE_V2_CONVERSATION_INGESTION_TENANTS: TENANT,
    });
    delete process.env.CLAIRE_WORK_LEDGER;
    delete process.env.DAPHNE_V2_DECISION_POINTS_TENANTS;
    sql = await mysql.createConnection(DATABASE_URL!);
    await sql.query(
      "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [TENANT, TENANT, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "loop@example.invalid", ZONE]
    );
    for (const op of OPERATORS) {
      await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [TENANT, op.openId, op.name, `${op.openId}@example.invalid`]);
      await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [TENANT, op.openId]);
    }
    infoSpy.mockImplementation((...args: unknown[]) => {
      if (args[0] === "[ClaireBrainV2Primary]" && typeof args[1] === "string") v2Lines.push(JSON.parse(args[1]));
    });
    const { seedGoldlineKingdoms } = await import("../../../goldlineKingdoms/seedKingdoms");
    await seedGoldlineKingdoms(TENANT);
  });

  afterAll(async () => {
    infoSpy.mockRestore();
    await sql?.end();
  });

  async function identityFor(openId: string) {
    const { resolveCanonicalOperatorIdentity } = await import("../../../agents/persistentOperator/identity");
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: TENANT, source: { type: "open_id", value: openId }, subsystem: "joystick_loop_test" });
    if (!resolved.ok) throw new Error(`operator fixture ${openId} did not resolve`);
    return resolved.identity;
  }

  /** The database is disposable, but a rerun must start from the same seed. */
  async function resetOperator(identity: Awaited<ReturnType<typeof identityFor>>) {
    const canonical = identity.canonicalOperatorId;
    const openIds = [identity.canonicalOpenId, identity.communicationOperatorUserId];
    const statements: Array<[string, unknown[]]> = [
      ["DELETE FROM day_director_commitments WHERE tenantId = ? AND actorId IN (?)", [TENANT, identity.dayDirectorActorIds?.length ? identity.dayDirectorActorIds : [identity.dayDirectorActorId]]],
      ["DELETE t FROM open_channel_mission_tasks t JOIN open_channel_missions m ON m.id = t.missionId WHERE m.tenantId = ? AND m.driverId IN (?)", [TENANT, openIds]],
      ["DELETE FROM open_channel_missions WHERE tenantId = ? AND driverId IN (?)", [TENANT, openIds]],
      ["DELETE FROM operator_macro_goals WHERE tenantId = ? AND operatorUserId IN (?)", [TENANT, openIds]],
      ["DELETE FROM macro_goal_runs WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, canonical]],
      ["DELETE FROM claire_operator_instructions WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, canonical]],
      ["DELETE FROM claire_prepared_items WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, canonical]],
      ["DELETE FROM daphne_observations WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, canonical]],
      ["DELETE FROM daphne_interventions WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, canonical]],
      ["DELETE FROM daphne_outcomes WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, canonical]],
      ["DELETE FROM claire_progression_evidence WHERE tenantId = ? AND operatorUserId IN (?)", [TENANT, openIds]],
      ["DELETE FROM claire_personal_ledger WHERE tenantId = ? AND operatorUserId IN (?)", [TENANT, openIds]],
    ];
    for (const [statement, params] of statements) await sql.query(statement, params);
  }

  async function seedOperator(op: OperatorFixture) {
    const identity = await identityFor(op.openId);
    await resetOperator(identity);
    const { addDaysYmd } = await import("../../../analytics/businessPeriods");

    // Macro goal and its run baseline.
    const { setActiveMacroGoal } = await import("../../../planning/macroGoalStore");
    const goal = await setActiveMacroGoal({
      tenantId: TENANT, operatorUserId: op.openId, objective: "Get to 50 active customers", metricKey: "active_customers",
      targetValue: 50, unit: "customers", source: "operator_attested", sourceNote: "joystick loop fixture",
    });
    await sql.query(
      "INSERT INTO macro_goal_runs (id,tenantId,canonicalOperatorId,operatorUserId,macroGoalId,verticalKey,status,goalSnapshotJson,metricKey,targetValue,unit,baselineValue,baselinePrecision,baselineCoverage,policyVersion) VALUES (?,?,?,?,?,'laundry_fluff_fold','active',?,'active_customers',50,'customers',23,'exact','complete','loop-fixture')",
      [randomUUID(), TENANT, identity.canonicalOperatorId, op.openId, goal.id, JSON.stringify({ objective: goal.objective })]
    );

    // Day 1 Ten Doors: 3 of the 5 Greystar Colosseum targets pitched, by the one outcome writer.
    const day1 = await import("../../../openChannel/day1TenDoorsService");
    const mission = await day1.getOrCreateDay1TenDoorsMission({ tenantId: TENANT, driverId: op.openId });
    for (const targetId of GREYSTAR_PITCHED) {
      await day1.recordDay1TenDoorsOutcome({ tenantId: TENANT, driverId: op.openId, missionId: mission.missionId, targetId, outcome: "pitched" });
    }

    // Day Line: one building twice today; "Call Dana" carried open across three earlier dates.
    const { acceptProposalWithReceipt } = await import("../../../planning/dayDirector/dayDirectorService");
    const { operatorInstructionAdmission } = await import("../../../planning/dayDirector/dayLineAdmission");
    const seed = async (title: string, businessDate: string) =>
      acceptProposalWithReceipt({
        tenantId: TENANT, actorId: identity.dayDirectorActorId, businessDate,
        proposal: {
          promptKey: `seed:${randomUUID()}`, title, kind: "operations", quantity: null, sourceText: title, prerequisites: [], question: null,
          intelligence: "manual_fallback", detailState: "COMPLETE", missingDetails: [], detailNote: null, references: [], targetBusinessDate: businessDate,
        } as never,
        admission: operatorInstructionAdmission({ operatorUserId: op.openId, surface: "day_line_ui", sourceRef: `joystick-loop:${randomUUID()}` }),
      });
    for (const offset of [-14, -8, -1]) await seed("Call Dana", addDaysYmd(today, offset));
    await seed("Visit Los Feliz Towers", today);
    await seed("Pitch Los Feliz Towers", today);

    // The operator's standing rule, captured from the real words.
    const { captureStandingInstructions } = await import("../../../agents/daphne/standingInstructions");
    const { FIXTURE_ENCOURAGEMENT, FIXTURE_TOMORROW_VISITS } = await import("../../../agents/daphne/standingInstructions/productionFixtures");
    await captureStandingInstructions({
      tenantId: TENANT, operatorUserId: op.openId, utterance: FIXTURE_ENCOURAGEMENT.utteranceNamed,
      conversationId: `loop-evening-${op.key}`, turnId: `loop-evening-${op.key}:1`, priorClaireTurn: FIXTURE_ENCOURAGEMENT.priorClaireTurn,
    });

    // Last night's promise, backed by the promise ledger the way the evening call backs it.
    const { reconcileSpokenPromises, resolvePromiseScope } = await import("../../promiseReconciler");
    const scope = await resolvePromiseScope({ tenantId: TENANT, operatorUserId: op.openId });
    if (!scope) throw new Error("promise scope did not resolve");
    const lastNight = new Date(`${addDaysYmd(today, -1)}T20:00:00-07:00`);
    const reconciled = await reconcileSpokenPromises(FIXTURE_TOMORROW_VISITS.claireSaid, {
      scope, conversationKey: `loop-evening-${op.key}`, now: lastNight, timeZone: ZONE,
    });

    // The operator's explicit motivational dimension, through Daphne's ingestion.
    const { ingestDaphneConversation } = await import("../../../agents/daphne/conversationIngestion");
    const stated = DIMENSION_UTTERANCE[op.dimension]!;
    await ingestDaphneConversation(
      { tenantId: TENANT, operatorUserId: op.openId, conversationId: `loop-desk-${op.key}`, turnId: `loop-desk-${op.key}:1`, utterance: stated.utterance, completed: true },
      { awaitModel: true }
    );
    return { identity, goal, mission, prepared: reconciled.prepared };
  }

  for (const op of OPERATORS) {
    describe(`operator ${op.key} (explicit ${op.dimension}, no experimentation consent)`, () => {
      const r: Record<string, any> = {};
      const sentences = () => (r.opening as string).match(/[^.!?]+[.!?]+/g)!.map(s => s.trim());
      const say = async (utterance: string) => {
        const { runRelayAuthoritativeTurn } = await import("../../claireTwilio");
        const before = v2Lines.length;
        const turn = await runRelayAuthoritativeTurn({ conversationId: r.opened.conversationId, utterance, token: r.opened.token });
        r.transcript.push(`OPERATOR: ${utterance}`, `CLAIRE: ${turn.speak}`);
        return { ...turn, v2: v2Lines.slice(before).at(-1) ?? null };
      };

      it("seeds through production writers (dimension stored as an operator-stated fact)", async () => {
        Object.assign(r, await seedOperator(op));
        const [dimRows] = await sql.query<mysql.RowDataPacket[]>(
          "SELECT payloadJson FROM daphne_observations WHERE tenantId = ? AND canonicalOperatorId = ? AND sourceType = 'claire_conversation_ingestion'",
          [TENANT, r.identity.canonicalOperatorId]
        );
        const facts = dimRows.flatMap(row => (typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson) : row.payloadJson).items ?? []);
        expect(facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "fact", key: `motivational_dimension:${op.dimension}` })]));
        const { buildShowrunnerBriefing, showrunnerOpening } = await import("../../showrunner/showrunnerBriefing");
        r.briefing = await buildShowrunnerBriefing({ identity: r.identity, purpose: "morning_readiness", timeZone: ZONE, now });
        r.opening = showrunnerOpening(r.briefing);
        r.transcript = [`CLAIRE (opening): ${r.opening}`];
        console.log(`OPERATOR ${op.key} OPENING: ${r.opening}`);
        results.set(op.key, r);
      });

      it("opening names the macro goal first, with its distance", () => {
        expect(sentences()[0]).toMatch(/^Good morning/);
        expect(sentences()[1]).toMatch(/^The goal is to get to 50 active customers\.$/);
        // Distance: the verified count when the metric is complete, else the run baseline (23).
        expect(sentences()[2]).toMatch(/^You're at \d+, \d+ to go\.$|started at 23/);
      });

      it("opening names the Kingdom 1 move and the two remaining Greystar targets, unprompted", () => {
        expect(r.opening).toMatch(/Wilshire Vermont or The Chadwick: two left for the Colosseum\./);
        for (const pitched of ["Rise Koreatown", "Avana on Wilshire", "The Pearl on Wilshire"]) expect(r.opening).not.toContain(`move is ${pitched}`);
      });

      it("opening speaks the duplicated building once", () => {
        expect(r.briefing.driverDayLine?.read).toBe("read");
        expect(r.opening.match(/Los Feliz Towers/g) ?? []).toHaveLength(1);
      });

      it("opening asks exactly one question, and it closes the opening", () => {
        expect(r.opening.match(/\?/g) ?? []).toHaveLength(1);
        expect(sentences().at(-1)).toMatch(/\?$/);
      });

      // KNOWN GAP (W5 feature, not the merge): the promise ledger reads the Day 1 campaign by
      // Day Director (numeric user) ids, but the driver app keys Day 1 missions by openId
      // (day1TenDoorsRouter: driverId = ctx.user.openId; W1's game-state reader uses the openId).
      // So the evening promise is stripped ("promise guard removed unbacked promise") and the
      // morning loader finds no live campaign. Flip to `it` when the ledger reads by openId.
      it.fails("opening honours last night's prepared promise (property visits)", () => {
        expect(r.prepared).toHaveLength(1);
        expect(r.opening).toMatch(/Last night I said I'd have the open property visits ready: .*Which one do you want first\?/);
      });

      // KNOWN GAP (W5 feature, not the merge): openingEncouragement requires briefing.objective,
      // which only a weekly strategic proposal supplies. With the macro goal on record and no
      // proposal this week the standing rule is loaded (asserted) but no line is spoken.
      it("the encouragement standing instruction is loaded for the call", () => {
        expect(r.briefing.standing?.encouragement).toBe(true);
        expect(r.briefing.standing?.section ?? "").toMatch(/encourag/i);
      });
      it.fails("opening includes the encouragement line", () => {
        expect(r.opening).toMatch(/is the move that serves "Get to 50 active customers"/);
      });

      it("Daphne's decision point writes one intervention row with policy version and probability, before the call", async () => {
        const { prepareDaphneCallDecision } = await import("../../../agents/daphne/decisionPointSeam");
        r.decision = await prepareDaphneCallDecision({ identity: r.identity, purpose: "morning_readiness", briefing: r.briefing, timeZone: ZONE, now });
        expect(r.decision).not.toBeNull();
        const [rows] = await sql.query<mysql.RowDataPacket[]>(
          "SELECT * FROM daphne_interventions WHERE tenantId = ? AND canonicalOperatorId = ?",
          [TENANT, r.identity.canonicalOperatorId]
        );
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        r.intervention = row;
        expect(row.policyVersion).toBe("daphne_framing_policy_v1");
        expect(Number(row.selectionProbability)).toBe(1);
        // No experimentation consent: the standard presentation, recorded deterministically.
        expect(row.selectionMode).toBe("deterministic");
        expect(row.chosenAction).toBe("plain_instruction");
        const receipt = typeof row.policyReceiptJson === "string" ? JSON.parse(row.policyReceiptJson) : row.policyReceiptJson;
        expect(receipt.reason).toBe("standard_presentation_without_experimentation_consent");
        expect(row.proximalOutcomeWindowMinutes).toBeGreaterThan(0);
        // A retried call reuses the stored assignment: still one row.
        await prepareDaphneCallDecision({ identity: r.identity, purpose: "morning_readiness", briefing: r.briefing, timeZone: ZONE, now });
        const [again] = await sql.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM daphne_interventions WHERE tenantId = ? AND canonicalOperatorId = ?",
          [TENANT, r.identity.canonicalOperatorId]
        );
        expect(Number(again[0]!.n)).toBe(1);
      });

      // KNOWN GAP (W6 feature, not the merge): no decision point reads the motivational dimension.
      // decisionPoints.ts chooses among framings (plain / implementation intention / choice of two)
      // from consent and the response model only; the explicit `suspense`/`comfort` fact written by
      // conversation ingestion is read by nothing. Until a presentation registry keyed by dimension
      // exists, A and B get the same presentation. Flip to `it` when the row carries the dimension.
      it.fails("Daphne's decision reflects the operator's explicit motivational dimension", () => {
        const receipt = JSON.stringify(r.intervention.policyReceiptJson ?? "") + JSON.stringify(r.intervention.acceptableActionsJson ?? "");
        expect(receipt).toContain(op.dimension);
      });

      it("the scheduled call opens through the production path without dialing", async () => {
        const { openPreparedClaireConversationWithoutDialing } = await import("../../claireTwilio");
        const id = r.identity;
        r.opened = await openPreparedClaireConversationWithoutDialing({
          tenantId: TENANT, actorId: id.communicationOperatorUserId, dayDirectorActorId: id.dayDirectorActorId, timeZone: ZONE,
          openingOverride: r.opening, sessionKindOverride: "morning_readiness",
          showrunner: {
            purpose: "morning_readiness", tenantId: TENANT, canonicalOperatorId: id.canonicalOperatorId, operatorUserId: id.canonicalOpenId,
            dayDirectorActorId: id.dayDirectorActorId, dayDirectorActorIds: id.dayDirectorActorIds, timeZone: ZONE,
            businessDate: today, briefing: r.briefing, captured: { missionUpdates: [], developments: [], readinessNeeds: [] }, replan: null, turns: 0,
            clockOffsetMs: now.getTime() - Date.now(), daphneDecision: r.decision,
          },
        });
        expect(r.opened.brief).toBe(r.opening.trim());
      });

      it('"What do you want me to do tomorrow?" yields a lead plan: goal, the move, the targets; no row dump, no "which buildings?"', async () => {
        const conductorCallsBefore = modelCalls.filter(call => call.schema === "claire_showrunner_turn").length;
        const turn = await say("What do you want me to do tomorrow?");
        r.leadSpeech = turn.speak;
        expect(turn.v2).toMatchObject({ origin: "brain_v2", composition: "composed", legacyConsulted: false });
        // V2 answered; the conductor's report-collecting interview never saw the turn.
        expect(modelCalls.filter(call => call.schema === "claire_showrunner_turn").length).toBe(conductorCallsBefore);
        // What V2 handed Claire's speaking organ: goal first, the first move, the Kingdom 1 position.
        const composerPrompt = modelCalls.filter(call => call.kind === "text" && call.schema === null).at(-1)!.prompt;
        expect(composerPrompt).toMatch(/The goal is to get to 50 active customers\. [^\n"]*Tomorrow, the first move is/);
        expect(composerPrompt).toMatch(/Kingdom 1, The Colosseum: you've pitched three of the five Greystar targets/);
        // Spoken: the move and both remaining targets. The goal sentence was already said in the
        // opening, and Claire never repeats a sentence within a call, so it is not said twice.
        expect(turn.speak).toMatch(/Tomorrow, the first move is/);
        expect(turn.speak).toMatch(/Wilshire Vermont/);
        expect(turn.speak).toMatch(/The Chadwick/);
        expect(turn.speak).toMatch(/Kingdom 1/);
        expect(turn.speak).not.toMatch(/which (?:\w+ )?buildings?\??/i);
        expect(turn.speak).not.toMatch(/On today's line:|Still open:/);
      });

      it('"What did you say?" repeats the previous line verbatim', async () => {
        const turn = await say("What did you say?");
        expect(turn.v2).toMatchObject({ composition: "repeat" });
        expect(turn.speak).toBe(r.leadSpeech);
      });

      it('"I love you, Claire" is deflected with a decline plus a pivot, and the advance is recorded', async () => {
        const turn = await say("I love you, Claire.");
        r.advanceSpeech = turn.speak;
        expect(turn.v2).toMatchObject({ composition: "deterministic" });
        expect(turn.speak).not.toMatch(/love you too|i love you/i);
        const { AUTHORED_DIALOGUE } = await import("../../progression/authoredDialogue");
        const authored = (category: string) => AUTHORED_DIALOGUE.filter(line => line.category === category).map(line => line.text);
        // advance_decline has authoring slots only (Adam writes those lines); until then the band's decline lines answer.
        expect([...authored("advance_decline"), ...authored("decline")].some(text => turn.speak.includes(text))).toBe(true);
        expect(authored("business_pivot").some(text => turn.speak.includes(text))).toBe(true);
        const [ledger] = await sql.query<mysql.RowDataPacket[]>(
          "SELECT kind, topic, declineId FROM claire_personal_ledger WHERE tenantId = ? AND operatorUserId = ? AND conversationId = ?",
          // The conversation key the phone path uses is `claire-call:<conversationId>`.
          [TENANT, r.identity.canonicalOpenId, `claire-call:${r.opened.conversationId}`]
        );
        expect(ledger).toEqual([expect.objectContaining({ kind: "advance_declined", topic: "romantic_advance" })]);
      });

      // Seam check: the merged opening no longer says "This week is about: …" (W1 replaced it with
      // the macro-goal line), which is one of the places macroGoalStatement used to find the goal.
      it('"What\'s my goal?" answers with the macro goal on record', async () => {
        const turn = await say("What's my goal again?");
        expect(turn.speak).toMatch(/Get to 50 active customers/i);
        expect(turn.speak).not.toMatch(/don't have a goal on record/i);
      });

      it("a verified Day 1 outcome later updates game state and produces one rapport evidence row", async () => {
        const evidenceRows = async () => {
          const [rows] = await sql.query<mysql.RowDataPacket[]>(
            "SELECT sourceId, kind, provenance FROM claire_progression_evidence WHERE tenantId = ? AND operatorUserId = ? AND sourceType = 'day1_ten_doors' ORDER BY sourceId",
            [TENANT, r.identity.canonicalOpenId]
          );
          return rows;
        };
        const before = await evidenceRows();
        expect(before.map(row => row.sourceId)).toEqual([...GREYSTAR_PITCHED].sort());
        const day1 = await import("../../../openChannel/day1TenDoorsService");
        await day1.recordDay1TenDoorsOutcome({
          tenantId: TENANT, driverId: op.openId, missionId: r.mission.missionId, targetId: "wilshire-vermont", outcome: "pitched",
        });
        // The progression credit is fire-and-forget after the committed tap.
        let after = before;
        for (let i = 0; i < 50 && after.length === before.length; i += 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
          after = await evidenceRows();
        }
        const added = after.filter(row => !before.some(prior => prior.sourceId === row.sourceId));
        expect(added).toEqual([expect.objectContaining({ sourceId: "wilshire-vermont", kind: "confirmed_field_visit", provenance: "day1_outcome_operator_confirmed:pitched" })]);
        const { buildShowrunnerBriefing, showrunnerOpening } = await import("../../showrunner/showrunnerBriefing");
        const next = await buildShowrunnerBriefing({ identity: r.identity, purpose: "morning_readiness", timeZone: ZONE, now });
        const colosseum = next.gameState!.colosseum as { pitched: Array<{ id: string }>; remaining: Array<{ id: string }> };
        expect(colosseum.pitched.map(t => t.id).sort()).toEqual([...GREYSTAR_PITCHED, "wilshire-vermont"].sort());
        expect(colosseum.remaining.map(t => t.id)).toEqual(["the-chadwick"]);
        expect(showrunnerOpening(next)).toMatch(/The game move is The Chadwick: one left for the Colosseum\./);
      });

      it("nothing claims a causal effect", async () => {
        const [observations] = await sql.query<mysql.RowDataPacket[]>(
          "SELECT payloadJson FROM daphne_observations WHERE tenantId = ? AND canonicalOperatorId = ?",
          [TENANT, r.identity.canonicalOperatorId]
        );
        const spoken = r.transcript.join("\n");
        const stored = [JSON.stringify(r.intervention.policyReceiptJson), ...observations.map(row => JSON.stringify(row.payloadJson))].join("\n");
        expect(spoken).not.toMatch(CAUSAL_CLAIM);
        expect(stored).not.toMatch(CAUSAL_CLAIM);
        // The decision itself says what it is: no delivery proof, an outcome rule from Day Line evidence only.
        const receipt = typeof r.intervention.policyReceiptJson === "string" ? JSON.parse(r.intervention.policyReceiptJson) : r.intervention.policyReceiptJson;
        expect(receipt.deliveryProven).toBe(false);
        expect(receipt.outcomeRule).toMatch(/Operator statements on calls are never evidence/);
        console.log(`OPERATOR ${op.key} TRANSCRIPT:\n${r.transcript.join("\n")}`);
      });
    });
  }

  // KNOWN GAP (production, not the merge): Brain V2 primary answers only operators on
  // CLAIRE_BRAIN_V2_OPERATOR_IDS (else OWNER_OPEN_ID + historical ids). Any other operator's
  // scheduled call falls to the legacy conductor (runScheduledClaireTurn → runShowrunnerTurn),
  // whose W3 open-item reply reader runs first on turn 1 and reads "tomorrow" in a QUESTION
  // as "snooze the carried item": it moves Call Dana to tomorrow and cancels the older copies.
  it.fails("an operator outside the V2 allowlist asking what to do tomorrow never moves the carried item", async () => {
    const b = results.get("B") as Record<string, any>;
    const { clearClaireOperatorAuthorityCache } = await import("../live/operatorAuthority");
    const saved = process.env.CLAIRE_BRAIN_V2_OPERATOR_IDS;
    process.env.CLAIRE_BRAIN_V2_OPERATOR_IDS = OPERATORS[0]!.openId;
    clearClaireOperatorAuthorityCache();
    try {
      const id = b.identity;
      const danaRows = async () => {
        const [rows] = await sql.query<mysql.RowDataPacket[]>(
          "SELECT id, businessDate, status FROM day_director_commitments WHERE tenantId = ? AND actorId = ? AND title = 'Call Dana' ORDER BY id",
          [TENANT, id.dayDirectorActorId]
        );
        return JSON.stringify(rows);
      };
      const { buildShowrunnerBriefing, showrunnerOpening } = await import("../../showrunner/showrunnerBriefing");
      const briefing = await buildShowrunnerBriefing({ identity: id, purpose: "morning_readiness", timeZone: ZONE, now });
      const { openPreparedClaireConversationWithoutDialing, runRelayAuthoritativeTurn } = await import("../../claireTwilio");
      const opened = await openPreparedClaireConversationWithoutDialing({
        tenantId: TENANT, actorId: id.communicationOperatorUserId, dayDirectorActorId: id.dayDirectorActorId, timeZone: ZONE,
        openingOverride: showrunnerOpening(briefing), sessionKindOverride: "morning_readiness",
        showrunner: {
          purpose: "morning_readiness", tenantId: TENANT, canonicalOperatorId: id.canonicalOperatorId, operatorUserId: id.canonicalOpenId,
          dayDirectorActorId: id.dayDirectorActorId, dayDirectorActorIds: id.dayDirectorActorIds, timeZone: ZONE,
          businessDate: today, briefing, captured: { missionUpdates: [], developments: [], readinessNeeds: [] }, replan: null, turns: 0,
          clockOffsetMs: now.getTime() - Date.now(),
        },
      });
      const before = await danaRows();
      const turn = await runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance: "What do you want me to do tomorrow?", token: opened.token });
      console.log(`OPERATOR B, LEGACY CONDUCTOR: ${turn.speak}`);
      expect(await danaRows()).toBe(before);
      expect(turn.speak).not.toMatch(/Moved Call Dana/);
    } finally {
      process.env.CLAIRE_BRAIN_V2_OPERATOR_IDS = saved;
      clearClaireOperatorAuthorityCache();
    }
  });

  it("A and B play the same Kingdom 1 with the same targets; only the presentation may differ", () => {
    const a = results.get("A")!;
    const b = results.get("B")!;
    const targets = (x: Record<string, any>) => (x.briefing.gameState.colosseum.targetIds as string[]).join(",");
    expect(targets(a)).toBe(targets(b));
    expect(a.briefing.gameState.activeKingdom?.kingdomId).toBe("kingdom-1-colosseum");
    expect(b.briefing.gameState.activeKingdom?.kingdomId).toBe("kingdom-1-colosseum");
    expect(legacyCalls).toEqual([]);
  });
}, 120_000);
