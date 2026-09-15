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
import { trackEmptyTranscript, trackNonEmptyTranscript } from "./voiceCommitmentLoop";
import { assembleTomorrowCandidates, confirmWorkdayPlan } from "./workdayPlanService";
import {
  extractClaireDebrief,
  writeClaireOutcomeConfirmation,
  writeClairePostStopOpening,
} from "./reasoning";
import { generateClairePreDriveOutput } from "./preDriveRuntime";
import { isClaireCallComplete } from "./preDriveConversation";
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
  linkClaireActionIds,
  linkClaireCallAction,
  persistOperatorAndClaire,
  safeClaireLedger,
} from "./conversation/liveCall";
import {
  handleCallCompleted,
  handleRecordingStatus,
} from "./conversation/pipeline";
import { isValidTwilioWebhook } from "./conversation/twilioSignature";
import { runClaireTurn, type ClaireTurnState } from "./turn/claireTurn";
import { claireConversationStateStore } from "./turn/conversationStateStore";
import { claireEncyclopediaFor } from "./turn/claireTurnWiring";
import { loadBusinessVocabulary, speechHints } from "./knowledge/businessVocabulary";

const DEBRIEF_PATH = "/api/claire/twilio/debrief";
const CONFIRM_PATH = "/api/claire/twilio/confirm";
const PRE_DRIVE_PATH = "/api/claire/twilio/pre-drive";
const CONTINUE_PATH = "/api/claire/twilio/pre-drive/continue";
export const CLAIRE_RECORDING_STATUS_PATH = "/api/claire/twilio/recording-status";
export const CLAIRE_CALL_STATUS_PATH = "/api/claire/twilio/call-status";
const CLAIRE_VOICE = "Polly.Ruth-Generative";
const PRE_DRIVE_CONVERSATION_TTL_MS = 45 * 60 * 1_000;
const MAX_PRE_DRIVE_TURNS = 80;
/** Twilio abandons a call webhook at 15 seconds; answer or hand off well before that. */
const TURN_BUDGET_MS = 11_000;
const MAX_HINT_CHARS = 2_200;
const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
const fromNumber = process.env.CLAIRE_TWILIO_FROM_NUMBER?.trim() ?? "";
const operatorNumber = process.env.CLAIRE_OPERATOR_PHONE?.trim() ?? "";
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

const DEFAULT_HINTS = "got it, I'm good, that's enough, end call, hang up, goodbye";

/**
 * A live call's working state. It is persisted (claire_conversation_states),
 * so a deploy, a restart, or a webhook landing on another replica does not
 * make Claire forget the brief, a pending briefing, or the thread.
 */
type PreDriveConversation = ClaireTurnState & {
  tenantId: string;
  actorId: string;
  /** The identity Day Director commitments are actually keyed by — see dayDirectorActorId(ctx). Never inferred from speech. */
  dayDirectorActorId: string;
  brief: string;
  context: Awaited<ReturnType<typeof assembleClaireDriveContext>>;
  turns: number;
  touchedAt: number;
  sessionKind?: "evening_planning" | "morning_reconciliation" | "field_debrief" | "pre_drive";
  /** Business names for speech recognition, loaded once per call. */
  hints?: string;
};

function callStateKey(conversationId: string): string {
  return `claire-call:${conversationId}`;
}

async function loadCall(conversationId: string): Promise<PreDriveConversation | null> {
  const stored = await claireConversationStateStore().load<PreDriveConversation>(callStateKey(conversationId));
  return stored?.state ?? null;
}

async function saveCall(conversationId: string, conversation: PreDriveConversation): Promise<void> {
  await claireConversationStateStore().save(
    callStateKey(conversationId),
    { tenantId: conversation.tenantId, operatorUserId: conversation.actorId, surface: "voice" },
    conversation,
    PRE_DRIVE_CONVERSATION_TTL_MS
  );
}

async function dropCall(conversationId: string): Promise<void> {
  await claireConversationStateStore()
    .remove(callStateKey(conversationId))
    .catch(error => console.warn("[Claire] could not clear call state", error));
}

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

function operatorPhoneMap(): Record<string, string> | null {
  const raw = process.env.CLAIRE_OPERATOR_PHONES?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  } catch {
    throw new Error("CLAIRE_OPERATOR_PHONES must be a JSON object mapping operator id to phone number");
  }
}

