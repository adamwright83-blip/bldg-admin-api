/**
 * hidden_game.lost_property: unlock eligibility, pure rules.
 *
 * The game READS this. It never writes a business fact and nothing here
 * produces one. A chapter opens because the Day Line was finished on a real
 * business day, as recorded by the systems that own those completions.
 *
 * Fail closed: anything not positively recorded as complete counts as not
 * complete, and a day with nothing required is not a finished day.
 */
import type { CurrentDayLine } from "./currentDayLine";

/** Chapters that exist. Chapter 4 is the "?" tag and is never unlockable here. */
export const HIDDEN_GAME_PLAYABLE_CHAPTERS = 3 as const;

export type ItemCompletion = "complete" | "incomplete" | "unknown";

export type NextUnlockRequirement =
  | "finish_today"
  | "come_back_tomorrow"
  | "all_unlocked";

export type HiddenGameEligibility = {
  /** Monotonic, 0..HIDDEN_GAME_PLAYABLE_CHAPTERS. */
  unlockedChapters: number;
  todayComplete: boolean;
  todayRequiredTotal: number;
  todayRequiredComplete: number;
  nextUnlockRequirement: NextUnlockRequirement;
};

export type DayCompletion = {
  todayComplete: boolean;
  todayRequiredTotal: number;
  todayRequiredComplete: number;
  /** Ids that were counted as required, in Day Line order. */
  requiredIds: string[];
};

/**
 * Required work for the day: every ranked item, plus the operator's
 * designated item when it is not already ranked. Items count only while
 * Mission Director's ranking is actually "ranked"; an unavailable or empty
 * line requires nothing and therefore completes nothing.
 */
export function requiredDayLineItemIds(
  line: Pick<CurrentDayLine, "rankingStatus" | "items" | "designated">
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (line.rankingStatus === "ranked") {
    for (const item of line.items) add(item.id);
  }
  add(line.designated?.id);
  return ids;
}

export function evaluateDayCompletion(
  line: Pick<CurrentDayLine, "rankingStatus" | "items" | "designated">,
  completion: ReadonlyMap<string, ItemCompletion>
): DayCompletion {
  const requiredIds = requiredDayLineItemIds(line);
  const done = requiredIds.filter(id => completion.get(id) === "complete").length;
  return {
    todayComplete: requiredIds.length > 0 && done === requiredIds.length,
    todayRequiredTotal: requiredIds.length,
    todayRequiredComplete: done,
    requiredIds,
  };
}

export type UnlockRecord = { chapter: number; unlockedOnLocalDate: string };

/**
 * The chapter that today's completion should add, or null. Chapter n opens on
 * the n-th distinct local day that was finished. At most one chapter per day;
 * never past the last playable chapter; never twice for the same day.
 */
export function chapterToUnlock(input: {
  existing: readonly UnlockRecord[];
  localDate: string;
  todayComplete: boolean;
}): number | null {
  if (!input.todayComplete) return null;
  if (input.existing.some(row => row.unlockedOnLocalDate === input.localDate)) return null;
  const highest = input.existing.reduce((max, row) => Math.max(max, row.chapter), 0);
  if (highest >= HIDDEN_GAME_PLAYABLE_CHAPTERS) return null;
  return highest + 1;
}

export function projectEligibility(input: {
  unlockedChapters: number;
  completion: Pick<
    DayCompletion,
    "todayComplete" | "todayRequiredTotal" | "todayRequiredComplete"
  >;
}): HiddenGameEligibility {
  const unlocked = Math.max(
    0,
    Math.min(HIDDEN_GAME_PLAYABLE_CHAPTERS, Math.floor(input.unlockedChapters))
  );
  const nextUnlockRequirement: NextUnlockRequirement =
    unlocked >= HIDDEN_GAME_PLAYABLE_CHAPTERS
      ? "all_unlocked"
      : input.completion.todayComplete
        ? "come_back_tomorrow"
        : "finish_today";
  return {
    unlockedChapters: unlocked,
    todayComplete: input.completion.todayComplete,
    todayRequiredTotal: input.completion.todayRequiredTotal,
    todayRequiredComplete: input.completion.todayRequiredComplete,
    nextUnlockRequirement,
  };
}
