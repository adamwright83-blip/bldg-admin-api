import { and, asc, eq, inArray } from "drizzle-orm";
import { storyAnswers, storyAttempts, storyChapters, storyLines, storyProgress, storySeasons } from "../../drizzle/schema";
import { getDb } from "../db";
import { storyConditionSchema, type StoryCondition, type StoryOutcome, type StorySeasonInput, type StorySlot } from "../../shared/story";
import { EMPTY_PROGRESS, type StoryLineRow, type StoryProgressState } from "./storyEngine";

/**
 * Database access for story seasons. Reads and writes only the six story_* tables (drizzle/0150). This file must not
 * import anything that can reach a customer, an order, a message, or an integration: see storyIsolation.test.ts.
 */

export type StoryScope = { tenantId: string; operatorId: string; seasonId: number };
export type StorySeasonRow = { id: number; slug: string; title: string; status: string };
export type StoryChapterRow = {
  id: number;
  number: number;
  gameKey: string;
  title: string;
  questionKey: string | null;
  config: Record<string, unknown> | null;
};

export interface StoryStore {
  findSeasonBySlug(slug: string): Promise<StorySeasonRow | null>;
  listChapters(seasonId: number): Promise<StoryChapterRow[]>;
  listLines(chapterIds: readonly number[]): Promise<Map<number, StoryLineRow[]>>;
  readProgress(scope: StoryScope): Promise<StoryProgressState>;
  writeProgress(scope: StoryScope, progress: StoryProgressState): Promise<void>;
  listAnswers(scope: StoryScope): Promise<Record<string, string>>;
  /** false when an answer to that question already exists (the unique key held) */
  insertAnswer(scope: StoryScope, questionKey: string, optionKey: string): Promise<boolean>;
  recordAttempt(scope: StoryScope, attempt: { chapterNumber: number; outcome: StoryOutcome; durationMs: number | null; localDate: string }): Promise<void>;
}

export class StoryStoreUnavailableError extends Error {
  constructor() {
    super("Story storage is unavailable");
  }
}

async function db() {
  const handle = await getDb();
  if (!handle) throw new StoryStoreUnavailableError();
  return handle;
}

function parseCondition(raw: unknown): StoryCondition | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  const parsed = storyConditionSchema.safeParse(value);
  // A malformed condition must never widen access: treat it as a condition no one meets.
  return parsed.success ? parsed.data : { minDaysAway: 365 };
}

