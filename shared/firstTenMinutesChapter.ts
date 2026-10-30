/**
 * The first chapter (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slice 5): the revelation, Hazel's "A Proper Letter" in
 * the Silver Lake courtyard, and the real draft at the same writing table. Everything the chapter shows of the
 * person's business comes from findings with sources; the draft is composed only from them, and is never shown as
 * sent unless it was.
 */
import type { OpportunityType, SourceRef } from "./firstTenMinutesFindings";

/** Hazel's errand, as in client/src/pages/goldline/silverLake3d/reunionQuests.ts ("squirrel_hoa_letter"). */
export const LETTER_STEPS = ["glove", "shake", "quill", "dip"] as const;
export type LetterStep = (typeof LETTER_STEPS)[number];

export const DRAFT_APPROACHES = ["still_wanted", "offer_start", "short"] as const;
export type DraftApproach = (typeof DRAFT_APPROACHES)[number];
export const DRAFT_APPROACH_NAMES: Record<DraftApproach, string> = {
  still_wanted: "Ask if it's still wanted",
  offer_start: "Offer to start",
  short: "Keep it short",
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
};

export type DraftView = {
  approach: DraftApproach;
  to: { name: string | null; address: string };
  subject: string;
  body: string;
  edited: boolean;
  status: DraftStatus;
  /** the composed text of each approach, so "Try another way" shows exactly what would change */
  approaches: Array<{ approach: DraftApproach; body: string }>;
};

export type ChapterView = {
  opportunity: ChapterOpportunity | null;
  progress: { revealed: boolean; steps: LetterStep[]; letterWritten: boolean };
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

export function composeDraft(opportunity: ChapterOpportunity, approach: DraftApproach, now: Date): { subject: string; body: string } {
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

/** The ways the message can go. Nothing new to offer without a service on record: ask, or ask briefly. */
export function approachesFor(opportunity: ChapterOpportunity | null): readonly DraftApproach[] {
  return opportunity && !opportunity.service ? (["still_wanted", "short"] as const) : DRAFT_APPROACHES;
}
