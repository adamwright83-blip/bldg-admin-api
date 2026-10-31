import { formatInTimeZone } from "date-fns-tz";
import type { FindingKind, FindingStatus, SourceRef } from "./firstTenMinutesFindings";
import type { DraftStatus } from "./firstTenMinutesChapter";

/**
 * What JOYSTICK learned about a business in its first ten minutes, as the paid workspace reads it back
 * (server/firstTenMinutes/knowledge/tenantKnowledge.ts), and how Claire and the desk say it.
 */
export type OnboardingFactSource = Pick<SourceRef, "provider" | "label" | "excerpt" | "at" | "who"> & { url: string | null };

export type OnboardingFact = {
  /** the finding id: the receipt for this fact */
  id: string;
  kind: FindingKind;
  /** in the person's own terms, as the crew's findings sheet first said it; their correction when they gave one */
  statement: string;
  status: Exclude<FindingStatus, "dismissed">;
  /** the person's correction, when they changed it */
  correction: string | null;
  sources: OnboardingFactSource[];
  learnedAt: string;
};

export type OnboardingMessage = {
  to: { name: string | null; address: string };
  subject: string;
  status: DraftStatus;
  /** when it left: Google's own answer (verified) or the person's report; null while it hasn't */
  sentAt: string | null;
  /** Google answered with the message id, or it was found in their Sent folder */
  verified: boolean;
  gmailThreadId: string | null;
  /** what JOYSTICK has seen since it went; "none_seen" is not "no reply": nothing may be watching that mailbox */
  reply: { state: "replied"; at: string } | { state: "bounced"; at: string } | { state: "none_seen" } | { state: "not_sent" };
};

export type OnboardingKnowledge = {
  journeyId: string;
  /** when the crew finished reading the person's accounts */
  readAt: string | null;
  business: string | null;
  owner: string | null;
  /** the accounts it was read from (never tokens) */
  readFrom: Array<{ provider: string; account: string | null; scopes: string[] }>;
  facts: OnboardingFact[];
  /** Claire's page about them, as kept (with their own edits), each line with the facts it rests on */
  portrait: null | { kept: boolean; lines: Array<{ text: string; factIds: string[] }> };
  /** the opportunity the first chapter was about: a real request from a real person, still open when it was read */
  opportunity: null | { factId: string; person: { name: string | null; address: string }; wants: string; askedAt: string; subject: string | null };
  /** the message the person prepared for it, and where it stands */
  message: OnboardingMessage | null;
};


/**
 * What Claire is handed about what JOYSTICK learned at signup: compact, every fact with its id (the receipt), its
 * status and when it was learned. History from the operator's own accounts, not current business truth.
 */
export type SignupKnowledgeBriefing = {
  readAt: string | null;
  business: string | null;
  owner: string | null;
  readFrom: string[];
  facts: Array<{ id: string; kind: string; statement: string; status: "proposed" | "confirmed" | "changed"; learnedAt: string; source: string | null }>;
  /** facts left out to keep the briefing short; Claire says she has more rather than that there's nothing */
  moreFacts: number;
  opportunity: OnboardingKnowledge["opportunity"];
  message: null | {
    to: string;
    subject: string;
    sent: boolean;
    /** the person chose not to send it ("Some letters are better kept"): nothing to chase */
    declined: boolean;
    sentOn: string | null;
    verified: boolean;
    reply: "replied" | "bounced" | "none_seen" | "not_sent";
    replyOn: string | null;
  };
};

const MAX_FACTS = 40;
/** The person's own reactions first, then the opportunity's own facts, then what was only read. */
const RANK: Record<SignupKnowledgeBriefing["facts"][number]["status"], number> = { confirmed: 0, changed: 0, proposed: 1 };

export function signupKnowledgeForBriefing(knowledge: OnboardingKnowledge | null, timeZone: string): SignupKnowledgeBriefing | null {
  if (!knowledge) return null;
  const day = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd") : null);
  const facts = [...knowledge.facts]
    .filter(fact => fact.kind !== "business" && fact.kind !== "owner")
    .sort((a, b) => RANK[a.status] - RANK[b.status] || (a.id === knowledge.opportunity?.factId ? -1 : 0) - (b.id === knowledge.opportunity?.factId ? -1 : 0))
    .map(fact => ({
      id: fact.id,
      kind: fact.kind,
      statement: fact.statement,
      status: fact.status,
      learnedAt: day(fact.learnedAt) ?? fact.learnedAt,
      source: fact.sources[0] ? `${fact.sources[0].label}${fact.sources[0].at ? `, ${day(fact.sources[0].at)}` : ""}` : null,
    }));
  const message = knowledge.message;
  return {
    readAt: day(knowledge.readAt),
    business: knowledge.business,
    owner: knowledge.owner,
    readFrom: knowledge.readFrom.map(source => `${source.provider}${source.account ? ` (${source.account})` : ""}`),
    facts: facts.slice(0, MAX_FACTS),
    moreFacts: Math.max(0, facts.length - MAX_FACTS),
    opportunity: knowledge.opportunity,
    message: message
      ? {
          to: message.to.name ?? message.to.address,
          subject: message.subject,
          sent: Boolean(message.sentAt),
          declined: message.status === "declined",
          sentOn: day(message.sentAt),
          verified: message.verified,
          reply: message.reply.state,
          replyOn: message.reply.state === "replied" || message.reply.state === "bounced" ? day(message.reply.at) : null,
        }
      : null,
  };
}

/** How Claire may use it: one rule line for every conversation that carries the briefing. */
export const SIGNUP_KNOWLEDGE_RULE =
  "BRIEFING.signupKnowledge is what JOYSTICK's crew read from the operator's own accounts when they signed up (readAt, readFrom): history, not current business truth. Each fact has an id and a status: 'confirmed' or 'changed' facts are the operator's own (a changed fact is already in their words); a 'proposed' fact was only read, so say it looked that way, never that it is confirmed. BRIEFING.signupKnowledge.message is the message they prepared at signup: say plainly whether it was sent and whether a reply has been seen; 'none_seen' means nothing seen, not that no one replied. None of it is a customer, a sale or a booking.";

/** The desk's opening line about it, when there is something to say: where that first message stands. */
export function signupOpeningLine(briefing: SignupKnowledgeBriefing | null, timeZone: string, now: Date): string | null {
  const message = briefing?.message;
  if (!message || message.declined) return null;
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const on = (ymd: string | null) => (!ymd ? "" : ymd === today ? " today" : ` on ${formatInTimeZone(new Date(`${ymd}T12:00:00Z`), "UTC", "EEEE d MMMM")}`);
  if (message.reply === "replied") return `${message.to} replied${on(message.replyOn)} to your note about “${message.subject}”.`;
  if (message.reply === "bounced") return `Your note to ${message.to} didn't arrive: the address bounced.`;
  if (message.sent) return `Your note to ${message.to} went${on(message.sentOn) || " out"}; I haven't seen a reply.`;
  return `Your note to ${message.to} is still waiting at the table.`;
}
