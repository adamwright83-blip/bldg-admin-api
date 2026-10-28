import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storySeasonSchema } from "../../shared/story";
import { resetDbForTesting } from "../db";
import { createStoryService } from "./storyService";
import { drizzleStoryStore, seedStorySeason } from "./storyStore";

/**
 * Story tables against a real, disposable MySQL. Runs only when DATABASE_URL points at a local database named
 * story_test, so it can never touch a shared or production database.
 *
 *   DATABASE_URL=mysql://root:root@127.0.0.1:3407/story_test pnpm exec vitest run --config vitest.integration.config.ts server/story
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const u = new URL(url);
    return ["localhost", "127.0.0.1"].includes(u.hostname) && u.pathname === "/story_test";
  } catch {
    return false;
  }
})();

const STORY_TABLES = ["story_answers", "story_attempts", "story_chapters", "story_lines", "story_progress", "story_seasons"];

async function statements(file: string) {
  const sql = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
  return sql.replace(/^\s*--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
}

describe.skipIf(!allowed)("story tables on real MySQL", () => {
  let conn: mysql.Connection;
  const tables = async () => ((await conn.query("SHOW TABLES"))[0] as Record<string, string>[]).map(r => Object.values(r)[0]!).sort();

  beforeAll(async () => {
    conn = await mysql.createConnection(url);
    // A table that is not ours, with a row in it, to prove the migration and its rollback leave it alone.
    await conn.query("CREATE TABLE IF NOT EXISTS story_neighbour_probe (id int PRIMARY KEY, note varchar(32))");
    await conn.query("REPLACE INTO story_neighbour_probe VALUES (1, 'untouched')");
    for (const s of await statements("0150_story_tables.rollback.sql")) await conn.query(s);
    for (const s of await statements("0150_story_tables.sql")) await conn.query(s);
    resetDbForTesting();
  });

  afterAll(async () => {
    await conn?.end();
  });

  it("the migration is additive and can run twice", async () => {
    for (const s of await statements("0150_story_tables.sql")) await conn.query(s);
    const all = await tables();
    for (const t of STORY_TABLES) expect(all).toContain(t);
    const [rows] = await conn.query("SELECT note FROM story_neighbour_probe WHERE id = 1");
    expect(rows).toEqual([{ note: "untouched" }]);
  });

  it("seeds Season 0, and re-seeding replaces rather than duplicates", async () => {
    const season = storySeasonSchema.parse(JSON.parse(await readFile(new URL("./fixtures/season-0.json", import.meta.url), "utf8")));
    const first = await seedStorySeason(season);
    const second = await seedStorySeason(season);
    expect(second).toEqual(first);
    const [[count]] = (await conn.query("SELECT COUNT(*) AS n FROM story_lines")) as unknown as [[{ n: number }]];
    expect(Number(count.n)).toBe(first.lines);
    const shorter = { ...season, chapters: season.chapters.slice(0, 2) };
    await seedStorySeason(shorter);
    const [[chapters]] = (await conn.query("SELECT COUNT(*) AS n FROM story_chapters")) as unknown as [[{ n: number }]];
    expect(Number(chapters.n)).toBe(2);
    await seedStorySeason(season);
  });

  it("plays a season end to end and persists progress, attempts and answers", async () => {
    let now = new Date("2026-10-27T19:00:00Z");
    const service = createStoryService({
      store: drizzleStoryStore,
      now: () => now,
      timeZone: () => "America/Los_Angeles",
      isEnabled: () => true,
      seasonSlug: () => "season-0",
    });
    const who = { tenantId: "story-proof", operatorId: `op-${Date.now()}` };

    expect(await service.tonight(who)).toMatchObject({ state: "available", chapter: { number: 1 } });
    await service.start(who, 1);
    await service.finish(who, { chapterNumber: 1, outcome: "lose" });
    const won = await service.finish(who, { chapterNumber: 1, outcome: "win", durationMs: 1000 });
    expect(won.advanced).toBe(true);
    const retried = await service.finish(who, { chapterNumber: 1, outcome: "win" });
    expect(retried.advanced).toBe(false);
    await service.answer(who, { questionKey: "s0.first", optionKey: "left" });
    await service.answer(who, { questionKey: "s0.first", optionKey: "left" });
    await expect(service.answer(who, { questionKey: "s0.first", optionKey: "right" })).rejects.toThrow("already_answered");

    // a fresh service (as after a deploy) sees the same state
    now = new Date(now.getTime() + 86_400_000);
    const tonight = await service.tonight(who);
    expect(tonight).toMatchObject({ state: "available", chapter: { number: 2 } });
    expect(JSON.stringify(tonight)).toContain("chose left");
    expect(JSON.stringify(tonight)).not.toContain("chose right");

    const [attempts] = await conn.query("SELECT outcome FROM story_attempts WHERE operator_id = ? ORDER BY id", [who.operatorId]);
    expect(attempts).toEqual([{ outcome: "lose" }, { outcome: "win" }]);
    const [answers] = await conn.query("SELECT question_key, option_key FROM story_answers WHERE operator_id = ?", [who.operatorId]);
    expect(answers).toEqual([{ question_key: "s0.first", option_key: "left" }]);
  });

  it("the rollback drops exactly the six story tables and nothing else", async () => {
    const before = await tables();
    for (const s of await statements("0150_story_tables.rollback.sql")) await conn.query(s);
    const after = await tables();
    expect(before.filter(t => !after.includes(t)).sort()).toEqual(STORY_TABLES);
    const [rows] = await conn.query("SELECT note FROM story_neighbour_probe WHERE id = 1");
    expect(rows).toEqual([{ note: "untouched" }]);
    for (const s of await statements("0150_story_tables.sql")) await conn.query(s);
    await conn.query("DROP TABLE story_neighbour_probe");
  });
});
