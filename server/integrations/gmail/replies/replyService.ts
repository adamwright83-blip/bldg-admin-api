import type { Express, Request, Response } from "express";
import { jawbreakerGmailAuthFor, listJawbreakerGmailConnections } from "../../cleancloud/browserSync/gmailVerification";
import { gmailMailboxApi } from "./gmailMailboxApi";
import { parseGmailPush, pushAuthConfig, verifyPushAuthorization, type GmailPushNotice } from "./pushAuth";
import { processMailbox, type InboundEffect, type Mailbox, type ProcessResult } from "./replyDetection";
import { mailboxStore, noticeStore, replyStore } from "./replyStore";
import { sentConversations } from "./trackedConversations";

/**
 * Gmail reply detection, wired: one watch per connected operator mailbox (the tenant's Gmail connection, gmail.readonly),
 * renewed daily; authenticated Pub/Sub pushes recorded durably, then processed; and a reconciliation pass every few
 * minutes, because Google says notifications can be delayed or dropped.
 *
 * Off unless GMAIL_REPLY_DETECTION=on. Also needed (Railway, bldg-admin-api):
 *   GMAIL_PUSH_TOPIC            projects/gen-lang-client-0159109182/topics/joystick-gmail-inbox
 *   GMAIL_PUSH_AUDIENCE         https://admin.bldg.chat/api/integrations/gmail/push
 *   GMAIL_PUSH_SERVICE_ACCOUNT  joystick-gmail-push@gen-lang-client-0159109182.iam.gserviceaccount.com
 */
export const GMAIL_PUSH_PATH = "/api/integrations/gmail/push";

export function replyDetectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GMAIL_REPLY_DETECTION?.trim().toLowerCase() === "on";
}

/**
 * Which tenants' mailboxes are watched: GMAIL_REPLY_DETECTION_TENANTS, comma-separated. Empty or unset: none, so
 * turning the global switch on never starts watching every connected mailbox at once. Rollout is one tenant at a time.
 */
export function replyDetectionTenants(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set((env.GMAIL_REPLY_DETECTION_TENANTS ?? "").split(",").map(id => id.trim()).filter(Boolean));
}

export function replyDetectionEnabledFor(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return replyDetectionEnabled(env) && replyDetectionTenants(env).has(tenantId);
}

const operatorKey = (tenantId: string) => `operator:${tenantId}`;
const tenantOf = (mailboxKey: string) => (mailboxKey.startsWith("operator:") ? mailboxKey.slice("operator:".length) : null);

/** Renew a watch older than this (Google: at least every 7 days, daily recommended). */
const RENEW_AFTER_MS = 20 * 60 * 60 * 1000;
const CLAIM_MS = 5 * 60 * 1000;

/** What a verified inbound message changes beyond its own record. Receiving never authorises a send. */
const effects: InboundEffect[] = [
  async record => {
    console.log(
      "[GmailReplies]",
      JSON.stringify({ event: "inbound_recorded", tenantId: record.tenantId, kind: record.kind, conversation: record.conversation, gmailMessageId: record.gmailMessageId })
    );
  },
];

async function apiFor(mailbox: Pick<Mailbox, "key">) {
  const tenantId = tenantOf(mailbox.key);
  const connection = tenantId ? await jawbreakerGmailAuthFor(tenantId) : null;
  return connection ? gmailMailboxApi(connection.auth) : null;
}

/** One pass over one mailbox, one at a time per mailbox. */
export async function runMailbox(mailbox: Mailbox, noticedHistoryId: string | null, now = new Date()): Promise<ProcessResult> {
  if (!(await mailboxStore.claim(mailbox.key, now, CLAIM_MS))) return { outcome: "skipped", reason: "another pass is running" };
  try {
    const fresh = await mailboxStore.find(mailbox.key);
    if (!fresh) return { outcome: "skipped", reason: "mailbox no longer watched" };
    const api = await apiFor(fresh);
    if (!api) {
      await mailboxStore.setStatus(fresh.key, "disconnected", "Gmail is no longer connected for this tenant");
      return { outcome: "skipped", reason: "disconnected" };
    }
    return await processMailbox(fresh, noticedHistoryId, { api, tracked: sentConversations, store: replyStore, effects });
  } finally {
    await mailboxStore.release(mailbox.key);
  }
}

/** A durable notice, handled: every mailbox with that address (each tenant's own), then marked processed. */
/**
 * The mailboxes a notice for this address may be handled for: active, and of a tenant listed in
 * GMAIL_REPLY_DETECTION_TENANTS. A watch made before its tenant was unlisted keeps pushing until Google expires it
 * (up to 7 days); those notices match nothing here. users.stop isn't called for them, since another tenant may
 * share the address.
 */
