/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only (disposable-database tenant tables); canonical product is JOYSTICK. */
/**
 * Call B of 2026-10-28 (session cb980810), replayed through the real phone processing path against
 * a disposable MySQL. Acceptance for "you tell Claire what tomorrow is for, and the Day Line says so".
 *
 * Phone: openAuthorizedInboundClaireConversation → runRelayAuthoritativeTurn → runClaireV2PrimaryTurn,
 * the real day-plan lane, the real operator mission command (Daily Command read-back, game binding),
 * the real remove-from-day writer and the real Day Director table. The ONLY substitution is the model
 * boundary: a scripted model answers each schema.
 *
 * Ends with: tomorrow's challenge is publishing the Instagram landing page; the Greystar pitch is off
 * tomorrow but not abandoned (removedFromDay, notPursuing false); the pickup is untouched; a later
 * generic "Yes." writes nothing; Claire's words match the rows.
 *
 *   docker run -d --name claire-oct28-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=claire_oct28 -p 127.0.0.1:3472:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3472/claire_oct28 node scripts/migrate.mjs
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3472/claire_oct28 pnpm vitest run --config vitest.integration.config.ts server/claire/brain/tests/october28DayPlan.mysql.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;
const ZONE = "America/Los_Angeles";

const PITCH = "Pitch Wilshire Vermont and The Chadwick in person (Greystar Koreatown)";
const PICKUP = "Pick up laundry at Century Park East";
const CHALLENGE = "Publish the Instagram landing page";
const CUSTOMER_VISIT = "Visit customer to collect laundry";

// Adam's words on the call (claire_conversation_turns, session cb980810).
const CONVERTING =
  "we're not converting anybody, and I think it's because of our funnel, specifically the landing page. So I had MetaMuse create a specified landing page catered to our offer.";
const PRIORITY = "And now I just need to put the final touches on it and get it published. So think that should take priority over the Luis";
const REMOVE = "Remove the sales stops from the dayline and put the marketing challenge.";

const dayPlanReadings: Record<string, unknown> = {
  [PRIORITY]: { applies: true, explicit: false, day: "tomorrow", primaryTitle: CHALLENGE, removeSales: false, removeTitles: [] },
  [REMOVE]: { applies: true, explicit: true, day: "tomorrow", primaryTitle: CHALLENGE, removeSales: true, removeTitles: [] },
};

function perceptionFor(utterance: string) {
  const text = utterance.toLowerCase();
  const turnKind = /^yes/.test(text) ? "acknowledgement" : /remove|put the/.test(text) ? "work_instruction" : "report_or_narration";
  return { turnKind, endsConversation: false, disputesContent: false };
}

function lastUserPayload(messages: Array<{ role: string; content: unknown }>): string {
  const user = [...messages].reverse().find(message => message.role === "user");
  return typeof user?.content === "string" ? user.content : JSON.stringify(user?.content ?? "");
}

const dayPlanCalls: string[] = [];

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
      const payload = JSON.parse(lastUserPayload(params.messages as never) || "{}") as { utterance?: string };
      if (schema === "claire_brain_v2_perception") return structured(perceptionFor(payload.utterance ?? ""), model);
      if (schema === "claire_day_plan_edit") {
        const utterance = payload.utterance ?? "";
        dayPlanCalls.push(utterance);
        // The relay hands V2 the assembled thought (a grown transcript), as on the real call.
        const key = Object.keys(dayPlanReadings).find(said => utterance.includes(said));
        return structured(
          (key ? dayPlanReadings[key] : null) ?? { applies: false, explicit: false, day: "tomorrow", primaryTitle: null, removeSales: false, removeTitles: [] },
          model
        );
      }
      if (schema === "claire_brain_v3_turn") {
        return structured({
          target: "open_conversation", act: "question", workDisposition: "none", dayLineDisposition: "none",
          priorClaim: "none", weeklyDisposition: "none", identityTopic: "none", broadBriefingRequest: false,
          canonicalWork: null, referent: null, rationale: "scripted legacy reading",
        }, model);
      }
      throw new Error(`unscripted structured call: ${schema}`);
    }),
    invokeTextLLM: vi.fn(async (params: Parameters<typeof actual.invokeTextLLM>[0]) => {
      if ((params.maxTokens ?? params.max_tokens ?? 0) <= 16) return "CLEAN";
      // The production model copied this tag from history on the real call.
      return "[Playback unconfirmed] A landing page is a reasonable thing to suspect.";
    }),
  };
});

vi.mock("../../turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("../../turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: vi.fn(async () => {
      throw new Error("legacy Claire answered a Brain V2 primary turn");
    }),
  };
});

describeMysql("2026-10-28 call B — the operator's choice for tomorrow, real phone path, disposable MySQL", () => {
  let sql: mysql.Connection;
  const operatorUserId = "adam-admin";

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
    });
    delete process.env.CLAIRE_WORK_LEDGER;
    delete process.env.CLAIRE_DAY_PLAN_EDIT;
    sql = await mysql.createConnection(DATABASE_URL!);
    await sql.query(
      "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES ('default','default','Laundry Farm','Laundry Farm','#123456','Adam','acceptance@example.invalid',?,'active','laundry_fluff_fold')",
      [ZONE]
    );
    await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES ('default',?,'owner',true)", [operatorUserId]);
    await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES ('default',?,?,?,'admin','password')", [operatorUserId, "Adam", "acceptance@example.invalid"]);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("tomorrow ends as the landing-page challenge; the pitch is off tomorrow but kept; a stray yes writes nothing", async () => {
    const { resolveCanonicalOperatorIdentity } = await import("../../../agents/persistentOperator/identity");
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: "default", source: { type: "open_id", value: operatorUserId }, subsystem: "claire_oct28_acceptance" });
    if (!resolved.ok) throw new Error("operator fixture did not resolve");
    const actorId = resolved.identity.dayDirectorActorId;
    const { addDaysYmd } = await import("../../../analytics/businessPeriods");
    const { businessDateInZone } = await import("../../../../shared/currentDayLine");
    const today = businessDateInZone(new Date(), ZONE);
    const tomorrow = addDaysYmd(today, 1);

    await sql.query("DELETE FROM day_director_commitments WHERE tenantId = 'default' AND actorId = ?", [actorId]);
    const seed = async (title: string, kind: string) => {
      const id = randomUUID();
      await sql.query(
        "INSERT INTO day_director_commitments (id,tenantId,actorId,businessDate,idempotencyKey,title,kind,provenance,status,sourceText,metadataJson) VALUES (?,?,?,?,?,?,?,'manual','open',?,?)",
        [id, "default", actorId, tomorrow, `seed:${id}`, title, kind, title, JSON.stringify({ detailState: "COMPLETE" })]
      );
      return id;
    };
    // What production held for 10-29 after the wrong "Yes." saved the pitch, plus fixed work.
    const pitchId = await seed(PITCH, "growth");
    const pickupId = await seed(PICKUP, "operations");
    // An obligation with a "visit" in its title: the kind, not the word, says it is not a sales stop.
    const customerVisitId = await seed(CUSTOMER_VISIT, "operations");

    const { openAuthorizedInboundClaireConversation, runRelayAuthoritativeTurn } = await import("../../claireTwilio");
    const opened = await openAuthorizedInboundClaireConversation({
      tenantId: "default",
      operatorUserId,
      dayDirectorActorId: actorId,
      callSid: `CA${randomUUID().replace(/-/g, "").slice(0, 32)}`,
    });
    const say = (utterance: string) => runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance, token: opened.token });
    const rowsFor = async (date: string) =>
      (await sql.query<mysql.RowDataPacket[]>(
        "SELECT id, title, kind, status, metadataJson FROM day_director_commitments WHERE tenantId = 'default' AND actorId = ? AND businessDate = ? ORDER BY createdAt",
        [actorId, date]
      ))[0];
    const { getDayDirectorState } = await import("../../../planning/dayDirector/dayDirectorService");
    const visibleTomorrow = async () => (await getDayDirectorState({ tenantId: "default", actorId, businessDate: tomorrow })).commitments.map(row => row.title);

    const transcript: string[] = [];

    // The landing-page story. Composed reply; the copied playback tag never reaches the ear.
    const story = await say(CONVERTING);
    transcript.push(story.speak);
    expect(story.speak).not.toMatch(/Playback/i);

    // A stated preference: offered once, by name, nothing written.
    const offer = await say(PRIORITY);
    transcript.push(offer.speak);
    expect(offer.speak).toBe("Want me to set tomorrow's challenge to publish the Instagram landing page?");
    expect((await rowsFor(tomorrow)).length).toBe(3);

    // Yes to THAT offer: the challenge is saved for tomorrow and read back through the Daily Command.
    const yes = await say("Yes.");
    transcript.push(yes.speak);
    expect(yes.speak).toBe("Saved. Tomorrow's challenge: publish the Instagram landing page. It counts when the Instagram landing page is published.");
    const afterYes = await rowsFor(tomorrow);
    const challenge = afterYes.find(row => row.title === CHALLENGE);
    expect(challenge).toBeTruthy();
    const challengeMeta = challenge!.metadataJson as Record<string, any>;
    expect(challengeMeta.command?.role).toBe("primary");
    expect(challengeMeta.command?.designatedBy).toBe("operator");
    expect(challengeMeta.operatorMission?.completionCondition).toBe("The Instagram landing page is published.");
    expect(challengeMeta.operatorMission?.businessDate).toBe(tomorrow);

    // The explicit instruction: the sales stop comes off tomorrow, the challenge stands.
    const remove = await say(REMOVE);
    transcript.push(remove.speak);
    expect(remove.speak).toBe(
      "I took Pitch Wilshire Vermont and The Chadwick in person off tomorrow's line. It stays on record; only tomorrow changed. Already set. Tomorrow's challenge: publish the Instagram landing page. It counts when the Instagram landing page is published."
    );
    expect(remove.speak).not.toMatch(/can't remove|can't add/i);

    const final = await rowsFor(tomorrow);
    const pitch = final.find(row => row.id === pitchId)!;
    const pitchOverlay = (pitch.metadataJson as Record<string, any>).goldlineDayLine;
    expect(pitchOverlay.removedFromDay?.businessDate).toBe(tomorrow);
    // Off tomorrow, not abandoned.
    expect(pitchOverlay.notPursuing).toBe(false);
    expect(pitchOverlay.cancelledAt ?? null).toBeNull();
    expect(pitch.status).toBe("open");
    for (const id of [pickupId, customerVisitId]) {
      const kept = final.find(row => row.id === id)!;
      expect((kept.metadataJson as Record<string, any>).goldlineDayLine ?? null).toBeNull();
    }
    expect((await visibleTomorrow()).sort()).toEqual([CHALLENGE, PICKUP, CUSTOMER_VISIT].sort());

    // A later generic yes binds to nothing and writes nothing.
    const stray = await say("Yes.");
    transcript.push(stray.speak);
    expect(stray.speak).not.toMatch(/Wilshire|Chadwick|Saved|Added/);
    const afterStray = await rowsFor(tomorrow);
    expect(afterStray.length).toBe(final.length);
    expect((await visibleTomorrow()).sort()).toEqual([CHALLENGE, PICKUP, CUSTOMER_VISIT].sort());

    // The Daily Command for tomorrow is the operator's challenge.
    const { loadDailyCommand } = await import("../../dailyCommandContract");
    const command = await loadDailyCommand({ tenantId: "default", actorId, dayDirectorActorId: actorId, operatorUserId, businessDate: tomorrow });
    expect(command.primary?.title).toBe(CHALLENGE);
    expect(command.explicitOperatorMission?.completionCondition).toBe("The Instagram landing page is published.");

    // Off ONE day, never abandoned: moved to the next day, the pitch shows there, open, not notPursuing.
    const dayAfter = addDaysYmd(tomorrow, 1);
    const { moveDayDirectorCommitmentsToDate } = await import("../../../planning/dayDirector/dayDirectorService");
    const movedIds = await moveDayDirectorCommitmentsToDate({ tenantId: "default", actorId, commitmentIds: [pitchId], toBusinessDate: dayAfter });
    expect(movedIds).toEqual([pitchId]);
    const onDayAfter = await getDayDirectorState({ tenantId: "default", actorId, businessDate: dayAfter });
    expect(onDayAfter.commitments.map(row => row.title)).toEqual([PITCH]);
    expect(onDayAfter.commitments[0]!.status).toBe("open");
    const [movedRow] = (await sql.query<mysql.RowDataPacket[]>("SELECT status, metadataJson FROM day_director_commitments WHERE id = ?", [pitchId]))[0];
    expect((movedRow!.metadataJson as Record<string, any>).goldlineDayLine.notPursuing).toBe(false);
    expect((await visibleTomorrow()).sort()).toEqual([CHALLENGE, PICKUP, CUSTOMER_VISIT].sort());

    expect(dayPlanCalls).toHaveLength(2);
    expect(dayPlanCalls[0]).toContain(PRIORITY);
    expect(dayPlanCalls[1]).toContain(REMOVE);
    console.log(transcript.map((line, index) => `CLAIRE[${index + 1}]: ${line}`).join("\n"));
  }, 120_000);
});
