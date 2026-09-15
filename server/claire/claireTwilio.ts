import { createHash, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { ENV } from "../_core/env";
import { assertDriverCanReadMission } from "../commercialMissions/commercialMissionAuthorization";
import {
  getCommercialMissionFieldState,
  recordCommercialMissionVisitOutcome,
  saveCommercialMissionFieldNotes,
} from "../commercialMissions/commercialMissionFieldService";
import { recordClaireMissionOutcomeEvents, recordQualifyingClaireInteraction } from "./character/relationshipEmitters";
import { assembleClaireDriveContext } from "./contextAssembler";
import {
  ensureCurrentMissionSalesBrief,
  getLatestMissionSalesBrief,
} from "../missionSalesBrief/missionSalesBriefService";
import {
  handleVoiceCommitmentTurn,
  trackEmptyTranscript,
  trackNonEmptyTranscript,
} from "./voiceCommitmentLoop";
import { assembleTomorrowCandidates, confirmWorkdayPlan } from "./workdayPlanService";
import type { DayDirectorProposal } from "../../shared/dayDirector";
import {
  extractClaireDebrief,
  writeClaireOutcomeConfirmation,
  writeClairePostStopOpening,
} from "./reasoning";
import { generateClairePreDriveOutput } from "./preDriveRuntime";
import {
  answerClairePreDriveFollowUp,
  isClaireCallComplete,
} from "./preDriveConversation";
import {
  answerClaireBusinessTurn,
  hasPendingClaireAction,
  type ClaireAnalyticsSession,
} from "./businessConversation";
import {
  issueClaireToken,
  verifyClaireToken,
  type ClaireMissionAccess,
} from "./claireToken";
import { isClaireVoiceRecordingEnabled } from "./conversation/consent";
import {
  attachCallSid,
  createConversationSession,
  persistSpokenTurn,
} from "./conversation/ledgerService";
import {
  endClaireCallLedger,
  linkClaireCallAction,
  persistOperatorAndClaire,
  safeClaireLedger,
} from "./conversation/liveCall";
import {
  handleCallCompleted,
  handleRecordingStatus,
} from "./conversation/pipeline";
import { isValidTwilioWebhook } from "./conversation/twilioSignature";

const DEBRIEF_PATH = "/api/claire/twilio/debrief";
const CONFIRM_PATH = "/api/claire/twilio/confirm";
const PRE_DRIVE_PATH = "/api/claire/twilio/pre-drive";
export const CLAIRE_RECORDING_STATUS_PATH = "/api/claire/twilio/recording-status";
export const CLAIRE_CALL_STATUS_PATH = "/api/claire/twilio/call-status";
const CLAIRE_VOICE = "Polly.Ruth-Generative";
const PRE_DRIVE_CONVERSATION_TTL_MS = 30 * 60 * 1_000;
const MAX_PRE_DRIVE_TURNS = 24;
const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
const fromNumber = process.env.CLAIRE_TWILIO_FROM_NUMBER?.trim() ?? "";
const operatorNumber = process.env.CLAIRE_OPERATOR_PHONE?.trim() ?? "";
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

type PreDriveConversation = {
  tenantId: string;
  actorId: string;
  /** The identity Day Director commitments are actually keyed by — see dayDirectorActorId(ctx). Never inferred from speech. */
  dayDirectorActorId: string;
  brief: string;
  context: Awaited<ReturnType<typeof assembleClaireDriveContext>>;
  turns: number;
  touchedAt: number;
  /** Voice commitment loop: a proposed Day Director commitment awaiting explicit yes/no. */
  pendingProposal?: DayDirectorProposal | null;
  /** An utterance whose new-vs-existing-work status was ambiguous; awaiting the operator's clarifying reply. */
  clarifyingUtterance?: string | null;
  /** Consecutive empty Twilio speech results — only two in a row end the call. */
  consecutiveEmptyTranscripts?: number;
  sessionKind?: "evening_planning" | "morning_reconciliation" | "field_debrief" | "pre_drive";
  /** Analytical follow-up context for this call only. Never business truth. */
  analytics?: ClaireAnalyticsSession | null;
};

const preDriveConversations = new Map<string, PreDriveConversation>();

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
  const body = (req.body ?? {}) as Record<string, string>;
  return isValidTwilioWebhook({
    authToken,
    signature: req.headers["x-twilio-signature"],
    urls: [publicUrlFor(req), `${publicBaseUrl()}${req.originalUrl}`],
    body,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
}

export function spokenClaireText(text: string, opening = false): string {
  return opening ? `Adam. Claire here. ${text}` : text;
}

export function claireVoiceCallCreateOptions(): {
  record: boolean;
  recordingChannels?: "dual";
  recordingStatusCallback?: string;
  recordingStatusCallbackEvent?: Array<"completed" | "absent">;
  recordingStatusCallbackMethod?: "POST";
  statusCallback: string;
  statusCallbackEvent: ["completed"];
  statusCallbackMethod: "POST";
} {
  const recordingEnabled = isClaireVoiceRecordingEnabled();
  return {
    record: recordingEnabled,
    ...(recordingEnabled
      ? {
          recordingChannels: "dual" as const,
          recordingStatusCallback: `${publicBaseUrl()}${CLAIRE_RECORDING_STATUS_PATH}`,
          recordingStatusCallbackEvent: ["completed" as const, "absent" as const],
          recordingStatusCallbackMethod: "POST" as const,
        }
      : {}),
    statusCallback: `${publicBaseUrl()}${CLAIRE_CALL_STATUS_PATH}`,
    statusCallbackEvent: ["completed"],
    statusCallbackMethod: "POST",
  };
}

function callSidFrom(req: Request): string | undefined {
  const sid = String(((req.body ?? {}) as Record<string, string>).CallSid ?? "").trim();
  return sid || undefined;
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
  const say = response.say({ voice: CLAIRE_VOICE, language: "en-US" }, "");
  say.prosody({ rate: "90%", volume: "+6dB" }, text);
  response.hangup();
  return response.toString();
}

export function preDriveConversationTwiML(input: {
  text: string;
  token: string;
  opening?: boolean;
}): string {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    action: `${publicBaseUrl()}${PRE_DRIVE_PATH}?token=${encodeURIComponent(input.token)}`,
    method: "POST",
    language: "en-US",
    speechModel: "experimental_conversations",
    speechTimeout: "2",
    timeout: 5,
    maxSpeechTime: 20,
    actionOnEmptyResult: true,
    bargeIn: true,
    hints: "got it, I'm good, that's enough, end call, hang up, goodbye",
  });
  const say = gather.say({ voice: CLAIRE_VOICE, language: "en-US" }, "");
  say.prosody(
    { rate: "90%", volume: "+6dB" },
    spokenClaireText(input.text, input.opening)
  );
  response.hangup();
  return response.toString();
}

