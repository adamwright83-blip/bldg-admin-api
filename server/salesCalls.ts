/**
 * Operator-first bridge for Saleslay Bold Pitch and Goldline Cold Call Burst.
 *
 * Twilio dials the operator cellphone first (repLegCallSid). Only after that
 * leg is answered does Twilio fetch bridge TwiML, and only that TwiML dials
 * the prospect (customerLegCallSid). The prospect is never called unattended.
 *
 * Two caller-ID roles stay separate:
 * - operator leg: to = authorized operator cellphone, from = CLAIRE_TWILIO_FROM_NUMBER
 * - prospect leg: to = authoritative prospect phone, callerId = operator cellphone
 *
 * `sales_call_attempts.caller_id` stores the prospect-facing caller ID only.
 *
 * Saleslay Bold Pitch still treats a customer leg of >=20s as completed_success
 * and rewardGranted. Cold Call Burst rows (coldCallTargetId set) record
 * communications facts only. Duration never grants a Goldline business outcome
 * and never writes the commercial mission call attempt.
 *
 * `spoke` and `visit_booked` are connected conversations. They require the
 * prospect leg of the named attempt to have connected: attempt status
 * `customer_connected`, or a same-tenant `CALL_CONNECTED` receipt on that
 * attempt's prospect leg. A placed bridge, a rep answer, ringing,
 * `completed_success` alone, a customer-leg `completed` callback without that
 * signal, or some other attempt on the mission does not. A legacy log that
 * cannot name the attempt fails closed.
 *
 * Recording is OFF. Do not add recording without a separate product decision.
 */
import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import {
  communicationReceipts,
  driverColdCallTargets,
  salesCallAttempts,
  type SalesCallAttempt,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { claireTwilioFromNumber, registerClaireRoutes } from "./claire/claireTwilio";
import { isValidTwilioWebhook } from "./claire/conversation/twilioSignature";
import {
  COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE,
  isConnectedConversationOutcome,
  prospectLegConnected,
  ProspectLegNotConnectedError,
  type ProspectLegReceiptFact,
} from "../shared/coldCallBurst";
import { communicationReceiptEventFromProviderStatus } from "../shared/twilioPlatform";
import {
  recordCommunicationReceipt,
  TwilioCommunicationReceiptError,
} from "./twilioPlatform/communicationReceipts";

const CALL_STATUS_PATH = "/api/saleslay/twilio/call-status";
const CONNECTED_DURATION_THRESHOLD_SEC = 20;
export const COLD_CALL_OPERATOR_INTRO = "Connecting your next call.";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

function normalizeToE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}

function publicBaseUrl(): string {
  // Twilio needs a publicly reachable URL to fetch TwiML and post status
  // callbacks to. Reuses the existing deployed admin origin (same one
  // vendor-booking links are already built from) — there is no safe
  // localhost fallback for a live outbound call.
  return ENV.adminBaseUrl.replace(/\/$/, "");
}

export class ColdCallCallerIdUnverifiedError extends Error {
  readonly code = "COLD_CALL_CALLER_ID_UNVERIFIED" as const;
  constructor() {
    super(COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE);
    this.name = "ColdCallCallerIdUnverifiedError";
  }
}

export type OperatorFirstBridgeLegs = {
  /** Authorized operator cellphone. Twilio calls this first. */
  operatorLegTo: string;
  /** CLAIRE_TWILIO_FROM_NUMBER. Never the prospect caller ID. */
  operatorLegFrom: string;
  /** Authoritative prospect phone. Dialed only from bridge TwiML. */
  prospectLegTo: string;
  /** Operator cellphone presented to the prospect. */
  prospectCallerId: string;
};

export type StartBoldPitchCallInput = {
  tenantId: string;
  leadId?: number | null;
  orderId?: number | null;
  repPhone: string;
  customerPhone: string;
};

/**
 * Fail closed before any dial when the operator cellphone is not a Twilio
 * Verified Outgoing Caller ID. Does not substitute CLAIRE_TWILIO_FROM_NUMBER.
 */
