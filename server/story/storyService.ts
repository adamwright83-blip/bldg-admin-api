import type { StoryOutcome, StoryQuestion, StoryResolvedLine, StoryTonight } from "../../shared/story";
import {
  answerDecision,
  chapterAvailability,
  canStart,
  daysAway as daysAwayOf,
  localDateOf,
  progressAfter,
  resolveSlot,
  type ResolutionContext,
  type StoryLineRow,
} from "./storyEngine";
import type { StoryChapterRow, StoryScope, StorySeasonRow, StoryStore } from "./storyStore";

/**
 * Story season orchestration. Everything it can touch is passed in, so it is tested without a database. It reads and
 * writes story state only. It cannot send, schedule, or change anything about the business.
 */

export type StoryAccessReason = "not_enabled" | "no_season" | "chapter_locked" | "unknown_question" | "question_locked" | "unknown_option" | "already_answered";

export class StoryAccessError extends Error {
  constructor(public readonly reason: StoryAccessReason) {
    super(`story: ${reason}`);
  }
}

export type StoryServiceDeps = {
  store: StoryStore;
  now: () => Date;
  timeZone: () => string;
  isEnabled: (tenantId: string) => boolean;
  seasonSlug: () => string | null;
};

export type StoryWho = { tenantId: string; operatorId: string };

type Loaded = {
  season: StorySeasonRow;
  scope: StoryScope;
  chapters: StoryChapterRow[];
  today: string;
};

