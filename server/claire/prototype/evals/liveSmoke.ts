/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only (disposable-database tenant tables); canonical product is JOYSTICK. */
/**
 * Live-path smoke test for the native-tool Claire: the production inbound-call open and the
 * production relay turn handler, a REAL model, a disposable MySQL, a Day Line write and a
 * read-back from the table. Everything a phone call runs except Twilio's audio.
 *
 * Spends credit from the key in ANTHROPIC_API_KEY (CI supplies the capped testing key).
 *
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3306/claire_eval pnpm tsx server/claire/prototype/evals/liveSmoke.ts
 *
 * Exit 0 only when: the call opened on the native-tool engine, the dictated row exists on the
 * day spoken, the pre-call row named in the singular was completed, nothing else on the line
 * changed, and the call ended on Claire's end_call.
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const TENANT = "default";
const ZONE = "America/Los_Angeles";
const OPERATOR = "adam-live-smoke";
const KEY_ROW = "Pick up the spare key from the Bergstroms";

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL (disposable MySQL) is required");
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("local DATABASE_URL only");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY (testing key) is required");
  Object.assign(process.env, {
    ALLOW_TEST_DB: "1",
    CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "owner",
    OWNER_OPEN_ID: OPERATOR,
    JWT_SECRET: process.env.JWT_SECRET || "live-smoke-jwt-secret-not-production",
  });
  delete process.env.CLAIRE_NATIVE_TOOL_KILL_SWITCH;

  const sql = await mysql.createConnection(databaseUrl);
  await sql.query(
    "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
    [TENANT, TENANT, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "smoke@example.invalid", ZONE]
  );
  await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [TENANT, OPERATOR, "Adam Wright", `${OPERATOR}@example.invalid`]);
  await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [TENANT, OPERATOR]);
  const { resolveCanonicalOperatorIdentity } = await import("../../../agents/persistentOperator/identity");
  const resolved = await resolveCanonicalOperatorIdentity({ tenantId: TENANT, source: { type: "open_id", value: OPERATOR }, subsystem: "claire_live_smoke" });
  if (!resolved.ok) throw new Error("operator identity did not resolve");
  const actorId = resolved.identity.dayDirectorActorId;
  const { businessDateToday, addDaysYmd } = await import("../spokenDate");
  const today = businessDateToday(new Date(), ZONE);
  const tomorrow = addDaysYmd(today, 1);
  await sql.query("DELETE FROM day_director_commitments WHERE tenantId = ? AND actorId = ?", [TENANT, actorId]);
  await sql.query("DELETE FROM claire_operator_instructions WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, resolved.identity.canonicalOperatorId]);
  const keyId = randomUUID();
  await sql.query(
    "INSERT INTO day_director_commitments (id,tenantId,actorId,businessDate,idempotencyKey,title,kind,provenance,status,sourceText,metadataJson) VALUES (?,?,?,?,?,?,'operations','manual','open',?,?)",
    [keyId, TENANT, actorId, tomorrow, `seed:${keyId}`, KEY_ROW, KEY_ROW, JSON.stringify({ detailState: "COMPLETE" })]
  );

  const { openAuthorizedInboundClaireConversation, runRelayAuthoritativeTurn, CLAIRE_INBOUND_GREETING } = await import("../../claireTwilio");
  const callSid = `CA${randomUUID().replace(/-/g, "").slice(0, 32)}`;
  const opened = await openAuthorizedInboundClaireConversation({ tenantId: TENANT, operatorUserId: OPERATOR, dayDirectorActorId: actorId, callSid });
  const transcript: string[] = [`CLAIRE: ${CLAIRE_INBOUND_GREETING}`];
  const failures: string[] = [];
  if (opened.engine !== "native_tool") failures.push(`engine at pickup was ${opened.engine}, expected native_tool`);

  let ended = false;
  const say = async (utterance: string) => {
    const started = Date.now();
    transcript.push(`OPERATOR: ${utterance}`);
    const result = await runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance, token: opened.token, callSid });
    transcript.push(`CLAIRE (${Date.now() - started} ms): ${result.speak}`);
    if (result.endCall) ended = true;
    return result;
  };

  await say("Hey Claire. Put the Okafor sprinkler valve on tomorrow, and Friday, call the flour rep about the short pallet.");
  await say("Right, the Bergstrom key. I did that this afternoon, mark it done.");
  await say("Read me tomorrow.");
  await say("That's all, thanks. Bye.");

  const [rows] = await sql.query<mysql.RowDataPacket[]>("SELECT id, title, businessDate, status FROM day_director_commitments WHERE tenantId = ? AND actorId = ? ORDER BY businessDate, createdAt", [TENANT, actorId]);
  const table = rows.map(row => ({ id: String(row.id), title: String(row.title), businessDate: String(row.businessDate).slice(0, 10), status: String(row.status) }));
  const okafor = table.filter(row => /okafor/i.test(row.title));
  const flour = table.filter(row => /flour/i.test(row.title));
  const key = table.find(row => row.id === keyId);
  if (okafor.length !== 1 || okafor[0]!.businessDate !== tomorrow || okafor[0]!.status !== "open") failures.push(`expected one open Okafor row on ${tomorrow}, found ${JSON.stringify(okafor)}`);
  if (flour.length !== 1) failures.push(`expected one flour-rep row, found ${JSON.stringify(flour)}`);
  if (!key || key.status !== "completed") failures.push(`expected the pre-call Bergstrom row completed, found ${JSON.stringify(key)}`);
  if (table.length !== 3) failures.push(`expected exactly three rows after the call, found ${table.length}`);
  if (!ended) failures.push("the call did not end on Claire's end_call");

  const [session] = await sql.query<mysql.RowDataPacket[]>("SELECT id FROM claire_conversation_sessions WHERE claireConversationId = ?", [opened.conversationId]);
  const [ledger] = session.length
    ? await sql.query<mysql.RowDataPacket[]>("SELECT speaker, text FROM claire_conversation_turns WHERE sessionId = ? ORDER BY ordinal", [session[0]!.id])
    : [[] as mysql.RowDataPacket[]];
  if (ledger.length < 9) failures.push(`expected the call ledger to hold the greeting and four exchanges, found ${ledger.length} turns`);

  console.log("=== LIVE SMOKE: transcript ===");
  for (const line of transcript) console.log(line);
  console.log("=== LIVE SMOKE: Day Line after the call (read back from day_director_commitments) ===");
  console.table(table);
  console.log(`=== LIVE SMOKE: ledger turns persisted: ${ledger.length} ===`);
  console.log(failures.length ? `=== LIVE SMOKE: FAIL ===\n- ${failures.join("\n- ")}` : "=== LIVE SMOKE: PASS ===");
  await sql.end();
  return failures.length ? 1 : 0;
}

main().then(
  code => process.exit(code),
  error => {
    console.error("=== LIVE SMOKE: ERROR ===", error);
    process.exit(1);
  }
);
