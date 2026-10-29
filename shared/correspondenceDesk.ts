/**
 * Rook's correspondence desk: one real customer situation, what Sable can recall of it, and Rook's draft.
 *
 * Sable only repeats what a record holds, with its date and where it came from, and says plainly what is not known.
 * She keeps apart what the customer could have received (a send you reported, or one a provider or device observed)
 * from words that never left (a saved draft, or a message opened in your messaging app but never recorded as sent):
 * only the first is "you said". She never infers what a customer feels or means; what a reply asks for is the reply
 * service's own deterministic reading of it (`classifyPersonalOutreachReply`), stored with the reply, never re-guessed.
 *
 * Rook drafts only when the record supports a message: never to someone who opted out, never a pickup pitch after a
 * "not now" or a complaint, never an answer to a question only the operator can answer, and never a promise of a day
 * or time. When the record isn't enough he hands the message to you instead of guessing. Nothing here sends,
 * schedules or records anything: the desk hands off to the existing Letter Desk, whose consent rules are unchanged.
 *
 * Evidence authority, never upgraded: "record" (our own stored data: orders, drafts), "operator_reported" (the operator
 * told us: a send, a reply), "observed" (a provider or device independently observed it).
 *
 * What reaches this desk (see docs/goldline/silver-lake-3d-slice/SPECIAL_DELIVERY.md): saved drafts and revisions,
 * messages opened in the messaging app, sends you reported, sends a provider or device observed, and replies with the
 * reply service's reading. Orders placed after a message do not reach it yet, and it says so.
 */
import {
  COZY_REPLY_CLASSIFICATION_LABELS,
  type CozyReplyClassification,
} from "./cozyVillagerEvidence";

export type RecallAuthority = "record" | "operator_reported" | "observed";

export type RecallEntry = {
  /** ISO time of the thing itself (when it was written, opened, reported) */
  at: string;
  kind:
    | "operator_message"
    | "handoff_opened"
    | "reported_sent"
    | "observed_sent"
    | "reply"
    | "order";
  /** the words, when the record holds words */
  text: string | null;
  authority: RecallAuthority;
  /** where it came from, in plain words, with the record id */
  source: string;
  /** replies: the reply service's reading, stored with the reply */
  replyClass?: CozyReplyClassification;
  /** replies: the reply service recorded that they opted out */
  optedOut?: boolean;
  /** replies: the follow-up the reply service prepared for it, if it prepared one */
  preparedReply?: string | null;
};

/** How a message could have reached the customer: you reported sending it, or a provider or device observed it. */
export type Heard = "reported" | "observed";

/** A promise in words the customer could have received. This is the only kind Sable quotes as "you said". */
export type SablePromise = {
  at: string;
  quote: string;
  source: string;
  authority: RecallAuthority;
  heard: Heard;
};

/** A promise in words that never left: a saved draft, or a message opened but never recorded as sent. */
export type SableUnsentPromise = {
  at: string;
  quote: string;
  source: string;
  state: "draft" | "opened";
};

export type SableReply = {
  at: string;
  text: string | null;
  source: string;
  authority: RecallAuthority;
  replyClass: CozyReplyClassification;
  /** the reply service's own label for it */
  label: string;
  /** a question mark in their words */
  asks: boolean;
  /** a day or a time in their words */
  namesTime: boolean;
  preparedReply: string | null;
};

export type SableRecall = {
  entries: RecallEntry[];
  /** the latest promise they could have received */
  promise: SablePromise | null;
  /** a later promise that never left, if there is one */
  unsentPromise: SableUnsentPromise | null;
  /** the latest message they could have received */
  lastSent: { at: string; heard: Heard } | null;
  lastReply: SableReply | null;
  /** any reply the reply service read as an opt-out */
  optedOut: boolean;
  /** short, plain statements of what the record does not show */
  unknowns: string[];
  /** a reply recorded since the last message they could have received (or any reply, when nothing was sent) */
  replyRecorded: boolean;
};

