/**
 * A promise is consumed only when it is delivered (disposable MySQL).
 *
 * Bug (Codex, PR #689 review): operatorAppointmentExecution consumed the prepared item right after
 * PLACING the outbound call, so an unanswered call, a failed dial or voicemail spent the promise
 * ("Last night I said I'd have the open property visits ready…") and the next call could not keep it.
 *
 * Now the dialer records exactly the item the opening speaks (showrunner.preparedOffered) and the
 * voice turn handler consumes it on the first authoritative operator utterance that is not voicemail.
 * Every case below runs the production path: persisted conversation, runRelayAuthoritativeTurn
 * → runAuthoritativeClaireVoiceTurn, the Drizzle prepared-item store, real rows.
 *
 *   docker run -d --name joystick-loop-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=joystick_loop -p 127.0.0.1:3481:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3481/joystick_loop node scripts/migrate.mjs
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3481/joystick_loop pnpm vitest run --config vitest.integration.config.ts server/claire/showrunner/preparedDelivery.mysql.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { formatInTimeZone } from "date-fns-tz";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// No model is needed to prove delivery; any model call answers with a harmless line.
vi.mock("../../_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("../../_core/llm")>();
  const structured = (content: unknown) => ({
    id: randomUUID(),
    created: Date.now(),
    model: "scripted",
    choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(content) }, finish_reason: "tool_use" }],
  });
  return {
    ...actual,
    invokeLLM: vi.fn(async (params: Parameters<typeof actual.invokeLLM>[0]) => {
      const schema = params.outputSchema?.name ?? params.output_schema?.name ?? null;
      if (schema === "claire_brain_v2_perception") return structured({ turnKind: "unclear", endsConversation: false, disputesContent: false });
      if (schema === "daphne_conversation_ingestion") return structured({ kinds: [], dimension: "none" });
      if (schema === "claire_showrunner_turn")
        return structured({ speak: "Got it.", operatorIsDone: false, missionUpdates: [], developments: [], readinessNeeds: [], planEdits: [] });
      return structured({});
    }),
    invokeTextLLM: vi.fn(async (params: Parameters<typeof actual.invokeTextLLM>[0]) =>
      (params.maxTokens ?? params.max_tokens ?? 0) <= 16 ? "CLEAN" : "Got it."
    ),
  };
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;
const TENANT = "default";
const ZONE = "America/Los_Angeles";
const OPEN_ID = "prepared-delivery-operator";

describeMysql("prepared promises are consumed only on delivery (disposable MySQL)", () => {
  let sql: mysql.Connection;
  let identity: Awaited<ReturnType<typeof import("../../agents/persistentOperator/identity").resolveCanonicalOperatorIdentity>> extends infer R
    ? R extends { ok: true; identity: infer I } ? I : never
    : never;
  const now = new Date();
  const today = formatInTimeZone(now, ZONE, "yyyy-MM-dd");

  beforeAll(async () => {
    const parsed = new URL(DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error(`refusing non-local DATABASE_URL host ${parsed.hostname}`);
    Object.assign(process.env, {
      CLAIRE_BRAIN_V2_PRIMARY: "1",
      JWT_SECRET: process.env.JWT_SECRET || "prepared-delivery-test-secret",
      OWNER_OPEN_ID: OPEN_ID,
      CLAIRE_BRAIN_V2_OPERATOR_IDS: OPEN_ID,
      ANTHROPIC_API_KEY: "scripted-model-boundary",
    });
    sql = await mysql.createConnection(DATABASE_URL!);
    await sql.query(
      "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [TENANT, TENANT, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "delivery@example.invalid", ZONE]
    );
    await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [TENANT, OPEN_ID, "Delivery Operator", `${OPEN_ID}@example.invalid`]);
    await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [TENANT, OPEN_ID]);
    const { resolveCanonicalOperatorIdentity } = await import("../../agents/persistentOperator/identity");
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: TENANT, source: { type: "open_id", value: OPEN_ID }, subsystem: "prepared_delivery_test" });
    if (!resolved.ok) throw new Error("operator fixture did not resolve");
    identity = resolved.identity as never;
  });

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql.query("DELETE FROM claire_prepared_items WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, identity.canonicalOperatorId]);
  });

  const scope = () => ({ tenantId: TENANT, canonicalOperatorId: identity.canonicalOperatorId });

  /** Last night's promise, prepared for today by the production store. */
  async function preparePromise() {
    const { drizzlePreparedItemStore, PREPARED_PROPERTY_VISIT_CHOICE } = await import("../../agents/persistentOperator/preparedItems");
    return drizzlePreparedItemStore().upsert({
      ...scope(),
      kind: PREPARED_PROPERTY_VISIT_CHOICE,
      forBusinessDate: today,
      promiseText: "Tomorrow morning I'll have the open property visits ready so you can choose one.",
      payload: { targets: [{ name: "Wilshire Vermont", address: null }, { name: "The Chadwick", address: null }], remainingCount: 2, totalCount: 5 },
      sourceConversationKey: "prepared-delivery-evening",
    });
  }

  async function row(id: string) {
    const [rows] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT status, consumedConversationKey, consumedAt FROM claire_prepared_items WHERE id = ?",
      [id]
    );
    return rows[0] as { status: string; consumedConversationKey: string | null; consumedAt: Date | null } | undefined;
  }

  /** A scheduled call exactly as the dialer prepares it: the opening speaks the promise and records its id. */
  async function openCall(itemId: string | null) {
    const { buildShowrunnerBriefing, showrunnerOpening } = await import("./showrunnerBriefing");
    const briefing = await buildShowrunnerBriefing({ identity, purpose: "morning_readiness", timeZone: ZONE, now });
    const { openPreparedClaireConversationWithoutDialing } = await import("../claireTwilio");
    return openPreparedClaireConversationWithoutDialing({
      tenantId: TENANT,
      actorId: identity.communicationOperatorUserId,
      dayDirectorActorId: identity.dayDirectorActorId,
      timeZone: ZONE,
      openingOverride: showrunnerOpening(briefing),
      sessionKindOverride: "morning_readiness",
      showrunner: {
        purpose: "morning_readiness",
        tenantId: TENANT,
        canonicalOperatorId: identity.canonicalOperatorId,
        operatorUserId: identity.canonicalOpenId,
        dayDirectorActorId: identity.dayDirectorActorId,
        dayDirectorActorIds: identity.dayDirectorActorIds,
        timeZone: ZONE,
        businessDate: today,
        briefing,
        captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
        replan: null,
        turns: 0,
        clockOffsetMs: 0,
        preparedOffered: itemId ? { ids: [itemId], consumedAt: null } : null,
      },
    });
  }

  async function operatorSays(call: { conversationId: string; token: string }, utterance: string) {
    const { runRelayAuthoritativeTurn } = await import("../claireTwilio");
    return runRelayAuthoritativeTurn({ conversationId: call.conversationId, utterance, token: call.token });
  }

  it("the dialer records exactly the spoken item and the opening speaks it", async () => {
    const item = await preparePromise();
    const { buildShowrunnerBriefing, preparedItemSpoken, showrunnerOpening } = await import("./showrunnerBriefing");
    const briefing = await buildShowrunnerBriefing({ identity, purpose: "morning_readiness", timeZone: ZONE, now });
    // The live campaign is empty in this database, so the loader withholds it; the record still exists.
    const spoken = preparedItemSpoken({ preparedItems: [{ id: item.id, kind: "property_visit_choice", forBusinessDate: today, promiseText: item.promiseText, targets: item.payload.targets, remainingCount: 2 }] });
    expect(spoken?.id).toBe(item.id);
    expect(showrunnerOpening({ ...briefing, preparedItems: [spoken!] })).toMatch(/Last night I said I'd have the open property visits ready: Wilshire Vermont and The Chadwick\. Which one do you want first\?$/);
    expect((await row(item.id))?.status).toBe("prepared");
  });

  it("an unanswered or failed call leaves the promise prepared", async () => {
    const item = await preparePromise();
    await openCall(item.id); // dialed (no-answer, busy, failed): no operator turn ever arrives
    expect((await row(item.id))?.status).toBe("prepared");
    const { drizzlePreparedItemStore } = await import("../../agents/persistentOperator/preparedItems");
    expect((await drizzlePreparedItemStore().listDue(scope(), today)).map(r => r.id)).toContain(item.id);
  });

  it("a disconnect before anyone speaks (empty speech) leaves it prepared", async () => {
    const item = await preparePromise();
    const call = await openCall(item.id);
    await operatorSays(call, "");
    expect((await row(item.id))?.status).toBe("prepared");
  });

  it("voicemail leaves it prepared", async () => {
    const item = await preparePromise();
    const call = await openCall(item.id);
    const turn = await operatorSays(call, "You've reached Adam. Leave a message, and I'll call you right back.");
    expect(turn.endCall).toBe(true);
    await operatorSays(call, "If you're satisfied with the message, press 1.");
    expect((await row(item.id))?.status).toBe("prepared");
  });

  it("the operator speaking on the call consumes exactly that item, once, with this call as the receipt", async () => {
    const item = await preparePromise();
    const call = await openCall(item.id);
    await operatorSays(call, "Wilshire Vermont first.");
    const consumed = await row(item.id);
    expect(consumed?.status).toBe("consumed");
    expect(consumed?.consumedConversationKey).toBe(call.conversationId);
    const firstAt = consumed?.consumedAt?.getTime();

    // A duplicate webhook for the same speech, and a later turn on the same call: no second write.
    await operatorSays(call, "Wilshire Vermont first.");
    await operatorSays(call, "And then The Chadwick.");
    const again = await row(item.id);
    expect(again?.status).toBe("consumed");
    expect(again?.consumedConversationKey).toBe(call.conversationId);
    expect(again?.consumedAt?.getTime()).toBe(firstAt);
    const [count] = await sql.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM claire_prepared_items WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, identity.canonicalOperatorId]);
    expect(Number(count[0]!.n)).toBe(1);
  });

  it("a retried call keeps the promise until a call is delivered, and only that call consumes it", async () => {
    const item = await preparePromise();
    await openCall(item.id); // first attempt: no answer
    const voicemail = await openCall(item.id); // retry: voicemail
    await operatorSays(voicemail, "You've reached Adam. Leave a message, and I'll call you right back.");
    expect((await row(item.id))?.status).toBe("prepared");
    const answered = await openCall(item.id); // second retry: answered
    await operatorSays(answered, "Morning. The Chadwick.");
    expect((await row(item.id))?.consumedConversationKey).toBe(answered.conversationId);
    // A late retry after delivery: the store no longer offers it, and a stale offer writes nothing.
    const { drizzlePreparedItemStore } = await import("../../agents/persistentOperator/preparedItems");
    expect((await drizzlePreparedItemStore().listDue(scope(), today)).map(r => r.id)).not.toContain(item.id);
    const late = await openCall(item.id);
    await operatorSays(late, "Hello?");
    expect((await row(item.id))?.consumedConversationKey).toBe(answered.conversationId);
  });

  it("a call that offered no promise consumes nothing", async () => {
    const item = await preparePromise();
    const call = await openCall(null);
    await operatorSays(call, "Good morning.");
    expect((await row(item.id))?.status).toBe("prepared");
  });
}, 120_000);
