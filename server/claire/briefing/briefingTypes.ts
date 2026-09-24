/**
 * "Adam gave Claire a bundle of operational information."
 *
 * One spoken or typed turn can carry completed work, several new pieces of
 * work for different days with different timing, current-time context, and
 * business questions. Every item keeps the exact words it came from, so
 * nothing Claire adds can be anything Adam didn't say.
 */

export type BriefingTiming =
  | { kind: "none" }
  | { kind: "at"; start: string; label: string }
  | { kind: "window"; start: string; end: string; label: string }
  | { kind: "before"; end: string; label: string }
  | { kind: "after"; start: string; label: string }
  | { kind: "daypart"; label: string };

import type { ObjectiveExecutionType } from "../../../shared/objectiveExecution";

export type BriefingItemKind = "completed" | "new_work";

export type BriefingItem = {
  kind: BriefingItemKind;
  /** Adam's own words, lightly cleaned (lead-ins and timing phrases removed). */
  title: string;
  /** The exact span of the utterance this item came from. */
  quote: string;
  businessDate: string;
  timing: BriefingTiming;
  quantity: number | null;
  people: string[];
  place: string | null;
  /** A genuinely important missing detail, phrased as a question. Null when the item is actionable as said. */
  needs: string | null;
  /** Set when this item is already on the Day Line (never add it twice). */
  existing: {
    id: string;
    title: string;
    source: "day_line" | "campaign";
    executionType?: ObjectiveExecutionType | null;
  } | null;
  /** Explicit operator execution type. Absent means unspecified, not Mission. */
  executionType?: ObjectiveExecutionType | null;
};

export type ParsedBriefing = {
  items: BriefingItem[];
  /** Statements that inform Claire but are not work ("It's 9:30am on Tuesday September 15th"). */
  context: string[];
  /** Business questions asked inside the briefing, verbatim. */
  questions: string[];
  /** Fragments that were neither work, context, nor a question. */
  unparsed: string[];
  source: "model" | "deterministic";
};

export type BriefingClock = {
  now: Date;
  timeZone: string;
  /** Business-local YYYY-MM-DD. */
  today: string;
  /** Minutes since local midnight. */
  minutesNow: number;
};
