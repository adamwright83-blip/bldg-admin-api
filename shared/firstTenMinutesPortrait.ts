/**
 * Claire's portrait (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slice 4): the crew's discoveries, given their language
 * on one page. Every line rests on findings the person hasn't corrected away, and cites them. The person can keep it
 * as it is ("That sounds like me") or put their own words in place of a line ("Let me change something"); their
 * words stand on the page in their own hand, and Claire's original stays visible, struck through.
 */

export const PORTRAIT_CONTROLS = {
  keep: "That sounds like me",
  change: "Let me change something",
} as const;

/** Astra's opening and closing lines, word for word. */
export function portraitGreeting(firstName: string | null): string {
  return firstName ? `${firstName}, here's where you are.` : "Here's where you are.";
}
export const PORTRAIT_CLOSING = "There's one I'd like to show you.";

export type PortraitLine = {
  /** stable within one portrait: "p1.s2", or "closing" */
  key: string;
  text: string;
  findingIds: string[];
  /** what the person put in its place: their words, or null when they took the line out; absent when untouched */
  changedTo?: string | null;
};

/**
 * writing: Claire is writing it. ready: written, not yet kept. kept: the person said it sounds like them.
 * unavailable: too little is known to write a page worth reading, so there isn't one. failed: the writing failed.
 */
export type PortraitStatus = "writing" | "ready" | "kept" | "unavailable" | "failed";

export type PortraitView = {
  status: PortraitStatus;
  greeting: string | null;
  paragraphs: PortraitLine[][];
  closing: PortraitLine | null;
};

/** Each line of the page, in order, with the closing line last. */
export function portraitLines(view: Pick<PortraitView, "paragraphs" | "closing">): PortraitLine[] {
  return [...view.paragraphs.flat(), ...(view.closing ? [view.closing] : [])];
}
