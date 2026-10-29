/**
 * Rook's correspondence desk: one real customer situation, what Sable can recall of it, and Rook's draft.
 *
 * Sable only repeats what a record holds, with its date and where it came from, and says plainly what is not known.
 * She never infers what a customer feels or intends. Rook's draft is built from what Sable found before it is
 * written, never written first and corrected for show. Nothing here sends, schedules or records anything: the desk
 * hands off to the existing Letter Desk, whose consent and hand-off rules are unchanged.
 *
 * Evidence authority, never upgraded: "record" (our own stored data: orders, drafts), "operator_reported" (the operator
 * told us: a send, a reply), "observed" (a provider or device independently observed it).
 */

export type RecallAuthority = "record" | "operator_reported" | "observed";

export type RecallEntry = {
  /** ISO time of the thing itself (when it was written, opened, reported) */
  at: string;
  kind: "operator_message" | "handoff_opened" | "reported_sent" | "observed_sent" | "reply" | "order";
  /** the words, when the record holds words */
  text: string | null;
  authority: RecallAuthority;
  /** where it came from, in plain words, with the record id */
  source: string;
};

export type SablePromise = { at: string; quote: string; source: string; authority: RecallAuthority };

export type SableRecall = {
  entries: RecallEntry[];
  promise: SablePromise | null;
  /** short, plain statements of what the record does not show */
  unknowns: string[];
  replyRecorded: boolean;
};

/** Sentences in the operator's own message that commit to a next step ("I'll follow up next week"). */
const PROMISE = /\b(i['’]ll|i will|i['’]m going to|we['’]ll|we will|let me)\b[^.!?\n]*\b(follow(?:ing)? up|check (?:in|back)|get back|reach out|text you|call you|message you|be in touch|circle back)\b[^.!?\n]*[.!?]?/i;
const TIME_HINT = /\b(tomorrow|tonight|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in a few days|soon|later this week)\b/i;

export function extractPromise(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(PROMISE);
  if (!m) return null;
  return m[0].trim().replace(/\s+/g, " ");
}

export function buildSableRecall(entries: RecallEntry[]): SableRecall {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
  // the most recent promise in the operator's own words
  let promise: SablePromise | null = null;
  for (const e of sorted) {
    if (e.kind !== "operator_message" && e.kind !== "reported_sent" && e.kind !== "observed_sent") continue;
    const quote = extractPromise(e.text);
    if (quote) promise = { at: e.at, quote, source: e.source, authority: e.authority };
  }
  const lastOut = [...sorted].reverse().find(e => e.kind === "operator_message" || e.kind === "reported_sent" || e.kind === "observed_sent" || e.kind === "handoff_opened");
  const replies = sorted.filter(e => e.kind === "reply" && (!lastOut || e.at >= lastOut.at));
  const unknowns: string[] = [];
  const sent = sorted.some(e => e.kind === "observed_sent");
  const reported = sorted.some(e => e.kind === "reported_sent");
  if (lastOut && !sent && reported) unknowns.push("The send was reported by you; no provider or device observed it.");
  if (lastOut && !sent && !reported) unknowns.push("Nothing shows this message was sent.");
  if (lastOut && replies.length === 0) unknowns.push("No reply recorded since.");
  if (!lastOut) unknowns.push("No earlier message to this customer is on record.");
  return { entries: sorted, promise, unknowns, replyRecorded: replies.length > 0 };
}

export function firstName(displayName: string) {
  const n = displayName.trim().split(/\s+/)[0] ?? "";
  return n.replace(/[^\p{L}'’-]/gu, "") || displayName.trim();
}

/** Rook's draft: short, honours what Sable found, invents nothing (no feelings, no urgency, no offers not made). */
export function composeRookDraft(input: { displayName: string; recall: SableRecall; service?: string | null; fallback?: string | null }) {
  const name = firstName(input.displayName);
  const service = input.service?.trim() || "laundry";
  const r = input.recall;
  if (r.replyRecorded) {
    return { draft: `Hi ${name}, thanks for getting back to me. Would you like me to set up a ${service} pickup this week?`, note: "Kept it short. Sable has their reply." };
  }
  if (r.promise) {
    const when = r.promise.quote.match(TIME_HINT)?.[0]?.toLowerCase();
    return {
      draft: `Hi ${name}, following up as promised about your next ${service} pickup. Would you like me to help arrange one this week?`,
      note: when ? "Kept it short. Sable found the promise." : "Kept it short. Sable found what you said last time.",
    };
  }
  if (r.entries.some(e => e.kind === "operator_message" || e.kind === "reported_sent")) {
    return { draft: `Hi ${name}, checking back in about ${service} pickup. Want me to set one up this week?`, note: "Kept it short. You've written before." };
  }
  return { draft: input.fallback?.trim() || `Hi ${name}, it's been a while. Would you like a ${service} pickup this week?`, note: "First note. Kept it plain." };
}

/** The real customer facts the desk leads with, from the existing mission's evidence. */
export type DeskCustomer = {
  customerId: string;
  displayName: string;
  paidOrders: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  lastOrderSummary: string | null;
};

export function whyNow(c: DeskCustomer): string {
  const orders = `${c.paidOrders} paid order${c.paidOrders === 1 ? "" : "s"}`;
  if (c.lastOrderDate && c.daysSinceLastOrder !== null) {
    const d = new Date(`${c.lastOrderDate.slice(0, 10)}T12:00:00`);
    const when = Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "long", day: "numeric" }) : c.lastOrderDate;
    return `${orders}, then nothing since ${when} (${c.daysSinceLastOrder} days).`;
  }
  return `${orders} on record; no recent order.`;
}

export function formatDay(iso: string) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "long", day: "numeric" }) : iso;
}

