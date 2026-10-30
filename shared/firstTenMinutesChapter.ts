/**
 * The first chapter (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slices 5 and 8), chosen by the opportunity the crew
 * found: "The Friday That Didn't Exist" when something became possible (Nina plays with time), "The Estimate That
 * Wouldn't Fit" when an estimate still holds what can wait (Dev plays with scope), and Hazel's "A Proper Letter"
 * otherwise. Everything the chapter shows of the person's business comes from findings with sources; the draft is
 * composed only from them, and is never shown as sent unless it was.
 */
import type { EstimateArea, OpportunityType, SourceRef } from "./firstTenMinutesFindings";

/** Hazel's errand, as in client/src/pages/goldline/silverLake3d/reunionQuests.ts ("squirrel_hoa_letter"). */
export const LETTER_STEPS = ["glove", "shake", "quill", "dip"] as const;
export type LetterStep = (typeof LETTER_STEPS)[number];

/** Which authored chapter carries the opportunity (Astra, Part 3). */
export type ChapterKind = "time" | "scope" | "letter";

export const DRAFT_APPROACHES = ["still_wanted", "offer_start", "short"] as const;
/** The estimate chapter's two ways forward: the focused estimate, or the precise question that finishes it. */
export const ESTIMATE_APPROACHES = ["focused", "question"] as const;
export type DraftApproach = (typeof DRAFT_APPROACHES)[number] | (typeof ESTIMATE_APPROACHES)[number];
export const ALL_DRAFT_APPROACHES = [...DRAFT_APPROACHES, ...ESTIMATE_APPROACHES] as const;
export const DRAFT_APPROACH_NAMES: Record<DraftApproach, string> = {
  still_wanted: "Ask if it's still wanted",
  offer_start: "Offer to start",
  short: "Keep it short",
  focused: "The focused estimate",
  question: "Ask the open question first",
};

export type DraftStatus = "prepared" | "declined" | "handed_off" | "reported_sent" | "verified_sent";

export type ChapterCard = { findingId: string; quote: string; at: string; sources: SourceRef[] };

export type ChapterOpportunity = {
  id: string;
  type: OpportunityType;
  person: { name: string | null; address: string };
  firstName: string | null;
  /** what they asked for, then; and the person's answer */
  request: ChapterCard & { wants: string; subject: string | null };
  reply: (ChapterCard & { missing: string | null }) | null;
  /** what the person offers now */
  service: (ChapterCard & { name: string }) | null;
  route: { findingId: string; weekday: number; title: string; stops: Array<{ label: string; lat: number | null; lng: number | null }> } | null;
  place: { findingId: string; name: string; category: string | null; lat: number | null; lng: number | null } | null;
  along: "street" | "nearby" | null;
  /** the estimate that wouldn't fit, in its own words, and what the client said comes first */
  estimate: { findingId: string; title: string; client: string | null; areas: EstimateArea[]; at: string; sources: SourceRef[] } | null;
  scope: (ChapterCard & { first: string; later: string }) | null;
};

/** How the person split the estimate: area names on each tray, every area on one of them. */
export type EstimateTrays = { thisJob: string[]; later: string[] };

export type DraftView = {
  approach: DraftApproach;
  to: { name: string | null; address: string };
  subject: string;
  body: string;
  edited: boolean;
  status: DraftStatus;
  /** when the message left the table, what the person said, what their Sent folder showed (ISO), or null */
  handedOffAt: string | null;
  reportedSentAt: string | null;
  verifiedSentAt: string | null;
  /** the composed text of each approach, so "Try another way" shows exactly what would change */
  approaches: Array<{ approach: DraftApproach; body: string }>;
};

export type ChapterView = {
  opportunity: ChapterOpportunity | null;
  kind: ChapterKind;
  title: string;
  /** the days the person keeps closed, by a rule they confirmed: the Sunday crossing stays shut */
  closedDays: number[];
  progress: { revealed: boolean; steps: LetterStep[]; letterWritten: boolean; trays: EstimateTrays | null };
  draft: DraftView | null;
};

// ------------------------------------------------------------------ the draft, composed only from findings

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "earlier this year", from when they asked and today. */
export function whenAsked(at: string, now: Date): string {
  const asked = new Date(at);
  const days = (now.getTime() - asked.getTime()) / 86_400_000;
  if (days < 21) return "recently";
  if (days < 45) return "a few weeks ago";
  if (asked.getUTCFullYear() === now.getUTCFullYear()) return "earlier this year";
  if (asked.getUTCFullYear() === now.getUTCFullYear() - 1) return "last year";
  return "a while ago";
}