/** Sentences in the operator's own message that commit to a next step ("I'll follow up next week"). */
const PROMISE =
  /\b(i['’]ll|i will|i['’]m going to|we['’]ll|we will|let me)\b[^.!?\n]*\b(follow(?:ing)? up|check (?:in|back)|get back|reach out|text you|call you|message you|be in touch|circle back)\b[^.!?\n]*[.!?]?/i;
const TIME_HINT =
  /\b(tomorrow|tonight|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in a few days|soon|later this week)\b/i;
/** A day or a time someone names ("Thursday", "tomorrow morning", "at 4", "10:30am"). */
const NAMES_TIME =
  /\b(today|tonight|tomorrow|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|noon|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;

export function extractPromise(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(PROMISE);
  if (!m) return null;
  return m[0].trim().replace(/\s+/g, " ");
}

function heardOf(e: RecallEntry): Heard | null {
  if (e.kind === "observed_sent") return "observed";
  if (e.kind === "reported_sent") return "reported";
  return null;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function replyOf(e: RecallEntry): SableReply {
  // the reply service files anything it cannot place as a question, so an unread reply is a question too
  const replyClass: CozyReplyClassification = e.optedOut
    ? "opt_out"
    : (e.replyClass ?? "question");
  const text = e.text?.trim() || null;
  return {
    at: e.at,
    text,
    source: e.source,
    authority: e.authority,
    replyClass,
    label: COZY_REPLY_CLASSIFICATION_LABELS[replyClass],
    asks: Boolean(text && text.includes("?")),
    namesTime: Boolean(text && NAMES_TIME.test(text)),
    preparedReply: e.preparedReply?.trim() || null,
  };
}

export function buildSableRecall(entries: RecallEntry[]): SableRecall {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
  const sent = sorted.filter(e => heardOf(e) !== null);
  const sentWords = sent.map(e => squash(e.text ?? ""));

  // the latest promise they could have received, in the operator's own words
  let promise: SablePromise | null = null;
  for (const e of sent) {
    const quote = extractPromise(e.text);
    if (quote)
      promise = {
        at: e.at,
        quote,
        source: e.source,
        authority: e.authority,
        heard: heardOf(e)!,
      };
  }
  // a later promise that only exists in a draft or an opened message (the same words sent are the promise above)
  let unsentPromise: SableUnsentPromise | null = null;
  for (const e of sorted) {
    if (e.kind !== "operator_message" && e.kind !== "handoff_opened") continue;
    const quote = extractPromise(e.text);
    if (!quote || sentWords.some(words => words.includes(squash(quote))))
      continue;
    if (promise && e.at <= promise.at) continue;
    unsentPromise = {
      at: e.at,
      quote,
      source: e.source,
      state: e.kind === "handoff_opened" ? "opened" : "draft",
    };
  }

  const last = sent[sent.length - 1];
  const lastSent = last ? { at: last.at, heard: heardOf(last)! } : null;
  const replies = sorted.filter(e => e.kind === "reply");
  const lastReply = replies.length
    ? replyOf(replies[replies.length - 1])
    : null;
  const optedOut = replies.some(
    e => e.optedOut === true || e.replyClass === "opt_out"
  );
  const replyRecorded = Boolean(
    lastReply && (!lastSent || lastReply.at >= lastSent.at)
  );

  const unknowns: string[] = [];
  const unsent = sorted.filter(
    e => e.kind === "operator_message" || e.kind === "handoff_opened"
  );
  if (!lastSent) {
    const opened = [...unsent].reverse().find(e => e.kind === "handoff_opened");
    if (opened)
      unknowns.push(
        `You opened a message to them in your messaging app on ${formatDay(opened.at)}; it isn't recorded as sent.`
      );
    else if (unsent.length)
      unknowns.push("Nothing you wrote to them is recorded as sent.");
    else unknowns.push("No earlier message to this customer is on record.");
  } else {
    if (lastSent.heard === "reported")
      unknowns.push(
        "The send was reported by you; no provider or device observed it."
      );
    if (!replyRecorded) unknowns.push("No reply recorded since.");
    unknowns.push(
      "This desk can't see orders yet, so it can't tell you whether they've ordered since."
    );
  }
  return {
    entries: sorted,
    promise,
    unsentPromise,
    lastSent,
    lastReply,
    optedOut,
    unknowns,
    replyRecorded,
  };
}

/** One line of Sable's recall as the desk shows it: what it is, in so many words, never more than the record holds. */
export type RecallLine = {
  at: string;
  tag: string;
  text: string | null;
  source: string;
};

/**
 * The recall as lines, oldest first. A draft or an opened message whose words later went out is not shown twice (the
 * send says it); one that never went out says so.
 */
export function recallLines(recall: SableRecall): RecallLine[] {
  const sentWords = recall.entries
    .filter(e => heardOf(e) !== null)
    .map(e => squash(e.text ?? ""));
  const wentOut = (e: RecallEntry) =>
    Boolean(e.text && sentWords.some(words => words === squash(e.text!)));
  const lines: RecallLine[] = [];
  for (const e of recall.entries) {
    const base = { at: e.at, text: e.text?.trim() || null, source: e.source };
    switch (e.kind) {
      case "operator_message":
        if (!wentOut(e))
          lines.push({ ...base, tag: "A draft you saved, never sent" });
        break;
      case "handoff_opened":
        if (!wentOut(e))
          lines.push({
            ...base,
            tag: "Opened in your messaging app, not recorded as sent",
          });
        break;
      case "reported_sent":
        lines.push({ ...base, tag: "You reported sending" });
        break;
      case "observed_sent":
        lines.push({ ...base, tag: "Sent (observed)" });
        break;
      case "reply": {
        const r = replyOf(e);
        lines.push({ ...base, tag: `They replied · ${r.label}` });
        break;
      }
      default:
        break;
    }
  }
  return lines;
}

export function firstName(displayName: string) {
  const n = displayName.trim().split(/\s+/)[0] ?? "";
  return n.replace(/[^\p{L}'’-]/gu, "") || displayName.trim();
}

/**
 * What Rook does with what Sable found:
 *   draft   a short message the record supports, for you to read and edit
 *   review  the message is yours to write (a question to answer, a time to settle, a problem to read); at most a greeting,
 *           or the careful reply the reply service already prepared
 *   hold    they said not now: no message
 *   none    they opted out: no message, and none can be written here
 */
export type RookMode = "draft" | "review" | "hold" | "none";
export type RookDraft = { mode: RookMode; draft: string; note: string };

/** Rook's draft: short, honours what Sable found, invents nothing (no feelings, no urgency, no offers or times not made). */
export function composeRookDraft(input: {
  displayName: string;
  recall: SableRecall;
  service?: string | null;
  fallback?: string | null;
}): RookDraft {
  const name = firstName(input.displayName);
  const service = input.service?.trim() || "laundry";
  const r = input.recall;
  const hello = `Hi ${name}, `;
  if (r.optedOut)
    return {
      mode: "none",
      draft: "",
      note: "They asked not to be contacted. Rook won't write to them.",
    };

  const reply = r.lastReply;
  if (reply?.replyClass === "not_now") {
    return {
      mode: "hold",
      draft: "",
      note: r.replyRecorded
        ? `They said not right now (${formatDay(reply.at)}). Rook won't push. Passing on them for a while is fine.`
        : `They said not right now (${formatDay(reply.at)}), and you've written since. Rook won't push again.`,
    };
  }
  if (reply?.replyClass === "complaint") {
    return r.replyRecorded
      ? {
          mode: "review",
          draft: reply.preparedReply ?? hello,
          note: reply.preparedReply
            ? "They raised a problem. Read their words first; this is the careful reply your Letter Desk prepared, not a sales note."
            : "They raised a problem. Read their words first; this one is yours to write.",
        }
      : {
          mode: "review",
          draft: hello,
          note: `They raised a problem (${formatDay(reply.at)}). Rook won't write a sales note until you've read it.`,
        };
  }
  if (reply && r.replyRecorded) {
    if (
      reply.replyClass === "pickup_interest" &&
      !reply.asks &&
      !reply.namesTime
    ) {
      return {
        mode: "draft",
        draft: `${hello}happy to set that up. What day and time work best for you?`,
        note: "They asked for a pickup. Rook only asked when.",
      };
    }
    if (reply.replyClass === "pickup_interest") {
      return {
        mode: "review",
        draft: hello,
        note: reply.namesTime
          ? "They suggested a time. Only you know your schedule, so Rook won't promise one."
          : "They asked something about the pickup. Answer it in your own words.",
      };
    }
    // a question, or a reply the reply service couldn't place
    return {
      mode: "review",
      draft: hello,
      note: !reply.text
        ? "A reply is recorded without its words. Have a look before writing."
        : reply.asks
          ? "They asked something only you can answer. Rook won't guess."
          : "Rook can't tell what their reply needs, so it's over to you.",
    };
  }

  if (r.promise && r.lastSent && r.promise.at === r.lastSent.at) {
    const when = r.promise.quote.match(TIME_HINT)?.[0]?.toLowerCase();
    return {
      mode: "draft",
      draft: `Hi ${name}, following up as promised about your next ${service} pickup. Would you like me to help arrange one this week?`,
      note: when
        ? "Kept it short. Sable found the promise."
        : "Kept it short. Sable found what you said last time.",
    };
  }
  if (r.lastSent) {
    return {
      mode: "draft",
      draft: `Hi ${name}, checking back in about ${service} pickup. Want me to set one up this week?`,
      note: "Kept it short. You've written before.",
    };
  }
  const firstNote =
    input.fallback?.trim() ||
    `Hi ${name}, it's been a while. Would you like a ${service} pickup this week?`;
  if (r.unsentPromise) {
    return {
      mode: "draft",
      draft: firstNote,
      note: "Your saved words never went out, so this is a first note, not a follow-up.",
    };
  }
  return {
    mode: "draft",
    draft: firstNote,
    note: "First note. Kept it plain.",
  };
}

/** Whether a draft is ready to take to the Letter Desk: something to say, and in review, more than a greeting. */
export function draftReady(mode: RookMode, draft: string, displayName: string) {
  const text = draft.trim();
  if (mode === "none" || !text) return false;
  if (
    mode === "review" &&
    squash(text).replace(/[,.!\s]+$/, "") ===
      squash(`Hi ${firstName(displayName)}`)
  )
    return false;
  return true;
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
    const when = Number.isFinite(d.getTime())
      ? d.toLocaleDateString("en-US", { month: "long", day: "numeric" })
      : c.lastOrderDate;
    return `${orders}, then nothing since ${when} (${c.daysSinceLastOrder} days).`;
  }
  return `${orders} on record; no recent order.`;
}

export function formatDay(iso: string) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : iso;
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
    {
      at: "2026-05-14T16:20:00Z",
      kind: "order",
      text: "Wash & fold, 2 bags",
      authority: "record",
      source: "Fixture order 1 of 4",
    },
    {
      at: "2026-08-28T17:05:00Z",
      kind: "order",
      text: "Wash & fold, 2 bags",
      authority: "record",
      source: "Fixture order 4 of 4",
    },
    {
      at: "2026-10-21T18:12:00Z",
      kind: "reported_sent",
      text: "Hi Tessa! Thanks again for being a regular. I'll follow up with you next week about another pickup.",
      authority: "operator_reported",
      source: "Fixture conversation: your message, reported sent",
    },
  ] satisfies RecallEntry[],
};

const FIXTURE_SENT = TESSA_PARK_FIXTURE.recallEntries[2];
const fixtureReply = (
  text: string,
  replyClass: CozyReplyClassification,
  extra: Partial<RecallEntry> = {}
): RecallEntry => ({
  at: "2026-10-23T16:40:00Z",
  kind: "reply",
  text,
  authority: "operator_reported",
  source: "Fixture conversation: her reply, recorded by you",
  replyClass,
  ...extra,
});

/**
 * Other situations for the same labelled fixture, so the preview can show how the desk handles each (open the preview
 * with #desk-<name>). All synthetic; the replies carry the reading the reply service would store for them.
 */
export const TESSA_PARK_CASES: Record<
  string,
  { label: string; entries: RecallEntry[] }
> = {
  "draft-only": {
    label: "her promise is only in a draft you never sent",
    entries: [
      ...TESSA_PARK_FIXTURE.recallEntries.slice(0, 2),
      {
        ...FIXTURE_SENT,
        kind: "operator_message",
        authority: "record",
        source: "Fixture conversation: your saved draft",
      },
    ],
  },
  question: {
    label: "she replied with a question",
    entries: [
      ...TESSA_PARK_FIXTURE.recallEntries,
      fixtureReply("How much would a king comforter be?", "question"),
    ],
  },
  yes: {
    label: "she said yes to a pickup",
    entries: [
      ...TESSA_PARK_FIXTURE.recallEntries,
      fixtureReply("Yes please, I'd love a pickup.", "pickup_interest"),
    ],
  },
  "not-now": {
    label: "she said not right now",
    entries: [
      ...TESSA_PARK_FIXTURE.recallEntries,
      fixtureReply("Not right now, maybe after the holidays.", "not_now"),
    ],
  },
  complaint: {
    label: "she reported a problem",
    entries: [
      ...TESSA_PARK_FIXTURE.recallEntries,
      fixtureReply(
        "My last order came back with a shirt missing.",
        "complaint",
        {
          preparedReply:
            "Hi Tessa, thank you for telling me directly—I'm really sorry about that experience and want to review what happened personally. What is the best time for me to follow up with you today?",
        }
      ),
    ],
  },
  "opt-out": {
    label: "she asked not to be contacted",
    entries: [
      ...TESSA_PARK_FIXTURE.recallEntries,
      fixtureReply("Please stop texting me.", "opt_out", { optedOut: true }),
    ],
  },
};

/**
 * The desk's one-line state. Orders are not on it: no order evidence reaches this desk (the recovery projection
 * passes none), so it never says one was, or wasn't, placed. `drafted` is whether the box holds a message worth
 * sending; when Rook hands over or holds off, nothing has been prepared and the line doesn't say otherwise.
 */
export function deskStateLabel(input: {
  saved: boolean;
  drafted: boolean;
  message: string | null | undefined;
  replyObserved: boolean;
}) {
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
      return "Saved draft. Nothing has been sent.";
    default:
      if (input.saved) return "Saved for later. Nothing has been sent.";
      return input.drafted
        ? "Draft prepared. Nothing has been sent."
        : "Nothing has been sent.";
  }
}
