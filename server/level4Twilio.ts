/**
 * Level 4 War — Twilio call-strike webhook.
 *
 * Every ATTEMPTED call is a strike: the rep who wins is the one who dials,
 * so no-answer scores too (exposure scoring against rejection sensitivity).
 * A connected conversation (answered, with duration) lands a heavier blow.
 *
 * Wiring: point a Twilio Voice status callback at
 *   POST /api/level4/twilio/call-status
 * Until the owner's Twilio account is activated for real traffic this route
 * simply receives nothing — the in-app LOG STRIKE button covers the loop.
 *
 * Security: when TWILIO_AUTH_TOKEN is set, X-Twilio-Signature is validated
 * (HMAC-SHA1 over the exact public URL + sorted POST params per Twilio spec).
 * Without the env var the route accepts unsigned posts ONLY outside
 * production, so local/dev testing stays easy and prod stays closed.
 */
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { recordLevel4WarAction } from "./level4War";

const CALL_STATUS_PATH = "/api/level4/twilio/call-status";

function expectedSignature(authToken: string, url: string, params: Record<string, unknown>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + String(params[k] ?? ""))
      .join("");
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function publicUrlFor(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0] || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

function isValidTwilioRequest(req: Request): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // No token configured: only allow in non-production so dev can simulate.
    return process.env.NODE_ENV !== "production";
  }
  const signature = req.headers["x-twilio-signature"];
  if (typeof signature !== "string" || !signature) return false;
  const expected = expectedSignature(
    authToken,
    publicUrlFor(req),
    (req.body ?? {}) as Record<string, unknown>
  );
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function registerLevel4TwilioRoutes(app: Express): void {
  app.post(CALL_STATUS_PATH, async (req: Request, res: Response) => {
    try {
      if (!isValidTwilioRequest(req)) {
        return res.status(403).json({ ok: false, error: "invalid signature" });
      }

      const body = (req.body ?? {}) as Record<string, string>;
      const callSid = body.CallSid || `nocallsid-${Date.now()}`;
      const callStatus = (body.CallStatus || "").toLowerCase();
      const durationSec = Number.parseInt(body.CallDuration ?? "0", 10) || 0;
      const tenantId = (req.query.tenant as string) || "default";

      // Terminal statuses only — ringing/in-progress are not strikes yet.
      const TERMINAL = ["completed", "busy", "no-answer", "failed", "canceled"];
      if (!TERMINAL.includes(callStatus)) {
        return res.json({ ok: true, ignored: callStatus });
      }

      // Every dial is a strike. A real conversation lands harder.
      const connected = callStatus === "completed" && durationSec >= 20;
      const result = await recordLevel4WarAction({
        tenantId,
        kind: connected ? "call_connected" : "call_strike",
        dedupeKey: `twilio:${callSid}`,
        meta: {
          callSid,
          callStatus,
          durationSec,
          to: body.To ?? null,
          from: body.From ?? null,
          source: "twilio_webhook",
        },
      });

      return res.json({
        ok: true,
        recorded: result.recorded,
        deduped: result.deduped,
        kind: result.kind,
      });
    } catch (error) {
      console.error("[Level4War][Twilio] webhook error", error);
      // Always 200-range Twilio responses after auth — retries won't help.
      return res.json({ ok: false });
    }
  });
}