/** What they asked about, in their own subject line when it's short ("Friday flowers"), else what they wanted. */
export function askedAbout(subject: string | null, wants: string): string {
  const plain = (subject ?? "").replace(/^\s*(re|fwd?):\s*/i, "").replace(/[?!.\s]+$/, "").trim();
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 4 && !/^(hello|hi|question|inquiry|enquiry|quick question)$/i.test(plain)) return plain;
  return lowerFirst(wants.trim());
}

/** "weekly Friday delivery" from "Weekly Friday delivery": names of days and places keep their capitals. */
export function lowerFirst(text: string): string {
  const [first, ...rest] = text.split(" ");
  if (!first) return text;
  const keep = WEEKDAYS.includes(first) || (first.length > 1 && first === first.toUpperCase());
  return [keep ? first : first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(" ");
}

const article = (phrase: string) => (/^[aeiou]/i.test(phrase) ? "an" : "a");
const theName = (name: string) => name.replace(/^The\s/, "the ");

export function composeDraft(opportunity: ChapterOpportunity, approach: (typeof DRAFT_APPROACHES)[number], now: Date): { subject: string; body: string } {
  const hello = opportunity.firstName ? `Hi ${opportunity.firstName} —` : "Hello —";
  const service = opportunity.service ? lowerFirst(opportunity.service.name) : lowerFirst(opportunity.reply?.missing ?? opportunity.request.wants);
  const subject = opportunity.request.subject
    ? /^re:/i.test(opportunity.request.subject.trim())
      ? opportunity.request.subject.trim()
      : `Re: ${opportunity.request.subject.trim()}`
    : `${service.charAt(0).toUpperCase()}${service.slice(1)}`;
  const atThePlace = opportunity.place?.category ? ` at the ${opportunity.place.category}` : "";
  const passes =
    opportunity.route && opportunity.place && opportunity.along
      ? `, and the ${WEEKDAYS[opportunity.route.weekday]} route already goes past ${theName(opportunity.place.name)}`
      : "";
  const about = askedAbout(opportunity.request.subject, opportunity.request.wants);
  // Without a service on record there is nothing new to offer: the message picks the conversation up and claims nothing.
  if (!opportunity.service) {
    const unanswered = !opportunity.reply;
    return approach === "short"
      ? { subject, body: `${hello} still looking for ${about}?` }
      : {
          subject,
          body: `${hello} you asked ${whenAsked(opportunity.request.at, now)} about ${about}${unanswered ? ", and I never got back to you" : ""}. Is that still something you're looking for${atThePlace}?`,
        };
  }
  switch (approach) {
    case "still_wanted":
      return {
        subject,
        body: `${hello} you asked ${whenAsked(opportunity.request.at, now)} about ${about}. We now have ${article(service)} ${service}. Is that still something you're looking for${atThePlace}?`,
      };
    case "offer_start":
      return { subject, body: `${hello} our ${service} is up and running now${passes}. Would you like to be on it?` };
    case "short":
      return { subject, body: `${hello} we have ${article(service)} ${service} now. Still interested?` };
  }
}

// ------------------------------------------------------------------ which chapter, and its estimate

/** Nina plays with time when something became possible; Dev plays with scope when an estimate wouldn't fit. */
export function chapterKind(opportunity: ChapterOpportunity | null): ChapterKind {
  if (!opportunity) return "letter";
  if (opportunity.estimate && opportunity.scope) return "scope";
  if (opportunity.type === "became_possible" && opportunity.service) return "time";
  return "letter";
}

const titleCase = (text: string) => text.replace(/\b[a-z]/g, letter => letter.toUpperCase());

/** "The Friday That Didn't Exist", "The Estimate That Wouldn't Fit", or Hazel's "A Proper Letter". */
export function chapterTitle(opportunity: ChapterOpportunity | null): string {
  const kind = chapterKind(opportunity);
  if (kind === "scope") return "The Estimate That Wouldn't Fit";
  if (kind === "time" && opportunity) {
    const missing = opportunity.reply?.missing ?? opportunity.service?.name ?? "";
    const day = opportunity.route ? WEEKDAYS[opportunity.route.weekday] : WEEKDAYS.find(name => new RegExp(`\\b${name}`, "i").test(missing));
    return `The ${day ?? titleCase(missing.replace(/^(a|an|the)\s+/i, ""))} That Didn't Exist`;
  }
  return "A Proper Letter";
}

export function approachesFor(opportunity: ChapterOpportunity | null): readonly DraftApproach[] {
  // nothing new to offer without a service on record: ask, or ask briefly
  if (opportunity && !opportunity.service && chapterKind(opportunity) !== "scope") return ["still_wanted", "short"] as const;
  if (chapterKind(opportunity) !== "scope") return DRAFT_APPROACHES;
  return openLines(opportunity!).length ? ESTIMATE_APPROACHES : (["focused"] as const);
}

const plain = (phrase: string) => phrase.trim().replace(/^(the|a|an|our|my|your)\s+/i, "").toLowerCase();
const tokensOf = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !["the", "and"].includes(word)));

