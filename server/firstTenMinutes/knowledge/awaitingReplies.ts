import type { AwaitingReplies, AwaitingReply } from "../../../shared/firstTenMinutesKnowledge";
import type { JourneyRow } from "../store";
import { googleAccessFor } from "../understanding/deps";
import { ProviderError } from "../providerFetch";
import { gmailReader, type GoogleAccess } from "../understanding/googleReaders";
import type { MailItem } from "../understanding/sources";
import { journeyForTenant } from "./tenantKnowledge";

/**
 * Who the person is waiting to hear back from, read from their own Gmail: someone they wrote to, in a conversation
 * that expects an answer, who hasn't written since. Deterministic and explainable: every item is one real message in
 * their Sent folder, with the reason it counts.
 *
 * It counts when the person's last message to that address is at least `minDays` old (and within `maxDays`), nothing
 * has come back from that address or in that thread since, the address isn't automated, and either the message asked
 * something (a question mark in their own words) or they'd been writing to each other (an earlier message from that
 * address): a "thanks!" to a stranger is not waiting on anyone.
 */
export const AWAITING_WINDOW = { minDays: 2, maxDays: 30 } as const;

const AUTOMATED_ADDRESS = /(?:^|[._+-])(?:no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?|alerts?|billing|receipts?|support)(?:[._+-]|@)/i;

export function computeAwaitingReplies(input: {
  sent: readonly MailItem[];
  received: readonly MailItem[];
  ownerEmail: string;
  now: Date;
  window?: { minDays: number; maxDays: number };
}): AwaitingReply[] {
  const window = input.window ?? AWAITING_WINDOW;
  const owner = input.ownerEmail.toLowerCase();
  const day = 86_400_000;
  const newest = input.now.getTime() - window.minDays * day;
  const oldest = input.now.getTime() - window.maxDays * day;
  const human = input.received.filter(item => !item.automated);
  const latestTo = new Map<string, MailItem>();
  for (const message of input.sent) {
    if (!message.sentByOwner || message.automated) continue;
    for (const recipient of message.to) {
      const address = recipient.email.toLowerCase();
      if (!address || address === owner || AUTOMATED_ADDRESS.test(address)) continue;
      const current = latestTo.get(address);
      if (!current || current.at < message.at) latestTo.set(address, message);
    }
  }
  const items: AwaitingReply[] = [];
  for (const [address, message] of latestTo) {
    const at = message.at.getTime();
    if (at > newest || at < oldest) continue;
    const answered = human.some(item => item.at.getTime() > at && (item.from.email.toLowerCase() === address || item.threadId === message.threadId));
    if (answered) continue;
    const asked = /\?/.test(message.text);
    const talking = human.some(item => item.from.email.toLowerCase() === address && item.at.getTime() < at);
    if (!asked && !talking) continue;
    const recipient = message.to.find(item => item.email.toLowerCase() === address)!;
    const words = message.text.replace(/\s+/g, " ").trim();
    items.push({
      person: { name: recipient.name, address: recipient.email },
      subject: message.subject,
      sentAt: message.at.toISOString(),
      waitingDays: Math.floor((input.now.getTime() - at) / day),
      lastLine: words.length > 160 ? `${words.slice(0, 157)}…` : words,
      asked,
      messageId: message.id,
      threadId: message.threadId,
      url: message.url,
    });
  }
  // a question asked first, then the longest wait
  return items.sort((a, b) => Number(b.asked) - Number(a.asked) || b.waitingDays - a.waitingDays).slice(0, 12);
}

// ------------------------------------------------------------------ read from the workspace's own Gmail

export type AwaitingReaderDeps = {
  journeyFor?: (tenantId: string) => Promise<JourneyRow | null>;
  accessFor?: (journey: JourneyRow) => Promise<GoogleAccess | null>;
  now?: () => Date;
};

const SENT_LIMIT = 60;
const RECEIVED_LIMIT = 150;
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: AwaitingReplies }>();

/** The last answer for this tenant, if it is fresh: what Claire uses mid-conversation without asking Google again. */
export function cachedAwaitingReplies(tenantId: string, now = Date.now()): AwaitingReplies | null {
  const hit = cache.get(tenantId);
  return hit && now - hit.at < CACHE_MS ? hit.value : null;
}

export function clearAwaitingRepliesCache(): void {
  cache.clear();
}

/**
 * Who this workspace's owner is waiting on, from the Gmail they connected when they signed up (the provisioned
 * First Ten Minutes journey's own Google connection: read-only, gmail.readonly). Nothing connected, or Gmail not
 * shared, says so; it never guesses. Read only: nothing is labelled, sent or changed in their mailbox.
 */
export async function readAwaitingReplies(tenantId: string, deps: AwaitingReaderDeps = {}): Promise<AwaitingReplies | null> {
  const now = (deps.now ?? (() => new Date()))();
  const fresh = cachedAwaitingReplies(tenantId, now.getTime());
  if (fresh) return fresh;
  const journey = await (deps.journeyFor ?? journeyForTenant)(tenantId);
  if (!journey) return null;
  const empty = (unavailable: string, account: string | null = null): AwaitingReplies => ({
    checkedAt: now.toISOString(),
    account,
    items: [],
    unavailable,
    scanned: { sent: 0, received: 0, days: AWAITING_WINDOW.maxDays },
  });
  const access = await (deps.accessFor ?? googleAccessFor)(journey);
  if (!access) return empty("Gmail isn't connected to this workspace.");
  const reader = gmailReader(access);
  const since = new Date(now.getTime() - (AWAITING_WINDOW.maxDays + 1) * 86_400_000);
  let value: AwaitingReplies;
  try {
    const [sent, received] = await Promise.all([reader.sentSince(since, SENT_LIMIT), reader.receivedSince(since, RECEIVED_LIMIT)]);
    const unavailable = sent.unavailable ?? received.unavailable;
    value = unavailable
      ? empty(unavailable, access.ownerEmail || null)
      : {
          checkedAt: now.toISOString(),
          account: access.ownerEmail || null,
          items: computeAwaitingReplies({ sent: sent.items, received: received.items, ownerEmail: access.ownerEmail, now }),
          unavailable: null,
          scanned: { sent: sent.items.length, received: received.items.length, days: AWAITING_WINDOW.maxDays },
        };
  } catch (error) {
    value = empty(error instanceof ProviderError ? `Gmail didn't answer just now (${error.status}).` : "Gmail couldn't be read just now.", access.ownerEmail || null);
    // a failure is not cached: the next look tries again
    return value;
  }
  cache.set(tenantId, { at: now.getTime(), value });
  return value;
}