export async function assertVerifiedOutgoingCallerId(phone: string): Promise<void> {
  if (!client) {
    throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing)");
  }
  const wanted = normalizeToE164(phone);
  let matches: Array<{ phoneNumber?: string | null }> = [];
  try {
    matches = await client.outgoingCallerIds.list({ phoneNumber: wanted, limit: 20 });
  } catch {
    throw new ColdCallCallerIdUnverifiedError();
  }
  const verified = matches.some(row => {
    const number = row.phoneNumber?.trim();
    return Boolean(number) && normalizeToE164(number!) === wanted;
  });
  if (!verified) throw new ColdCallCallerIdUnverifiedError();
}

/**
 * Creates the durable attempt row, then asks Twilio to dial the operator.
 * The prospect is not a `calls.create` destination. Twilio fetches bridge
 * TwiML only after the operator answers, and that response is what dials.
 */
export async function placeOperatorFirstBridgeCall(input: {
  tenantId: string;
  leadId?: number | null;
  orderId?: number | null;
  coldCallTargetId?: string | null;
  legs: OperatorFirstBridgeLegs;
}): Promise<{ attemptId: number; repLegCallSid: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!client) {
    throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing)");
  }

  const operatorLegTo = normalizeToE164(input.legs.operatorLegTo);
  const operatorLegFrom = normalizeToE164(input.legs.operatorLegFrom);
  const prospectLegTo = normalizeToE164(input.legs.prospectLegTo);
  const prospectCallerId = normalizeToE164(input.legs.prospectCallerId);

  if (operatorLegFrom === operatorLegTo) {
    throw new Error("Operator leg from must be the Twilio number, not the operator cellphone");
  }
  if (prospectCallerId !== operatorLegTo) {
    throw new Error("Prospect caller ID must be the operator cellphone");
  }
  if (prospectCallerId === operatorLegFrom) {
    throw new Error("Prospect caller ID must not fall back to the Twilio number");
  }

  const inserted = await db.insert(salesCallAttempts).values({
    tenantId: input.tenantId,
    leadId: input.leadId ?? null,
    orderId: input.orderId ?? null,
    coldCallTargetId: input.coldCallTargetId ?? null,
    repPhone: operatorLegTo,
    customerPhone: prospectLegTo,
    callerId: prospectCallerId,
    status: "dialing_rep",
    recordingEnabled: false,
    rewardGranted: false,
  });
  const attemptId = Number((inserted as { [0]?: { insertId?: number } })[0]?.insertId ?? 0);
  if (!attemptId) throw new Error("Failed to create sales call attempt record");

  const base = publicBaseUrl();
  try {
    const call = await client.calls.create({
      to: operatorLegTo,
      from: operatorLegFrom,
      url: `${base}/api/saleslay/twilio/bridge-twiml/${attemptId}`,
      method: "POST",
      statusCallback: `${base}${CALL_STATUS_PATH}?attemptId=${attemptId}&leg=rep`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      record: false,
    });
    await db
      .update(salesCallAttempts)
      .set({ repLegCallSid: call.sid })
      .where(eq(salesCallAttempts.id, attemptId));
    if (input.coldCallTargetId) {
      await recordColdCallProviderReceipt({
        tenantId: input.tenantId,
        coldCallTargetId: input.coldCallTargetId,
        callSid: call.sid,
        from: operatorLegFrom,
        to: operatorLegTo,
        callStatus: "initiated",
        bestEffort: true,
      });
    }
    return { attemptId, repLegCallSid: call.sid };
  } catch (error) {
    await db
      .update(salesCallAttempts)
      .set({
        status: "failed",
        rewardGranted: false,
        failureReason: (error instanceof Error ? error.message : "operator_leg_create_failed").slice(0, 255),
      })
      .where(eq(salesCallAttempts.id, attemptId));
    throw error;
  }
}

export async function startBoldPitchCall(
  input: StartBoldPitchCallInput
): Promise<{ attemptId: number; repLegCallSid: string }> {
  const operatorLegTo = normalizeToE164(input.repPhone);
  const prospectLegTo = normalizeToE164(input.customerPhone);
  const operatorLegFrom = claireTwilioFromNumber();
  return placeOperatorFirstBridgeCall({
    tenantId: input.tenantId,
    leadId: input.leadId ?? null,
    orderId: input.orderId ?? null,
    coldCallTargetId: null,
    legs: {
      operatorLegTo,
      operatorLegFrom,
      prospectLegTo,
      prospectCallerId: operatorLegTo,
    },
  });
}

