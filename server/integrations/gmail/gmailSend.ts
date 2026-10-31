import { createHash, randomUUID } from "node:crypto";

/**
 * Sending email from a person's own Gmail (users.messages.send), for anything in JOYSTICK that may send on their
 * behalf: the first ten minutes' writing table today, gameplay and Claire later. One permissioned path:
 *
 * - **Their account, their words.** The message goes from the connected account, exactly as approved: the caller
 *   passes the digest of the recipient, subject and body the person approved, and anything else is refused.
 * - **Once.** Every send carries the caller's idempotency key. A key that has sent never sends again, whether the
 *   retry comes from a double click, a reload or a replay; one whose outcome is unknown is settled from the person's
 *   Sent folder before anything is tried again.
 * - **Only what Google showed.** `sent` means Google answered with the message's id (or the Sent folder holds it).
 *   A lost answer is `sending`, never sent; a refusal is `failed`, and nothing went.
 *
 * Callers supply the ledger (gmailSendLedger.ts in production) and the access (a token and the granted scopes).
 */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
/** an attempt younger than this may still be answering: it is waited on, not settled */
const IN_FLIGHT_MS = 60_000;
/** an unknown attempt is tried again only after its Sent folder has had this long to show it */
const SETTLE_MS = 2 * 60_000;

export type FetchLike = typeof fetch;

export type OutgoingEmail = {
  to: { name: string | null; address: string };
  subject: string;
  body: string;
};

/** What the person approved, exactly: a different recipient, subject or body is a different message. */
export function approvalDigest(mail: OutgoingEmail): string {
  return createHash("sha256")
    .update(JSON.stringify([mail.to.address.trim().toLowerCase(), mail.to.name ?? "", mail.subject, mail.body]))
    .digest("hex");
}

export type SendApproval = { digest: string; approvedBy: string; approvedAt: Date };

export type GmailSendAccess = {
  /** the connected account the message is sent from */
  accountEmail: string;
  grantedScopes: readonly string[];
  /** A usable access token. `renew` asks for a new one, after Google refused the last. */
  token: (renew: boolean) => Promise<string>;
};

export type SendStatus = "sending" | "sent" | "failed" | "unknown";

export type SendRecord = {
  key: string;
  actor: string;
  accountEmail: string;
  recipient: string;
  subject: string;
  digest: string;
  approvedBy: string;
  approvedAt: Date;
  rfc822MessageId: string;
  status: SendStatus;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  attempts: number;
  lastAttemptAt: Date;
  sentAt: Date | null;
  failure: string | null;
};

export interface SendLedger {
  find(key: string): Promise<SendRecord | null>;
  /** Records a first attempt. False when the key already has a record (nothing is written). */
  claim(record: SendRecord): Promise<boolean>;
  /** Takes another attempt on a record that is `from`, for this message. False when its status has since changed. */
  retry(key: string, from: "failed" | "unknown", message: Pick<SendRecord, "recipient" | "subject" | "digest" | "approvedBy" | "approvedAt">, at: Date): Promise<boolean>;
  settle(key: string, outcome: Pick<SendRecord, "status" | "gmailMessageId" | "gmailThreadId" | "sentAt" | "failure">): Promise<void>;
}

export type SendOutcome =
  | { status: "sent"; gmailMessageId: string; gmailThreadId: string | null; sentAt: Date; already: boolean }
  /** an attempt is in flight, or its answer was lost: nothing is claimed until Google or the Sent folder shows it */
  | { status: "sending" }
  /** Google refused it; nothing went */
  | { status: "failed"; reason: string }
  /** the connected account hasn't allowed JOYSTICK to send */
  | { status: "needs_permission" };

export class SendRefused extends Error {
  constructor(
    readonly code: "not_approved" | "bad_address",
    message: string
  ) {
    super(message);
    this.name = "SendRefused";
  }
}

type Deps = { ledger: SendLedger; fetch?: FetchLike; now?: () => Date };

export function canSendFrom(access: Pick<GmailSendAccess, "grantedScopes">): boolean {
  return access.grantedScopes.includes(GMAIL_SEND_SCOPE);
}

// ------------------------------------------------------------------ the message, as Gmail receives it