function parseConfig(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const scopeWhere = <T extends { tenantId: any; operatorId: any; seasonId: any }>(table: T, scope: StoryScope) =>
  and(eq(table.tenantId, scope.tenantId), eq(table.operatorId, scope.operatorId), eq(table.seasonId, scope.seasonId));

export const drizzleStoryStore: StoryStore = {
  async findSeasonBySlug(slug) {
    const [row] = await (await db())
      .select({ id: storySeasons.id, slug: storySeasons.slug, title: storySeasons.title, status: storySeasons.status })
      .from(storySeasons)
      .where(eq(storySeasons.slug, slug))
      .limit(1);
    return row ?? null;
  },

  async listChapters(seasonId) {
    const rows = await (await db())
      .select()
      .from(storyChapters)
      .where(eq(storyChapters.seasonId, seasonId))
      .orderBy(asc(storyChapters.chapterNumber));
    return rows.map(r => ({
      id: r.id,
      number: r.chapterNumber,
      gameKey: r.gameKey,
      title: r.title,
      questionKey: r.questionKey ?? null,
      config: parseConfig(r.configJson),
    }));
  },

  async listLines(chapterIds) {
    const out = new Map<number, StoryLineRow[]>();
    if (chapterIds.length === 0) return out;
    const rows = await (await db()).select().from(storyLines).where(inArray(storyLines.chapterId, [...chapterIds]));
    for (const r of rows) {
      const list = out.get(r.chapterId) ?? [];
      list.push({
        slot: r.slot as StorySlot,
        lineKey: r.lineKey,
        variantKey: r.variantKey,
        sortOrder: r.sortOrder,
        condition: parseCondition(r.conditionJson),
        text: r.text,
        stillId: r.stillId ?? null,
      });
      out.set(r.chapterId, list);
    }
    return out;
  },

  async readProgress(scope) {
    const [row] = await (await db()).select().from(storyProgress).where(scopeWhere(storyProgress, scope)).limit(1);
    if (!row) return EMPTY_PROGRESS;
    return { highestChapterWon: row.highestChapterWon, lastWonOn: row.lastWonOn ?? null, lastPlayedOn: row.lastPlayedOn ?? null };
  },

  async writeProgress(scope, progress) {
    await (await db())
      .insert(storyProgress)
      .values({ ...scope, highestChapterWon: progress.highestChapterWon, lastWonOn: progress.lastWonOn, lastPlayedOn: progress.lastPlayedOn })
      .onDuplicateKeyUpdate({
        set: { highestChapterWon: progress.highestChapterWon, lastWonOn: progress.lastWonOn, lastPlayedOn: progress.lastPlayedOn },
      });
  },

  async listAnswers(scope) {
    const rows = await (await db())
      .select({ questionKey: storyAnswers.questionKey, optionKey: storyAnswers.optionKey })
      .from(storyAnswers)
      .where(scopeWhere(storyAnswers, scope));
    return Object.fromEntries(rows.map(r => [r.questionKey, r.optionKey]));
  },

  async insertAnswer(scope, questionKey, optionKey) {
    try {
      await (await db()).insert(storyAnswers).values({ ...scope, questionKey, optionKey });
      return true;
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
      if (code === "ER_DUP_ENTRY") return false;
      throw error;
    }
  },

  async recordAttempt(scope, attempt) {
    await (await db()).insert(storyAttempts).values({ ...scope, ...attempt });
  },
};

/**
 * Load a validated season into the database. Upserts the season and its chapters and replaces each chapter's lines.
 * Used by scripts/story/seed-season.ts. Never logs text.
 */
export async function seedStorySeason(season: StorySeasonInput): Promise<{ seasonId: number; chapters: number; lines: number }> {
  const handle = await db();
  return handle.transaction(async tx => {
    await tx
      .insert(storySeasons)
      .values({ slug: season.slug, title: season.title })
      .onDuplicateKeyUpdate({ set: { title: season.title } });
    const [seasonRow] = await tx.select({ id: storySeasons.id }).from(storySeasons).where(eq(storySeasons.slug, season.slug)).limit(1);
    if (!seasonRow) throw new Error("season row missing after upsert");
    let lines = 0;
    for (const chapter of season.chapters) {
      await tx
        .insert(storyChapters)
        .values({
          seasonId: seasonRow.id,
          chapterNumber: chapter.number,
          gameKey: chapter.gameKey,
          title: chapter.title,
          questionKey: chapter.questionKey ?? null,
          configJson: chapter.config ?? null,
        })
        .onDuplicateKeyUpdate({
          set: { gameKey: chapter.gameKey, title: chapter.title, questionKey: chapter.questionKey ?? null, configJson: chapter.config ?? null },
        });
      const [chapterRow] = await tx
        .select({ id: storyChapters.id })
        .from(storyChapters)
        .where(and(eq(storyChapters.seasonId, seasonRow.id), eq(storyChapters.chapterNumber, chapter.number)))
        .limit(1);
      if (!chapterRow) throw new Error("chapter row missing after upsert");
      await tx.delete(storyLines).where(eq(storyLines.chapterId, chapterRow.id));
      await tx.insert(storyLines).values(
        chapter.lines.map(line => ({
          chapterId: chapterRow.id,
          slot: line.slot,
          lineKey: line.key,
          variantKey: line.variant,
          sortOrder: line.order,
          conditionJson: line.when ?? null,
          text: line.text,
          stillId: line.still ?? null,
        }))
      );
      lines += chapter.lines.length;
    }
    // A shorter re-seed must not leave orphaned chapters reachable.
    const keep = season.chapters.map(c => c.number);
    const stale = (await tx.select({ id: storyChapters.id, n: storyChapters.chapterNumber }).from(storyChapters).where(eq(storyChapters.seasonId, seasonRow.id))).filter(r => !keep.includes(r.n));
    if (stale.length > 0) {
      const ids = stale.map(r => r.id);
      await tx.delete(storyLines).where(inArray(storyLines.chapterId, ids));
      await tx.delete(storyChapters).where(inArray(storyChapters.id, ids));
    }
    return { seasonId: seasonRow.id, chapters: season.chapters.length, lines };
  });
}
