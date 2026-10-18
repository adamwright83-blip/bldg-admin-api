import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitBriefing } from "./briefingCommit";
import { validateModelBriefing } from "./llmBriefing";
import { briefingClock } from "./briefingTiming";
import { reviseBriefing } from "./reviseBriefing";
import { createDatabaseConversationStateStore, ConversationStateConflictError } from "../turn/conversationStateStore";
import type { ClaireTurnState } from "../turn/claireTurn";

// Deliberately refuse a production or shared developer database, even if DATABASE_URL is set.
const url = process.env.DATABASE_URL;
const enabled = process.env.CLAIRE_REPAIR_DB_TEST === "1";
const suite = enabled ? describe : describe.skip;
suite("Claire conversation and verified work on disposable MySQL", () => {
  let sql: mysql.Connection;
  const tenantId = `claire-repair-${randomUUID().slice(0, 8)}`;
  const owner = { tenantId, operatorUserId: "repair-operator", surface: "voice" as const };
  const scope = { tenantId, dayDirectorActorId: "1", operatorUserId: "repair-operator", conversationKey: `repair:${tenantId}` };
  const clock = briefingClock(new Date("2026-10-16T00:30:00Z"), "America/Los_Angeles");
  const quote = "Before I leave work, create the Laundry Farm landing page and Instagram ad. The ad says pickup tomorrow, twenty pounds free.";
  const parsed = () => validateModelBriefing({ items: [{ kind: "new_work", title: "Create Laundry Farm landing page and Instagram ad", quote,
    day: "today", date: "", timingWords: "", quantity: 0, people: [], place: "", needs: "", intent: "commitment", executionType: "challenge" }], context: [], questions: [] },
    { tenantId, utterance: "Add this as a marketing challenge today.", clock, vocabulary: [], recentTurns: [{ speaker: "operator", text: quote }] });

  beforeAll(async () => {
    if (!url || new URL(url).pathname !== "/claire_repair_test" || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
      throw new Error("Requires localhost disposable database named claire_repair_test");
    }
    sql = await mysql.createConnection(url);
  });
  afterAll(async () => { await sql?.end(); });

  it("loads accepted instructions and pending work from a fresh store instance, with optimistic concurrency", async () => {
    const first = createDatabaseConversationStateStore();
    const key = `${scope.conversationKey}:state`;
    const state: ClaireTurnState = { history: [{ speaker: "operator", text: quote, at: Date.now() },
      { speaker: "claire", text: "Shall I save the campaign?", delivery: "generated", at: Date.now() }],
      pendingBriefing: { parsed: parsed(), createdAt: Date.now() } };
    await first.save(key, owner, state, 60_000);
    const second = createDatabaseConversationStateStore();
    const loaded = await second.load<ClaireTurnState>(key);
    expect(loaded?.persistence).toBe("durable");
    expect(loaded?.state).toEqual(state);
    await second.compareAndSave!(key, owner, state, 60_000, loaded!.version, Date.now(), { requireDurable: true });
    await expect(first.compareAndSave!(key, owner, state, 60_000, loaded!.version, Date.now(), { requireDurable: true }))
      .rejects.toBeInstanceOf(ConversationStateConflictError);
    await second.remove(key);
  });

  it("writes and independently reads one today challenge containing both deliverables, then replays without duplication", async () => {
    const result = await commitBriefing(parsed(), scope);
    expect(result.failed).toEqual([]);
    expect(result.added).toHaveLength(1);
    const [rows] = await sql.execute<mysql.RowDataPacket[]>("SELECT * FROM day_director_commitments WHERE tenantId = ? AND actorId = ?", [tenantId, "1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessDate).toBe("2026-10-15");
    expect(rows[0].title).toMatch(/landing page.*Instagram ad/);
    expect(rows[0].sourceText).toBe(quote);
    const metadata = typeof rows[0].metadataJson === "string" ? JSON.parse(rows[0].metadataJson) : rows[0].metadataJson;
    expect(metadata.executionType).toBe("challenge");
    const replay = await commitBriefing(parsed(), scope);
    expect(replay.added).toHaveLength(0);
    expect(replay.alreadyPresent).toHaveLength(1);
    expect(replay.commitmentIds).toEqual(result.commitmentIds);
  });

  it("does not confirm a write when readback fails; retry finds the one real row", async () => {
    const failureScope = { ...scope, conversationKey: `${scope.conversationKey}:readback-failure` };
    const failed = await commitBriefing(parsed(), failureScope, { readCanonical: async () => null });
    expect(failed.added).toEqual([]);
    expect(failed.receipts).toEqual([]);
    expect(failed.failed).toHaveLength(1);
    const retry = await commitBriefing(parsed(), failureScope);
    expect(retry.failed).toEqual([]);
    expect(retry.alreadyPresent).toHaveLength(1);
    const [rows] = await sql.execute<mysql.RowDataPacket[]>("SELECT id FROM day_director_commitments WHERE tenantId = ?", [tenantId]);
    expect(rows).toHaveLength(2); // one per separate authorized conversation, never one per retry
  });

  it("persists 3 distinct rows for multi-item single-turn Day Line commit", async () => {
    const multiScope = { ...scope, conversationKey: `repair:multi:${tenantId}` };
    const multiBriefing = validateModelBriefing(
      {
        items: [
          { kind: "new_work", title: "Call Todd", quote: "Call Todd", day: "tomorrow", date: "2026-10-16", timingWords: "", quantity: 0, people: ["Todd"], place: "", needs: "", intent: "commitment", executionType: "call" },
          { kind: "new_work", title: "Pick up the dry cleaning", quote: "pick up the dry cleaning", day: "tomorrow", date: "2026-10-16", timingWords: "", quantity: 0, people: [], place: "", needs: "", intent: "commitment", executionType: "field" },
          { kind: "new_work", title: "Drop off the OPUS towels", quote: "drop off the OPUS towels", day: "tomorrow", date: "2026-10-16", timingWords: "", quantity: 0, people: [], place: "OPUS", needs: "", intent: "commitment", executionType: "field" },
        ],
        context: [],
        questions: [],
      },
      { tenantId, utterance: "Add call Todd, pick up the dry cleaning, and drop off the OPUS towels to the day line for tomorrow", clock, vocabulary: [] }
    );
    const result = await commitBriefing(multiBriefing, multiScope);
    expect(result.failed).toEqual([]);
    expect(result.added).toHaveLength(3);
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM day_director_commitments WHERE tenantId = ? AND businessDate = '2026-10-16' AND actorId = ?",
      [tenantId, "1"]
    );
    expect(rows).toHaveLength(3);
    const titles = rows.map(r => r.title);
    expect(titles.some(t => /Todd/i.test(t))).toBe(true);
    expect(titles.some(t => /dry cleaning/i.test(t))).toBe(true);
    expect(titles.some(t => /OPUS/i.test(t))).toBe(true);
  });

  it("handles content replacement revision and commits only the replaced item", async () => {
    const replaceScope = { ...scope, conversationKey: `repair:replace:${tenantId}` };
    const initialBriefing = validateModelBriefing(
      {
        items: [
          { kind: "new_work", title: "Pick up the laundry from Coast", quote: "picking up the laundry from Coast", day: "tomorrow", date: "2026-10-16", timingWords: "", quantity: 0, people: [], place: "Coast", needs: "", intent: "commitment", executionType: "field" },
        ],
        context: [],
        questions: [],
      },
      { tenantId, utterance: "Put picking up the laundry from Coast on the day line for tomorrow", clock, vocabulary: [] }
    );
    // reviseBriefing returns { parsed, changes }; the revised briefing is `parsed`.
    const revised = reviseBriefing(
      initialBriefing,
      "Actually change the Coast pickup to picking up the KITH TREATS aprons on Rodeo Drive",
      clock
    ).parsed;
    expect(revised.items).toHaveLength(1);
    expect(revised.items[0]!.title).toMatch(/KITH TREATS.*aprons/i);
    expect(revised.items[0]!.title).not.toMatch(/Coast/i);
    const result = await commitBriefing(revised, replaceScope);
    expect(result.failed).toEqual([]);
    expect(result.added).toHaveLength(1);
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM day_director_commitments WHERE tenantId = ? AND title LIKE '%KITH TREATS%'",
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    const [coastRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM day_director_commitments WHERE tenantId = ? AND title LIKE '%Coast%'",
      [tenantId]
    );
    expect(coastRows).toHaveLength(0);
  });
});
