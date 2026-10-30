import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { offerWords, gmailComposeUrl, type ActivationView } from "../../../shared/firstTenMinutesActivation";
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

/**
 * Activation at the moment of value, and the message leaving the table. Checkout is today's (server/saas), on the
 * journey's own signup draft, and returns to /joystick-start. Sending is the person's: their own mail opens with the
 * message ready. JOYSTICK records only what it knows: that it opened their mail, what they said, and what their own
 * Sent folder shows.
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
    canOpenInGmail: Boolean(google),
    gmailAccount: google?.accountLabel ?? null,
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

/**
 * The message leaves the table: the person's own mail opens with it ready (or they copy it). Only that is recorded.
 * While billing is open, a journey has to be active first.
 */
export async function handOffDraft(
  journey: JourneyRow,
  credentials: DraftCredentials,
  channel: "gmail" | "copy"
): Promise<{ url: string | null }> {
  if (journey.kind === "example") throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing is sent from Nina's example." });
  const activation = await activationView(journey, credentials);
  if (activation.required && activation.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Continue with JOYSTICK first; your message stays here." });
  }
  const row = await draftRow(journey.id);
  if (!row || (row.status !== "prepared" && row.status !== "handed_off")) {
    throw new TRPCError({ code: "CONFLICT", message: "This message isn't waiting at the table." });
  }
  if (channel === "gmail" && !activation.canOpenInGmail) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Gmail isn't connected." });
  const db = await firstTenDb();
  await db.update(firstTenDrafts).set({ status: "handed_off", handedOffAt: row.handedOffAt ?? new Date() }).where(eq(firstTenDrafts.journeyId, journey.id));
  await recordEvent(journey.id, "draft_handed_off", { channel, to: row.recipientAddress });
  const google = (await connectionRows(journey.id)).find(item => item.provider === "google");
  return {
    url:
      channel === "gmail"
        ? gmailComposeUrl({ to: row.recipientAddress, subject: row.subject, body: row.body, account: google?.accountLabel ?? null })
        : null,
  };
}

/** What the person says happened: they sent it, or not yet. Their word is recorded as theirs. */
export async function reportDraft(journey: JourneyRow, outcome: "sent" | "not_yet"): Promise<void> {
  const row = await draftRow(journey.id);
  if (!row || (row.status !== "handed_off" && row.status !== "reported_sent")) {
    throw new TRPCError({ code: "CONFLICT", message: "This message hasn't left the table." });
  }
  const db = await firstTenDb();
  if (outcome === "sent" && row.status === "handed_off") {
    await db.update(firstTenDrafts).set({ status: "reported_sent", reportedSentAt: new Date() }).where(eq(firstTenDrafts.journeyId, journey.id));
  }
  await recordEvent(journey.id, outcome === "sent" ? "draft_reported_sent" : "draft_not_sent_yet", {});
}

/**
 * Look in the person's own Sent folder for a message to the recipient since it left the table. Found: verified, with
 * the message's id. Not found: nothing changes.
 */
export async function verifyDraft(journey: JourneyRow): Promise<boolean> {
  const row = await draftRow(journey.id);
  if (!row?.handedOffAt || (row.status !== "handed_off" && row.status !== "reported_sent")) return row?.status === "verified_sent";
  const access = await googleAccessFor(journey);
  if (!access) return false;
  const since = row.handedOffAt.getTime() - 60_000;
  const found = (await gmailReader(access).sentTo(row.recipientAddress, new Date(since))).find(item => item.at.getTime() >= since);
  if (!found) return false;
  const db = await firstTenDb();
  await db
    .update(firstTenDrafts)
    .set({ status: "verified_sent", verifiedSentAt: found.at, verifiedMessageId: found.id })
    .where(eq(firstTenDrafts.journeyId, journey.id));
  await recordEvent(journey.id, "draft_verified_sent", { messageId: found.id, at: found.at.toISOString() });
  return true;
}
