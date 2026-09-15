import { dayMention, parseTiming, spokenDay } from "./briefingTiming";
import type { BriefingClock, ParsedBriefing } from "./briefingTypes";

/**
 * Changes to a list Claire is holding, said the way people say them:
 * "drop Coast", "make KITH before 11", "move the Century Park delivery to
 * Thursday". Only an unambiguous target is changed; anything else is left
 * for the ordinary understanding path (which adds new work).
 */

const GENERIC = new Set([
  "the", "and", "for", "from", "with", "pickup", "pick", "deliver", "delivery", "drop", "off", "make", "that", "this",
  "today", "tomorrow", "before", "after", "noon", "back", "orders", "order", "move", "change", "put", "set", "take",
]);

function distinctive(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/'s\b/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 3 && !GENERIC.has(token))
    )
  );
}

export function reviseBriefing(
  parsed: ParsedBriefing,
  utterance: string,
  clock: BriefingClock
): { parsed: ParsedBriefing; changes: string[] } {
  const lower = utterance.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length;
  let items = parsed.items.map(item => ({ ...item }));
  const changes: string[] = [];
  const mentioned = (text: string) => items.filter(item => distinctive(`${item.title} ${item.people.join(" ")} ${item.place ?? ""}`).some(token => new RegExp(`\\b${token}\\b`).test(text)));

  const removal = /\b(?:drop|skip|remove|take off|leave off|forget(?: about)?|scratch|without|except|don'?t add|no need for|not)\s+(?:the\s+)?([^,.;]+)/i.exec(utterance);
  if (removal) {
    const targets = mentioned(removal[1]!.toLowerCase());
    if (targets.length === 1) {
      items = items.filter(item => item !== targets[0]);
      changes.push(`Took "${targets[0]!.title}" off the list.`);
    }
  }

  const isChange = /^(?:no|actually|make|move|change|push|set|put|switch|sorry|i mean|but)\b/i.test(lower.trim()) || words <= 6;
  if (!removal && isChange) {
    const targets = mentioned(lower);
    if (targets.length === 1) {
      const target = targets[0]!;
      const day = dayMention(utterance, clock.today);
      if (day && day.ymd !== target.businessDate) {
        target.businessDate = day.ymd;
        changes.push(`Moved "${target.title}" to ${spokenDay(day.ymd, clock.today)}.`);
      }
      const timing = parseTiming(utterance, { isToday: target.businessDate === clock.today, minutesNow: clock.minutesNow }).timing;
      if (timing.kind !== "none") {
        target.timing = timing;
        changes.push(`"${target.title}" is now ${timing.label}.`);
      }
    }
  }
  return { parsed: { ...parsed, items }, changes };
}
