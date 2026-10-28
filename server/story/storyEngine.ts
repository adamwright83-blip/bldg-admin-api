import type { StoryCondition, StoryResolvedLine, StorySlot } from "../../shared/story";

/**
 * Pure rules for a story season. No database, no clock, no I/O: the service passes everything in.
 *
 * One chapter per business-local calendar night. Chapter n+1 opens on the first local date after chapter n was won.
 * Losing changes nothing. Answers are final.
 */

export type StoryProgressState = {
  highestChapterWon: number;
  /** YYYY-MM-DD, business-local, the night the highest chapter was won */
  lastWonOn: string | null;
  /** YYYY-MM-DD, business-local, the last night a chapter was started */
  lastPlayedOn: string | null;
};

export const EMPTY_PROGRESS: StoryProgressState = { highestChapterWon: 0, lastWonOn: null, lastPlayedOn: null };

export type ChapterAvailability =
  | { state: "available"; chapterNumber: number }
  | { state: "won_tonight"; chapterNumber: number }
  | { state: "season_complete"; chapterNumber: null };

/** Business-local calendar date of an instant, as YYYY-MM-DD. */
export function localDateOf(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function chapterAvailability(progress: StoryProgressState, chapterCount: number, today: string): ChapterAvailability {
  const won = Math.max(0, progress.highestChapterWon);
  if (won === 0) return { state: "available", chapterNumber: 1 };
  const wonOn = progress.lastWonOn;
  // A win with no date cannot be placed in time; treat it as an earlier night rather than lock the season forever.
  const nightsSinceWin = wonOn ? daysBetween(wonOn, today) : 1;
  if (nightsSinceWin <= 0) {
    // Won tonight (or the clock went backwards): tonight's chapter is done, the next waits for tomorrow.
    return { state: "won_tonight", chapterNumber: won };
  }
  if (won >= chapterCount) return { state: "season_complete", chapterNumber: null };
  return { state: "available", chapterNumber: won + 1 };
}

/** Only the next chapter, on a night it is open, may be started. Replaying a won chapter is not allowed (yet). */
export function canStart(progress: StoryProgressState, chapterCount: number, today: string, chapterNumber: number): boolean {
  const availability = chapterAvailability(progress, chapterCount, today);
  return availability.state === "available" && availability.chapterNumber === chapterNumber;
}

/** The progress after an outcome. Only a win on an open chapter moves anything. Re-sending a win is a no-op. */
export function progressAfter(
  progress: StoryProgressState,
  chapterCount: number,
  today: string,
  chapterNumber: number,
  outcome: "win" | "lose" | "quit"
): { progress: StoryProgressState; advanced: boolean } {
  if (outcome !== "win") return { progress, advanced: false };
  if (!canStart(progress, chapterCount, today, chapterNumber)) return { progress, advanced: false };
  return { progress: { ...progress, highestChapterWon: chapterNumber, lastWonOn: today }, advanced: true };
}

/** Nights since the operator last started a chapter. 0 on the first night and on a night they already played. */
export function daysAway(progress: StoryProgressState, today: string): number {
  if (!progress.lastPlayedOn) return 0;
  return Math.max(0, daysBetween(progress.lastPlayedOn, today));
}

export type StoryLineRow = {
  slot: StorySlot;
  lineKey: string;
  variantKey: string;
  sortOrder: number;
  condition: StoryCondition | null;
  text: string;
  stillId: string | null;
};

export type ResolutionContext = { answers: Readonly<Record<string, string>>; daysAway: number };

export function conditionHolds(condition: StoryCondition | null, context: ResolutionContext): boolean {
  if (!condition) return true;
  if (condition.minDaysAway !== undefined && context.daysAway < condition.minDaysAway) return false;
  for (const [question, option] of Object.entries(condition.answers ?? {})) {
    if (context.answers[question] !== option) return false;
  }
  return true;
}

function specificity(condition: StoryCondition | null): number {
  if (!condition) return 0;
  return Object.keys(condition.answers ?? {}).length + (condition.minDaysAway !== undefined ? 1 : 0);
}

/**
 * The lines of one slot as this operator should see them: for each line key, the most specific variant whose condition
 * holds (ties go to the earliest variant key alphabetically, so the choice is stable). Keys with no matching variant
 * are dropped. Variants that did not win never leave the server.
 */
export function resolveSlot(rows: readonly StoryLineRow[], slot: StorySlot, context: ResolutionContext): StoryResolvedLine[] {
  const best = new Map<string, StoryLineRow>();
  for (const row of rows) {
    if (row.slot !== slot || !conditionHolds(row.condition, context)) continue;
    const current = best.get(row.lineKey);
    if (
      !current ||
      specificity(row.condition) > specificity(current.condition) ||
      (specificity(row.condition) === specificity(current.condition) && row.variantKey < current.variantKey)
    ) {
      best.set(row.lineKey, row);
    }
  }
  return Array.from(best.values())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.lineKey.localeCompare(b.lineKey))
    .map(row => ({ key: row.lineKey, text: row.text, still: row.stillId }));
}

/** Answering: the option must exist; the same answer again is accepted (a retry); a different answer is refused. */
export function answerDecision(
  optionKeys: readonly string[],
  existing: string | null,
  chosen: string
): { ok: true; write: boolean } | { ok: false; reason: "unknown_option" | "already_answered" } {
  if (!optionKeys.includes(chosen)) return { ok: false, reason: "unknown_option" };
  if (existing === null) return { ok: true, write: true };
  if (existing === chosen) return { ok: true, write: false };
  return { ok: false, reason: "already_answered" };
}
