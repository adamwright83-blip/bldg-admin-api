import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { offerWords, type ActivationView } from "../../../shared/firstTenMinutesActivation";
import { GOOGLE_SEND_SCOPE } from "../../../shared/firstTenMinutes";
import type { FindingView } from "../../../shared/firstTenMinutesFindings";
import { advertisedOfferForPlan } from "../../saas/joystickStripeOffer";
import { assertNewBusinessIdentity, assertTestModeCheckoutKey } from "../../saas/paidCustomerLifecycle";
import { createLegacyDayforgeSubscriptionCheckout, legacyDayforgeBillingAppUrl, legacyDayforgeBillingSecretKey } from "../../saas/saasBilling";
import { listPublicSaasPlans, requireOnboardingSession, saveFirstTenOnboardingIdentity } from "../../saas/saasStore";
import { chapterView } from "../chapter/chapter";
import { recordEvent } from "../events";
import type { DraftCredentials } from "../journeys";
import { connectionRows, firstTenDb, setJourneyStage, type JourneyRow } from "../store";
import { firstTenDrafts, firstTenJourneys } from "../schema";
import { googleAccessFor } from "../understanding/deps";
import { gmailReader } from "../understanding/googleReaders";
import { understandingView } from "../understanding/view";
import { refreshGoogleAccess } from "../google";
import { providerUrl } from "../providerFetch";
import { approvalDigest, checkSend, SendRefused, sendApprovedEmail, type GmailSendAccess, type SendOutcome } from "../../integrations/gmail/gmailSend";
import { gmailSendLedger } from "../../integrations/gmail/gmailSendLedger";

/**
 * Activation at the moment of value, and the message leaving the table. Checkout is today's (server/saas), on the
 * journey's own signup draft, and returns to /joystick-start. The person sends the message from inside JOYSTICK, from
 * their own Gmail (server/integrations/gmail), once they have approved its exact recipient and words. It is shown as
 * sent only when Google answered with its id, or their Sent folder shows it.
 */

type Stripe = Parameters<typeof createLegacyDayforgeSubscriptionCheckout>[0]["stripe"];

/** The origin today's checkout returns to. */
function billingReturnOrigin(): string {
  try {
    return new URL(legacyDayforgeBillingAppUrl()).origin;
  } catch {
    return "https://admin.bldg.chat";
  }
}

async function currentOffer(): Promise<ActivationView["offer"]> {
  const [plan] = await listPublicSaasPlans();
  if (!plan) return null;
  const advertised = advertisedOfferForPlan(plan.planKey);
  const words = offerWords({
    trialDays: advertised?.trialDays ?? plan.trialDays,
    unitAmountCents: advertised?.unitAmountCents ?? null,
    interval: advertised?.interval ?? null,
    displayName: plan.displayName,
  });
  return { planKey: plan.planKey, ...words };
}

function named<K extends string>(findings: FindingView[], kind: K): string | null {
  const finding = findings.find(item => item.payload.kind === kind && item.status !== "dismissed" && item.status !== "changed");
  return finding && "name" in finding.payload ? (finding.payload as { name: string }).name : null;
}

export async function activationView(journey: JourneyRow, credentials: DraftCredentials): Promise<ActivationView> {
  const session = await requireOnboardingSession(credentials);
  const offer = journey.kind === "example" ? null : await currentOffer();
  const google = (await connectionRows(journey.id)).find(row => row.provider === "google" && row.status === "connected");
  const findings = (await understandingView(journey.id)).findings;
  const status = session.status === "provisioned" || session.status === "complete" ? "active" : session.status === "checkout_pending" ? "checkout_pending" : "none";
  // the paid workspace, once there is one, belongs to this journey
  if (status === "active" && session.tenantId && journey.tenantId !== session.tenantId) {
    const db = await firstTenDb();
    await db.update(firstTenJourneys).set({ tenantId: session.tenantId }).where(eq(firstTenJourneys.id, journey.id));
  }
  return {
    example: journey.kind === "example",
    required: Boolean(offer),
    offer,
    status,
    identity: {
      businessName: session.businessName ?? named(findings, "business"),
      contactName: named(findings, "owner"),
      ownerEmail: session.ownerEmail ?? google?.accountLabel ?? null,
    },
    sendFrom: google?.accountLabel ?? null,
    canSend: Boolean(google?.grantedScopes.split(/\s+/).includes(GOOGLE_SEND_SCOPE)),
    returnOrigin: billingReturnOrigin(),
  };
}