/**
 * Relationship-event writes are best-effort telemetry on top of the real
 * call flow, never a precondition for it — a failure here must never
 * change what Claire says or does on the call, and must never surface to
 * the caller. See character/relationshipEmitters.ts for the fail-closed
 * identity contract (operatorUserId here is always the token-verified
 * `claims.userId`/`conversation.actorId`, never a Twilio ANI/CallerId).
 */
async function safeRecordRelationshipEvent(
  work: () => Promise<unknown>
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn("[Claire] relationship-event recording failed", error);
  }
}

function clearExpiredPreDriveConversations(now = Date.now()): void {
  preDriveConversations.forEach((conversation, id) => {
    if (now - conversation.touchedAt > PRE_DRIVE_CONVERSATION_TTL_MS) {
      preDriveConversations.delete(id);
    }
  });
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
  missionId?: number;
  /** The identity Day Director commitments (and Driver's dayline) are actually keyed by — see dayDirectorActorId(ctx). */
  dayDirectorActorId?: string;
}): Promise<{ callSid: string; brief: string }> {
  const to = configuredOperatorPhone();
  const generated = await generateClairePreDriveOutput({
    tenantId: input.tenantId,
    actorId: input.actorId,
    timeZone: input.timeZone,
    missionId: input.missionId,
    dayDirectorActorId: input.dayDirectorActorId,
  });
  const { brief, context } = generated;
  clearExpiredPreDriveConversations();
  const conversationId = randomUUID();
  preDriveConversations.set(conversationId, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    dayDirectorActorId: input.dayDirectorActorId ?? input.actorId,
    brief,
    context,
    turns: 0,
    touchedAt: Date.now(),
    sessionKind: context.workday?.session,
  });
  const token = issueClaireToken({
    kind: "pre_drive_conversation",
    tenantId: input.tenantId,
    userId: input.actorId,
    conversationId,
  });
  const recordingEnabled = isClaireVoiceRecordingEnabled();
  await safeClaireLedger(() =>
    createConversationSession({
      tenantId: input.tenantId,
      operatorUserId: input.actorId,
      claireConversationId: conversationId,
      conversationKind: context.workday?.session ?? "pre_drive",
      missionId: input.missionId ?? null,
      recordingEnabled,
    })
  );
  try {
    const call = await client!.calls.create({
      to,
      from: assertPhone(fromNumber),
      twiml: preDriveConversationTwiML({ text: brief, token, opening: true }),
      ...claireVoiceCallCreateOptions(),
    });
    await safeClaireLedger(async () => {
      await attachCallSid({
        claireConversationId: conversationId,
        callSid: call.sid,
      });
      await persistSpokenTurn({
        claireConversationId: conversationId,
        callSid: call.sid,
        speaker: "CLAIRE",
        text: spokenClaireText(brief, true),
      });
    });
    return { callSid: call.sid, brief };
  } catch (error) {
    preDriveConversations.delete(conversationId);
    await endClaireCallLedger({
      claireConversationId: conversationId,
      reason: "call_create_failed",
    });
    throw error;
  }
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
    throw new Error(
      "Claire debrief requires an authoritative arrived field state"
    );
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
  const opening = await writeClairePostStopOpening({
    tenantId: input.tenantId,
    operatorUserId: input.actorId,
    accountName: context.mission.accountName,
  });
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    speechTimeout: "auto",
    action: `${publicBaseUrl()}${DEBRIEF_PATH}?token=${encodeURIComponent(token)}`,
    method: "POST",
  });
  gather.say({ voice: CLAIRE_VOICE, language: "en-US" }, opening);
  response.say(
    { voice: CLAIRE_VOICE, language: "en-US" },
    "I didn't catch a debrief. Nothing was changed."
  );
  response.hangup();

  const conversationId = randomUUID();
  await safeClaireLedger(() =>
    createConversationSession({
      tenantId: input.tenantId,
      operatorUserId: input.actorId,
      claireConversationId: conversationId,
      conversationKind: "field_debrief",
      missionId: input.missionId,
      recordingEnabled: isClaireVoiceRecordingEnabled(),
    })
  );
  const call = await client!.calls.create({
    to,
    from: assertPhone(fromNumber),
    twiml: response.toString(),
    ...claireVoiceCallCreateOptions(),
  });
  await safeClaireLedger(async () => {
    await attachCallSid({
      claireConversationId: conversationId,
      callSid: call.sid,
    });
    await persistSpokenTurn({
      claireConversationId: conversationId,
      callSid: call.sid,
      speaker: "CLAIRE",
      text: opening,
    });
  });
  return { callSid: call.sid };
}

