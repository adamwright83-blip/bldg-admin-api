import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { ENV } from "../_core/env";
import { assertDriverCanReadMission } from "../commercialMissions/commercialMissionAuthorization";
import {
  getCommercialMissionFieldState,
  recordCommercialMissionVisitOutcome,
  saveCommercialMissionFieldNotes,
} from "../commercialMissions/commercialMissionFieldService";
import { assembleClaireDriveContext } from "./contextAssembler";
import { extractClaireDebrief, writeClairePreDriveBrief } from "./reasoning";
import {
  issueClaireToken,
  verifyClaireToken,
  type ClaireMissionAccess,
} from "./claireToken";

const DEBRIEF_PATH = "/api/claire/twilio/debrief";
const CONFIRM_PATH = "/api/claire/twilio/confirm";
const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
const fromNumber = process.env.CLAIRE_TWILIO_FROM_NUMBER?.trim() ?? "";
const operatorNumber = process.env.CLAIRE_OPERATOR_PHONE?.trim() ?? "";
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

function publicBaseUrl(): string {
  return ENV.adminBaseUrl.replace(/\/$/, "");
}

function normalizeE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}

function assertPhone(value: string): string {
  const normalized = normalizeE164(value);
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Claire requires a valid E.164 phone number");
  }
  return normalized;
}

function assertTwilioConfigured(): void {
  if (!client || !fromNumber || !operatorNumber) {
    throw new Error(
      "Claire calling is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CLAIRE_TWILIO_FROM_NUMBER, and CLAIRE_OPERATOR_PHONE are required)"
    );
  }
}

function configuredOperatorPhone(): string {
  assertTwilioConfigured();
  return assertPhone(operatorNumber);
}

function stableRequestId(callSid: string, suffix: string): string {
  return createHash("sha256")
    .update(`claire:${callSid}:${suffix}`)
    .digest("hex")
    .slice(0, 48);
}

function publicUrlFor(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string)?.split(",")[0] ||
    req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

function validTwilioRequest(req: Request): boolean {
  if (!authToken) return process.env.NODE_ENV !== "production";
  const signature = req.headers["x-twilio-signature"];
  if (typeof signature !== "string" || !signature) return false;
  return twilio.validateRequest(
    authToken,
    signature,
    publicUrlFor(req),
    (req.body ?? {}) as Record<string, string>
  );
}

function assertMissionAccess(input: {
  mission: Parameters<typeof assertDriverCanReadMission>[0]["mission"];
  userId: string;
  missionAccess: ClaireMissionAccess;
}): void {
  assertDriverCanReadMission({
    mission: input.mission,
    userId: input.userId,
    isAdmin: input.missionAccess === "operator",
  });
}

function speakAndHangUp(text: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say({ voice: "Polly.Joanna" }, text);
  response.hangup();
  return response.toString();
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "no_contact":
      return "no contact";
    case "no_decision":
      return "no decision";
    case "follow_up":
      return "follow up";
    case "won":
      return "won";
    case "lost":
      return "lost";
    default:
      return outcome;
  }
}

export async function startClairePreDriveCall(input: {
  tenantId: string;
  actorId: string;
  timeZone?: string;
}): Promise<{ callSid: string; brief: string }> {
  const to = configuredOperatorPhone();
  const context = await assembleClaireDriveContext({
    tenantId: input.tenantId,
    actorId: input.actorId,
    phase: "pre_drive",
    timeZone: input.timeZone,
  });
  const brief = await writeClairePreDriveBrief({
    tenantId: input.tenantId,
    context,
  });
  const call = await client!.calls.create({
    to,
    from: assertPhone(fromNumber),
    twiml: speakAndHangUp(brief),
    record: false,
  });
  return { callSid: call.sid, brief };
}

export async function startClairePostStopCall(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  missionAccess: ClaireMissionAccess;
  timeZone?: string;
}): Promise<{ callSid: string }> {
  const to = configuredOperatorPhone();
  const current = await getCommercialMissionFieldState({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  if (!current) throw new Error("Commercial mission not found");
  assertMissionAccess({
    mission: current.mission,
    userId: input.actorId,
    missionAccess: input.missionAccess,
  });
  if (!current.field?.arrivedAt) {
    throw new Error("Claire debrief requires an authoritative arrived field state");
  }
  if (current.visitOutcome) {
    throw new Error("This visit already has a recorded outcome");
  }

  const context = await assembleClaireDriveContext({
    tenantId: input.tenantId,
    actorId: input.actorId,
    phase: "post_stop",
    missionId: input.missionId,
    timeZone: input.timeZone,
  });
  if (!context.mission) throw new Error("Commercial mission not found");

  const token = issueClaireToken({
    kind: "drive_call",
    tenantId: input.tenantId,
    userId: input.actorId,
    missionId: input.missionId,
    missionAccess: input.missionAccess,
    phase: "post_stop",
  });
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    speechTimeout: "auto",
    action: `${publicBaseUrl()}${DEBRIEF_PATH}?token=${encodeURIComponent(token)}`,
    method: "POST",
  });
  gather.say(
    { voice: "Polly.Joanna" },
    `You're clear of ${context.mission.accountName}. Tell me what actually happened. I won't mark anything won, lost, or followed up unless you say it.`
  );
  response.say(
    { voice: "Polly.Joanna" },
    "I didn't catch a debrief. Nothing was changed."
  );
  response.hangup();

  const call = await client!.calls.create({
    to,
    from: assertPhone(fromNumber),
    twiml: response.toString(),
    record: false,
  });
  return { callSid: call.sid };
}

