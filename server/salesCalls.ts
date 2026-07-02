/**
 * Bold Pitch — Saleslay "call" weapon backend.
 *
 * Bridge-through-cellphone architecture: Twilio first dials the rep's own
 * cellphone (repLegCallSid). Only once that leg is answered does the TwiML
 * <Dial> the lead/customer's number (customerLegCallSid). This means the
 * rep is always the one initiating and present for the pitch — Twilio never
 * calls the customer unattended.
 *
 * Reward rule: the customer leg must reach >=20s of connected duration
 * before completeWeaponAction("call") fires on the frontend — same
 * threshold already used for the Level 4 war call-strike ("connected")
 * event in server/level4Twilio.ts. A shorter or failed customer leg calls
 * failWeaponAction and awards nothing.
 *
 * Every attempt is a durable row in sales_call_attempts (see
 * drizzle/schema.ts), keyed uniquely on repLegCallSid so a duplicate Twilio
 * status callback can never create a second reward for the same call.
 *
 * Recording is OFF (no <Record> verb, no recordingStatusCallback, no
 * record: true on the call). Do not add recording without a separate,
 * explicit product decision — call recording has consent implications this
 * slice does not address.
 *
 * Until the Twilio account is verified for real outbound traffic, calls to
 * initiateBoldPitchCall will fail at the Twilio API step; the DB row and
 * webhook plumbing are still exercised so the feature is ready to flip on.
 */
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { salesCallAttempts, type SalesCallAttempt } from "../drizzle/schema";
import { ENV } from "./_core/env";

const CALL_STATUS_PATH = "/api/saleslay/twilio/call-status";
const CONNECTED_DURATION_THRESHOLD_SEC = 20;

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

export type StartBoldPitchCallInput = {
  tenantId: string;
  leadId?: number | null;
  orderId?: number | null;
  repPhone: string;
  customerPhone: string;
};

/**
 * Creates the durable attempt row, then asks Twilio to dial the rep's
 * cellphone. The customer is never dialed directly from here — the TwiML
 * served from /api/saleslay/twilio/bridge-twiml/:attemptId only dials the
 * customer once the rep leg is confirmed answered (see the TwiML handler
 * below), and Twilio only fetches that TwiML after the rep leg connects.
 */