/** "Continue with JOYSTICK": the person's identity on their signup draft, then today's checkout. */
export async function beginActivation(
  journey: JourneyRow,
  credentials: DraftCredentials,
  identity: { businessName: string; contactName: string; ownerEmail: string; timeZone: string },
  stripe?: Stripe
): Promise<{ url: string }> {
  if (journey.kind === "example") throw new TRPCError({ code: "BAD_REQUEST", message: "Nina's example can't be activated. Bring your own to continue." });
  const offer = await currentOffer();
  if (!offer) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "JOYSTICK isn't taking payment yet. Everything here is saved." });
  const chapter = await chapterView(journey);
  if (!chapter.draft) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There's nothing at the table yet." });
  const checked = assertNewBusinessIdentity(identity);
  if (!stripe) assertTestModeCheckoutKey(legacyDayforgeBillingSecretKey());
  const session = await requireOnboardingSession(credentials);
  if (session.status === "draft") {
    await saveFirstTenOnboardingIdentity({ ...credentials, expectedVersion: session.version, ...checked });
  }
  const checkout = await createLegacyDayforgeSubscriptionCheckout({ ...credentials, planKey: offer.planKey, requestId: randomUUID(), stripe });
  if (!checkout.url) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe didn't return a checkout page." });
  await recordEvent(journey.id, "activation_started", { planKey: offer.planKey });
  await setJourneyStage(journey.id, "activation");
  return { url: checkout.url };
}

async function draftRow(journeyId: string) {
  const db = await firstTenDb();
  const [row] = await db.select().from(firstTenDrafts).where(eq(firstTenDrafts.journeyId, journeyId)).limit(1);
  return row ?? null;
}

/** One send per journey's message: a retry, a reload or a replay finds the same key and never sends twice. */
const sendKey = (journey: JourneyRow) => `first_ten:${journey.id}`;
const sendFetch: typeof fetch = (url, init) => fetch(providerUrl(String(url)), init);

/** The journey's Gmail, as the send service uses it: the connected account, its grants, and a token kept fresh. */
async function sendAccess(journey: JourneyRow): Promise<GmailSendAccess | null> {
  const access = await googleAccessFor(journey);
  if (!access) return null;
  let token = access.accessToken;
  let expires = access.accessExpiresAt;
  return {
    accountEmail: access.ownerEmail,
    grantedScopes: access.grantedScopes,
    async token(renew) {
      const stale = expires ? expires.getTime() - Date.now() < 60_000 : false;
      if ((renew || stale) && access.refreshToken) {
        const renewed = await refreshGoogleAccess({ refreshToken: access.refreshToken });
        token = renewed.accessToken;
        expires = renewed.expiresAt;
        await access.onRefreshed(token, expires);
      }
      return token;
    },
  };
}

export type SendDraftResult = "sent" | "sending" | "needs_permission" | "failed";

/** What a send (or a check on one) showed, written to the draft. Sent only with Google's id. */
async function recordSend(journey: JourneyRow, outcome: SendOutcome): Promise<SendDraftResult> {
  const db = await firstTenDb();
  const set = (values: Partial<typeof firstTenDrafts.$inferInsert>) => db.update(firstTenDrafts).set(values).where(eq(firstTenDrafts.journeyId, journey.id));
  if (outcome.status === "sent") {
    await set({ status: "verified_sent", verifiedSentAt: outcome.sentAt, verifiedMessageId: outcome.gmailMessageId });
    await recordEvent(journey.id, "draft_sent", { messageId: outcome.gmailMessageId, threadId: outcome.gmailThreadId, at: outcome.sentAt.toISOString() });
    return "sent";
  }
  if (outcome.status === "sending") return "sending";
  // nothing went: the message is back at the table, as it was
  await set({ status: "prepared" });
  await recordEvent(journey.id, "draft_send_failed", { reason: outcome.status === "failed" ? outcome.reason : "no permission to send" });
  return outcome.status;
}

/**
 * The person sends the message from JOYSTICK, from their own Gmail. `approved` is exactly what they saw and approved
 * (recipient, subject, words); if the message at the table isn't that, nothing is sent. Without permission to send,
 * nothing is tried: the page asks Google for it first. While billing is open, a journey has to be active first.
 */