function assertTwilioConfigured(): void {
  if (!client || !fromNumber || (!operatorNumber && !process.env.CLAIRE_OPERATOR_PHONES?.trim())) {
    throw new Error(
      "Claire calling is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CLAIRE_TWILIO_FROM_NUMBER, and CLAIRE_OPERATOR_PHONE or CLAIRE_OPERATOR_PHONES are required)"
    );
  }
}

/**
 * The number Claire dials for this operator. When CLAIRE_OPERATOR_PHONES is
 * configured, an operator without an entry is never dialed on someone else's
 * phone; otherwise the single configured operator phone is used.
 */
export function operatorPhoneFor(actorId: string): string {
  assertTwilioConfigured();
  const map = operatorPhoneMap();
  if (map) {
    const phone = map[actorId];
    if (!phone) throw new Error("No Claire phone number is configured for this operator");
    return assertPhone(phone);
  }
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

function boundedHints(hints: string | null | undefined): string {
  const value = hints?.trim() || DEFAULT_HINTS;
  if (value.length <= MAX_HINT_CHARS) return value;
  return value.slice(0, value.lastIndexOf(",", MAX_HINT_CHARS)).trim();
}

export function preDriveConversationTwiML(input: {
  text: string;
  token: string;
  opening?: boolean;
  hints?: string | null;
  /** Listen without speaking — the operator paused mid-thought. */
  listenOnly?: boolean;
}): string {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    action: `${publicBaseUrl()}${PRE_DRIVE_PATH}?token=${encodeURIComponent(input.token)}`,
    method: "POST",
    language: "en-US",
    speechModel: "experimental_conversations",
    // A morning briefing is a list spoken with pauses. Wait for three seconds
    // of silence before closing a turn, and allow a full minute of speech.
    speechTimeout: "3",
    timeout: input.listenOnly ? 4 : 6,
    maxSpeechTime: 60,
    actionOnEmptyResult: true,
    bargeIn: true,
    hints: boundedHints(input.hints),
  });
  if (!input.listenOnly && input.text.trim()) {
    const say = gather.say({ voice: CLAIRE_VOICE, language: "en-US" }, "");
    say.prosody(
      { rate: "90%", volume: "+6dB" },
      spokenClaireText(input.text, input.opening)
    );
  }
  response.hangup();
  return response.toString();
}

