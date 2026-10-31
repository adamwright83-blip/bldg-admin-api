/** The stock line under a won chapter, for a season that still has a chapter to come. */
export const NEXT_CHAPTER_TOMORROW_LINE = "The next chapter opens tomorrow night.";

/**
 * The line about tomorrow under a won chapter. An authored `closing.tomorrow` is shown as written. Without one, the
 * stock line appears only when the season has a next chapter: after the final chapter nothing is promised.
 */
export function tomorrowLine(authored: string | null | undefined, chapterNumber: number, chapterCount: number): string | null {
  return authored ?? (chapterNumber < chapterCount ? NEXT_CHAPTER_TOMORROW_LINE : null);
}