export function registerClaireRoutes(app: Express): void {
  app.post(PRE_DRIVE_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res
        .status(403)
        .send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const claims = verifyClaireToken(String(req.query.token ?? ""));
      if (claims.kind !== "pre_drive_conversation") {
        return res.send(
          speakAndHangUp("This pre-drive conversation is no longer valid.")
        );
      }
      clearExpiredPreDriveConversations();
      const conversation = preDriveConversations.get(claims.conversationId);
      if (
        !conversation ||
        conversation.tenantId !== claims.tenantId ||
        conversation.actorId !== claims.userId
      ) {
        const hangup =
          "I lost the current brief, so I won't guess. We'll pick this up in Goldline.";
        await endClaireCallLedger({
          callSid: callSidFrom(req),
          claireConversationId: claims.conversationId,
          claireText: hangup,
          reason: "lost_in_memory_conversation",
        });
        return res.send(speakAndHangUp(hangup));
      }

      const transcript = String(
        ((req.body ?? {}) as Record<string, string>).SpeechResult ?? ""
      ).trim();
      const callSid = callSidFrom(req);
      if (!transcript) {
        conversation.touchedAt = Date.now();
        const { shouldEndCall } = trackEmptyTranscript(conversation);
        if (shouldEndCall) {
          preDriveConversations.delete(claims.conversationId);
          const hangup = "All right. I'll let you focus on the drive.";
          await endClaireCallLedger({
            callSid,
            claireConversationId: claims.conversationId,
            claireText: hangup,
            reason: "empty_transcript",
          });
          return res.send(speakAndHangUp(hangup));
        }
        const prompt = "Go ahead, I'm listening.";
        await persistOperatorAndClaire({
          callSid,
          claireConversationId: claims.conversationId,
          claireText: prompt,
        });
        return res.send(
          preDriveConversationTwiML({
            text: prompt,
            token: String(req.query.token),
          })
        );
      }
      trackNonEmptyTranscript(conversation);
      if (isClaireCallComplete(transcript)) {
        preDriveConversations.delete(claims.conversationId);
        await safeRecordRelationshipEvent(() =>
          recordQualifyingClaireInteraction({
            tenantId: claims.tenantId,
            operatorUserId: claims.userId,
            conversationId: claims.conversationId,
            reason: "closing_phrase",
          })
        );
        const hangup = "You've got it. Drive safe.";
        await endClaireCallLedger({
          callSid,
          claireConversationId: claims.conversationId,
          operatorText: transcript,
          claireText: hangup,
          reason: "closing_phrase",
        });
        return res.send(speakAndHangUp(hangup));
      }
      if (conversation.turns >= MAX_PRE_DRIVE_TURNS) {
        preDriveConversations.delete(claims.conversationId);
        await safeRecordRelationshipEvent(() =>
          recordQualifyingClaireInteraction({
            tenantId: claims.tenantId,
            operatorUserId: claims.userId,
            conversationId: claims.conversationId,
            reason: "turn_cap_reached",
          })
        );
        const hangup =
          "That's the useful part of this brief. Drive safe, and take it one stop at a time.";
        await endClaireCallLedger({
          callSid,
          claireConversationId: claims.conversationId,
          operatorText: transcript,
          claireText: hangup,
          reason: "turn_cap_reached",
        });
        return res.send(speakAndHangUp(hangup));
      }

      // Business questions are answered from deterministic analytics before
      // the work classifier runs, unless a yes/no confirmation is pending.
      if (!hasPendingClaireAction(conversation)) {
        const businessTurn = await answerClaireBusinessTurn({
          tenantId: conversation.tenantId,
          utterance: transcript,
          state: conversation,
          surface: "voice",
        });
        if (businessTurn.handled) {
          conversation.turns += 1;
          conversation.touchedAt = Date.now();
          await persistOperatorAndClaire({
            callSid,
            claireConversationId: claims.conversationId,
            operatorText: transcript,
            claireText: businessTurn.speak,
          });
          return res.send(
            preDriveConversationTwiML({
              text: businessTurn.speak,
              token: String(req.query.token),
            })
          );
        }
      }

      let commitmentTurn: Awaited<ReturnType<typeof handleVoiceCommitmentTurn>>;
      try {
        commitmentTurn = await handleVoiceCommitmentTurn({
          tenantId: conversation.tenantId,
          actorId: conversation.dayDirectorActorId,
          businessDate: conversation.context.businessDate,
          utterance: transcript,
          state: conversation,
          conversationId: claims.conversationId,
        }, {
          confirmPlan: () =>
            confirmWorkdayPlan({
              tenantId: conversation.tenantId,
              actorId: conversation.dayDirectorActorId,
              businessDate:
                conversation.context.clock?.tomorrowBusinessDate ??
                conversation.context.businessDate,
              items: assembleTomorrowCandidates(conversation.context),
            }).then(() => undefined),
        });
      } catch (error) {
        // Hard truth rule: never let conversational fluency outrun system
        // truth. A failed persistence must never be reported as a success.
        console.error("[Claire] voice commitment turn failed", error);
        conversation.turns += 1;
        conversation.touchedAt = Date.now();
        const retry = "I understood it, but I couldn't save it. Let's try again in a moment.";
        await persistOperatorAndClaire({
          callSid,
          claireConversationId: claims.conversationId,
          operatorText: transcript,
          claireText: retry,
        });
        return res.send(
          preDriveConversationTwiML({
            text: retry,
            token: String(req.query.token),
          })
        );
      }
      if (commitmentTurn.kind !== "not_applicable") {
        conversation.turns += 1;
        conversation.touchedAt = Date.now();
        await persistOperatorAndClaire({
          callSid,
          claireConversationId: claims.conversationId,
          operatorText: transcript,
          claireText: commitmentTurn.speak,
        });
        await linkClaireCallAction({
          callSid,
          claireConversationId: claims.conversationId,
          turn: commitmentTurn,
        });
        return res.send(
          preDriveConversationTwiML({
            text: commitmentTurn.speak,
            token: String(req.query.token),
          })
        );
      }

      const answer = await answerClairePreDriveFollowUp({
        tenantId: conversation.tenantId,
        utterance: transcript,
        brief: conversation.brief,
        context: conversation.context,
      });
      conversation.turns += 1;
      conversation.touchedAt = Date.now();
      await persistOperatorAndClaire({
        callSid,
        claireConversationId: claims.conversationId,
        operatorText: transcript,
        claireText: answer,
      });
      return res.send(
        preDriveConversationTwiML({
          text: answer,
          token: String(req.query.token),
        })
      );
    } catch (error) {
      console.error("[Claire] pre-drive conversation webhook error", error);
      return res.send(
        speakAndHangUp(
          "I couldn't answer that safely from today's brief, so I won't guess. Drive safe."
        )
      );
    }
  });

  app.post(DEBRIEF_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res
        .status(403)
        .send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const token = String(req.query.token ?? "");
      const claims = verifyClaireToken(token);
      if (claims.kind !== "drive_call" || claims.phase !== "post_stop") {
        return res.send(
          speakAndHangUp("This debrief link is no longer valid.")
        );
      }
      const body = (req.body ?? {}) as Record<string, string>;
      const transcript = String(body.SpeechResult ?? "").trim();
      const callSid = String(body.CallSid ?? "unknown-call");
      const ledgerCallSid = callSidFrom(req);
      if (!transcript) {
        const hangup = "I didn't catch that. Nothing was changed.";
        await endClaireCallLedger({
          callSid: ledgerCallSid,
          claireText: hangup,
          reason: "empty_debrief",
        });
        return res.send(speakAndHangUp(hangup));
      }

      const current = await getCommercialMissionFieldState({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
      });
      if (!current?.field?.arrivedAt) {
        return res.send(
          speakAndHangUp(
            "Goldline does not have verified arrival for this stop, so I left business truth unchanged."
          )
        );
      }
      assertMissionAccess({
        mission: current.mission,
        userId: claims.userId,
        missionAccess: claims.missionAccess,
      });
      if (current.visitOutcome) {
        return res.send(
          speakAndHangUp("This visit already has a recorded outcome.")
        );
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
        { voice: CLAIRE_VOICE, language: "en-US" },
        `I heard: ${proposal.summary}. I would record this as ${outcomeLabel(proposal.proposedOutcome)}. Say confirm to save that outcome, or cancel to leave only your raw debrief.`
      );
      response.say(
        { voice: CLAIRE_VOICE, language: "en-US" },
        "No confirmation received. I kept your raw debrief, but did not record an outcome."
      );
      response.hangup();
      await persistOperatorAndClaire({
        callSid: ledgerCallSid,
        operatorText: transcript,
        claireText: `I heard: ${proposal.summary}. I would record this as ${outcomeLabel(proposal.proposedOutcome)}. Say confirm to save that outcome, or cancel to leave only your raw debrief.`,
      });
      return res.send(response.toString());
    } catch (error) {
      console.error("[Claire] debrief webhook error", error);
      return res.send(
        speakAndHangUp(
          "I couldn't safely interpret that. Your business outcome was not changed."
        )
      );
    }
  });

  app.post(CONFIRM_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res
        .status(403)
        .send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const claims = verifyClaireToken(String(req.query.token ?? ""));
      if (claims.kind !== "debrief_approval") {
        return res.send(
          speakAndHangUp("This confirmation is no longer valid.")
        );
      }
      const body = (req.body ?? {}) as Record<string, string>;
      const confirmation = String(body.SpeechResult ?? "")
        .trim()
        .toLowerCase();
      const ledgerCallSid = callSidFrom(req);
      if (!/\b(confirm|confirmed|yes|save it|correct)\b/.test(confirmation)) {
        const hangup =
          "Cancelled. I kept the raw debrief but did not record a business outcome.";
        await endClaireCallLedger({
          callSid: ledgerCallSid,
          operatorText: confirmation,
          claireText: hangup,
          reason: "debrief_cancelled",
        });
        return res.send(speakAndHangUp(hangup));
      }
      const current = await getCommercialMissionFieldState({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
      });
      if (!current?.field || !current.field.arrivedAt) {
        return res.send(
          speakAndHangUp(
            "Verified arrival is missing, so I did not change the visit outcome."
          )
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
      const priorBrief = await getLatestMissionSalesBrief({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
      }).catch(() => null);
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
      await safeRecordRelationshipEvent(() =>
        recordClaireMissionOutcomeEvents({
          tenantId: claims.tenantId,
          operatorUserId: claims.userId,
          missionId: claims.missionId,
          outcome: claims.proposal.proposedOutcome,
        })
      );
      // Real evidence (the just-persisted visit outcome) has changed, so
      // the next request for the mission's brief creates a new immutable
      // version rather than mutating v1 — never triggered by Claire's own
      // wording, only by this authoritative business-truth write.
      const newBrief = await ensureCurrentMissionSalesBrief({
        tenantId: claims.tenantId,
        missionId: claims.missionId,
      }).catch(() => null);
      const strategyChange =
        newBrief && priorBrief && newBrief.version !== priorBrief.version
          ? {
              previousObjective: priorBrief.recommendedApproach.primaryObjective,
              newObjective: newBrief.recommendedApproach.primaryObjective,
              newlyKnown: newBrief.knownFacts
                .filter(fact => !priorBrief.knownFacts.some(prior => prior.text === fact.text))
                .map(fact => fact.text),
            }
          : null;
      const confirmationLine = await writeClaireOutcomeConfirmation({
        tenantId: claims.tenantId,
        operatorUserId: claims.userId,
        outcome: claims.proposal.proposedOutcome,
        outcomeLabel: outcomeLabel(claims.proposal.proposedOutcome),
        strategyChange,
      });
      await endClaireCallLedger({
        callSid: ledgerCallSid,
        operatorText: confirmation,
        claireText: confirmationLine,
        reason: "debrief_confirmed",
      });
      return res.send(speakAndHangUp(confirmationLine));
    } catch (error) {
      console.error("[Claire] confirm webhook error", error);
      return res.send(
        speakAndHangUp(
          "I couldn't safely save that outcome, so business truth was left unchanged."
        )
      );
    }
  });

  app.post(CLAIRE_RECORDING_STATUS_PATH, async (req: Request, res: Response) => {
    if (!validTwilioRequest(req)) {
      return res.status(403).send("Forbidden");
    }
    const body = (req.body ?? {}) as Record<string, string>;
    res.status(204).end();
    void handleRecordingStatus({
      callSid: String(body.CallSid ?? ""),
      recordingSid: String(body.RecordingSid ?? ""),
      recordingStatus: String(body.RecordingStatus ?? ""),
      recordingDuration: body.RecordingDuration,
      recordingChannels: body.RecordingChannels,
      recordingTrack: body.RecordingTrack,
      accountSid,
      authToken,
    }).catch(error => {
      console.error("[ClaireLedger] recording-status failed", error);
    });
  });

  app.post(CLAIRE_CALL_STATUS_PATH, async (req: Request, res: Response) => {
    if (!validTwilioRequest(req)) {
      return res.status(403).send("Forbidden");
    }
    const body = (req.body ?? {}) as Record<string, string>;
    res.status(204).end();
    void handleCallCompleted({
      callSid: String(body.CallSid ?? ""),
      callStatus: String(body.CallStatus ?? body.CallStatusEvent ?? ""),
    }).catch(error => {
      console.error("[ClaireLedger] call-status failed", error);
    });
  });
}
