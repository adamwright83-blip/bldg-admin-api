import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runClaireTurn, type ClaireTurnState } from "../turn/claireTurn";
import { interpretClaireBrainV3 } from "../turn/brainV3";
import { extractBriefingWithModel } from "./llmBriefing";
import { runScheduledClaireTurn } from "../showrunner/scheduledConversation";
import type { ShowrunnerCallState } from "../showrunner/showrunnerTurn";
import type { ClaireTurnDeps, ClaireTurnInput } from "../turn/claireTurn";
import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { createDatabaseConversationStateStore } from "../turn/conversationStateStore";

const suite = process.env.CLAIRE_REPAIR_LIVE_MODEL === "1" ? describe : describe.skip;
suite("actual Claire models plus disposable MySQL (no telephone calls)", () => {
  let sql: mysql.Connection;
  const now = new Date("2026-10-16T00:30:00Z");
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || new URL(url).pathname !== "/claire_repair_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
      throw new Error("Live verification requires localhost disposable claire_repair_test database");
    }
    if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("BLOCKED: ANTHROPIC_API_KEY is required; a mock is not live-model verification");
    sql = await mysql.createConnection(url);
  });
  afterAll(async () => { await sql?.end(); });

  it.each(["ordinary", "morning_readiness", "evening_debrief"] as const)("%s: retains the day, distinguishes ad copy, saves only the requested campaign, and survives every reload", async mode => {
    const tenantId = `claire-live-${randomUUID().slice(0, 8)}`;
    const key = `claire-repair-live:${tenantId}`;
    const owner = { tenantId, operatorUserId: `repair-operator-${tenantId}`, surface: "voice" as const };
    await sql.execute("INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Repair acceptance", "Repair acceptance", "#123456", "Operator", "repair@example.invalid", "America/Los_Angeles"]);
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')",
      [tenantId, owner.operatorUserId, "Operator", "repair@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, owner.operatorUserId]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: owner.operatorUserId }, subsystem: "claire_repair_acceptance" });
    if (!resolved.ok) throw new Error("Disposable operator fixture could not resolve identity");
    const identity = resolved.identity;
    const initial: ClaireTurnState & { showrunner?: ShowrunnerCallState } = {};
    if (mode !== "ordinary") initial.showrunner = {
      purpose: mode, tenantId, canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: owner.operatorUserId,
      dayDirectorActorId: identity.dayDirectorActorId, dayDirectorActorIds: identity.dayDirectorActorIds, timeZone: "America/Los_Angeles", businessDate: "2026-10-15",
      turns: 0, replan: null, captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
      briefing: { purpose: mode, businessDate: "2026-10-15", weekday: "Thursday", objective: "Conversation repair acceptance",
        weekPlan: null, today: [], tomorrow: [], developments: [], pendingDecision: null, adaptations: [], uncertain: [],
        weekToDate: { reportedOutcomes: [], planChanges: [] } },
    };
    const transcript: Array<{ operator: string; claire: string }> = [];
    const turns = [
      "I have 3 dry cleaning orders. I need to see if those have been charged yet. If not, I need to charge them. I need to deliver 2 of them tonight.",
      "And 1 of them tomorrow morning.",
      "And before I leave work, I have to create a new page for our Laundry Farm landing page website.",
      "To align with the Instagram ad that I am creating also that says, skip laundry this week on us. We will pick up tomorrow, 20 pounds free. No charge today. Keep the monthly service only if you love it.",
      "The marketing challenge I'm doing, the website and the Instagram ad, needs to be added to the Day Line for today. Keep the orders separate; don't save those yet.",
    ];
    const send = async (utterance: string) => {
      // Fresh adapter instance each turn: success cannot depend on a process-local Map.
      const store = createDatabaseConversationStateStore();
      const previous = await store.load<typeof initial>(key);
      const state = previous?.state ?? initial;
      const input: ClaireTurnInput & { state: typeof initial } = { tenantId, operatorUserId: owner.operatorUserId, dayDirectorActorId: identity.dayDirectorActorId, surface: "voice",
        utterance, state, conversationKey: key, allowFragmentWait: false };
      const deps: Partial<ClaireTurnDeps> = {
        now: () => now, timeZone: () => "America/Los_Angeles",
        brainV3: async input => {
          const result = await interpretClaireBrainV3(input);
          console.info("CLAIRE_LIVE_INTERPRETATION", JSON.stringify({ mode, utterance: input.utterance, result }));
          return result;
        }, extractModel: async input => {
          const result = await extractBriefingWithModel(input);
          console.info("CLAIRE_LIVE_EXTRACTION", JSON.stringify({ mode, utterance: input.utterance, result }));
          return result;
        },
        // Empty isolated business fixture, not a substituted interpretation or write path.
        business: { plan: async () => null }, vocabulary: async () => [], accounts: async () => [], campaign: async () => null,
        searchMemory: async () => [], memoryBetween: async () => [], encyclopedia: null, watchBoard: undefined, doctrineTurn: undefined,
      };
      const result = mode === "ordinary" ? await runClaireTurn(input, deps)
        : await runScheduledClaireTurn(input, { turn: deps, showrunner: { now } });
      transcript.push({ operator: utterance, claire: result.speak });
      await store.save(key, owner, state, 600_000);
    };
    for (const utterance of turns) {
      await send(utterance);
      if (utterance !== turns.at(-1)) {
        const [rows] = await sql.execute<mysql.RowDataPacket[]>("SELECT id FROM day_director_commitments WHERE tenantId = ?", [tenantId]);
        expect(rows, JSON.stringify(transcript)).toHaveLength(0);
      }
    }
    const [rows] = await sql.execute<mysql.RowDataPacket[]>("SELECT * FROM day_director_commitments WHERE tenantId = ?", [tenantId]);
    expect(rows, JSON.stringify(transcript)).toHaveLength(1);
    expect(rows[0].businessDate).toBe("2026-10-15");
    const metadata = typeof rows[0].metadataJson === "string" ? JSON.parse(rows[0].metadataJson) : rows[0].metadataJson;
    expect(metadata.executionType).toBe("challenge");
    expect(`${rows[0].title} ${rows[0].sourceText}`).toMatch(/Instagram/i);
    expect(`${rows[0].title} ${rows[0].sourceText}`).toMatch(/page|website/i);
    expect(transcript.at(-1)?.claire).toMatch(/challenge/i);
    const restored = await createDatabaseConversationStateStore().load<ClaireTurnState>(key);
    expect(restored?.persistence).toBe("durable");
    expect(restored?.state.history?.filter(h => h.speaker === "operator")).toHaveLength(5);
    expect(JSON.stringify(restored?.state.heldBriefingItems)).toMatch(/dry cleaning/i);
    await send("Before you save the dry-cleaning work, change the one delivery tomorrow to tomorrow afternoon. Keep two deliveries tonight and charge only orders that have not already been charged. Show me the corrected plan; do not save it yet.");
    const [beforeApproval] = await sql.execute<mysql.RowDataPacket[]>("SELECT id FROM day_director_commitments WHERE tenantId = ?", [tenantId]);
    expect(beforeApproval, JSON.stringify(transcript)).toHaveLength(1);
    await send("Yes, save that corrected dry-cleaning work to the Day Line now.");
    const [afterApproval] = await sql.execute<mysql.RowDataPacket[]>("SELECT * FROM day_director_commitments WHERE tenantId = ?", [tenantId]);
    const orderRows = afterApproval.filter(r => r.id !== rows[0].id);
    expect(orderRows.length, JSON.stringify(transcript)).toBeGreaterThan(0);
    const words = (row: mysql.RowDataPacket) => `${row.title} ${row.sourceText}`;
    expect(orderRows.some(r => r.businessDate === "2026-10-15" && /deliver/i.test(words(r)) && /\b(?:2|two)\b/i.test(words(r))), JSON.stringify(orderRows)).toBe(true);
    expect(orderRows.some(r => r.businessDate === "2026-10-16" && /deliver/i.test(words(r)) && /afternoon/i.test(words(r))), JSON.stringify(orderRows)).toBe(true);
    expect(orderRows.some(r => /charg/i.test(words(r)) && /only|if|not already|unpaid/i.test(words(r))), JSON.stringify(orderRows)).toBe(true);
    expect(orderRows.every(r => !/Instagram|landing page|20 pounds/i.test(words(r)))).toBe(true);
    console.info("CLAIRE_LIVE_REPLAY", JSON.stringify({ mode, transcript, rows: rows.map(r => ({ id: r.id, title: r.title, date: r.businessDate, metadata: r.metadataJson })) }));
  }, 300_000);
});
