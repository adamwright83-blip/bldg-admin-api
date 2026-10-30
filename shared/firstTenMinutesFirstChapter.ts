/**
 * "Your first chapter" (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slice 7): the person returns to their portrait and a
 * new entry has appeared. Claire answers "Where did we leave things with Elena?" through her engine
 * (server/claire/prototype), from what she reads here: what the person did, their own words, and the real state of the
 * message. "Tomorrow, we'll pick up from here."
 */
import { lowerFirst, type ChapterOpportunity, type DraftView } from "./firstTenMinutesChapter";

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

// ------------------------------------------------------------------ what Claire reads, and what she may say

/** Where the message is, in words that can't be misread. */
export type MessageState = "ready_not_sent" | "kept_for_later" | "opened_in_their_mail" | "they_said_they_sent_it" | "in_their_sent_folder";

/**
 * What Claire reads before she answers: the records as they are now. Words are verbatim; times are already in the
 * person's zone, or absent when the zone isn't known.
 */
export type FirstChapterFacts = {
  question: string;
  recipient: { name: string | null; firstName: string | null; address: string };
  request: { label: string; words: string; askedIn: string | null };
  /** the person's reply back then, in their words */
  replyThen: string | null;
  /** what the person offers now, by its name on record */
  offerNow: string | null;
  message: {
    to: string;
    subject: string;
    words: string;
    version: "as_drafted" | "the_shorter_one" | "the_one_offering_to_start" | "their_own_words";
    state: MessageState;
    openedInTheirMail: string | null;
    theySaidSent: string | null;
    inSentFolderSince: string | null;
  };
  /** whether the Sent folder was looked at just now, and what it showed */
  sentFolder: "found_it" | "looked_just_now_not_there" | "could_not_look" | "not_relevant";
  /** read from the person's own mail, only once the message is out */
  recipientWroteBack: { answer: "yes"; when: string | null; words: string } | { answer: "no" } | { answer: "not_known" };
};

export function firstChapterFacts(
  opportunity: ChapterOpportunity,
  draft: DraftView,
  reply: ReplyState,
  options: { timeZone: string | null; lookedInSent: boolean; now?: Date }
): FirstChapterFacts {
  const zone = knownTimeZone(options.timeZone);
  const now = options.now ?? new Date();
  const at = (iso: string | null) => when(iso, zone, now).trim() || null;
  const out = draft.status === "reported_sent" || draft.status === "verified_sent";
  const pending = draft.status === "handed_off" || draft.status === "reported_sent";
  const state: MessageState =
    draft.status === "prepared"
      ? "ready_not_sent"
      : draft.status === "declined"
        ? "kept_for_later"
        : draft.status === "handed_off"
          ? "opened_in_their_mail"
          : draft.status === "reported_sent"
            ? "they_said_they_sent_it"
            : "in_their_sent_folder";
  return {
    question: firstChapterQuestion(opportunity),
    recipient: { name: opportunity.person.name, firstName: opportunity.firstName, address: opportunity.person.address },
    request: {
      label: requestLabel(opportunity),
      words: opportunity.request.quote,
      askedIn: zone ? new Date(opportunity.request.at).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: zone }) : null,
    },
    replyThen: opportunity.reply?.quote ?? null,
    offerNow: opportunity.service?.name ?? null,
    message: {
      to: draft.to.name ? `${draft.to.name} <${draft.to.address}>` : draft.to.address,
      subject: draft.subject,
      words: draft.body,
      version: draft.edited ? "their_own_words" : draft.approach === "short" ? "the_shorter_one" : draft.approach === "offer_start" ? "the_one_offering_to_start" : "as_drafted",
      state,
      openedInTheirMail: at(draft.handedOffAt),
      theySaidSent: at(draft.reportedSentAt),
      inSentFolderSince: at(draft.verifiedSentAt),
    },
    sentFolder: draft.status === "verified_sent" ? "found_it" : pending ? (options.lookedInSent ? "looked_just_now_not_there" : "could_not_look") : "not_relevant",
    recipientWroteBack: !out
      ? { answer: "not_known" }
      : reply.kind === "replied"
        ? { answer: "yes", when: at(reply.at), words: reply.excerpt }
        : reply.kind === "none"
          ? { answer: "no" }
          : { answer: "not_known" },
  };
}

export type AnswerProblem = { kind: "misquote" | "sent" | "sent_folder" | "wrote_back" | "time" | "machinery"; text: string };