export async function sendDraft(
  journey: JourneyRow,
  credentials: DraftCredentials,
  approved: { to: string; subject: string; body: string }
): Promise<SendDraftResult> {
  if (journey.kind === "example") throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing is sent from Nina's example." });
  const activation = await activationView(journey, credentials);
  if (activation.required && activation.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Continue with JOYSTICK first; your message stays here." });
  }
  const row = await draftRow(journey.id);
  if (row?.status === "verified_sent") return "sent";
  if (!row || (row.status !== "prepared" && row.status !== "sending")) {
    throw new TRPCError({ code: "CONFLICT", message: "This message isn't waiting at the table." });
  }
  if (approved.to !== row.recipientAddress || approved.subject !== row.subject || approved.body !== row.body) {
    throw new TRPCError({ code: "CONFLICT", message: "The message changed since you looked at it. Look it over again before sending." });
  }
  const access = await sendAccess(journey);
  if (!access || !access.grantedScopes.includes(GOOGLE_SEND_SCOPE)) return "needs_permission";

  const mail = { to: { name: row.recipientName, address: row.recipientAddress }, subject: row.subject, body: row.body };
  // it can't be changed or declined while it's being sent
  const db = await firstTenDb();
  if (row.status === "prepared") {
    await db.update(firstTenDrafts).set({ status: "sending", handedOffAt: row.handedOffAt ?? new Date() }).where(eq(firstTenDrafts.journeyId, journey.id));
  }
  let outcome: SendOutcome;
  try {
    outcome = await sendApprovedEmail(
      {
        key: sendKey(journey),
        actor: "first_ten_onboarding",
        mail,
        approval: { digest: approvalDigest(mail), approvedBy: `first_ten_journey:${journey.id}`, approvedAt: new Date() },
        access,
      },
      { ledger: gmailSendLedger, fetch: sendFetch }
    );
  } catch (error) {
    if (!(error instanceof SendRefused)) throw error;
    await recordSend(journey, { status: "failed", reason: error.message });
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  const result = await recordSend(journey, outcome);
  if (result === "sending") await recordEvent(journey.id, "draft_send_unconfirmed", {});
  return result;
}

const plainSubject = (subject: string) =>
  subject
    .trim()
    .replace(/^(?:(?:re|fwd?|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
const plainWords = (text: string) =>
  text
    .replace(/[“”"]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * The prepared message, not just any mail to the same person: the same subject, or its opening words. The person may
 * edit it in their own mail; if they changed both, it isn't claimed, and their own word ("I sent it") still counts.
 */
export function isThePreparedMessage(item: { subject: string; text: string }, prepared: { subject: string; body: string }): boolean {
  const subject = plainSubject(prepared.subject);
  if (subject && plainSubject(item.subject) === subject) return true;
  const opening = plainWords(prepared.body).slice(0, 60);
  return opening.length >= 20 && plainWords(item.text).includes(opening);
}

/** The newest of these on the prepared message's subject: a reply to it, and the last word on where things stand. */
export function latestOnSubject<T extends { subject: string; text: string; at: Date }>(mail: readonly T[], subject: string): T | null {
  return mail.filter(item => isThePreparedMessage(item, { subject, body: "" })).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
}

/**
 * Look in the person's own Sent folder for the prepared message, to the recipient, since it left the table. Found:
 * verified, with the message's id. Not found: nothing changes.
 */
export async function verifyDraft(journey: JourneyRow): Promise<boolean> {
  const row = await draftRow(journey.id);
  if (row?.status === "sending") {
    const access = await sendAccess(journey);
    const outcome = access ? await checkSend({ key: sendKey(journey), access }, { ledger: gmailSendLedger, fetch: sendFetch }) : null;
    return outcome ? (await recordSend(journey, outcome)) === "sent" : false;
  }
  if (!row?.handedOffAt || (row.status !== "handed_off" && row.status !== "reported_sent")) return row?.status === "verified_sent";
  const access = await googleAccessFor(journey);
  if (!access) return false;
  const since = row.handedOffAt.getTime() - 60_000;
  const found = (await gmailReader(access).sentTo(row.recipientAddress, new Date(since))).find(
    item => item.at.getTime() >= since && isThePreparedMessage(item, row)
  );
  if (!found) return false;
  const db = await firstTenDb();
  await db
    .update(firstTenDrafts)
    .set({ status: "verified_sent", verifiedSentAt: found.at, verifiedMessageId: found.id })
    .where(eq(firstTenDrafts.journeyId, journey.id));
  await recordEvent(journey.id, "draft_verified_sent", { messageId: found.id, at: found.at.toISOString() });
  return true;
}
