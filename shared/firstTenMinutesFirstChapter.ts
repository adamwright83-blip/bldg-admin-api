/**
 * "Your first chapter" (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slice 7): the person returns to their portrait and a
 * new entry has appeared. Claire answers "Where did we leave things with Elena?" from the records alone: what the
 * person did, their own words, and the real state of the message. "Tomorrow, we'll pick up from here."
 */
import { DRAFT_APPROACHES, lowerFirst, type ChapterOpportunity, type DraftView } from "./firstTenMinutesChapter";

export const FIRST_CHAPTER_TITLE = "Your first chapter";
export const TOMORROW = "Tomorrow, we'll pick up from here.";

/** Whether the recipient has written since the message went, read from the person's own mail when it can be. */
export type ReplyState = { kind: "none" } | { kind: "replied"; at: string; excerpt: string } | { kind: "unknown" };

export type FirstChapterView = {
  entry: string;
  question: string;
  /** Claire's last answer, kept: she remembers what she said */
  answer: { text: string; at: string } | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function who(opportunity: ChapterOpportunity): string {
  return opportunity.firstName ?? opportunity.person.name ?? opportunity.person.address;
}

/** "Elena's Friday request": the day they asked for, when they asked for one. */
function requestLabel(opportunity: ChapterOpportunity): string {
  const text = `${opportunity.request.quote} ${opportunity.request.wants}`;
  const day = WEEKDAYS.find(name => new RegExp(`\\b${name}s?\\b`, "i").test(text));
  return `${who(opportunity)}'s ${day ? `${day} ` : ""}request`;
}

/** "the weekly service", or the service by name. */
function serviceLabel(opportunity: ChapterOpportunity): string | null {
  if (!opportunity.service) return null;
  return /\bweekly\b/i.test(opportunity.service.name) ? "the weekly service" : `the ${lowerFirst(opportunity.service.name)}`;
}

/** Astra's entry, from the records: "You revisited Elena's Friday request and prepared a reply using the weekly service you now offer." */
export function firstChapterEntry(opportunity: ChapterOpportunity, draft: DraftView): string {
  if (draft.status === "declined") return `You revisited ${requestLabel(opportunity)} and decided the reply could wait.`;
  const service = serviceLabel(opportunity);
  return `You revisited ${requestLabel(opportunity)} and prepared a reply${service ? ` using ${service} you now offer` : ""}.`;
}

export function firstChapterQuestion(opportunity: ChapterOpportunity): string {
  return `Where did we leave things with ${who(opportunity)}?`;
}

/** A zone the person's browser gave, if it is one; times are said only in the person's own zone. */
export function knownTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function dayKey(at: Date, zone: string): string {
  return at.toLocaleDateString("en-CA", { timeZone: zone });
}

/** "at 7:42 PM", "yesterday at 7:42 PM", "on Oct 28 at 7:42 PM" — in the person's zone, or nothing without one. */
function when(iso: string | null, zone: string | null, now: Date): string {
  if (!iso || !zone) return "";
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).replace(/\u202f/g, " ");
  if (dayKey(at, zone) === dayKey(now, zone)) return ` at ${time}`;
  if (dayKey(at, zone) === dayKey(new Date(now.getTime() - 86_400_000), zone)) return ` yesterday at ${time}`;
  return ` on ${at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone })} at ${time}`;
}

/**
 * The first words of a reply, verbatim: past a greeting line, before any quoted history, about a sentence long.
 */
export function replyExcerpt(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // quoted history, a signature, or a forwarded message: the reply's own words are above it
    if (/^>/.test(line) || /^On .{4,120} wrote:$/i.test(line) || /^-{2,}\s*((Original Message|Forwarded).*)?$/i.test(line)) break;
    if (!line) {
      if (lines.length) break;
      continue;
    }
    if (!lines.length && /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[\w .'-]{0,30}[,!:]?$/i.test(line)) continue;
    lines.push(line);
  }
  const words = lines.join(" ");
  let excerpt = "";
  for (const sentence of words.split(/(?<=[.?!])\s+/)) {
    if (!sentence) continue;
    excerpt = excerpt ? `${excerpt} ${sentence}` : sentence;
    if (excerpt.length >= 40) break;
  }
  return excerpt.length > 160 ? `${excerpt.slice(0, 157).trimEnd()}…` : excerpt;
}

/**
 * Claire's answer: concise and exact. What the person did, the message as it stands (their own words, or the version
 * they chose), and only what is known of where it is now: she says it isn't in the Sent folder only when she looked.
 * Times are given in the person's zone, or not at all.
 */
export function claireAnswer(
  opportunity: ChapterOpportunity,
  draft: DraftView,
  reply: ReplyState,
  options: { timeZone: string | null; lookedInSent: boolean; now?: Date }
): string {
  const name = who(opportunity);
  const zone = knownTimeZone(options.timeZone);
  const now = options.now ?? new Date();
  const asked = zone ? new Date(opportunity.request.at).toLocaleDateString("en-US", { month: "long", timeZone: zone }) : null;
  const parts = [`You picked up ${requestLabel(opportunity)}${asked ? ` from ${asked}` : ""}.`];
  if (draft.edited) parts.push(`You put the reply in your own words: “${draft.body}”`);
  else if (draft.approach !== DRAFT_APPROACHES[0]) parts.push(`You chose ${draft.approach === "short" ? "the shorter reply" : "the reply offering to start"}: “${draft.body}”`);
  else parts.push(`You kept the reply as it was drafted: “${draft.body}”`);
  switch (draft.status) {
    case "prepared":
      parts.push("It's ready, and it hasn't been sent.");
      break;
    case "declined":
      parts.push("You decided it could wait. It hasn't been sent.");
      break;
    case "handed_off":
      parts.push(
        `You opened it in your Gmail${when(draft.handedOffAt, zone, now)}. ${
          options.lookedInSent
            ? "It isn't in your Sent folder, so as far as I can tell it hasn't gone yet."
            : "I couldn't look in your Sent folder just now, so I don't know yet whether it went."
        }`
      );
      break;
    case "reported_sent":
      parts.push(
        `You told me you sent it${when(draft.reportedSentAt, zone, now)}. ${
          options.lookedInSent ? "I haven't found it in your Sent folder." : "I couldn't look in your Sent folder just now."
        }`
      );
      break;
    case "verified_sent": {
      const sent = when(draft.verifiedSentAt, zone, now);
      parts.push(sent ? `It's in your Sent folder, sent${sent}.` : "It's in your Sent folder.");
      break;
    }
  }
  if (draft.status === "reported_sent" || draft.status === "verified_sent") {
    if (reply.kind === "none") parts.push(`${name} hasn't written back yet.`);
    if (reply.kind === "replied") parts.push(`${name} wrote back${when(reply.at, zone, now)}${reply.excerpt ? `: “${reply.excerpt}”` : "."}`);
  }
  return parts.join(" ");
}
