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
 * Recording is OFF. Do not add recording without a separate product decision.
 */
import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { salesCallAttempts, type SalesCallAttempt } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { claireTwilioFromNumber, registerClaireRoutes } from "./claire/claireTwilio";
import { isValidTwilioWebhook } from "./claire/conversation/twilioSignature";
import { COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE } from "../shared/coldCallBurst";

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
export function goldlineTransportStatusFromCustomerLeg(input: {
  callStatus: string;
  durationSec: number;
}): {
  status: "completed_success" | "completed_no_connect";
  rewardGranted: false;
  failureReason: string | null;
} {
  const completed = input.callStatus === "completed";
  return {
    status: completed ? "completed_success" : "completed_no_connect",
    rewardGranted: false,
    failureReason: completed ? null : `customer_leg_${input.callStatus}_${input.durationSec}s`,
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
      res.json({ ok: true });
      return;
    }

    if (leg === "rep") {
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
      res.json({ ok: true });
      return;
    }

    if (leg === "customer") {
      if (callStatus === "in-progress" || callStatus === "answered") {
        await db
          .update(salesCallAttempts)
          .set({ status: "customer_connected" })
          .where(eq(salesCallAttempts.id, attemptId));
      }
      if (TERMINAL.includes(callStatus)) {
        const customerLegCallSid = body.CallSid || null;
        if (goldline) {
          const transport = goldlineTransportStatusFromCustomerLeg({ callStatus, durationSec });
          await db
            .update(salesCallAttempts)
            .set({
              customerLegCallSid,
              customerLegDurationSec: durationSec,
              status: transport.status,
              failureReason: transport.failureReason,
              rewardGranted: false,
            })
            .where(eq(salesCallAttempts.id, attemptId));
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
