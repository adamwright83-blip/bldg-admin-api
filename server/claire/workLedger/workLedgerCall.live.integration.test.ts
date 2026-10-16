/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only (disposable-database tenant tables); not current architecture. */
/**
 * The 2026-10-15 production call, replayed through the production voice path
 * with real models and a real (disposable, localhost) MySQL. No telephone.
 *
 * Path exercised, in order, exactly as a Twilio Conversation Relay call:
 *   openAuthorizedInboundClaireConversation  (what the inbound webhook does after authorizing the caller)
 *   runRelayAuthoritativeTurn                (what every Relay prompt does)
 *     → runAuthoritativeClaireVoiceTurn → work ledger → (Brain V3 + Claire V1 for non-work turns)
 *   persisted Day Director commitments, conversation turns, call state and Daphne observations
 *
 * The scheduled evening debrief that dropped just before the call is recreated
 * as its own session, so Claire's knowledge of her own call is tested too.
 *
 *   docker run -d --name claire-ledger-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=claire_ledger_test -p 3307:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3307/claire_ledger_test node scripts/migrate.mjs
 *   CLAIRE_WORK_LEDGER_LIVE=1 DATABASE_URL=mysql://root:test-only@127.0.0.1:3307/claire_ledger_test \
 *     railway run -- env DATABASE_URL=mysql://root:test-only@127.0.0.1:3307/claire_ledger_test \
 *     pnpm vitest run --config vitest.integration.config.ts server/claire/workLedger/workLedgerCall.live.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { briefingClock } from "../briefing/briefingTiming";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { OCTOBER_15_CALL } from "./october15CallFixture";

const enabled = process.env.CLAIRE_WORK_LEDGER_LIVE === "1";
const ZONE = "America/Los_Angeles";

describe.skipIf(!enabled)("Claire voice path, real models, disposable MySQL — the 2026-10-15 call", () => {
  let sql: mysql.Connection;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      throw new Error(`This replay writes; it refuses non-local DATABASE_URL host ${parsed.hostname}`);
    }
    if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("BLOCKED: a real ANTHROPIC_API_KEY is required");
    process.env.DAPHNE_V2_CLAIRE_ENABLED = "true";
    process.env.DAPHNE_V2_CONVERSATION_INGESTION_ENABLED = "true";
    process.env.DAPHNE_V2_CONVERSATION_INGESTION_TENANTS = "default";
    sql = await mysql.createConnection(url);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it(
    "understands, saves, revises and reads back the call's work; knows about its own dropped call; teaches Daphne",
    async () => {
      const tenantId = "default";
      const operatorUserId = "adam-admin";
      // Fresh operator data each run: this database is disposable.
      await sql.query(
        "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
        [tenantId, tenantId, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "replay@example.invalid", ZONE]
      );
      await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [tenantId, operatorUserId, "Adam", "replay@example.invalid"]);
      await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operatorUserId]);

      const { resolveCanonicalOperatorIdentity } = await import("../../agents/persistentOperator/identity");
      const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operatorUserId }, subsystem: "claire_work_ledger_replay" });
      if (!resolved.ok) throw new Error("operator fixture did not resolve");
      const dayDirectorActorId = resolved.identity.dayDirectorActorId;
      await sql.query("DELETE FROM day_director_commitments WHERE tenantId = ? AND actorId = ?", [tenantId, dayDirectorActorId]);

      // The scheduled evening debrief that connected and dropped seconds before the operator called back.
      const { createConversationSession, persistSpokenTurn } = await import("../conversation/ledgerService");
      const debriefConversationId = randomUUID();
      const debrief = await createConversationSession({
        tenantId, operatorUserId, claireConversationId: debriefConversationId, conversationKind: "evening_debrief", recordingEnabled: false,
      });
      await persistSpokenTurn({
        claireConversationId: debriefConversationId, speaker: "CLAIRE", turnKey: 0,
        text: "Claire here. Hi, it's Claire for today's wrap. There wasn't anything on today's Day Line. How did it go?",
      });
      await sql.query(
        "UPDATE claire_conversation_sessions SET status='complete', completionReason='remote_hangup', startedAt = DATE_SUB(NOW(), INTERVAL 20 SECOND), endedAt = DATE_SUB(NOW(), INTERVAL 11 SECOND) WHERE id = ?",
        [debrief.id]
      );

      const { openAuthorizedInboundClaireConversation, runRelayAuthoritativeTurn } = await import("../claireTwilio");
      const opened = await openAuthorizedInboundClaireConversation({ tenantId, operatorUserId, dayDirectorActorId, callSid: `CA${randomUUID().replace(/-/g, "").slice(0, 32)}` });

      const clock = briefingClock(new Date(), ZONE);
      const today = clock.today;
      const tomorrow = addDaysYmd(today, 1);
      const transcript: string[] = ["CLAIRE: Claire here. What's up?"];
      const timings: number[] = [];
      for (const step of OCTOBER_15_CALL) {
        const started = Date.now();
        const turn = await runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance: step.operator, token: opened.token });
        timings.push(Date.now() - started);
        transcript.push(`OPERATOR: ${step.operator}`, `CLAIRE (${Date.now() - started} ms): ${turn.speak}`);
      }
      const [rows] = await sql.query<mysql.RowDataPacket[]>(
        "SELECT id, businessDate, title, sourceText, status, metadataJson FROM day_director_commitments WHERE tenantId = ? AND actorId = ? ORDER BY createdAt",
        [tenantId, dayDirectorActorId]
      );
      const meta = (row: mysql.RowDataPacket) => (typeof row.metadataJson === "string" ? JSON.parse(row.metadataJson) : row.metadataJson) ?? {};
      const { readDayLineOverlay, dayLineDisplayTitle, isDayLineCancelled } = await import("../../../shared/goldlineDayLine");
      const visible = rows
        .filter(row => !isDayLineCancelled(readDayLineOverlay(meta(row))))
        .map(row => ({
          date: row.businessDate as string,
          title: dayLineDisplayTitle(readDayLineOverlay(meta(row)), row.title as string),
          type: (meta(row).executionType as string | null | undefined) ?? null,
          source: row.sourceText as string,
        }));
      const [turnRows] = await sql.query<mysql.RowDataPacket[]>(
        "SELECT t.speaker, t.text FROM claire_conversation_turns t JOIN claire_conversation_sessions s ON s.id = t.sessionId WHERE s.claireConversationId = ? ORDER BY t.ordinal",
        [opened.conversationId]
      );
      const [observations] = await sql.query<mysql.RowDataPacket[]>(
        "SELECT observationKind, payloadJson FROM daphne_observations WHERE tenantId = ? AND sourceType = 'claire_work_ledger' ORDER BY occurredAt",
        [tenantId]
      ).catch(async () => sql.query<mysql.RowDataPacket[]>("SELECT observationKind, payload AS payloadJson FROM daphne_observations WHERE tenantId = ? AND sourceType = 'claire_work_ledger'", [tenantId]));

      console.log(
        `\n${transcript.join("\n")}\n\nDAY LINE (MySQL readback):\n${visible.map(row => `  [${row.date === today ? "today" : row.date === tomorrow ? "tomorrow" : row.date}${row.type ? `/${row.type}` : ""}] ${row.title}`).join("\n")}` +
          `\n\nPERSISTED TURNS: ${turnRows.length}\nDAPHNE OBSERVATIONS: ${observations.map(row => JSON.stringify(typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson) : row.payloadJson)).join("\n  ")}` +
          `\n\nturn latency ms: ${timings.join(", ")}`
      );

      // Claire owns her dropped call instead of denying it.
      expect(transcript[2]).not.toMatch(/(?:wasn't|was not) me|don't make (?:outbound )?calls/i);
      // The real work, on the right days, with no fragments or ad copy as tasks.
      expect(visible.some(row => row.date === today && /charg/i.test(`${row.title} ${row.source}`))).toBe(true);
      expect(visible.some(row => row.date === today && /deliver/i.test(row.title))).toBe(true);
      expect(visible.some(row => row.date === tomorrow && /deliver/i.test(row.title))).toBe(true);
      expect(visible.filter(row => /^(?:it for today|our processing center|claim free order|if in the case|we will pick up)/i.test(row.title))).toEqual([]);
      expect(visible.filter(row => row.date === tomorrow && /20 pounds|pick up/i.test(row.title))).toEqual([]);
      const landing = visible.filter(row => /landing page|website/i.test(row.title));
      expect(landing).toHaveLength(1);
      expect(landing[0]!.date).toBe(today);
      expect(landing[0]!.type).toBe("challenge");
      // Every turn is in the durable transcript (opening + operator + Claire).
      expect(turnRows.filter(row => String(row.speaker).toUpperCase() === "OPERATOR")).toHaveLength(OCTOBER_15_CALL.length);
      // Claire never fell into "ask me again" while holding the conversation.
      expect(transcript.join("\n")).not.toMatch(/ask me that once more|say yes or no|quantity 1|Done\. \d+ on/i);
      // Daphne learned something observable from the call, and the next conversation carries it.
      expect(observations.length).toBeGreaterThan(0);
      const { loadDaphneClaireGuidance } = await import("../../agents/daphne/claireAdapter");
      const guidance = await loadDaphneClaireGuidance({ tenantId, operatorUserId });
      console.log(`\nDAPHNE GUIDANCE FOR THE NEXT CALL:\n${guidance?.promptSection ?? "(none)"}`);
      expect(guidance?.promptSection ?? "").toMatch(/marketing challenge|sales mission/i);
    },
    600_000
  );

  it(
    "runs the scheduled evening debrief through the same path: completes, moves, adds, reads back, and ends",
    async () => {
      const tenantId = "default";
      const operatorUserId = "adam-admin";
      const { resolveCanonicalOperatorIdentity } = await import("../../agents/persistentOperator/identity");
      const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operatorUserId }, subsystem: "claire_work_ledger_replay" });
      if (!resolved.ok) throw new Error("operator fixture did not resolve");
      const identity = resolved.identity;
      await sql.query("DELETE FROM day_director_commitments WHERE tenantId = ? AND actorId = ?", [tenantId, identity.dayDirectorActorId]);
      const now = new Date();
      const clock = briefingClock(now, ZONE);
      const today = clock.today;
      const tomorrow = addDaysYmd(today, 1);
      const { acceptProposalWithReceipt } = await import("../../planning/dayDirector/dayDirectorService");
      const seed = async (title: string, businessDate: string, executionType?: "challenge") =>
        acceptProposalWithReceipt({
          tenantId, actorId: identity.dayDirectorActorId, businessDate,
          proposal: {
            promptKey: `seed:${randomUUID()}`, title, kind: "operations", quantity: null, sourceText: title, prerequisites: [], question: null,
            intelligence: "manual_fallback", detailState: "COMPLETE", missingDetails: [], detailNote: null, references: [], targetBusinessDate: businessDate,
            ...(executionType ? { executionType } : {}),
          } as never,
        });
      await seed("Check whether 3 dry-cleaning orders were charged and charge any that weren't", today);
      await seed("Deliver 2 dry-cleaning orders tonight", today);
      await seed("Build Laundry Farm landing page to match Instagram ad", today, "challenge");
      await seed("Deliver third dry-cleaning order tomorrow morning", tomorrow);

      const { buildShowrunnerBriefing, showrunnerOpening } = await import("../showrunner/showrunnerBriefing");
      const briefing = await buildShowrunnerBriefing({ identity, purpose: "evening_debrief", timeZone: ZONE, now });
      const { openPreparedClaireConversationWithoutDialing, runRelayAuthoritativeTurn } = await import("../claireTwilio");
      const opened = await openPreparedClaireConversationWithoutDialing({
        tenantId, actorId: identity.communicationOperatorUserId, dayDirectorActorId: identity.dayDirectorActorId, timeZone: ZONE,
        openingOverride: showrunnerOpening(briefing), sessionKindOverride: "evening_debrief",
        showrunner: {
          purpose: "evening_debrief", tenantId, canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: identity.canonicalOpenId,
          dayDirectorActorId: identity.dayDirectorActorId, dayDirectorActorIds: identity.dayDirectorActorIds, timeZone: ZONE,
          businessDate: today, briefing, captured: { missionUpdates: [], developments: [], readinessNeeds: [] }, replan: null, turns: 0,
          clockOffsetMs: 0,
        },
      });
      const transcript = [`CLAIRE: ${opened.brief}`];
      const turns = [
        "Charged all three and delivered both tonight. The landing page didn't happen, I ran out of time, push it to tomorrow.",
        "And I need to call Louise tomorrow at 10 about the contract renewal.",
        "What's on tomorrow?",
        "Perfect. That's it, thanks.",
      ];
      let ended = false;
      for (const utterance of turns) {
        const started = Date.now();
        const turn = await runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance, token: opened.token });
        transcript.push(`OPERATOR: ${utterance}`, `CLAIRE (${Date.now() - started} ms${turn.endCall ? ", ends call" : ""}): ${turn.speak}`);
        ended = ended || turn.endCall;
      }
      const { getDayDirectorState } = await import("../../planning/dayDirector/dayDirectorService");
      const [todayState, tomorrowState] = await Promise.all([
        getDayDirectorState({ tenantId, actorId: identity.dayDirectorActorId, businessDate: today }),
        getDayDirectorState({ tenantId, actorId: identity.dayDirectorActorId, businessDate: tomorrow }),
      ]);
      console.log(
        `\n${transcript.join("\n")}\n\nTODAY: ${todayState.commitments.map(row => `${row.title} [${row.status}]`).join(" · ")}` +
          `\nTOMORROW: ${tomorrowState.commitments.map(row => `${row.title} [${row.status}${row.executionType ? `/${row.executionType}` : ""}]`).join(" · ")}`
      );
      expect(todayState.commitments.find(row => /charged/i.test(row.title))?.status).toBe("completed");
      expect(todayState.commitments.find(row => /deliver 2/i.test(row.title))?.status).toBe("completed");
      expect(todayState.commitments.filter(row => /landing page/i.test(row.title))).toEqual([]);
      const landing = tomorrowState.commitments.filter(row => /landing page/i.test(row.title));
      expect(landing).toHaveLength(1);
      expect(landing[0]!.executionType).toBe("challenge");
      expect(tomorrowState.commitments.some(row => /louise/i.test(row.title))).toBe(true);
      expect(transcript.join("\n")).toMatch(/louise/i);
      expect(ended).toBe(true);
    },
    600_000
  );
});