export function createStoryService(deps: StoryServiceDeps) {
  async function load(who: StoryWho): Promise<Loaded> {
    if (!deps.isEnabled(who.tenantId)) throw new StoryAccessError("not_enabled");
    const slug = deps.seasonSlug();
    if (!slug) throw new StoryAccessError("not_enabled");
    const season = await deps.store.findSeasonBySlug(slug);
    if (!season) throw new StoryAccessError("no_season");
    const chapters = await deps.store.listChapters(season.id);
    if (chapters.length === 0) throw new StoryAccessError("no_season");
    return {
      season,
      chapters,
      scope: { tenantId: who.tenantId, operatorId: who.operatorId, seasonId: season.id },
      today: localDateOf(deps.now(), deps.timeZone()),
    };
  }

  const chapterByNumber = (chapters: StoryChapterRow[], n: number) => chapters.find(c => c.number === n) ?? null;

  async function linesFor(chapter: StoryChapterRow): Promise<StoryLineRow[]> {
    return (await deps.store.listLines([chapter.id])).get(chapter.id) ?? [];
  }

  function questionFor(chapter: StoryChapterRow, rows: StoryLineRow[], context: ResolutionContext): StoryQuestion | undefined {
    if (!chapter.questionKey) return undefined;
    const [text] = resolveSlot(rows, "question", context);
    const options = resolveSlot(rows, "option", context).map(o => ({ key: o.key, text: o.text }));
    if (!text || options.length < 2) return undefined;
    return { key: chapter.questionKey, text: text.text, options, answered: context.answers[chapter.questionKey] ?? null };
  }

  return {
    async tonight(who: StoryWho): Promise<StoryTonight> {
      let loaded: Loaded;
      try {
        loaded = await load(who);
      } catch (error) {
        if (error instanceof StoryAccessError) return { enabled: false };
        throw error;
      }
      const { season, chapters, scope, today } = loaded;
      const progress = await deps.store.readProgress(scope);
      const availability = chapterAvailability(progress, chapters.length, today);
      const away = daysAwayOf(progress, today);
      const base = { enabled: true as const, seasonTitle: season.title, chapterCount: chapters.length, daysAway: away };
      if (availability.state === "season_complete") return { ...base, state: "season_complete", chapter: null };
      const chapter = chapterByNumber(chapters, availability.chapterNumber);
      if (!chapter) return { ...base, state: "season_complete", chapter: null };
      const rows = await linesFor(chapter);
      const answers = await deps.store.listAnswers(scope);
      const context = { answers, daysAway: away };
      const view: NonNullable<Extract<StoryTonight, { enabled: true }>["chapter"]> = {
        number: chapter.number,
        title: chapter.title,
        gameKey: chapter.gameKey,
        before: resolveSlot(rows, "before", context),
      };
      if (availability.state === "won_tonight") {
        view.after = resolveSlot(rows, "after", context);
        view.question = questionFor(chapter, rows, context);
      }
      return { ...base, state: availability.state, chapter: view };
    },

    async start(who: StoryWho, chapterNumber: number): Promise<{ chapterNumber: number; gameKey: string; config: Record<string, unknown> }> {
      const { chapters, scope, today } = await load(who);
      const progress = await deps.store.readProgress(scope);
      if (!canStart(progress, chapters.length, today, chapterNumber)) throw new StoryAccessError("chapter_locked");
      const chapter = chapterByNumber(chapters, chapterNumber);
      if (!chapter) throw new StoryAccessError("chapter_locked");
      if (progress.lastPlayedOn !== today) await deps.store.writeProgress(scope, { ...progress, lastPlayedOn: today });
      return { chapterNumber, gameKey: chapter.gameKey, config: chapter.config ?? {} };
    },

    async finish(
      who: StoryWho,
      input: { chapterNumber: number; outcome: StoryOutcome; durationMs?: number | null }
    ): Promise<{ advanced: boolean; after: StoryResolvedLine[] | null; question: StoryQuestion | null }> {
      const { chapters, scope, today } = await load(who);
      const progress = await deps.store.readProgress(scope);
      const chapter = chapterByNumber(chapters, input.chapterNumber);
      if (!chapter) throw new StoryAccessError("chapter_locked");
      const open = canStart(progress, chapters.length, today, input.chapterNumber);
      const wonTonightAlready = progress.highestChapterWon === input.chapterNumber && progress.lastWonOn === today;
      if (!open && !wonTonightAlready) throw new StoryAccessError("chapter_locked");

      let advanced = false;
      if (open) {
        await deps.store.recordAttempt(scope, { chapterNumber: input.chapterNumber, outcome: input.outcome, durationMs: input.durationMs ?? null, localDate: today });
        const next = progressAfter(progress, chapters.length, today, input.chapterNumber, input.outcome);
        if (next.advanced) {
          await deps.store.writeProgress(scope, next.progress);
          advanced = true;
        }
      }
      // A retried win after the first one landed returns the same ending and question; it records and advances nothing.
      if (!advanced && !(wonTonightAlready && input.outcome === "win")) return { advanced: false, after: null, question: null };
      const rows = await linesFor(chapter);
      const context = { answers: await deps.store.listAnswers(scope), daysAway: daysAwayOf(progress, today) };
      return { advanced, after: resolveSlot(rows, "after", context), question: questionFor(chapter, rows, context) ?? null };
    },

    async answer(who: StoryWho, input: { questionKey: string; optionKey: string }): Promise<{ answered: string }> {
      const { chapters, scope } = await load(who);
      const chapter = chapters.find(c => c.questionKey === input.questionKey);
      if (!chapter) throw new StoryAccessError("unknown_question");
      const progress = await deps.store.readProgress(scope);
      if (progress.highestChapterWon < chapter.number) throw new StoryAccessError("question_locked");
      const rows = await linesFor(chapter);
      const optionKeys = Array.from(new Set(rows.filter(r => r.slot === "option").map(r => r.lineKey)));
      const answers = await deps.store.listAnswers(scope);
      const decision = answerDecision(optionKeys, answers[input.questionKey] ?? null, input.optionKey);
      if (!decision.ok) throw new StoryAccessError(decision.reason);
      if (decision.write) {
        const inserted = await deps.store.insertAnswer(scope, input.questionKey, input.optionKey);
        if (!inserted) {
          // Lost a race with another request for the same question: the stored answer stands.
          const stored = (await deps.store.listAnswers(scope))[input.questionKey];
          if (stored !== input.optionKey) throw new StoryAccessError("already_answered");
        }
      }
      return { answered: input.optionKey };
    },
  };
}

export type StoryService = ReturnType<typeof createStoryService>;