function stillWorkingTwiML(token: string, attempt: number): string {
  const response = new twilio.twiml.VoiceResponse();
  if (attempt === 0) {
    const say = response.say({ voice: CLAIRE_VOICE, language: "en-US" }, "");
    say.prosody({ rate: "90%", volume: "+6dB" }, "One second.");
  } else {
    response.pause({ length: 1 });
  }
  response.redirect(
    { method: "POST" },
    `${publicBaseUrl()}${CONTINUE_PATH}?token=${encodeURIComponent(token)}&n=${attempt + 1}`
  );
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

/** In-flight turn computations, so a continuation redirect can collect a slow answer. The state itself is durable. */
const inflightTurns = new Map<string, Promise<string>>();

async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startVoiceTurn(input: {
  conversationId: string;
  conversation: PreDriveConversation;
  utterance: string;
  rawTranscript: string | null;
  allowFragmentWait: boolean;
  callSid?: string;
  token: string;
}): Promise<string> {
  const { conversationId, conversation, token } = input;
  const turnKey = conversation.turns;
  const job = (async () => {
    try {
      const result = await runClaireTurn(
        {
          tenantId: conversation.tenantId,
          operatorUserId: conversation.actorId,
          dayDirectorActorId: conversation.dayDirectorActorId,
          surface: "voice",
          utterance: input.utterance,
          state: conversation,
          conversationKey: callStateKey(conversationId),
          brief: conversation.brief,
          context: conversation.context,
          allowFragmentWait: input.allowFragmentWait,
        },
        {
          confirmPlan: () =>
            confirmWorkdayPlan({
              tenantId: conversation.tenantId,
              actorId: conversation.dayDirectorActorId,
              businessDate: conversation.context.clock?.tomorrowBusinessDate ?? conversation.context.businessDate,
              items: assembleTomorrowCandidates(conversation.context),
            }).then(() => undefined),
          encyclopedia: claireEncyclopediaFor({ dayDirectorActorId: conversation.dayDirectorActorId }),
        }
      );
      conversation.touchedAt = Date.now();
      await saveCall(conversationId, conversation);
      await persistOperatorAndClaire({
        callSid: input.callSid,
        claireConversationId: conversationId,
        operatorText: input.rawTranscript,
        claireText: result.speak,
        turnKey,
      });
      if (result.commitmentTurn) {
        await linkClaireCallAction({ callSid: input.callSid, claireConversationId: conversationId, turn: result.commitmentTurn });
      } else if (result.actionIds?.length) {
        await linkClaireActionIds({ callSid: input.callSid, claireConversationId: conversationId, actionIds: result.actionIds });
      }
      if (result.listenOnly) {
        return preDriveConversationTwiML({ text: "", token, hints: conversation.hints, listenOnly: true });
      }
      return preDriveConversationTwiML({ text: result.speak || "Go ahead.", token, hints: conversation.hints });
    } catch (error) {
      // Hard truth rule: a failure is never spoken as success.
      console.error("[Claire] voice turn failed", error);
      await saveCall(conversationId, conversation).catch(() => undefined);
      const retry = "I understood it, but I couldn't finish that just now. Nothing changed. Say it again?";
      await persistOperatorAndClaire({
        callSid: input.callSid,
        claireConversationId: conversationId,
        operatorText: input.rawTranscript,
        claireText: retry,
        turnKey,
      });
      return preDriveConversationTwiML({ text: retry, token, hints: conversation.hints });
    }
  })();
  inflightTurns.set(conversationId, job);
  void job.finally(() => {
    setTimeout(() => {
      if (inflightTurns.get(conversationId) === job) inflightTurns.delete(conversationId);
    }, 60_000).unref?.();
  });
  return job;
}

export async function startClairePreDriveCall(input: {
  tenantId: string;
  actorId: string;
  timeZone?: string;
  missionId?: number;
  /** The identity Day Director commitments (and Driver's dayline) are actually keyed by — see dayDirectorActorId(ctx). */
  dayDirectorActorId?: string;
}): Promise<{ callSid: string; brief: string }> {
  const to = operatorPhoneFor(input.actorId);
  const generated = await generateClairePreDriveOutput({
    tenantId: input.tenantId,
    actorId: input.actorId,
    timeZone: input.timeZone,
    missionId: input.missionId,
    dayDirectorActorId: input.dayDirectorActorId,
  });
  const { brief, context } = generated;
  const conversationId = randomUUID();
  const hints = speechHints(await loadBusinessVocabulary(input.tenantId).catch(() => [] as string[]));
  const now = Date.now();
  await saveCall(conversationId, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    dayDirectorActorId: input.dayDirectorActorId ?? input.actorId,
    brief,
    context,
    turns: 0,
    touchedAt: now,
    sessionKind: context.workday?.session,
    hints: boundedHints(hints),
    history: [{ speaker: "claire", text: spokenClaireText(brief, true), at: now }],
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
      twiml: preDriveConversationTwiML({ text: brief, token, opening: true, hints }),
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
        turnKey: 0,
      });
    });
    return { callSid: call.sid, brief };
  } catch (error) {
    await dropCall(conversationId);
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
  const to = operatorPhoneFor(input.actorId);
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
    maxSpeechTime: 60,
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
      turnKey: 0,
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
      const conversation = await loadCall(claims.conversationId);
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
          reason: "lost_conversation_state",
        });
        return res.send(speakAndHangUp(hangup));
      }

      const token = String(req.query.token);
      const callSid = callSidFrom(req);
      const rawTranscript = String(
        ((req.body ?? {}) as Record<string, string>).SpeechResult ?? ""
      ).trim();
      let utterance = rawTranscript;
      let allowFragmentWait = true;
      if (!rawTranscript) {
        if (conversation.pendingFragment) {
          // Adam went quiet after an unfinished thought: take it as said.
          utterance = conversation.pendingFragment;
          conversation.pendingFragment = null;
          allowFragmentWait = false;
          trackNonEmptyTranscript(conversation);
        } else {
          conversation.touchedAt = Date.now();
          const { shouldEndCall } = trackEmptyTranscript(conversation);
          if (shouldEndCall) {
            await dropCall(claims.conversationId);
            const hangup = "All right. I'll let you focus on the drive.";
            await endClaireCallLedger({
              callSid,
              claireConversationId: claims.conversationId,
              claireText: hangup,
              reason: "empty_transcript",
            });
            return res.send(speakAndHangUp(hangup));
          }
          await saveCall(claims.conversationId, conversation);
          const prompt = conversation.pendingBriefing ? "Still there? Say yes and I'll add the list." : "Go ahead, I'm listening.";
          await persistOperatorAndClaire({
            callSid,
            claireConversationId: claims.conversationId,
            claireText: prompt,
            turnKey: `empty-${conversation.turns}-${conversation.consecutiveEmptyTranscripts ?? 0}`,
          });
          return res.send(
            preDriveConversationTwiML({ text: prompt, token, hints: conversation.hints })
          );
        }
      } else {
        trackNonEmptyTranscript(conversation);
      }

      const words = utterance.split(/\s+/).filter(Boolean).length;
      const holding = Boolean(conversation.pendingBriefing || conversation.pendingProposal || conversation.pendingAccountFollowUp);
      if (words <= 6 && !holding && isClaireCallComplete(utterance)) {
        await dropCall(claims.conversationId);
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
          operatorText: rawTranscript,
          claireText: hangup,
          reason: "closing_phrase",
        });
        return res.send(speakAndHangUp(hangup));
      }
      if (conversation.turns >= MAX_PRE_DRIVE_TURNS) {
        await dropCall(claims.conversationId);
        await safeRecordRelationshipEvent(() =>
          recordQualifyingClaireInteraction({
            tenantId: claims.tenantId,
            operatorUserId: claims.userId,
            conversationId: claims.conversationId,
            reason: "turn_cap_reached",
          })
        );
        const hangup =
          "That's a long call. Let's pick the rest up in Goldline. Drive safe.";
        await endClaireCallLedger({
          callSid,
          claireConversationId: claims.conversationId,
          operatorText: rawTranscript,
          claireText: hangup,
          reason: "turn_cap_reached",
        });
        return res.send(speakAndHangUp(hangup));
      }

      conversation.turns += 1;
      conversation.touchedAt = Date.now();
      const job = startVoiceTurn({
        conversationId: claims.conversationId,
        conversation,
        utterance,
        rawTranscript: rawTranscript || null,
        allowFragmentWait,
        callSid,
        token,
      });
      const twiml = await withinBudget(job, TURN_BUDGET_MS);
      return res.send(twiml ?? stillWorkingTwiML(token, 0));
    } catch (error) {
      console.error("[Claire] pre-drive conversation webhook error", error);
      return res.send(
        speakAndHangUp(
          "I couldn't answer that safely from today's brief, so I won't guess. Drive safe."
        )
      );
    }
  });

  app.post(CONTINUE_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res.status(403).send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const claims = verifyClaireToken(String(req.query.token ?? ""));
      if (claims.kind !== "pre_drive_conversation") {
        return res.send(speakAndHangUp("This pre-drive conversation is no longer valid."));
      }
      const token = String(req.query.token);
      const attempt = Number(req.query.n ?? 1);
      const job = inflightTurns.get(claims.conversationId);
      if (!job) {
        const conversation = await loadCall(claims.conversationId);
        return res.send(
          preDriveConversationTwiML({
            text: "I lost that last thought. Say it again?",
            token,
            hints: conversation?.hints,
          })
        );
      }
      const twiml = await withinBudget(job, TURN_BUDGET_MS);
      if (twiml) return res.send(twiml);
      if (attempt >= 3) {
        return res.send(
          preDriveConversationTwiML({ text: "That's taking too long, so I stopped. Nothing changed. Ask me again?", token })
        );
      }
      return res.send(stillWorkingTwiML(token, attempt));
    } catch (error) {
      console.error("[Claire] continuation webhook error", error);
      return res.send(speakAndHangUp("I couldn't finish that safely, so I won't guess. Drive safe."));
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
        turnKey: "debrief",
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