export function buildBridgeTwiml(attempt: {
  id: number;
  callerId: string;
  customerPhone: string;
  coldCallTargetId?: string | null;
}): string {
  const prospectCallerId = attempt.callerId;
  const prospectLegTo = attempt.customerPhone;
  const twimlResponse = new twilio.twiml.VoiceResponse();
  if (attempt.coldCallTargetId) {
    twimlResponse.say(COLD_CALL_OPERATOR_INTRO);
  }
  const base = publicBaseUrl();
  const dial = twimlResponse.dial({
    callerId: prospectCallerId,
    record: "do-not-record",
    action: `${base}${CALL_STATUS_PATH}?attemptId=${attempt.id}&leg=rep-dial-complete`,
  });
  dial.number(
    {
      statusCallback: `${base}${CALL_STATUS_PATH}?attemptId=${attempt.id}&leg=customer`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    },
    prospectLegTo
  );
  return twimlResponse.toString();
}

/** Communications-only terminal mapping for Cold Call Burst. No reward. */
/**
 * Provider call fact on the existing communication_receipts spine.
 * Not a commercial outcome, not a dayforge event, and not a customer-message
 * product event. Claire's read path lists these by tenant and operator.
 */
async function recordColdCallProviderReceipt(input: {
  tenantId: string;
  coldCallTargetId: string;
  callSid: string | null;
  parentCallSid?: string | null;
  from?: string | null;
  to?: string | null;
  callStatus: string;
  durationSeconds?: number | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  /** Create-path only. The call is already placed; a later status callback can write the receipt. */
  bestEffort?: boolean;
}): Promise<void> {
  const eventType = communicationReceiptEventFromProviderStatus({
    channel: "voice",
    status: input.callStatus,
  });
  const callSid = input.callSid?.trim() || "";
  if (!eventType || !callSid) return;
  const db = await getDb();
  if (!db) return;
  const targets = await db
    .select()
    .from(driverColdCallTargets)
    .where(
      and(
        eq(driverColdCallTargets.id, input.coldCallTargetId),
        eq(driverColdCallTargets.tenantId, input.tenantId)
      )
    )
    .limit(1);
  const operatorUserId = targets[0]?.actorId?.trim() || "";
  if (!operatorUserId) return;
  const terminal =
    eventType === "CALL_COMPLETED" ||
    eventType === "CALL_NO_ANSWER" ||
    eventType === "CALL_BUSY" ||
    eventType === "CALL_FAILED";
  try {
    await recordCommunicationReceipt({
      tenantId: input.tenantId,
      operatorUserId,
      eventType,
      callSid,
      parentCallSid: input.parentCallSid ?? null,
      direction: "outbound",
      from: input.from,
      to: input.to,
      status: input.callStatus,
      durationSeconds: input.durationSeconds ?? null,
      providerErrorCode: input.providerErrorCode,
      providerErrorMessage: input.providerErrorMessage,
      answeredAt: eventType === "CALL_CONNECTED" ? new Date().toISOString() : null,
      completedAt: terminal ? new Date().toISOString() : null,
    });
  } catch (error) {
    if (
      error instanceof TwilioCommunicationReceiptError &&
      error.code === "persistence_unconfigured"
    ) {
      return;
    }
    if (input.bestEffort) {
      console.warn(
        "[ColdCall] communication receipt was not stored",
        error instanceof Error ? error.name : "error"
      );
      return;
    }
    throw error;
  }
}

type ProspectAttemptRow = Pick<
  SalesCallAttempt,
  "tenantId" | "status" | "repLegCallSid" | "customerLegCallSid"
>;