export function registerClaireRoutes(app: Express): void {
  app.post(DEBRIEF_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res.status(403).send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const token = String(req.query.token ?? "");
      const claims = verifyClaireToken(token);
      if (claims.kind !== "drive_call" || claims.phase !== "post_stop") {
        return res.send(speakAndHangUp("This debrief link is no longer valid."));
      }
      const body = (req.body ?? {}) as Record<string, string>;
      const transcript = String(body.SpeechResult ?? "").trim();
      const callSid = String(body.CallSid ?? "unknown-call");
      if (!transcript) {
        return res.send(speakAndHangUp("I didn't catch that. Nothing was changed."));
      }

      const current = await getCommercialMissionFieldState({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
      });
      if (!current?.field?.arrivedAt) {
        return res.send(
          speakAndHangUp("Goldline does not have verified arrival for this stop, so I left business truth unchanged.")
        );
      }
      assertMissionAccess({
        mission: current.mission,
        userId: claims.userId,
        missionAccess: claims.missionAccess,
      });
      if (current.visitOutcome) {
        return res.send(speakAndHangUp("This visit already has a recorded outcome."));
      }

      await saveCommercialMissionFieldNotes({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
        actorId: claims.userId,
        expectedFieldVersion: current.field.version,
        notes: transcript,
        requestId: stableRequestId(callSid, "raw-debrief"),
      });

      const context = await assembleClaireDriveContext({
        tenantId: claims.tenantId,
        actorId: claims.userId,
        phase: "post_stop",
        missionId: claims.missionId,
      });
      const proposal = await extractClaireDebrief({
        tenantId: claims.tenantId,
        transcript,
        context,
      });
      const approvalToken = issueClaireToken({
        kind: "debrief_approval",
        tenantId: claims.tenantId,
        userId: claims.userId,
        missionId: claims.missionId,
        missionAccess: claims.missionAccess,
        requestId: stableRequestId(callSid, "confirmed-outcome"),
        proposal,
      });
      const response = new twilio.twiml.VoiceResponse();
      const gather = response.gather({
        input: ["speech"],
        speechTimeout: "auto",
        action: `${publicBaseUrl()}${CONFIRM_PATH}?token=${encodeURIComponent(approvalToken)}`,
        method: "POST",
      });
      gather.say(
        { voice: "Polly.Joanna" },
        `I heard: ${proposal.summary}. I would record this as ${outcomeLabel(proposal.proposedOutcome)}. Say confirm to save that outcome, or cancel to leave only your raw debrief.`
      );
      response.say(
        { voice: "Polly.Joanna" },
        "No confirmation received. I kept your raw debrief, but did not record an outcome."
      );
      response.hangup();
      return res.send(response.toString());
    } catch (error) {
      console.error("[Claire] debrief webhook error", error);
      return res.send(
        speakAndHangUp("I couldn't safely interpret that. Your business outcome was not changed.")
      );
    }
  });

  app.post(CONFIRM_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res.status(403).send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const claims = verifyClaireToken(String(req.query.token ?? ""));
      if (claims.kind !== "debrief_approval") {
        return res.send(speakAndHangUp("This confirmation is no longer valid."));
      }
      const body = (req.body ?? {}) as Record<string, string>;
      const confirmation = String(body.SpeechResult ?? "").trim().toLowerCase();
      if (!/\b(confirm|confirmed|yes|save it|correct)\b/.test(confirmation)) {
        return res.send(
          speakAndHangUp("Cancelled. I kept the raw debrief but did not record a business outcome.")
        );
      }
      const current = await getCommercialMissionFieldState({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
      });
      if (!current?.field || !current.field.arrivedAt) {
        return res.send(
          speakAndHangUp("Verified arrival is missing, so I did not change the visit outcome.")
        );
      }
      assertMissionAccess({
        mission: current.mission,
        userId: claims.userId,
        missionAccess: claims.missionAccess,
      });
      if (current.visitOutcome) {
        return res.send(speakAndHangUp("That outcome was already saved."));
      }
      await recordCommercialMissionVisitOutcome({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
        actorId: claims.userId,
        expectedMissionVersion: current.mission.version,
        expectedFieldVersion: current.field.version,
        requestId: claims.requestId,
        outcome: claims.proposal.proposedOutcome,
        notes: current.field.notes,
        followUpAt: claims.proposal.followUpAt
          ? new Date(claims.proposal.followUpAt)
          : undefined,
        decisionMakerStatus: claims.proposal.decisionMakerStatus,
        collateralDelivered: claims.proposal.collateralDelivered,
        quoteRequested: claims.proposal.quoteRequested,
        pilotRequested: claims.proposal.pilotRequested,
        followUpRequested: claims.proposal.followUpRequested,
      });
      return res.send(
        speakAndHangUp(`Confirmed. I saved ${outcomeLabel(claims.proposal.proposedOutcome)} and left anything you didn't report unresolved.`)
      );
    } catch (error) {
      console.error("[Claire] confirm webhook error", error);
      return res.send(
        speakAndHangUp("I couldn't safely save that outcome, so business truth was left unchanged.")
      );
    }
  });
}
