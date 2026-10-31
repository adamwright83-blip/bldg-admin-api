/**
 * What follows a kept portrait. Keeping Claire's page always leads somewhere visible:
 * - the chapter itself, when the crew found a conversation worth picking up;
 * - an honest note when it didn't (nothing is made up to fill the space);
 * - a "still opening" line while the chapter is on its way;
 * - a way to try again when it couldn't be read.
 *
 * Before this gate, the chapter opened only when an opportunity came back. A kept page with none, or a chapter read
 * that failed, left the person on their sealed page with nothing to do next.
 */
export type ChapterGate =
  /** no kept page yet, or the person is back on their page for "Your first chapter" */
  | "closed"
  /** kept just now: the seal lands before anything else */
  | "sealing"
  | "loading"
  | "error"
  /** kept, read, and there is no conversation to pick up */
  | "no_opportunity"
  | "open";

export type ChapterGateInput = {
  portraitKept: boolean;
  /** the seal's moment has passed (or the page was kept before this visit) */
  chapterOpen: boolean;
  onFirstChapter: boolean;
  /** what the chapter read returned, if it has returned */
  data: { opportunity: unknown } | null | undefined;
  isError: boolean;
};

export function chapterGate({ portraitKept, chapterOpen, onFirstChapter, data, isError }: ChapterGateInput): ChapterGate {
  if (!portraitKept || onFirstChapter) return "closed";
  if (!chapterOpen) return "sealing";
  // a chapter already read stays usable even if a later refetch fails
  if (data) return data.opportunity ? "open" : "no_opportunity";
  if (isError) return "error";
  return "loading";
}
