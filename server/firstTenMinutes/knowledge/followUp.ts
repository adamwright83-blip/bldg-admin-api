import { TRPCError } from "@trpc/server";
import { formatInTimeZone } from "date-fns-tz";
import type { AwaitingReply } from "../../../shared/firstTenMinutesKnowledge";
import { approvalDigest, canSendFrom, sendApprovedEmail, SendRefused, type OutgoingEmail, type SendOutcome } from "../../integrations/gmail/gmailSend";
import { gmailSendLedger } from "../../integrations/gmail/gmailSendLedger";
import { followUpVerdict } from "../../integrations/gmail/replies/trackedConversations";
import { sendAccess } from "../activation/activation";
import { providerUrl } from "../providerFetch";
import { journeyForTenant } from "./tenantKnowledge";
import { clearAwaitingRepliesCache, readAwaitingReplies } from "./awaitingReplies";

/**
 * A follow-up to someone the owner is waiting on, prepared for their approval and sent only when they approve the
 * exact words, from their own Gmail (server/integrations/gmail/gmailSend: approval digest, one send per key, shown as
 * sent only with Google's id).
 *
 * The reply gate runs immediately before sending: the owner's Gmail is read again, and if the person has written back
 * since (by address or in that thread), nothing is sent; nor is it if a follow-up JOYSTICK already sent for this
 * message has been answered (followUpVerdict). Without Gmail's permission to send, nothing is tried: the owner gets the
 * exact message to send from Gmail themselves. JOYSTICK never sends on its own.
 */
export const FOLLOW_UP_ACTOR = "claire_desk_follow_up";
export const followUpKey = (tenantId: string, messageId: string) => `desk_follow_up:${tenantId}:${messageId}`;

export type FollowUpDraft = {
  messageId: string;
  mail: OutgoingEmail;
  /** what the owner is approving, exactly */
  digest: string;
  /** the workspace's Gmail allows sending (gmail.send was granted) */
  canSend: boolean;
  sendFrom: string | null;
  /** the same message, for Gmail's own compose window when JOYSTICK can't send it */
  composeUrl: string;
  /** a follow-up for this message already went */
  alreadySent: { at: string } | null;
};

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

/** Plain words the owner edits before approving: who, when they last wrote, about what. Nothing promised or offered. */
export function composeFollowUp(item: AwaitingReply, timeZone: string): OutgoingEmail {
  const day = formatInTimeZone(new Date(item.sentAt), timeZone, "EEEE d MMMM");
  const subject = /^re:/i.test(item.subject.trim()) ? item.subject.trim() : `Re: ${item.subject.trim() || "my last note"}`;
  const hello = firstName(item.person.name) ? `Hi ${firstName(item.person.name)},` : "Hi,";
  const ask = item.asked ? "Did you have a chance to look?" : "Just checking it reached you.";
  return {
    to: { name: item.person.name, address: item.person.address },
    subject,
    body: `${hello}\n\nFollowing up on my note from ${day} about "${item.subject.trim()}". ${ask}\n`,
  };
}

export function gmailComposeUrl(mail: OutgoingEmail, account: string | null): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: mail.to.address, su: mail.subject, body: mail.body });
  return `https://mail.google.com/mail/u/${encodeURIComponent(account ?? "0")}/?${params}`;
}

async function waitingItem(tenantId: string, messageId: string, fresh: boolean): Promise<AwaitingReply | null> {
  if (fresh) clearAwaitingRepliesCache(tenantId);
  const awaiting = await readAwaitingReplies(tenantId);
  if (awaiting?.unavailable) throw new TRPCError({ code: "PRECONDITION_FAILED", message: awaiting.unavailable });
  return awaiting?.items.find(item => item.messageId === messageId) ?? null;
}

async function journeyAccess(tenantId: string) {
  const journey = await journeyForTenant(tenantId);
  if (!journey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Gmail isn't connected to this workspace." });
  return { journey, access: await sendAccess(journey) };
}

export async function prepareFollowUp(tenantId: string, messageId: string, timeZone: string): Promise<FollowUpDraft> {
  const item = await waitingItem(tenantId, messageId, false);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "They're not on the waiting list any more: they may have written back." });
  const { access } = await journeyAccess(tenantId);
  const mail = composeFollowUp(item, timeZone);
  const previous = await gmailSendLedger.find(followUpKey(tenantId, messageId));
  return {
    messageId,
    mail,
    digest: approvalDigest(mail),
    canSend: Boolean(access && canSendFrom(access)),
    sendFrom: access?.accountEmail ?? null,
    composeUrl: gmailComposeUrl(mail, access?.accountEmail ?? null),
    alreadySent: previous?.status === "sent" && previous.sentAt ? { at: previous.sentAt.toISOString() } : null,
  };
}

export type FollowUpResult =
  | { status: "sent"; at: string; already: boolean }
  | { status: "sending" }
  | { status: "needs_permission"; composeUrl: string }
  | { status: "failed"; reason: string }
  | { status: "replied" };

/** The owner approved exactly `mail`: check they're still waiting, then send it from their own Gmail, once. */
export async function sendFollowUp(
  input: { tenantId: string; approverOpenId: string; messageId: string; mail: OutgoingEmail },
  deps: { now?: () => Date; send?: typeof sendApprovedEmail } = {}
): Promise<FollowUpResult> {
  const key = followUpKey(input.tenantId, input.messageId);
  const previous = await gmailSendLedger.find(key);
  if (previous?.status === "sent" && previous.sentAt) return { status: "sent", at: previous.sentAt.toISOString(), already: true };
  // the reply gate: their answer, or an answer to a follow-up already sent, holds this one
  const verdict = await followUpVerdict({ kind: "gmail_send", ref: key });
  if (!verdict.proceed) return { status: "replied" };
  const item = await waitingItem(input.tenantId, input.messageId, true);
  if (!item) return { status: "replied" };
  if (item.person.address.trim().toLowerCase() !== input.mail.to.address.trim().toLowerCase()) {
    throw new SendRefused("bad_address", "A follow-up goes to the person you're waiting on, no one else.");
  }
  const { access } = await journeyAccess(input.tenantId);
  if (!access || !canSendFrom(access)) return { status: "needs_permission", composeUrl: gmailComposeUrl(input.mail, access?.accountEmail ?? null) };
  const now = (deps.now ?? (() => new Date()))();
  const outcome: SendOutcome = await (deps.send ?? sendApprovedEmail)(
    {
      key,
      actor: FOLLOW_UP_ACTOR,
      mail: input.mail,
      approval: { digest: approvalDigest(input.mail), approvedBy: `operator:${input.approverOpenId}`, approvedAt: now },
      access,
    },
    // through the provider origin the onboarding uses (a stand-in in tests and e2e; Google itself otherwise)
    { ledger: gmailSendLedger, fetch: (url, init) => fetch(providerUrl(String(url)), init) }
  );
  clearAwaitingRepliesCache(input.tenantId);
  if (outcome.status === "sent") return { status: "sent", at: outcome.sentAt.toISOString(), already: outcome.already };
  if (outcome.status === "needs_permission") return { status: "needs_permission", composeUrl: gmailComposeUrl(input.mail, access.accountEmail) };
  return outcome;
}