const plainText = (text: string) =>
  text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NEGATION = /\b(?:not|never|no|hasn't|haven't|hadn't|isn't|wasn't|didn't|doesn't|won't|can't|couldn't)\s+(?:[\w']+\s+){0,4}$/i;

/** Each match of the pattern, with its sentence, and whether the words just before it negate it. */
function claims(text: string, pattern: RegExp): Array<{ text: string; sentence: string; negated: boolean }> {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].map(match => {
    const index = match.index ?? 0;
    const sentenceStart = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf("!", index - 1)) + 1;
    const before = text.slice(sentenceStart, index);
    const end = text.slice(index).search(/[.?!](?:\s|$)/);
    return { text: match[0], sentence: text.slice(sentenceStart, end < 0 ? text.length : index + end + 1).trim(), negated: NEGATION.test(before) };
  });
}

/**
 * Defence in depth for Claire's written answer, after the prompt: what she quotes is verbatim; she says the message
 * went only when it did (the person's word for "you sent it", their Sent folder for "it went"); the Sent folder and a
 * reply only as they stand; times only as the records give them; never the machinery. The checks detect; they never
 * decide what is true.
 */
export function checkClaireAnswer(answer: string, facts: FirstChapterFacts): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  const said = facts.recipientWroteBack.answer === "yes" ? facts.recipientWroteBack : null;
  const sources = [facts.message.words, facts.message.subject, facts.request.words, facts.replyThen, facts.offerNow, said?.words ?? null]
    .filter((text): text is string => Boolean(text))
    .map(plainText);
  for (const match of answer.matchAll(/[“"]([^”"]{8,})[”"]/g)) {
    const quoted = plainText(match[1]).replace(/[.,;:!?…]+$/, "");
    if (!sources.some(source => source.includes(quoted))) problems.push({ kind: "misquote", text: match[1] });
  }

  const state = facts.message.state;
  for (const claim of claims(answer, /\b(?:you|they)\s+(?:sent|mailed|emailed)\b/i)) {
    if (!claim.negated && state !== "they_said_they_sent_it" && state !== "in_their_sent_folder") problems.push({ kind: "sent", text: claim.sentence });
  }
  for (const claim of claims(answer, /\b(?:was|been|is|got)\s+sent\b|\bwent out\b|\bhas gone\b|\bit's gone\b|\bI\s+(?:sent|mailed|emailed)\b/i)) {
    const mine = /^I\s/i.test(claim.text);
    if (!claim.negated && (mine || state !== "in_their_sent_folder")) problems.push({ kind: "sent", text: claim.sentence });
  }

  for (const claim of claims(answer, /\bsent folder\b/i)) {
    const couldNotLook = /\b(?:couldn't|could not|can't|cannot|wasn't able to|unable to)\s+(?:look|check|search|see)\b/i.test(claim.sentence);
    const allowed = couldNotLook
      ? facts.sentFolder === "could_not_look"
      : claim.negated
        ? facts.sentFolder === "looked_just_now_not_there"
        : facts.sentFolder === "found_it";
    if (!allowed) problems.push({ kind: "sent_folder", text: claim.sentence });
  }

  const names = [facts.recipient.firstName, facts.recipient.name].filter((name): name is string => Boolean(name)).map(escape);
  const who = `(?:${[...names, "she", "he", "they"].join("|")})`;
  for (const claim of claims(answer, new RegExp(`\\b${who}\\s+(?:has\\s+|have\\s+)?(?:wrote back|written back|replied|responded|answered|got back to you)\\b`, "i"))) {
    if (!claim.negated && !said) problems.push({ kind: "wrote_back", text: claim.sentence });
  }
  const notYet = new RegExp(`\\b${who}\\s+(?:hasn't|has not|haven't|have not|didn't|did not)\\s+(?:written back|write back|replied|reply|responded|respond|answered|answer|got back|gotten back)\\b|\\bno reply\\b`, "i");
  for (const claim of claims(answer, notYet)) {
    if (facts.recipientWroteBack.answer !== "no") problems.push({ kind: "wrote_back", text: claim.sentence });
  }

  const times = [facts.message.openedInTheirMail, facts.message.theySaidSent, facts.message.inSentFolderSince, said?.when ?? null]
    .filter((text): text is string => Boolean(text))
    .map(text => plainText(text).replace(/\./g, ""));
  for (const match of answer.matchAll(/\b\d{1,2}:\d{2}\s?[ap]\.?m\.?/gi)) {
    if (!times.some(time => time.includes(plainText(match[0]).replace(/\./g, "")))) problems.push({ kind: "time", text: match[0] });
  }

  for (const match of answer.matchAll(/\bread_first_chapter\b|\b(?:tool|database|JSON|system prompt)\b/gi)) problems.push({ kind: "machinery", text: match[0] });
  return problems;
}
