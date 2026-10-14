import { formatInTimeZone } from "date-fns-tz";

/**
 * Relative timing written into a task ("in 3 hours", "tomorrow") is only
 * meaningful against the moment it was written. It is never re-read relative to
 * a later planning run.
 */
const RELATIVE =
  /\b(?:in\s+(\d+|an?|one|two|three|four|five|six|ten|twenty|thirty)\s+(minute|min|hour|hr|day|week)s?|later today|this (?:afternoon|evening)|tonight|tomorrow(?: morning| afternoon| evening)?)\b/i;

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twenty: 20, thirty: 30 };
const UNIT_MS: Record<string, number> = { minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000, day: 86_400_000, week: 604_800_000 };

export type ResolvedInstruction = {
  text: string;
  relative: boolean;
  resolvedAt: Date | null;
  /** Relative timing whose reference moment is unknown. */
  unresolved: boolean;
};

export function resolveRelativeInstruction(input: {
  text: string;
  /** When the instruction was written. */
  referenceAt: Date | null;
  /** Explicit due time recorded with the instruction, when one exists. */
  dueAt?: Date | null;
  timeZone: string;
}): ResolvedInstruction {
  const match = RELATIVE.exec(input.text);
  if (!match) return { text: input.text, relative: false, resolvedAt: null, unresolved: false };
  let resolvedAt: Date | null = input.dueAt ?? null;
  if (!resolvedAt && input.referenceAt) {
    if (match[1] && match[2]) {
      const n = /^\d+$/.test(match[1]) ? Number(match[1]) : WORDS[match[1].toLowerCase()] ?? null;
      const unit = UNIT_MS[match[2].toLowerCase()];
      if (n != null && unit) resolvedAt = new Date(input.referenceAt.getTime() + n * unit);
    } else {
      // Day-relative phrases resolve to the referenced local day, not a clock time.
      const day = formatInTimeZone(input.referenceAt, input.timeZone, "yyyy-MM-dd");
      const tomorrow = /tomorrow/i.test(match[0]);
      const ref = new Date(`${day}T12:00:00Z`);
      resolvedAt = new Date(ref.getTime() + (tomorrow ? 86_400_000 : 0));
    }
  }
  if (!resolvedAt) {
    return { text: `${input.text} (timing unresolved)`, relative: true, resolvedAt: null, unresolved: true };
  }
  const label = formatInTimeZone(resolvedAt, input.timeZone, "MMM d, h:mm a");
  const cleaned = input.text.replace(match[0], "").replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  return { text: `${cleaned} (due ${label})`, relative: true, resolvedAt, unresolved: false };
}