/** The area the client asked for first ("Garage" for "the garage"). */
export function firstAreas(opportunity: ChapterOpportunity): string[] {
  if (!opportunity.estimate || !opportunity.scope) return [];
  const first = tokensOf(opportunity.scope.first);
  return opportunity.estimate.areas.filter(area => [...tokensOf(area.name)].some(word => first.has(word))).map(area => area.name);
}

/** What the estimate leaves unresolved, in its own words. */
export function openLines(opportunity: ChapterOpportunity, areas?: readonly string[]): Array<{ area: string; text: string }> {
  return (opportunity.estimate?.areas ?? [])
    .filter(area => !areas || areas.includes(area.name))
    .flatMap(area => area.lines.filter(line => line.open).map(line => ({ area: area.name, text: line.text })));
}

/** Every area on exactly one tray, and something on each: the scope separated, nothing taken away. */
export function traysProblem(opportunity: ChapterOpportunity, trays: EstimateTrays): string | null {
  const names = (opportunity.estimate?.areas ?? []).map(area => area.name);
  const placed = [...trays.thisJob, ...trays.later];
  if (placed.some(name => !names.includes(name)) || new Set(placed).size !== placed.length) return "Those aren't this estimate's rooms.";
  if (placed.length !== names.length) return "Every room goes on one of the trays. Nothing is taken out.";
  if (!trays.thisJob.length || !trays.later.length) return "It still won't fit through the arch.";
  return null;
}

/** "the garage work" / "the house work": the client's own words when the trays follow them, else the rooms by name. */
export function trayWords(opportunity: ChapterOpportunity, trays: EstimateTrays): { now: string; later: string; followsClient: boolean } {
  const first = firstAreas(opportunity);
  const followsClient = Boolean(opportunity.scope) && first.length > 0 && first.every(name => trays.thisJob.includes(name)) && trays.thisJob.every(name => first.includes(name));
  const list = (names: string[]) => {
    const lower = names.map(name => name.toLowerCase());
    return lower.length <= 1 ? lower.join("") : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
  };
  return followsClient
    ? { now: plain(opportunity.scope!.first), later: plain(opportunity.scope!.later), followsClient }
    : { now: list(trays.thisJob), later: list(trays.later), followsClient };
}

function estimateLines(opportunity: ChapterOpportunity, names: readonly string[]): string[] {
  return (opportunity.estimate?.areas ?? [])
    .filter(area => names.includes(area.name))
    .flatMap(area => [area.name, ...area.lines.map(line => (line.amount ? `${line.text} — ${line.amount}` : line.text))]);
}

/** "charger model", from "EV charger installation — charger model TBD by client". */
export function openDetail(text: string): string {
  const tail = text.split(/\s+[—–-]\s+/).pop() ?? text;
  const before = tail.split(/\b(TBD|TBC|to be (confirmed|determined|decided|chosen))\b/i)[0].trim();
  return (before || tail).replace(/[.,;:]+$/, "").replace(/^(the|a|an)\s+/i, "");
}

/**
 * The estimate's cover message and the focused estimate, in the document's own words (Astra: "I've separated the garage
 * work from the house work so we can move ahead with the first part. The later work is listed separately."), or the
 * precise question needed to finish it. Nothing unresolved is given a price.
 */
export function composeEstimateDraft(opportunity: ChapterOpportunity, approach: "focused" | "question", trays: EstimateTrays): { subject: string; body: string } {
  const hello = opportunity.firstName ? `Hi ${opportunity.firstName} —` : "Hello —";
  const subject = opportunity.request.subject
    ? /^re:/i.test(opportunity.request.subject.trim())
      ? opportunity.request.subject.trim()
      : `Re: ${opportunity.request.subject.trim()}`
    : opportunity.estimate?.title ?? "Your estimate";
  const words = trayWords(opportunity, trays);
  const open = openLines(opportunity, trays.thisJob)[0];
  if (approach === "question" && open) {
    return { subject, body: `${hello} before I finish the ${words.now} estimate, I need one detail from you: the ${openDetail(open.text)}. Could you let me know?` };
  }
  const cover = `${hello} I've separated the ${words.now} work from the ${words.later} work so we can move ahead with the first part. The later work is listed separately.`;
  return { subject, body: [cover, "", ...estimateLines(opportunity, trays.thisJob), "", "Later work", ...estimateLines(opportunity, trays.later)].join("\n") };
}