async function receiptsForProspectLeg(input: {
  tenantId: string;
  repLegCallSid: string | null;
  customerLegCallSid: string | null;
}): Promise<ProspectLegReceiptFact[]> {
  const repSid = input.repLegCallSid?.trim() || "";
  const customerSid = input.customerLegCallSid?.trim() || "";
  const legs: SQL[] = [];
  if (customerSid) legs.push(eq(communicationReceipts.callSid, customerSid));
  if (repSid) {
    legs.push(eq(communicationReceipts.callSid, repSid));
    legs.push(eq(communicationReceipts.parentCallSid, repSid));
  }
  if (!legs.length) return [];
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      tenantId: communicationReceipts.tenantId,
      eventType: communicationReceipts.eventType,
      callSid: communicationReceipts.callSid,
      parentCallSid: communicationReceipts.parentCallSid,
    })
    .from(communicationReceipts)
    .where(and(eq(communicationReceipts.tenantId, input.tenantId), or(...legs)));
  return rows;
}

/**
 * Transport binding stored with a connected commercial outcome.
 * The attempt id is the sales_call_attempts row whose prospect leg connected.
 */
export type ConnectedCallTransportEvidence = {
  tenantId: string;
  missionId: number;
  coldCallTargetId: string;
  salesCallAttemptId: number;
  prospectLegCallSid: string | null;
};

/**
 * Latest attempt on this target only.
 * An older connected attempt on the same target is not a substitute.
 * `completed_success` is not enough: older rows used it for any customer-leg
 * `completed` callback. Duration is not an input.
 */
export async function coldCallTargetProspectLegConnected(input: {
  tenantId: string;
  coldCallTargetId: string;
}): Promise<boolean> {
  const attempt = await latestAttemptOnTarget({
    tenantId: input.tenantId,
    coldCallTargetId: input.coldCallTargetId,
  });
  if (!attempt) return false;
  return prospectAttemptConnected(attempt);
}

async function latestAttemptOnTarget(input: {
  tenantId: string;
  coldCallTargetId: string;
}): Promise<SalesCallAttempt | null> {
  const db = await getDb();
  if (!db) return null;
  const [attempt] = await db
    .select()
    .from(salesCallAttempts)
    .where(
      and(
        eq(salesCallAttempts.tenantId, input.tenantId),
        eq(salesCallAttempts.coldCallTargetId, input.coldCallTargetId)
      )
    )
    .orderBy(desc(salesCallAttempts.id))
    .limit(1);
  if (!attempt || attempt.tenantId !== input.tenantId) return null;
  if (attempt.coldCallTargetId !== input.coldCallTargetId) return null;
  return attempt;
}