/**
 * The labelled synthetic example for the isolated preview. Fictional demonstration data, internally consistent:
 * four paid wash-and-fold orders, none since August, one operator message on October 21, no reply, no new order.
 * It must never be shown as a real customer, and nothing about it is ever written anywhere.
 */
export const TESSA_PARK_FIXTURE = {
  label: "Synthetic example (fixture): not a real customer",
  customer: {
    customerId: "fixture:tessa-park",
    displayName: "Tessa Park",
    paidOrders: 4,
    lastOrderDate: "2026-08-28",
    daysSinceLastOrder: 62,
    lastOrderSummary: "Wash & fold, 2 bags",
  } satisfies DeskCustomer,
  recallEntries: [
    { at: "2026-05-14T16:20:00Z", kind: "order", text: "Wash & fold, 2 bags", authority: "record", source: "Fixture order 1 of 4" },
    { at: "2026-08-28T17:05:00Z", kind: "order", text: "Wash & fold, 2 bags", authority: "record", source: "Fixture order 4 of 4" },
    {
      at: "2026-10-21T18:12:00Z",
      kind: "reported_sent",
      text: "Hi Tessa! Thanks again for being a regular. I'll follow up with you next week about another pickup.",
      authority: "operator_reported",
      source: "Fixture conversation: your message, reported sent",
    },
  ] satisfies RecallEntry[],
};

export function deskStateLabel(input: { saved: boolean; message: string | null | undefined; replyObserved: boolean; orderObserved: boolean }) {
  if (input.orderObserved) return "A new paid order was recorded after this (not credited to the message).";
  if (input.replyObserved) return "A reply is recorded.";
  switch (input.message) {
    case "independently_verified_sent":
      return "Sent (observed).";
    case "operator_reported_sent":
      return "You reported sending it. Not independently observed.";
    case "compose_handoff_opened":
      return "Opened in your messaging app. Not sent until you send it.";
    case "scheduled":
    case "due_operator_action":
      return "Scheduled for you to send.";
    case "saved_draft":
      return "Saved draft.";
    default:
      return input.saved ? "Saved for later. Nothing has been sent." : "Draft prepared. Nothing has been sent.";
  }
}