const ADDRESS = /^[^\s<>()",;:\\@]+@[^\s<>()",;:\\@]+\.[^\s<>()",;:\\@]+$/;
const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
const encoded = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`);

/** RFC 2822, plain text, UTF-8, base64url for users.messages.send. Headers can't be smuggled through any field. */
export function rawMessage(input: { from: string; mail: OutgoingEmail; messageId: string; date: Date }): string {
  const to = oneLine(input.mail.to.address);
  const from = oneLine(input.from);
  if (!ADDRESS.test(to)) throw new SendRefused("bad_address", "That recipient address can't be sent to.");
  if (!ADDRESS.test(from)) throw new SendRefused("bad_address", "The connected account has no address to send from.");
  const name = input.mail.to.name ? oneLine(input.mail.to.name).replace(/"/g, "'") : "";
  const body = Buffer.from(input.mail.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, line => `${line}\r\n`);
  const message = [
    `From: ${from}`,
    `To: ${name ? `${encoded(`"${name}"`)} <${to}>` : to}`,
    `Subject: ${encoded(oneLine(input.mail.subject))}`,
    `Message-ID: ${input.messageId}`,
    `Date: ${input.date.toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}

// ------------------------------------------------------------------ Google

type GoogleAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; status: number | null };

async function call(access: GmailSendAccess, deps: Deps, url: string, init: { method: "GET" } | { method: "POST"; body: string }): Promise<GoogleAnswer> {
  const fetcher = deps.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      response = await fetcher(url, {
        method: init.method,
        headers: { authorization: `Bearer ${await access.token(attempt > 0)}`, ...(init.method === "POST" ? { "content-type": "application/json" } : {}) },
        body: init.method === "POST" ? init.body : undefined,
        signal: controller.signal,
      });
    } catch {
      // no answer: for a send, it may or may not have gone
      return { ok: false, status: null };
    } finally {
      clearTimeout(timer);
    }
    // an expired token is refused before anything is sent: renew once and ask again
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) return { ok: false, status: response.status };
    try {
      return { ok: true, body: (await response.json()) as Record<string, unknown> };
    } catch {
      return { ok: false, status: null };
    }
  }
  return { ok: false, status: 401 };
}

/** Is it in their Sent folder? Found by the Message-ID JOYSTICK gave it; null when the folder can't be read. */
async function lookInSent(record: SendRecord, access: GmailSendAccess, deps: Deps): Promise<{ id: string; threadId: string | null } | null | "unreadable"> {
  if (!access.grantedScopes.includes(GMAIL_READ_SCOPE)) return "unreadable";
  const query = `in:sent rfc822msgid:${record.rfc822MessageId.replace(/^<|>$/g, "")}`;
  const answer = await call(access, deps, `${GMAIL}/messages?${new URLSearchParams({ q: query, maxResults: "2" })}`, { method: "GET" });
  if (!answer.ok) return "unreadable";
  const found = (answer.body.messages as Array<{ id?: string; threadId?: string }> | undefined)?.find(message => message.id);
  return found?.id ? { id: found.id, threadId: found.threadId ?? null } : null;
}

const sentOutcome = (record: Pick<SendRecord, "gmailMessageId" | "gmailThreadId" | "sentAt">, already: boolean): SendOutcome => ({
  status: "sent",
  gmailMessageId: record.gmailMessageId!,
  gmailThreadId: record.gmailThreadId,
  sentAt: record.sentAt!,
  already,
});

type Settled = { outcome: SendOutcome; record: SendRecord | null; absentFromSent: boolean };

/** Looks in Sent for a send whose answer was lost; `absentFromSent` only when the folder was read and it isn't there. */
async function settle(key: string, access: GmailSendAccess, deps: Deps): Promise<Settled> {
  const record = await deps.ledger.find(key);
  if (!record) return { outcome: { status: "sending" }, record: null, absentFromSent: false };
  if (record.status === "sent") return { outcome: sentOutcome(record, true), record, absentFromSent: false };
  if (record.status === "failed") return { outcome: { status: "failed", reason: record.failure ?? "Google refused it." }, record, absentFromSent: false };
  const now = (deps.now ?? (() => new Date()))();
  if (record.status === "sending" && now.getTime() - record.lastAttemptAt.getTime() < IN_FLIGHT_MS) return { outcome: { status: "sending" }, record, absentFromSent: false };
  const found = await lookInSent(record, access, deps);
  if (found && found !== "unreadable") {
    const outcome = { status: "sent" as const, gmailMessageId: found.id, gmailThreadId: found.threadId, sentAt: record.lastAttemptAt, failure: null };
    await deps.ledger.settle(key, outcome);
    return { outcome: sentOutcome(outcome, true), record, absentFromSent: false };
  }
  if (record.status === "sending") await deps.ledger.settle(key, { status: "unknown", gmailMessageId: null, gmailThreadId: null, sentAt: null, failure: null });
  return { outcome: { status: "sending" }, record: { ...record, status: "unknown" }, absentFromSent: found === null };
}

/**
 * Settles a send whose answer was lost, from the Sent folder. Sent (with Google's id), or still `sending`: an
 * unknown send is never claimed, and never tried again here.
 */