async function targetBelongsToMission(input: {
  tenantId: string;
  missionId: number;
  coldCallTargetId: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [target] = await db
    .select({ id: driverColdCallTargets.id })
    .from(driverColdCallTargets)
    .where(
      and(
        eq(driverColdCallTargets.id, input.coldCallTargetId),
        eq(driverColdCallTargets.tenantId, input.tenantId),
        eq(driverColdCallTargets.missionId, input.missionId)
      )
    )
    .limit(1);
  return Boolean(target);
}

/**
 * The attempt the caller named. No fallback to another row on the mission.
 * Cross-tenant ids and attempts whose target is on a different mission miss.
 */
async function namedAttemptOnMission(input: {
  tenantId: string;
  missionId: number;
  salesCallAttemptId: number;
  coldCallTargetId?: string;
}): Promise<SalesCallAttempt | null> {
  const db = await getDb();
  if (!db) return null;
  const [attempt] = await db
    .select()
    .from(salesCallAttempts)
    .where(
      and(
        eq(salesCallAttempts.id, input.salesCallAttemptId),
        eq(salesCallAttempts.tenantId, input.tenantId)
      )
    )
    .limit(1);
  if (!attempt || attempt.tenantId !== input.tenantId) return null;
  const targetId = attempt.coldCallTargetId?.trim() || "";
  if (!targetId) return null;
  if (input.coldCallTargetId && input.coldCallTargetId !== targetId) return null;
  const onMission = await targetBelongsToMission({
    tenantId: input.tenantId,
    missionId: input.missionId,
    coldCallTargetId: targetId,
  });
  if (!onMission) return null;
  return attempt;
}

function transportEvidence(input: {
  tenantId: string;
  missionId: number;
  attempt: SalesCallAttempt;
}): ConnectedCallTransportEvidence | null {
  const targetId = input.attempt.coldCallTargetId?.trim() || "";
  if (!targetId || input.attempt.tenantId !== input.tenantId) return null;
  return {
    tenantId: input.tenantId,
    missionId: input.missionId,
    coldCallTargetId: targetId,
    salesCallAttemptId: input.attempt.id,
    prospectLegCallSid: input.attempt.customerLegCallSid?.trim() || null,
  };
}

async function prospectAttemptConnected(
  attempt: ProspectAttemptRow,
  customerLegCallSid?: string | null
): Promise<boolean> {
  const customerSid = customerLegCallSid?.trim() || attempt.customerLegCallSid;
  if (attempt.status === "customer_connected") return true;
  const receipts = await receiptsForProspectLeg({
    tenantId: attempt.tenantId,
    repLegCallSid: attempt.repLegCallSid,
    customerLegCallSid: customerSid,
  });
  return prospectLegConnected({
    tenantId: attempt.tenantId,
    attemptStatus: attempt.status,
    repLegCallSid: attempt.repLegCallSid,
    customerLegCallSid: customerSid,
    receipts,
  });
}

export async function assertColdCallConversationOutcome(input: {
  tenantId: string;
  coldCallTargetId: string;
  outcome: string;
}): Promise<void> {
  if (!isConnectedConversationOutcome(input.outcome)) return;
  const connected = await coldCallTargetProspectLegConnected({
    tenantId: input.tenantId,
    coldCallTargetId: input.coldCallTargetId,
  });
  if (!connected) throw new ProspectLegNotConnectedError();
}

/**
 * Cold Call Burst names the target and not an attempt id. The latest attempt
 * on that target is the only candidate. An older connected attempt on the
 * target, or a connected attempt on another target, is not enough.
 */
async function latestTargetAttemptOnMission(input: {
  tenantId: string;
  missionId: number;
  coldCallTargetId: string;
}): Promise<SalesCallAttempt | null> {
  const onMission = await targetBelongsToMission(input);
  if (!onMission) return null;
  return latestAttemptOnTarget({
    tenantId: input.tenantId,
    coldCallTargetId: input.coldCallTargetId,
  });
}

/**
 * Connected outcomes name one attempt.
 *
 * `salesCallAttemptId` checks that row's prospect leg. A legacy log with no
 * attempt id fails closed. The mission's latest attempt, including a latest
 * connected attempt, is not authorization.
 */
export async function assertMissionConversationOutcome(input: {
  tenantId: string;
  missionId: number;
  coldCallTargetId?: string;
  salesCallAttemptId?: number;
  outcome: string;
}): Promise<ConnectedCallTransportEvidence | null> {
  if (!isConnectedConversationOutcome(input.outcome)) return null;
  const attempt =
    input.salesCallAttemptId != null
      ? await namedAttemptOnMission({
          tenantId: input.tenantId,
          missionId: input.missionId,
          salesCallAttemptId: input.salesCallAttemptId,
          coldCallTargetId: input.coldCallTargetId,
        })
      : input.coldCallTargetId
        ? await latestTargetAttemptOnMission({
            tenantId: input.tenantId,
            missionId: input.missionId,
            coldCallTargetId: input.coldCallTargetId,
          })
        : null;
  if (!attempt) throw new ProspectLegNotConnectedError();
  const connected = await prospectAttemptConnected(attempt);
  if (!connected) throw new ProspectLegNotConnectedError();
  const evidence = transportEvidence({
    tenantId: input.tenantId,
    missionId: input.missionId,
    attempt,
  });
  if (!evidence) throw new ProspectLegNotConnectedError();
  return evidence;
}

export function goldlineTransportStatusFromCustomerLeg(input: {
  callStatus: string;
  durationSec: number;
  /** Observed from attempt status or a prospect-leg CALL_CONNECTED receipt. */
  prospectLegConnected?: boolean;
}): {
  status: "completed_success" | "completed_no_connect";
  rewardGranted: false;
  failureReason: string | null;
} {
  const connected = input.prospectLegConnected === true && input.callStatus === "completed";
  return {
    status: connected ? "completed_success" : "completed_no_connect",
    rewardGranted: false,
    failureReason: connected ? null : `customer_leg_${input.callStatus}_${input.durationSec}s`,
  };
}

export function registerSalesCallRoutes(app: Express): void {
  // Claire shares the already-established Twilio HTTP surface, but writes
  // business state only through existing Goldline mission/recovery services.
  registerClaireRoutes(app);

  app.post("/api/saleslay/twilio/bridge-twiml/:attemptId", (req, res) => {
    void handleBridgeTwiml(req, res);
  });

  app.post(CALL_STATUS_PATH, (req, res) => {
    void handleCallStatus(req, res);
  });
}

export async function handleBridgeTwiml(req: Request, res: Response): Promise<void> {
  res.type("text/xml");
  if (!validTwilioRequest(req)) {
    res.status(403).send(emptyTwiml());
    return;
  }
  try {
    const attemptId = Number(req.params.attemptId);
    const db = await getDb();
    if (!db || !attemptId) {
      res.send(emptyTwiml());
      return;
    }

    const rows = await db
      .select()
      .from(salesCallAttempts)
      .where(eq(salesCallAttempts.id, attemptId))
      .limit(1);
    const attempt = rows[0] as SalesCallAttempt | undefined;
    if (!attempt?.customerPhone) {
      res.send(emptyTwiml());
      return;
    }

    const xml = buildBridgeTwiml(attempt);
    await db
      .update(salesCallAttempts)
      .set({ status: "dialing_customer" })
      .where(eq(salesCallAttempts.id, attemptId));
    res.status(200).send(xml);
  } catch (error) {
    console.error("[BoldPitch] bridge-twiml error", error);
    res.send(emptyTwiml());
  }
}

export async function handleCallStatus(req: Request, res: Response): Promise<void> {
  try {
    if (!validTwilioRequest(req)) {
      res.status(403).json({ ok: false, error: "invalid signature" });
      return;
    }

    const attemptId = Number(req.query.attemptId);
    const leg = String(req.query.leg ?? "");
    const db = await getDb();
    if (!db || !attemptId) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const rows = await db
      .select()
      .from(salesCallAttempts)
      .where(eq(salesCallAttempts.id, attemptId))
      .limit(1);
    const attempt = rows[0] as SalesCallAttempt | undefined;
    if (!attempt) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const body = (req.body ?? {}) as Record<string, string>;
    const callStatus = (body.CallStatus || "").toLowerCase();
    const durationSec = Number.parseInt(body.CallDuration ?? "0", 10) || 0;
    const errorCode = Number.parseInt(body.ErrorCode ?? "", 10);
    const TERMINAL = ["completed", "busy", "no-answer", "failed", "canceled"];
    const goldline = Boolean(attempt.coldCallTargetId);
    const recordProviderFact = async () => {
      if (!goldline || !attempt.coldCallTargetId || !callStatus) return;
      await recordColdCallProviderReceipt({
        tenantId: attempt.tenantId,
        coldCallTargetId: attempt.coldCallTargetId,
        callSid: body.CallSid || null,
        parentCallSid: leg === "customer" ? attempt.repLegCallSid : null,
        from: body.From || (leg === "customer" ? attempt.callerId : null),
        to: body.To || (leg === "customer" ? attempt.customerPhone : attempt.repPhone),
        callStatus,
        durationSeconds: durationSec,
        providerErrorCode: body.ErrorCode || null,
        providerErrorMessage: body.ErrorMessage || null,
      });
    };

    if (
      goldline &&
      (errorCode === 21210 || /not yet verified|verified outgoing caller/i.test(body.ErrorMessage ?? ""))
    ) {
      await db
        .update(salesCallAttempts)
        .set({
          status: "failed",
          rewardGranted: false,
          failureReason: COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE.slice(0, 255),
          customerLegCallSid: body.CallSid || null,
          customerLegDurationSec: durationSec,
        })
        .where(eq(salesCallAttempts.id, attemptId));
      await recordProviderFact();
      res.json({ ok: true });
      return;
    }

    if (leg === "rep") {
      const operatorCallSid = body.CallSid?.trim() || "";
      if (operatorCallSid && !attempt.repLegCallSid?.trim()) {
        await db
          .update(salesCallAttempts)
          .set({ repLegCallSid: operatorCallSid })
          .where(
            and(eq(salesCallAttempts.id, attemptId), isNull(salesCallAttempts.repLegCallSid))
          );
      }
      if (callStatus === "in-progress" || callStatus === "answered") {
        await db
          .update(salesCallAttempts)
          .set({ status: "rep_connected" })
          .where(eq(salesCallAttempts.id, attemptId));
      } else if (TERMINAL.includes(callStatus) && callStatus !== "completed") {
        await db
          .update(salesCallAttempts)
          .set({ status: "failed", failureReason: `rep_leg_${callStatus}`, rewardGranted: false })
          .where(eq(salesCallAttempts.id, attemptId));
      }
      await recordProviderFact();
      res.json({ ok: true });
      return;
    }

    if (leg === "customer") {
      const prospectSid = body.CallSid?.trim() || "";
      const alreadyTerminal = ["completed_success", "completed_no_connect", "failed"].includes(
        attempt.status
      );
      if ((callStatus === "in-progress" || callStatus === "answered") && !alreadyTerminal) {
        await db
          .update(salesCallAttempts)
          .set({
            status: "customer_connected",
            ...(prospectSid ? { customerLegCallSid: prospectSid } : {}),
            recordingEnabled: false,
          })
          .where(eq(salesCallAttempts.id, attemptId));
      }
      if (TERMINAL.includes(callStatus)) {
        const customerLegCallSid = prospectSid || attempt.customerLegCallSid || null;
        if (goldline) {
          if (!alreadyTerminal) {
            const connected = await prospectAttemptConnected(
              {
                ...attempt,
                customerLegCallSid,
              },
              customerLegCallSid
            );
            const transport = goldlineTransportStatusFromCustomerLeg({
              callStatus,
              durationSec,
              prospectLegConnected: connected,
            });
            await db
              .update(salesCallAttempts)
              .set({
                customerLegCallSid,
                customerLegDurationSec: durationSec,
                status: transport.status,
                failureReason: transport.failureReason,
                rewardGranted: false,
                recordingEnabled: false,
              })
              .where(eq(salesCallAttempts.id, attemptId));
          }
        } else {
          const connected = callStatus === "completed" && durationSec >= CONNECTED_DURATION_THRESHOLD_SEC;
          await db
            .update(salesCallAttempts)
            .set({
              customerLegCallSid,
              customerLegDurationSec: durationSec,
              status: connected ? "completed_success" : "completed_no_connect",
              failureReason: connected ? null : `customer_leg_${callStatus}_${durationSec}s`,
              rewardGranted: connected,
            })
            .where(eq(salesCallAttempts.id, attemptId));
        }
      }
      await recordProviderFact();
      res.json({ ok: true });
      return;
    }

    res.json({ ok: true, ignored: leg });
  } catch (error) {
    console.error("[BoldPitch] call-status webhook error", error);
    res.json({ ok: false });
  }
}

function emptyTwiml(): string {
  const twimlResponse = new twilio.twiml.VoiceResponse();
  twimlResponse.hangup();
  return twimlResponse.toString();
}

function publicUrlFor(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0] || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

function validTwilioRequest(req: Request): boolean {
  const body = (req.body ?? {}) as Record<string, string>;
  return isValidTwilioWebhook({
    authToken: authToken ?? "",
    signature: req.headers["x-twilio-signature"],
    urls: [publicUrlFor(req), `${publicBaseUrl()}${req.originalUrl}`],
    body,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
}

/** Read-only status lookup for the frontend to poll after starting a call. */
export async function getBoldPitchCallAttempt(attemptId: number): Promise<SalesCallAttempt | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(salesCallAttempts).where(eq(salesCallAttempts.id, attemptId)).limit(1);
  return rows[0] as SalesCallAttempt | undefined;
}