export async function startBoldPitchCall(
  input: StartBoldPitchCallInput
): Promise<{ attemptId: number; repLegCallSid: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!client) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing)");

  const repPhone = normalizeToE164(input.repPhone);
  const customerPhone = normalizeToE164(input.customerPhone);
  // Caller ID must be a number verified/purchased in the Twilio account —
  // Twilio rejects unverified numbers as Caller ID at the API layer, so
  // this intentionally is not silently swapped for anything else here.
  const callerId = repPhone;

  const inserted = await db.insert(salesCallAttempts).values({
    tenantId: input.tenantId,
    leadId: input.leadId ?? null,
    orderId: input.orderId ?? null,
    repPhone,
    customerPhone,
    callerId,
    status: "dialing_rep",
    recordingEnabled: false,
  });
  const attemptId = Number((inserted as { [0]?: { insertId?: number } })[0]?.insertId ?? 0);
  if (!attemptId) throw new Error("Failed to create sales call attempt record");

  const base = publicBaseUrl();
  const call = await client.calls.create({
    to: repPhone,
    from: callerId,
    url: `${base}/api/saleslay/twilio/bridge-twiml/${attemptId}`,
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
}

/** TwiML served to the REP leg once Twilio connects the call to the rep's
 * cellphone. Dials the customer leg only now — after the rep has answered. */
export function registerSalesCallRoutes(app: Express): void {
  app.post("/api/saleslay/twilio/bridge-twiml/:attemptId", async (req: Request, res: Response) => {
    res.type("text/xml");
    try {
      const attemptId = Number(req.params.attemptId);
      const db = await getDb();
      if (!db || !attemptId) return res.send(emptyTwiml());

      const rows = await db
        .select()
        .from(salesCallAttempts)
        .where(eq(salesCallAttempts.id, attemptId))
        .limit(1);
      const attempt = rows[0] as SalesCallAttempt | undefined;
      if (!attempt) return res.send(emptyTwiml());

      const base = publicBaseUrl();
      const twimlResponse = new twilio.twiml.VoiceResponse();
      const dial = twimlResponse.dial({
        callerId: attempt.callerId,
        record: "do-not-record",
        action: `${base}${CALL_STATUS_PATH}?attemptId=${attemptId}&leg=rep-dial-complete`,
      });
      dial.number(
        {
          statusCallback: `${base}${CALL_STATUS_PATH}?attemptId=${attemptId}&leg=customer`,
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          statusCallbackMethod: "POST",
        },
        attempt.customerPhone
      );

      await db
        .update(salesCallAttempts)
        .set({ status: "dialing_customer" })
        .where(eq(salesCallAttempts.id, attemptId));

      return res.send(twimlResponse.toString());
    } catch (error) {
      console.error("[BoldPitch] bridge-twiml error", error);
      return res.send(emptyTwiml());
    }
  });

  app.post(CALL_STATUS_PATH, async (req: Request, res: Response) => {
    try {
      if (!isValidTwilioRequest(req)) {
        return res.status(403).json({ ok: false, error: "invalid signature" });
      }

      const attemptId = Number(req.query.attemptId);
      const leg = String(req.query.leg ?? "");
      const db = await getDb();
      if (!db || !attemptId) return res.json({ ok: true, ignored: true });

      const body = (req.body ?? {}) as Record<string, string>;
      const callStatus = (body.CallStatus || "").toLowerCase();
      const durationSec = Number.parseInt(body.CallDuration ?? "0", 10) || 0;
      const TERMINAL = ["completed", "busy", "no-answer", "failed", "canceled"];

      if (leg === "rep") {
        if (callStatus === "in-progress" || callStatus === "answered") {
          await db
            .update(salesCallAttempts)
            .set({ status: "rep_connected" })
            .where(eq(salesCallAttempts.id, attemptId));
        } else if (TERMINAL.includes(callStatus) && callStatus !== "completed") {
          // Rep leg failed to connect at all — no customer leg was ever
          // dialed. Nothing to reward or fail on the frontend yet since the
          // engine only cares about the customer leg outcome; this state is
          // recorded for the durable attempt history.
          await db
            .update(salesCallAttempts)
            .set({ status: "failed", failureReason: `rep_leg_${callStatus}` })
            .where(eq(salesCallAttempts.id, attemptId));
        }
        return res.json({ ok: true });
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
        return res.json({ ok: true });
      }

      return res.json({ ok: true, ignored: leg });
    } catch (error) {
      console.error("[BoldPitch] call-status webhook error", error);
      return res.json({ ok: false });
    }
  });
}

function emptyTwiml(): string {
  const twimlResponse = new twilio.twiml.VoiceResponse();
  twimlResponse.hangup();
  return twimlResponse.toString();
}

function expectedSignature(secret: string, url: string, params: Record<string, unknown>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + String(params[k] ?? ""))
      .join("");
  return crypto.createHmac("sha1", secret).update(Buffer.from(data, "utf-8")).digest("base64");
}

function publicUrlFor(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0] || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

function isValidTwilioRequest(req: Request): boolean {
  if (!authToken) {
    return process.env.NODE_ENV !== "production";
  }
  const signature = req.headers["x-twilio-signature"];
  if (typeof signature !== "string" || !signature) return false;
  const expected = expectedSignature(authToken, publicUrlFor(req), (req.body ?? {}) as Record<string, unknown>);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Read-only status lookup for the frontend to poll after starting a call —
 * the picker/confirmation UI uses this to know when to call
 * completeWeaponAction/failWeaponAction. */
export async function getBoldPitchCallAttempt(attemptId: number): Promise<SalesCallAttempt | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(salesCallAttempts).where(eq(salesCallAttempts.id, attemptId)).limit(1);
  return rows[0] as SalesCallAttempt | undefined;
}