export async function wantedMailboxes(emailAddress: string, tenants: ReadonlySet<string> = replyDetectionTenants()): Promise<Mailbox[]> {
  return (await mailboxStore.byEmail(emailAddress)).filter(mailbox => mailbox.status === "active" && tenants.has(mailbox.tenantId));
}

export async function handleNotice(notice: GmailPushNotice): Promise<void> {
  const mailboxes = await wantedMailboxes(notice.emailAddress);
  let outcome = mailboxes.length ? "processed" : "no_watched_mailbox";
  try {
    for (const mailbox of mailboxes) {
      const result = await runMailbox(mailbox, notice.historyId);
      // another pass holds the mailbox: leave the notice pending so reconciliation hands it on
      if (result.outcome === "skipped" && result.reason === "another pass is running") outcome = "deferred";
    }
  } catch (error) {
    await noticeStore.attempted(notice.pubsubMessageId);
    throw error;
  }
  if (outcome !== "deferred") await noticeStore.settle(notice.pubsubMessageId, outcome, new Date());
}

export type MailboxSyncStore = Pick<typeof mailboxStore, "all" | "create" | "replaceAccount" | "reactivate" | "setStatus">;

/**
 * Brings the watched set in line with the connected mailboxes. A new connection is watched. A different account on
 * the same tenant starts fresh (its own cursor and watch). The same account authorised again after Google ended
 * access, or after it was removed, is watched again from its kept cursor; a mailbox is reactivated only by a
 * connection stored after it stopped, so stale credentials are never retried in a loop. A removed connection is
 * disconnected. Only tenants in GMAIL_REPLY_DETECTION_TENANTS are watched: any other mailbox is paused, and resumes
 * (from its kept cursor) when its tenant is listed again.
 */
export async function syncOperatorMailboxes(
  deps: { connections?: typeof listJawbreakerGmailConnections; store?: MailboxSyncStore; now?: () => Date; tenants?: ReadonlySet<string> } = {}
): Promise<void> {
  const store = deps.store ?? mailboxStore;
  const now = (deps.now ?? (() => new Date()))();
  const tenants = deps.tenants ?? replyDetectionTenants();
  const connections = (await (deps.connections ?? listJawbreakerGmailConnections)()).filter(connection => tenants.has(connection.tenantId));
  const mailboxes = new Map((await store.all()).map(mailbox => [mailbox.key, mailbox]));
  const connected = new Set<string>();
  for (const connection of connections) {
    if (!connection.connectedEmail) continue;
    const key = operatorKey(connection.tenantId);
    const email = connection.connectedEmail.toLowerCase();
    connected.add(key);
    const existing = mailboxes.get(key);
    if (!existing) await store.create({ key, tenantId: connection.tenantId, source: "operator_gmail", email }, now);
    else if (existing.email !== email) await store.replaceAccount(key, email, now);
    // its tenant was listed again: it resumes from its kept cursor
    else if (existing.status === "paused") await store.reactivate(key, now);
    else if (
      existing.status !== "active" &&
      connection.updatedAt &&
      (!existing.statusChangedAt || connection.updatedAt.getTime() > existing.statusChangedAt.getTime())
    ) {
      await store.reactivate(key, now);
    }
  }
  for (const mailbox of mailboxes.values()) {
    if (mailbox.source !== "operator_gmail") continue;
    if (!tenants.has(mailbox.tenantId)) {
      if (mailbox.status === "active") await store.setStatus(mailbox.key, "paused", "tenant not in GMAIL_REPLY_DETECTION_TENANTS", now);
    } else if (mailbox.status !== "disconnected" && !connected.has(mailbox.key)) {
      await store.setStatus(mailbox.key, "disconnected", "Gmail was disconnected", now);
    }
  }
}