export async function checkSend(input: { key: string; access: GmailSendAccess }, deps: Deps): Promise<SendOutcome | null> {
  if (!(await deps.ledger.find(input.key))) return null;
  return (await settle(input.key, input.access, deps)).outcome;
}

/**
 * Sends the approved message from the connected account, once per key. See the file's comment for the guarantees.
 * Throws SendRefused when the message isn't the one approved, or can't be addressed.
 */
export async function sendApprovedEmail(
  input: { key: string; actor: string; mail: OutgoingEmail; approval: SendApproval; access: GmailSendAccess },
  deps: Deps
): Promise<SendOutcome> {
  const now = deps.now ?? (() => new Date());
  const digest = approvalDigest(input.mail);
  if (input.approval.digest !== digest) throw new SendRefused("not_approved", "This isn't the message that was approved.");
  const message = { recipient: input.mail.to.address.trim(), subject: oneLine(input.mail.subject), digest, approvedBy: input.approval.approvedBy, approvedAt: input.approval.approvedAt };

  let record = await deps.ledger.find(input.key);
  if (record?.status === "sent") return sentOutcome(record, true);
  if (record && record.status !== "failed") {
    // in flight, or its answer was lost: settle it from the Sent folder. It is tried again only when the folder was
    // actually read, long enough after, and doesn't have it; a folder that couldn't be read proves nothing
    const settled = await settle(input.key, input.access, deps);
    if (settled.outcome.status !== "sending" || !settled.record) return settled.outcome;
    record = settled.record;
    if (!settled.absentFromSent || record.status !== "unknown" || now().getTime() - record.lastAttemptAt.getTime() < SETTLE_MS) return { status: "sending" };
  }
  if (!canSendFrom(input.access)) return { status: "needs_permission" };

  const at = now();
  if (record) {
    if (!(await deps.ledger.retry(input.key, record.status as "failed" | "unknown", message, at))) return { status: "sending" };
    record = { ...record, ...message, status: "sending", attempts: record.attempts + 1, lastAttemptAt: at };
  } else {
    record = {
      key: input.key,
      actor: input.actor,
      accountEmail: input.access.accountEmail,
      ...message,
      rfc822MessageId: `<${randomUUID()}@gojoystick.com>`,
      status: "sending",
      gmailMessageId: null,
      gmailThreadId: null,
      attempts: 1,
      lastAttemptAt: at,
      sentAt: null,
      failure: null,
    };
    // someone else got there first (a double click): theirs is the attempt
    if (!(await deps.ledger.claim(record))) return { status: "sending" };
  }

  let raw: string;
  try {
    raw = rawMessage({ from: input.access.accountEmail, mail: input.mail, messageId: record.rfc822MessageId, date: at });
  } catch (error) {
    await deps.ledger.settle(input.key, { status: "failed", gmailMessageId: null, gmailThreadId: null, sentAt: null, failure: error instanceof Error ? error.message : "unaddressable" });
    throw error;
  }
  const answer = await call(input.access, deps, `${GMAIL}/messages/send`, { method: "POST", body: JSON.stringify({ raw }) });
  if (answer.ok && typeof answer.body.id === "string") {
    const sent = { status: "sent" as const, gmailMessageId: answer.body.id, gmailThreadId: typeof answer.body.threadId === "string" ? answer.body.threadId : null, sentAt: now(), failure: null };
    await deps.ledger.settle(input.key, sent);
    return sentOutcome(sent, false);
  }
  // Google answered with a refusal: nothing went, and it can be tried again
  if (!answer.ok && answer.status !== null && answer.status < 500) {
    const permission = answer.status === 403 || answer.status === 401;
    const reason = permission ? "Google didn't allow JOYSTICK to send from this account." : `Google refused it (${answer.status}).`;
    await deps.ledger.settle(input.key, { status: "failed", gmailMessageId: null, gmailThreadId: null, sentAt: null, failure: reason });
    return permission ? { status: "needs_permission" } : { status: "failed", reason };
  }
  // no usable answer: it may have gone. Look once; otherwise it stays unknown, never claimed
  await deps.ledger.settle(input.key, { status: "unknown", gmailMessageId: null, gmailThreadId: null, sentAt: null, failure: answer.ok ? "Google's answer had no message id" : null });
  const found = await lookInSent({ ...record, status: "unknown" }, input.access, deps);
  if (found && found !== "unreadable") {
    const sent = { status: "sent" as const, gmailMessageId: found.id, gmailThreadId: found.threadId, sentAt: at, failure: null };
    await deps.ledger.settle(input.key, sent);
    return sentOutcome(sent, false);
  }
  return { status: "sending" };
}
