/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only (disposable-database tenant tables); canonical product is JOYSTICK. */
/**
 * The native-tool Claire on the real phone processing path, against a disposable MySQL.
 *
 * Phone: openAuthorizedInboundClaireConversation → runRelayAuthoritativeTurn → the native-tool
 * engine, the real prototype tools, the real Day Director table, the real call ledger. The ONLY
 * substitution is the model boundary: a scripted client answers each round. Brain V2 and legacy
 * Claire are mocked to throw, so any turn reaching them fails the test.
 *
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3306/claire_eval pnpm vitest run --config vitest.integration.config.ts server/claire/prototype/voiceEngine.mysql.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;
const TENANT = "default";
const OPERATOR = "adam-native-voice-test";
const OTHER_OPERATOR = "teammate-native-voice-test";
const ZONE = "America/Los_Angeles";
const KEY_ROW = "Pick up the spare key from the Bergstroms";

type ScriptedResponse =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: Record<string, unknown>; text?: string }
  | { kind: "throw"; message: string };

const script: ScriptedResponse[] = [];
const seen: Array<{ system: string; messages: unknown[] }> = [];

const scriptedClient = {
  messages: {
    create: vi.fn(async (request: { system: string; messages: unknown[] }) => {
      seen.push({ system: request.system, messages: [...request.messages] });
      const next = script.shift();
      if (!next) throw new Error("scripted model: no response left for this round");
      if (next.kind === "throw") throw new Error(next.message);
      const content: unknown[] = [];
      if (next.kind === "tool") {
        if (next.text) content.push({ type: "text", text: next.text });
        content.push({ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name: next.name, input: next.input });
      } else {
        content.push({ type: "text", text: next.text });
      }
      return { content, stop_reason: next.kind === "tool" ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 20 } };
    }),
  },
};

vi.mock("./claireToolLoop", async importOriginal => {
  const actual = await importOriginal<typeof import("./claireToolLoop")>();
  return { ...actual, anthropicClient: () => scriptedClient };
});

vi.mock("../brain/live/primaryTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("../brain/live/primaryTurn")>();
  return {
    ...actual,
    runClaireV2PrimaryTurn: vi.fn(async () => {
      throw new Error("Brain V2 answered a native-tool call");
    }),
  };
});

vi.mock("../turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("../turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: vi.fn(async () => {
      throw new Error("legacy Claire answered a native-tool call");
    }),
  };
});

describeMysql("native-tool Claire on the phone path (disposable MySQL, scripted model)", () => {
  let sql: mysql.Connection;
  let actorId: string;
  let tomorrow: string;

  beforeAll(async () => {
    const parsed = new URL(DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("local DATABASE_URL only");
    Object.assign(process.env, {
      ALLOW_TEST_DB: "1",
      CLAIRE_BRAIN_V2_PRIMARY: "1",
      CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "owner",
      OWNER_OPEN_ID: OPERATOR,
      JWT_SECRET: process.env.JWT_SECRET || "native-voice-test-jwt-secret-not-production",
      ANTHROPIC_API_KEY: "scripted-model-boundary",
    });
    delete process.env.CLAIRE_NATIVE_TOOL_KILL_SWITCH;
    sql = await mysql.createConnection(DATABASE_URL!);
    await sql.query(
      "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [TENANT, TENANT, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "voice@example.invalid", ZONE]
    );
    for (const openId of [OPERATOR, OTHER_OPERATOR]) {
      await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [TENANT, openId, openId === OPERATOR ? "Adam Wright" : "Teammate", `${openId}@example.invalid`]);
      await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [TENANT, openId]);
    }
    const { resolveCanonicalOperatorIdentity } = await import("../../agents/persistentOperator/identity");
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: TENANT, source: { type: "open_id", value: OPERATOR }, subsystem: "claire_native_voice_test" });
    if (!resolved.ok) throw new Error("operator identity did not resolve");
    actorId = resolved.identity.dayDirectorActorId;
    const { businessDateToday, addDaysYmd } = await import("./spokenDate");
    tomorrow = addDaysYmd(businessDateToday(new Date(), ZONE), 1);
    await sql.query("DELETE FROM day_director_commitments WHERE tenantId = ? AND actorId = ?", [TENANT, actorId]);
    await sql.query("DELETE FROM claire_operator_instructions WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, resolved.identity.canonicalOperatorId]);
  });

  afterAll(async () => {
    await sql?.end();
  });

  const rowsTomorrow = async () =>
    (await sql.query<mysql.RowDataPacket[]>("SELECT id, title, status, metadataJson FROM day_director_commitments WHERE tenantId = ? AND actorId = ? AND businessDate = ? ORDER BY createdAt", [TENANT, actorId, tomorrow]))[0];

  it("an operator outside the switch opens on Brain V2; the owner opens on the native-tool engine", async () => {
    const { openAuthorizedInboundClaireConversation } = await import("../claireTwilio");
    const { resolveCanonicalOperatorIdentity } = await import("../../agents/persistentOperator/identity");
    const other = await resolveCanonicalOperatorIdentity({ tenantId: TENANT, source: { type: "open_id", value: OTHER_OPERATOR }, subsystem: "claire_native_voice_test" });
    if (!other.ok) throw new Error("teammate identity did not resolve");
    const v2 = await openAuthorizedInboundClaireConversation({ tenantId: TENANT, operatorUserId: OTHER_OPERATOR, dayDirectorActorId: other.identity.dayDirectorActorId, callSid: `CA${randomUUID().replace(/-/g, "").slice(0, 32)}` });
    expect(v2.engine).toBe("brain_v2");
    const { claireConversationStateStore } = await import("../turn/conversationStateStore");
    const v2State = await claireConversationStateStore().load<{ nativeTool?: unknown }>(`claire-call:${v2.conversationId}`);
    expect(v2State?.state.nativeTool ?? null).toBeNull();

    process.env.CLAIRE_NATIVE_TOOL_KILL_SWITCH = "1";
    const killed = await openAuthorizedInboundClaireConversation({ tenantId: TENANT, operatorUserId: OPERATOR, dayDirectorActorId: actorId, callSid: `CA${randomUUID().replace(/-/g, "").slice(0, 32)}` });
    expect(killed.engine).toBe("brain_v2");
    delete process.env.CLAIRE_NATIVE_TOOL_KILL_SWITCH;
  }, 60_000);

  it("writes dictated work, completes a pre-call row named in the singular, speaks a model failure as a failure, and ends the call on the same engine", async () => {
    // A row that predates the call: changed only on a named instruction.
    const keyId = randomUUID();
    await sql.query(
      "INSERT INTO day_director_commitments (id,tenantId,actorId,businessDate,idempotencyKey,title,kind,provenance,status,sourceText,metadataJson) VALUES (?,?,?,?,?,?,'operations','manual','open',?,?)",
      [keyId, TENANT, actorId, tomorrow, `seed:${keyId}`, KEY_ROW, KEY_ROW, JSON.stringify({ detailState: "COMPLETE" })]
    );

    const { openAuthorizedInboundClaireConversation, runRelayAuthoritativeTurn, CLAIRE_INBOUND_GREETING } = await import("../claireTwilio");
    const { claireConversationStateStore } = await import("../turn/conversationStateStore");
    const { NATIVE_TOOL_FAILURE_LINE } = await import("./voiceEngine");
    const callSid = `CA${randomUUID().replace(/-/g, "").slice(0, 32)}`;
    const opened = await openAuthorizedInboundClaireConversation({ tenantId: TENANT, operatorUserId: OPERATOR, dayDirectorActorId: actorId, callSid });
    expect(opened.engine).toBe("native_tool");
    const say = (utterance: string) => runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance, token: opened.token, callSid });
    const state = async () => (await claireConversationStateStore().load<{ nativeTool: { messages: unknown[]; turnsFailed: number; prepared: { operatorName: string; businessName: string } | null } | null; turns: number }>(`claire-call:${opened.conversationId}`))!.state;

    // Turn 1: dictation. The model writes through the real tool, then speaks.
    const dictation = "Put the Okafor sprinkler valve on tomorrow.";
    script.push(
      { kind: "tool", name: "apply_day_line_changes", input: { changes: [{ op: "add", title: "Okafor sprinkler valve", day: "tomorrow" }], operator_words: "Put the Okafor sprinkler valve on tomorrow" } },
      { kind: "text", text: "Done. The Okafor sprinkler valve is on tomorrow." }
    );
    const first = await say(dictation);
    expect(first.speak).toBe("Done. The Okafor sprinkler valve is on tomorrow.");
    expect(first.endCall).toBe(false);
    const afterFirst = await rowsTomorrow();
    expect(afterFirst.map(row => String(row.title)).sort()).toEqual([KEY_ROW, "Okafor sprinkler valve"].sort());
    expect(afterFirst.find(row => row.id === keyId)!.status).toBe("open");
    // The engine was prepared on the first turn with the real operator and business names.
    const s1 = await state();
    expect(s1.nativeTool?.prepared).toMatchObject({ operatorName: "Adam", businessName: "Laundry Farm" });
    expect(seen[0]!.system).toContain("chief of staff to Adam, who runs Laundry Farm");
    // The tool result is in the thread the model sees on the next round.
    expect(JSON.stringify(seen[1]!.messages)).toContain("applied");
    expect(s1.turns).toBe(1);

    // Turn 2: a pre-call row, named in the singular against a plural title (sealed run 27's failure).
    const done = "Right, the Bergstrom key. I did that this afternoon, mark it done.";
    script.push(
      { kind: "tool", name: "apply_day_line_changes", input: { changes: [{ op: "complete", title: "Bergstrom key", day: "tomorrow" }], operator_words: done } },
      { kind: "text", text: "Marked done, the Bergstrom key." }
    );
    const second = await say(done);
    expect(second.speak).toBe("Marked done, the Bergstrom key.");
    const afterSecond = await rowsTomorrow();
    expect(afterSecond.find(row => row.id === keyId)!.status).toBe("completed");

    // Turn 3: a forged quote is refused at the tool boundary even though the model asked for it.
    script.push(
      { kind: "tool", name: "apply_day_line_changes", input: { changes: [{ op: "remove", title: "Okafor sprinkler valve", day: "tomorrow" }], operator_words: "take the Okafor valve off tomorrow" } },
      { kind: "text", text: "I couldn't do that one; say it again?" }
    );
    const forged = await say("How's tomorrow looking?");
    expect(forged.speak).toBe("I couldn't do that one; say it again?");
    expect((await rowsTomorrow()).map(row => String(row.title)).sort()).toEqual([KEY_ROW, "Okafor sprinkler valve"].sort());
    expect(JSON.stringify(seen.at(-1)!.messages)).toContain("refused");

    // Turn 4: the model fails. Spoken as a failure, the thread is restored, the call stays on this engine.
    const before = await state();
    const messagesBefore = before.nativeTool!.messages.length;
    script.push({ kind: "throw", message: "upstream 529 overloaded" });
    const failed = await say("And the water bill sometime.");
    expect(failed.speak).toBe(NATIVE_TOOL_FAILURE_LINE);
    expect(failed.endCall).toBe(false);
    const afterFail = await state();
    expect(afterFail.nativeTool!.messages.length).toBe(messagesBefore);
    expect(afterFail.nativeTool!.turnsFailed).toBe(1);
    expect(afterFail.turns).toBe(4);

    // Turn 5: goodbye on the same engine.
    // As on a real call: end_call's result goes back to the model, which closes with no new text.
    script.push({ kind: "tool", name: "end_call", input: {}, text: "Bye, Adam." }, { kind: "text", text: "" });
    const bye = await say("That's all, bye.");
    expect(bye.endCall).toBe(true);
    expect(bye.speak).toBe("Bye, Adam.");
    expect(script).toHaveLength(0);

    // The call ledger holds the greeting and every turn, Claire's with the engine marked.
    const [session] = await sql.query<mysql.RowDataPacket[]>("SELECT id FROM claire_conversation_sessions WHERE claireConversationId = ?", [opened.conversationId]);
    expect(session).toHaveLength(1);
    const [turns] = await sql.query<mysql.RowDataPacket[]>("SELECT speaker, text, providerMetadataJson FROM claire_conversation_turns WHERE sessionId = ? ORDER BY ordinal", [session[0]!.id]);
    const spoken = turns.map(row => `${row.speaker}: ${row.text}`);
    expect(spoken[0]).toBe(`CLAIRE: ${CLAIRE_INBOUND_GREETING}`);
    expect(spoken).toContain(`OPERATOR: ${dictation}`);
    expect(spoken).toContain("CLAIRE: Done. The Okafor sprinkler valve is on tomorrow.");
    expect(spoken).toContain(`CLAIRE: ${NATIVE_TOOL_FAILURE_LINE}`);
    expect(spoken.at(-1)).toBe("CLAIRE: Bye, Adam.");
    const claireMeta = turns.filter(row => row.speaker === "CLAIRE" && row.providerMetadataJson).map(row => (typeof row.providerMetadataJson === "string" ? JSON.parse(row.providerMetadataJson) : row.providerMetadataJson) as { engine?: string; tools?: Array<{ name: string }> });
    expect(claireMeta.every(meta => meta.engine === "native_tool")).toBe(true);
    expect(claireMeta[0]!.tools?.map(tool => tool.name)).toEqual(["apply_day_line_changes"]);
  }, 60_000);

  it("a scheduled evening call: the model writes the opening from a goal read before dialing, the operator's answer continues that thread, and a mailbox never reaches the model", async () => {
    const { openNativeToolScheduledConversationWithoutDialing, runRelayAuthoritativeTurn } = await import("../claireTwilio");
    const { claireConversationStateStore } = await import("../turn/conversationStateStore");
    const opening = "Evening, Adam. I don't have a goal on record for you yet. How did today go?";
    script.push({ kind: "tool", name: "read_goal_progress", input: {} }, { kind: "text", text: opening });
    const seenBefore = seen.length;
    const opened = await openNativeToolScheduledConversationWithoutDialing({ tenantId: TENANT, actorId: OPERATOR, dayDirectorActorId: actorId, timeZone: ZONE, purpose: "evening_debrief" });
    expect(opened.brief).toBe(opening);
    // The model was told why it placed this call, and its goal read came back before it spoke.
    expect(seen[seenBefore]!.system).toContain("scheduled evening wrap");
    expect(JSON.stringify(seen[seenBefore + 1]!.messages)).toContain("no_goal");
    type Saved = { nativeTool: { operatorTurns: string[]; messages: Array<{ role: string }> } | null; sessionKind?: string; showrunner?: unknown };
    const saved = (await claireConversationStateStore().load<Saved>(`claire-call:${opened.conversationId}`))!.state;
    expect(saved.sessionKind).toBe("evening_debrief");
    expect(saved.showrunner ?? null).toBeNull();
    // The call-start notice is not the operator's words.
    expect(saved.nativeTool!.operatorTurns).toEqual([]);
    expect(saved.nativeTool!.messages.at(-1)!.role).toBe("assistant");

    // The operator answers; the native engine continues the same thread (no Brain V2: mocked to throw).
    const callSid = `CA${randomUUID().replace(/-/g, "").slice(0, 32)}`;
    script.push({ kind: "text", text: "Good. What's the one thing you want done first tomorrow?" });
    const reply = await runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance: "Pretty good, I finished the landing page.", token: opened.token, callSid });
    expect(reply.speak).toBe("Good. What's the one thing you want done first tomorrow?");
    const thread = JSON.stringify(seen.at(-1)!.messages);
    expect(thread.indexOf(opening)).toBeGreaterThan(-1);
    expect(thread.indexOf(opening)).toBeLessThan(thread.indexOf("Pretty good, I finished the landing page."));

    // The ledger holds the model's opening as turn 0.
    const [session] = await sql.query<mysql.RowDataPacket[]>("SELECT id, conversationKind FROM claire_conversation_sessions WHERE claireConversationId = ?", [opened.conversationId]);
    expect(session[0]!.conversationKind).toBe("evening_debrief");
    const [turns] = await sql.query<mysql.RowDataPacket[]>("SELECT speaker, text FROM claire_conversation_turns WHERE sessionId = ? ORDER BY ordinal", [session[0]!.id]);
    expect(String(turns[0]!.text)).toContain(opening);

    // A second scheduled call reaches a mailbox: the voicemail line is spoken and the model is never asked.
    script.push({ kind: "text", text: "Evening, Adam. How did today go?" });
    const mailbox = await openNativeToolScheduledConversationWithoutDialing({ tenantId: TENANT, actorId: OPERATOR, dayDirectorActorId: actorId, timeZone: ZONE, purpose: "evening_debrief" });
    const callsBefore = seen.length;
    const voicemail = await runRelayAuthoritativeTurn({
      conversationId: mailbox.conversationId,
      utterance: "The person you are trying to reach is not available. At the tone, please record your message.",
      token: mailbox.token,
      callSid: `CA${randomUUID().replace(/-/g, "").slice(0, 32)}`,
    });
    expect(voicemail.endCall).toBe(true);
    expect(seen.length).toBe(callsBefore);
    expect(script).toHaveLength(0);
  }, 60_000);
});