/** users.watch for every active mailbox whose watch is missing, expiring, or older than a day. */
export async function renewWatches(now = new Date(), topic = process.env.GMAIL_PUSH_TOPIC?.trim() ?? ""): Promise<Array<{ key: string; ok: boolean; error?: string }>> {
  if (!topic) return [];
  const results: Array<{ key: string; ok: boolean; error?: string }> = [];
  for (const mailbox of await mailboxStore.active()) {
    // a watch lasts 7 days: one with less than (7 days - RENEW_AFTER_MS) left was made more than RENEW_AFTER_MS ago
    const due = !mailbox.watchExpiresAt || mailbox.watchExpiresAt.getTime() - now.getTime() < 7 * 86_400_000 - RENEW_AFTER_MS;
    if (!due) continue;
    try {
      const api = await apiFor(mailbox);
      if (!api) {
        await mailboxStore.setStatus(mailbox.key, "disconnected", "Gmail is no longer connected for this tenant");
        continue;
      }
      const watch = await api.watch(topic);
      await mailboxStore.watched(mailbox.key, watch.historyId, watch.expiration, now);
      results.push({ key: mailbox.key, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "watch failed";
      if (error instanceof Error && error.name === "MailboxAccessError") await mailboxStore.setStatus(mailbox.key, "reconnect_required", message);
      results.push({ key: mailbox.key, ok: false, error: message.slice(0, 200) });
    }
  }
  return results;
}

/** The safety net: pending notices, then every active mailbox from its cursor (dropped or delayed notices). */
export async function reconcile(): Promise<void> {
  for (const notice of await noticeStore.pending(50)) {
    await handleNotice(notice).catch(error => console.warn("[GmailReplies] notice still pending:", error instanceof Error ? error.message : error));
  }
  for (const mailbox of await mailboxStore.active()) {
    await runMailbox(mailbox, null).catch(error => console.warn("[GmailReplies] reconcile failed:", error instanceof Error ? error.message : error));
  }
}

/**
 * POST /api/integrations/gmail/push. Authenticated first; then the notice is kept durably and acknowledged at once
 * (Pub/Sub must not wait on Gmail), and processed after the response. A redelivery is acknowledged and dropped.
 */
export function gmailPushHandler(
  deps: {
    verify?: typeof verifyPushAuthorization;
    receive?: typeof noticeStore.receive;
    process?: typeof handleNotice;
    wanted?: (emailAddress: string) => Promise<boolean>;
  } = {}
) {
  const verify = deps.verify ?? verifyPushAuthorization;
  const receive = deps.receive ?? noticeStore.receive;
  const process_ = deps.process ?? handleNotice;
  const wanted = deps.wanted ?? (async (emailAddress: string) => (await wantedMailboxes(emailAddress)).length > 0);
  return async (req: Request, res: Response) => {
    if (!replyDetectionEnabled()) return res.status(404).end();
    const auth = await verify(req.header("authorization") ?? undefined, pushAuthConfig());
    if (!auth.ok) {
      console.warn("[GmailReplies] push refused:", auth.reason);
      return res.status(401).end();
    }
    const notice = parseGmailPush(req.body);
    // malformed: acknowledged, so Pub/Sub doesn't redeliver it forever
    if (!notice) return res.status(204).end();
    try {
      // no active, listed tenant watches this address (a leftover watch from an unlisted tenant): acknowledged so
      // Pub/Sub stops redelivering, and nothing about it is kept or processed
      if (!(await wanted(notice.emailAddress))) return res.status(204).end();
      const fresh = await receive(notice, new Date());
      res.status(204).end();
      if (fresh) void process_(notice).catch(error => console.warn("[GmailReplies] processing deferred to reconciliation:", error instanceof Error ? error.message : error));
    } catch (error) {
      // not kept: let Pub/Sub redeliver
      console.warn("[GmailReplies] push not recorded:", error instanceof Error ? error.message : error);
      if (!res.headersSent) res.status(503).end();
    }
  };
}

export function registerGmailPushRoute(app: Express) {
  app.post(GMAIL_PUSH_PATH, gmailPushHandler());
}

/** Boots the watch renewal and reconciliation loop (production, flag on). Returns a stop function. */
export function startGmailReplyDetection(options: { reconcileEveryMs?: number; renewEveryMs?: number } = {}): () => void {
  if (!replyDetectionEnabled()) return () => undefined;
  const reconcileEvery = options.reconcileEveryMs ?? 5 * 60_000;
  const renewEvery = options.renewEveryMs ?? 60 * 60_000;
  let running = false;
  const tick = async (renew: boolean) => {
    if (running) return;
    running = true;
    try {
      await syncOperatorMailboxes();
      if (renew) await renewWatches();
      await reconcile();
    } catch (error) {
      console.warn("[GmailReplies] cycle failed:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  void tick(true);
  const reconcileTimer = setInterval(() => void tick(false), reconcileEvery);
  const renewTimer = setInterval(() => void tick(true), renewEvery);
  return () => {
    clearInterval(reconcileTimer);
    clearInterval(renewTimer);
  };
}
