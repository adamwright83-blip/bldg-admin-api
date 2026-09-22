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
import { getProgressionStore } from "./progression/drizzleStore";
import { isClaireProgressionEnabled } from "./progression/progressionFlag";
import { commitPendingDisclosuresForConversation } from "./progression/service";
import { recordConfirmedVisitEvidence } from "./progression/evidenceSources";
import { recordClaireMissionOutcomeEvents, recordQualifyingClaireInteraction } from "./character/relationshipEmitters";
import { assembleClaireDriveContext, buildClaireClock } from "./contextAssembler";
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
import { assembleClaireVoiceCallContext, generateClairePreDriveOutput } from "./preDriveRuntime";
import { shouldEndClaireCallOnUtterance } from "./preDriveConversation";
import {
  issueClaireToken,
  verifyClaireToken,
  type ClaireMissionAccess,
} from "./claireToken";
import { isClaireVoiceRecordingEnabled } from "./conversation/consent";
import {
  attachCallSid,
  attachConversationKind,
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
import { canonicalOperatorMetadata, claireQueuedSpeechMetadata } from "./conversation/speechDelivery";
import { claireProviderMetadataWithNarrative } from "./narratorPresentationConsumer";
import {
  handleCallCompleted,
  handleRecordingStatus,
} from "./conversation/pipeline";
import { isValidTwilioWebhook } from "./conversation/twilioSignature";
import {
  runClaireTurn,
  looksUnfinished,
  observationUtteranceForBrain,
  type ClaireTurnResult,
  type ClaireTurnState,
} from "./turn/claireTurn";
import {
  appendOperatorArtifactVoiceHistory,
  executeStandaloneOperatorArtifactVoiceRequest,
  isStandaloneOperatorArtifactVoiceRequest,
} from "./operatorArtifactVoice";
import { observeShadowTurnDetached } from "./brain/shadow/observeShadowTurn";
import { readOnlyWorkingMemorySource } from "./brain/shadow/v1Snapshot";
import { getDashboardTimeZone } from "../dashboardZoned";
import { claireConversationStateStore } from "./turn/conversationStateStore";
import { getUserByOpenId } from "../db";
import { dayDirectorActorId as dayDirectorActorIdFromUser } from "../dayDirector/dayDirectorActor";
import { claireEncyclopediaFor } from "./turn/claireTurnWiring";
import { loadBusinessVocabulary, speechHints } from "./knowledge/businessVocabulary";
import {
  CLAIRE_XAI_TTS_PATH,
  claireXaiSpeechUrl,
  handleClaireXaiTtsRequest,
  isClaireXaiTtsEnabled,
} from "./xaiTts";
import {
  CLAIRE_CONVERSATION_RELAY_ACTION_PATH,
  renderClaireOpeningVoice,
} from "./voice/claireVoiceTransport";
import { writeClaireLifecycleReceipt } from "./claireLifecycleReceipt";
import {
  abandonAuthorizedAmdHandoff,
  amdDetectionTwiml,
  amdHangupTwiml,
  authorizedAmdCreateFields,
  CLAIRE_AMD_PATH,
  recordAuthorizedCallAttempted,
} from "./amdVoicemail";

const DEBRIEF_PATH = "/api/claire/twilio/debrief";
const CONFIRM_PATH = "/api/claire/twilio/confirm";
const PRE_DRIVE_PATH = "/api/claire/twilio/pre-drive";
const CONTINUE_PATH = "/api/claire/twilio/pre-drive/continue";
export const CLAIRE_INBOUND_VOICE_PATH = "/api/claire/twilio/inbound";
export const CLAIRE_RECORDING_STATUS_PATH = "/api/claire/twilio/recording-status";
export const CLAIRE_CALL_STATUS_PATH = "/api/claire/twilio/call-status";
/** Spoken on inbound pickup only. Outbound still opens with the generated briefing. */
export const CLAIRE_INBOUND_GREETING = "Hey Adam. What's up?";
/** Polly stays as the fail-open fallback when xAI TTS is disabled or unconfigured. */
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

/** Seconds of silence after a held fragment before we treat the thought as finished. */
export const CONTINUATION_GRACE_SECONDS = 3;

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
  /** Opening briefing spoken at call start. Null on inbound — there was no briefing. */
  brief: string | null;
  context: Awaited<ReturnType<typeof assembleClaireDriveContext>>;
  turns: number;
  touchedAt: number;
  sessionKind?: "evening_planning" | "morning_reconciliation" | "field_debrief" | "pre_drive";
  /** Business names for speech recognition, loaded once per call. */
  hints?: string;
  /** True after inbound context assembly was applied or conservatively given up. */
  inboundContextReady?: boolean;
  /** Persisted opening was already queued on the Relay socket. Not a second copy of the line. */
  relayOpeningQueued?: boolean;
  /** One Relay → Gather hop has already been used for this call. */
  relayGatherFallbackUsed?: boolean;
  /** Claire sent Conversation Relay's documented end message. */
  relayIntentionalEnd?: boolean;
  /** CallSid observed on the Relay socket or the Connect action callback. */
  relayCallSid?: string | null;
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
  inboundContextPrefetch.delete(conversationId);
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
  /**
   * Single-number configuration (`CLAIRE_OPERATOR_PHONE`) is the OWNER's phone, not a general
   * destination. Without this binding the number is returned for any actorId at all, so any
   * other persisted user — `driver-primary`, a teammate, a synthetic identity — would ring it.
   * Multi-operator deployments must use `CLAIRE_OPERATOR_PHONES`.
   */
  const owner = ENV.ownerOpenId?.trim();
  if (!owner) {
    throw new Error(
      "CLAIRE_OPERATOR_PHONE is configured without OWNER_OPEN_ID, so Claire cannot prove whose phone it is. Set OWNER_OPEN_ID, or configure CLAIRE_OPERATOR_PHONES."
    );
  }
  if (actorId !== owner) {
    throw new Error(
      `Claire will not dial the configured operator phone for "${actorId}": that number belongs to "${owner}". Configure CLAIRE_OPERATOR_PHONES to call anyone else.`
    );
  }
  return assertPhone(operatorNumber);
}

/**
 * AUTHORIZED CALL DESTINATION.
 *
 * `operatorPhoneFor` alone is not authorization. With the single-number configuration that
 * production runs (`CLAIRE_OPERATOR_PHONE`, no `CLAIRE_OPERATOR_PHONES` map), it returns the
 * operator's real phone for ANY actorId string a caller passes. On 2026-09-20 a synthetic
 * acceptance identity (`slice0-adam` on tenant `zz-slice0-accept-2`) used that to ring Adam's
 * real phone, and Claire then answered his business questions from an empty synthetic tenant —
 * she said "$0.00 across 0 orders" about a business that had sales.
 *
 * The destination is now bound to a real, persisted user of the SAME tenant the call runs as.
 * A fabricated actor has no user row and cannot dial anyone; a real user cannot be dialed under
 * another tenant's context. This is identity binding, not a name-prefix heuristic, so it also
 * covers synthetic tenants nobody thought to blocklist.
 */
export async function authorizedOperatorPhone(input: { tenantId: string; actorId: string }): Promise<string> {
  const phone = operatorPhoneFor(input.actorId);
  const user = await getUserByOpenId(input.actorId);
  if (!user) {
    throw new Error(
      `Claire will not place a call for "${input.actorId}": no such operator exists. A real phone is never dialed for an unpersisted or synthetic identity.`
    );
  }
  const userTenant = user.tenantId?.trim() || "default";
  if (userTenant !== input.tenantId) {
    throw new Error(
      `Claire will not place a call: operator "${input.actorId}" belongs to tenant "${userTenant}", but the call was started as "${input.tenantId}".`
    );
  }
  return phone;
}

/**
 * Reverse of `operatorPhoneFor`: map a Twilio caller number onto the configured
 * operator id. Unknown, malformed, or ambiguous numbers fail closed — there is
 * no separate inbound allowlist.
 */
export function resolveClaireOperatorIdForPhone(rawPhone: string): string {
  const caller = assertPhone(rawPhone);
  const map = operatorPhoneMap();
  if (map) {
    const matches: string[] = [];
    for (const [actorId, phone] of Object.entries(map)) {
      try {
        if (assertPhone(phone) === caller) matches.push(actorId);
      } catch {
        // Skip malformed map entries rather than guessing.
      }
    }
    if (matches.length === 0) {
      throw new Error("Claire will not answer: this caller is not a configured operator.");
    }
    if (matches.length > 1) {
      throw new Error("Claire will not answer: this caller maps to more than one operator.");
    }
    return matches[0]!;
  }
  const owner = ENV.ownerOpenId?.trim();
  if (!owner) {
    throw new Error(
      "CLAIRE_OPERATOR_PHONE is configured without OWNER_OPEN_ID, so Claire cannot prove whose phone is calling. Set OWNER_OPEN_ID, or configure CLAIRE_OPERATOR_PHONES."
    );
  }
  if (!operatorNumber) {
    throw new Error("Claire calling is not configured (CLAIRE_OPERATOR_PHONE or CLAIRE_OPERATOR_PHONES is required)");
  }
  if (assertPhone(operatorNumber) !== caller) {
    throw new Error("Claire will not answer: this caller is not a configured operator.");
  }
  return owner;
}

/**
 * Inbound identity binding. Same persisted-user + tenant proof as
 * `authorizedOperatorPhone`, inverted from the caller's number.
 * Claire/operator scope is OpenID; Day Director / THE LINE is `String(user.id)`.
 */
export async function authorizedInboundOperator(from: string): Promise<{
  operatorUserId: string;
  dayDirectorActorId: string;
  tenantId: string;
}> {
  const operatorUserId = resolveClaireOperatorIdForPhone(from);
  const user = await getUserByOpenId(operatorUserId);
  if (!user) {
    throw new Error(
      `Claire will not answer for "${operatorUserId}": no such operator exists. An inbound call is never opened for an unpersisted or synthetic identity.`
    );
  }
  if (user.id == null) {
    throw new Error(
      `Claire will not answer for "${operatorUserId}": the persisted operator has no Day Director identity.`
    );
  }
  const directorId = dayDirectorActorIdFromUser({ user });
  if (!directorId || directorId === "unknown") {
    throw new Error(
      `Claire will not answer for "${operatorUserId}": the persisted operator has no Day Director identity.`
    );
  }
  return {
    operatorUserId,
    dayDirectorActorId: directorId,
    tenantId: user.tenantId?.trim() || "default",
  };
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

/**
 * Speech-output boundary only. Claire's reasoning/routing remains untouched.
 * xAI receives the already-approved sentence and returns telephony audio.
 */
function appendClaireSpeech(
  parent: any,
  text: string,
  opening = false
): void {
  const spoken = spokenClaireText(text, opening);
  if (isClaireXaiTtsEnabled()) {
    try {
      parent.play(claireXaiSpeechUrl(spoken, publicBaseUrl()));
      return;
    } catch (error) {
      console.warn("[Claire] xAI TTS URL creation failed; using Twilio voice", {
        reason: error instanceof Error ? error.message : "CLAIRE_XAI_TTS_URL_FAILED",
      });
    }
  }

  const say = parent.say({ voice: CLAIRE_VOICE, language: "en-US" }, "");
  say.prosody({ rate: "90%", volume: "+6dB" }, spoken);
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
  appendClaireSpeech(response, text);
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
    // Slice F: follow-up turns use Twilio's auto endpoint. A fixed 3-second
    // silence wait was dead air after every ordinary answer. Opening
    // briefings are still lists spoken with pauses, so they keep the
    // three-second close.
    speechTimeout: input.opening ? "3" : "auto",
    timeout: input.listenOnly ? CONTINUATION_GRACE_SECONDS : 6,
    maxSpeechTime: 60,
    actionOnEmptyResult: true,
    bargeIn: true,
    hints: boundedHints(input.hints),
  });
  if (!input.listenOnly && input.text.trim()) {
    appendClaireSpeech(gather, input.text, input.opening);
  }
  response.hangup();
  return response.toString();
}

/**
 * Gather is the production opening. Conversation Relay is selected only when
 * its capability is CONFIGURED (flag explicitly on). Flag off returns Gather.
 */
function openingVoiceTwiml(input: {
  text: string;
  token: string;
  opening?: boolean;
  hints?: string | null;
}): string {
  return renderClaireOpeningVoice({
    ...input,
    publicBaseUrl: publicBaseUrl(),
    renderGather: preDriveConversationTwiML,
  });
}

function stillWorkingTwiML(token: string, attempt: number): string {
  const response = new twilio.twiml.VoiceResponse();
  if (attempt === 0) {
    appendClaireSpeech(response, "One second.");
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
/** Prefetch only — never a concurrent writer of live conversation state. */
const inboundContextPrefetch = new Map<string, Promise<InboundPreparedContext | null>>();

type InboundPreparedContext = {
  context: PreDriveConversation["context"];
  hints: string;
};

/** Test helper: a replica cannot see another process's in-memory prefetch map. */
export function resetInboundContextPrefetchForTests(): void {
  inboundContextPrefetch.clear();
}

/**
 * Claire Intelligence Repair Part 2, Slice A: voice turn-around timing.
 *
 * Counts only, console only — the per-turn answer-path row already carries the
 * inside-the-turn marks. This records what the operator actually experiences:
 * how long after their speech ended Twilio got something to say, and whether
 * the turn overran the budget into a "One second." continuation, which is
 * where the dead air on the call comes from.
 */
function logVoiceTurnTiming(input: {
  tenantId: string;
  conversationId: string;
  turn: number | null;
  attempt: number;
  deferred: boolean;
  webhookReceivedAtMs: number;
}): void {
  console.info("[Claire] voice turn timing", {
    event: "claire_voice_timing",
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    turn: input.turn,
    continuationAttempt: input.attempt,
    // True means the budget expired and the operator heard filler plus a
    // redirect instead of an answer.
    deferredToContinuation: input.deferred,
    toTwimlMs: Date.now() - input.webhookReceivedAtMs,
    turnBudgetMs: TURN_BUDGET_MS,
  });
}

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

export type AuthoritativeClaireVoiceTurnResult = {
  speak: string;
  endCall: boolean;
  listenOnly: boolean;
  /** Gather adapter document. Relay does not play this TwiML. */
  gatherTwiml: string;
};

function voiceTurnDocument(input: {
  speak: string;
  token: string;
  hints?: string | null;
  endCall?: boolean;
  listenOnly?: boolean;
}): AuthoritativeClaireVoiceTurnResult {
  const endCall = Boolean(input.endCall);
  const listenOnly = Boolean(input.listenOnly);
  return {
    speak: input.speak,
    endCall,
    listenOnly,
    gatherTwiml: endCall
      ? speakAndHangUp(input.speak)
      : preDriveConversationTwiML({
          text: listenOnly ? "" : input.speak,
          token: input.token,
          hints: input.hints,
          listenOnly,
        }),
  };
}

/**
 * The one Claire voice-turn orchestration. Gather and Conversation Relay both
 * call this. Relay passes allowFragmentWait false so a final provider prompt
 * is not held as a Gather pause fragment.
 */
export function runAuthoritativeClaireVoiceTurn(input: {
  conversationId: string;
  conversation: PreDriveConversation;
  utterance: string;
  rawTranscript: string | null;
  allowFragmentWait: boolean;
  callSid?: string;
  token: string;
  /** Slice A: when Twilio's webhook arrived — the proxy for end-of-speech. */
  webhookReceivedAtMs: number;
}): Promise<AuthoritativeClaireVoiceTurnResult> {
  const { conversationId, conversation, token } = input;
  return (async () => {
    try {
      if (!conversation.inboundContextReady) {
        const prepared = await preparedInboundContextFor({
          conversationId,
          tenantId: conversation.tenantId,
          actorId: conversation.actorId,
          dayDirectorActorId: conversation.dayDirectorActorId,
        });
        inboundContextPrefetch.delete(conversationId);
        if (prepared) {
          applyPreparedInboundContext(conversation, prepared);
          await safeClaireLedger(() =>
            attachConversationKind({
              claireConversationId: conversationId,
              conversationKind: conversation.sessionKind ?? "pre_drive",
            })
          );
        }
        conversation.inboundContextReady = true;
      }
      /**
       * Operator-artifact utility turn.
       *
       * A short Gather fragment can be held by runClaireTurn before its final
       * referent arrives ("Can you text me" / "that"). Reassemble that held
       * fragment here only for the narrow standalone utility grammar. Everything
       * else continues through Claire V1 unchanged.
       */
      const artifactCandidate = conversation.pendingFragment
        ? `${conversation.pendingFragment} ${input.utterance}`.trim()
        : input.utterance;

      let result: ClaireTurnResult;
      if (isStandaloneOperatorArtifactVoiceRequest(artifactCandidate)) {
        if (input.utterance.trim()) {
          conversation.providerFragments = [
            ...(conversation.providerFragments ?? []),
            input.utterance.trim(),
          ];
        }
        conversation.pendingFragment = null;
        conversation.fragmentHolds = 0;

        // Same delivery boundary runClaireTurn normally owns: a new operator
        // turn confirms that the previous Claire line was actually reached.
        if (isClaireProgressionEnabled(conversation.tenantId)) {
          await commitPendingDisclosuresForConversation(getProgressionStore(), {
            tenantId: conversation.tenantId,
            conversationId: callStateKey(conversationId),
          });
        }

        // Lazy import avoids a runtime cycle:
        // claireTwilio -> operatorArtifactDecision -> sendOperatorArtifact
        // -> claireTwilio (authorizedOperatorPhone).
        const { applyOperatorArtifactDecision } = await import(
          "./operatorArtifactDecision"
        );
        const artifactTurn =
          await executeStandaloneOperatorArtifactVoiceRequest(
            {
              tenantId: conversation.tenantId,
              operatorUserId: conversation.actorId,
              utterance: artifactCandidate,
              history: conversation.history ?? [],
            },
            applyOperatorArtifactDecision
          );

        if (!artifactTurn) {
          throw new Error("operator artifact request was not executable");
        }

        conversation.history = appendOperatorArtifactVoiceHistory(
          conversation.history ?? [],
          {
            operatorText: artifactCandidate,
            claireText: artifactTurn.speak,
            at: Date.now(),
          }
        );

        result = {
          speak: artifactTurn.speak,
          kind: "answered",
          assembledUtterance: artifactCandidate,
          thoughtCompleteness: "complete",
        };
      } else {
        result = await runClaireTurn(
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
            turnStartedAtMs: input.webhookReceivedAtMs,
          },
          {
            confirmPlan: () =>
              confirmWorkdayPlan({
                tenantId: conversation.tenantId,
                actorId: conversation.dayDirectorActorId,
                businessDate:
                  conversation.context.clock?.tomorrowBusinessDate ??
                  conversation.context.businessDate,
                items: assembleTomorrowCandidates(conversation.context),
              }).then(() => undefined),
            encyclopedia: claireEncyclopediaFor({
              dayDirectorActorId: conversation.dayDirectorActorId,
            }),
          }
        );
      }
      conversation.touchedAt = Date.now();
      await saveCall(conversationId, conversation);

      /**
       * Brain V2 shadow observation. V1's authoritative result already exists above;
       * this is a ONE-WAY emission with no return path. It is fire-and-forget (never
       * awaited), default-off behind CLAIRE_BRAIN_V2_SHADOW, cannot throw, and receives
       * a frozen copy of state rather than the live conversation object. Nothing below
       * reads its result: V1 remains the sole speech, mutation and call-control authority.
       *
       * The observer is fed the exact assembled utterance V1 reasoned over — never the
       * raw provider webhook — and skipped entirely for holds and empty semantic turns.
       */
      const observation = observationUtteranceForBrain(result);
      if (observation.observe) {
        observeShadowTurnDetached({
          rawText: observation.assembledText,
          assembledText: observation.assembledText,
          completeness: observation.completeness,
          state: readOnlyWorkingMemorySource(conversation as unknown as Parameters<typeof readOnlyWorkingMemorySource>[0]),
          tenantId: conversation.tenantId,
          operatorUserId: conversation.actorId,
          surface: "voice",
          conversationKey: callStateKey(conversationId),
          // Read-only readers, constructed only when the flag is ON.
          live: {
            tenantId: conversation.tenantId,
            operatorUserId: conversation.actorId,
            conversationId,
            dayDirectorActorId: conversation.dayDirectorActorId,
            timeZone: getDashboardTimeZone(),
            businessDate: conversation.context.businessDate ?? new Date().toISOString().slice(0, 10),
            surface: "voice",
            priorClaimReceipts: conversation.claimReceipts ?? [],
          },
          v1: {
            endedCall: Boolean(result.endCall),
            // Voice records work either as a commitment turn or as linked action ids.
            mutated: Boolean(result.commitmentTurn) || Boolean(result.actionIds?.length),
            spokeSomething: Boolean(result.speak),
          },
        });
      }

      if (result.listenOnly) {
        return voiceTurnDocument({ speak: "", token, hints: conversation.hints, listenOnly: true });
      }
      conversation.turns += 1;
      await saveCall(conversationId, conversation);
      const fragments = [...(conversation.providerFragments ?? [])];
      const canonicalOperator =
        result.assembledUtterance ||
        (conversation.history ?? []).filter(entry => entry.speaker === "operator").at(-1)?.text ||
        input.utterance;
      conversation.providerFragments = [];
      await persistOperatorAndClaire({
        callSid: input.callSid,
        claireConversationId: conversationId,
        operatorText: canonicalOperator,
        claireText: result.speak,
        turnKey: conversation.turns,
        operatorMetadata: canonicalOperatorMetadata(fragments.length ? fragments : [canonicalOperator]),
        claireMetadata: claireProviderMetadataWithNarrative(result.narrativeSpeech),
      });
      if (result.commitmentTurn) {
        await linkClaireCallAction({ callSid: input.callSid, claireConversationId: conversationId, turn: result.commitmentTurn });
      } else if (result.actionIds?.length) {
        await linkClaireActionIds({ callSid: input.callSid, claireConversationId: conversationId, actionIds: result.actionIds });
      }
      if (result.endCall) {
        // A guarded personal turn closed the thread with business complete and an authored exit line.
        await dropCall(conversationId);
        await endClaireCallLedger({
          callSid: input.callSid,
          claireConversationId: conversationId,
          claireText: result.speak,
          reason: "personal_thread_closed",
        });
        return voiceTurnDocument({ speak: result.speak, token, hints: conversation.hints, endCall: true });
      }
      return voiceTurnDocument({
        speak: result.speak || "Go ahead.",
        token,
        hints: conversation.hints,
      });
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
        turnKey: conversation.turns,
        claireMetadata: claireQueuedSpeechMetadata(),
      });
      return voiceTurnDocument({ speak: retry, token, hints: conversation.hints });
    }
  })();
}

/** Gather adapter. Registers the TwiML job so the continuation redirect can collect it. */
function startVoiceTurn(input: Parameters<typeof runAuthoritativeClaireVoiceTurn>[0]): Promise<string> {
  const job = runAuthoritativeClaireVoiceTurn(input).then(result => result.gatherTwiml);
  inflightTurns.set(input.conversationId, job);
  void job.finally(() => {
    setTimeout(() => {
      if (inflightTurns.get(input.conversationId) === job) inflightTurns.delete(input.conversationId);
    }, 60_000).unref?.();
  });
  return job;
}

function inboundClaireCallBootstrapContext(actorId: string): PreDriveConversation["context"] {
  const now = new Date();
  const clock = buildClaireClock(now);
  return {
    phase: "pre_drive",
    generatedAt: now.toISOString(),
    businessDate: clock.businessDate,
    actorId,
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment: null,
    blockers: [],
    relevantTimeline: [],
    mission: null,
    clock,
    macroGoalKnown: false,
  };
}

async function assembleInboundPreparedContext(input: {
  tenantId: string;
  actorId: string;
  dayDirectorActorId: string;
}): Promise<InboundPreparedContext | null> {
  try {
    const [context, vocabulary] = await Promise.all([
      assembleClaireVoiceCallContext({
        tenantId: input.tenantId,
        actorId: input.actorId,
        dayDirectorActorId: input.dayDirectorActorId,
      }),
      loadBusinessVocabulary(input.tenantId).catch(() => [] as string[]),
    ]);
    return { context, hints: boundedHints(speechHints(vocabulary)) };
  } catch (error) {
    console.warn("[Claire] inbound context assembly failed", error);
    return null;
  }
}

function beginInboundContextPrefetch(input: {
  conversationId: string;
  tenantId: string;
  actorId: string;
  dayDirectorActorId: string;
}): void {
  if (inboundContextPrefetch.has(input.conversationId)) return;
  inboundContextPrefetch.set(input.conversationId, assembleInboundPreparedContext(input));
}

async function preparedInboundContextFor(input: {
  conversationId: string;
  tenantId: string;
  actorId: string;
  dayDirectorActorId: string;
}): Promise<InboundPreparedContext | null> {
  const existing = inboundContextPrefetch.get(input.conversationId);
  if (existing) return existing;
  const job = assembleInboundPreparedContext(input);
  inboundContextPrefetch.set(input.conversationId, job);
  return job;
}

function applyPreparedInboundContext(
  conversation: PreDriveConversation,
  prepared: InboundPreparedContext
): void {
  conversation.context = prepared.context;
  conversation.hints = prepared.hints;
  conversation.sessionKind = prepared.context.workday?.session ?? conversation.sessionKind;
}

async function persistClaireVoiceConversation(input: {
  tenantId: string;
  actorId: string;
  dayDirectorActorId?: string;
  brief: string | null;
  context: PreDriveConversation["context"];
  spokenOpening: string;
  missionId?: number | null;
  loadVocabulary?: boolean;
  /** Outbound already has assembled context. Inbound pickup bootstraps and waits until the first turn. */
  inboundContextReady?: boolean;
}): Promise<{ conversationId: string; token: string; hints: string }> {
  const conversationId = randomUUID();
  const hints = boundedHints(
    input.loadVocabulary === false
      ? undefined
      : speechHints(await loadBusinessVocabulary(input.tenantId).catch(() => [] as string[]))
  );
  const now = Date.now();
  await saveCall(conversationId, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    dayDirectorActorId: input.dayDirectorActorId ?? input.actorId,
    brief: input.brief,
    context: input.context,
    turns: 0,
    touchedAt: now,
    sessionKind: input.context.workday?.session,
    hints,
    inboundContextReady: input.inboundContextReady ?? true,
    history: [{ speaker: "claire", text: input.spokenOpening, at: now }],
  });
  const token = issueClaireToken({
    kind: "pre_drive_conversation",
    tenantId: input.tenantId,
    userId: input.actorId,
    conversationId,
  });
  await safeClaireLedger(() =>
    createConversationSession({
      tenantId: input.tenantId,
      operatorUserId: input.actorId,
      claireConversationId: conversationId,
      conversationKind: input.context.workday?.session ?? "pre_drive",
      missionId: input.missionId ?? null,
      recordingEnabled: isClaireVoiceRecordingEnabled(),
    })
  );
  return { conversationId, token, hints };
}

export async function startClairePreDriveCall(input: {
  tenantId: string;
  actorId: string;
  timeZone?: string;
  missionId?: number;
  /** The identity Day Director commitments (and Driver's dayline) are actually keyed by — see dayDirectorActorId(ctx). */
  dayDirectorActorId?: string;
}): Promise<{ callSid: string; brief: string }> {
  const to = await authorizedOperatorPhone({ tenantId: input.tenantId, actorId: input.actorId });
  const generated = await generateClairePreDriveOutput({
    tenantId: input.tenantId,
    actorId: input.actorId,
    timeZone: input.timeZone,
    missionId: input.missionId,
    dayDirectorActorId: input.dayDirectorActorId,
  });
  const { brief, context } = generated;
  const { conversationId, token, hints } = await persistClaireVoiceConversation({
    tenantId: input.tenantId,
    actorId: input.actorId,
    dayDirectorActorId: input.dayDirectorActorId,
    brief,
    context,
    spokenOpening: spokenClaireText(brief, true),
    missionId: input.missionId,
  });
  try {
    const interactiveTwiml = openingVoiceTwiml({ text: brief, token, opening: true, hints });
    const from = assertPhone(fromNumber);
    const amdFields = await authorizedAmdCreateFields({
      token,
      tenantId: input.tenantId,
      operatorUserId: input.actorId,
      interactiveTwiml,
      decisionUrl: `${publicBaseUrl()}${CLAIRE_AMD_PATH}?token=${encodeURIComponent(token)}`,
    });
    const call = await client!.calls.create({
      to,
      from,
      ...amdFields,
      ...claireVoiceCallCreateOptions(),
    });
    await recordAuthorizedCallAttempted({
      tenantId: input.tenantId,
      operatorUserId: input.actorId,
      callSid: call.sid,
      from,
      to,
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
    await abandonAuthorizedAmdHandoff(token);
    await dropCall(conversationId);
    await endClaireCallLedger({
      claireConversationId: conversationId,
      reason: "call_create_failed",
    });
    throw error;
  }
}

async function answerInboundClaireCall(req: Request): Promise<{ status: number; twiml: string }> {
  const body = (req.body ?? {}) as Record<string, string>;
  const callSid = String(body.CallSid ?? "").trim();
  const from = String(body.From ?? "").trim();
  if (!callSid || !from) {
    return { status: 403, twiml: speakAndHangUp("This call can't be connected.") };
  }
  let operator: {
    operatorUserId: string;
    dayDirectorActorId: string;
    tenantId: string;
  };
  try {
    operator = await authorizedInboundOperator(from);
  } catch {
    return { status: 403, twiml: speakAndHangUp("This call can't be connected.") };
  }
  const { conversationId, token, hints } = await persistClaireVoiceConversation({
    tenantId: operator.tenantId,
    actorId: operator.operatorUserId,
    dayDirectorActorId: operator.dayDirectorActorId,
    brief: null,
    context: inboundClaireCallBootstrapContext(operator.operatorUserId),
    spokenOpening: CLAIRE_INBOUND_GREETING,
    loadVocabulary: false,
    inboundContextReady: false,
  });
  beginInboundContextPrefetch({
    conversationId,
    tenantId: operator.tenantId,
    actorId: operator.operatorUserId,
    dayDirectorActorId: operator.dayDirectorActorId,
  });
  await safeClaireLedger(async () => {
    await attachCallSid({
      claireConversationId: conversationId,
      callSid,
    });
    await persistSpokenTurn({
      claireConversationId: conversationId,
      callSid,
      speaker: "CLAIRE",
      text: CLAIRE_INBOUND_GREETING,
      turnKey: 0,
    });
  });
  return {
    status: 200,
    twiml: openingVoiceTwiml({
      text: CLAIRE_INBOUND_GREETING,
      token,
      hints,
    }),
  };
}

export async function startClairePostStopCall(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  missionAccess: ClaireMissionAccess;
  timeZone?: string;
}): Promise<{ callSid: string }> {
  const to = await authorizedOperatorPhone({ tenantId: input.tenantId, actorId: input.actorId });
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
    context,
  });
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    speechTimeout: "auto",
    maxSpeechTime: 60,
    action: `${publicBaseUrl()}${DEBRIEF_PATH}?token=${encodeURIComponent(token)}`,
    method: "POST",
  });
  appendClaireSpeech(gather, opening);
  appendClaireSpeech(
    response,
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
  const interactiveTwiml = response.toString();
  const from = assertPhone(fromNumber);
  const amdFields = await authorizedAmdCreateFields({
    token,
    tenantId: input.tenantId,
    operatorUserId: input.actorId,
    interactiveTwiml,
    decisionUrl: `${publicBaseUrl()}${CLAIRE_AMD_PATH}?token=${encodeURIComponent(token)}`,
  });
  let call: { sid: string };
  try {
    call = await client!.calls.create({
      to,
      from,
      ...amdFields,
      ...claireVoiceCallCreateOptions(),
    });
  } catch (error) {
    await abandonAuthorizedAmdHandoff(token);
    throw error;
  }
  await recordAuthorizedCallAttempted({
    tenantId: input.tenantId,
    operatorUserId: input.actorId,
    callSid: call.sid,
    from,
    to,
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

export async function loadClaireVoiceConversation(
  conversationId: string
): Promise<PreDriveConversation | null> {
  return loadCall(conversationId);
}

function persistedClaireOpening(conversation: PreDriveConversation): string {
  const opening = (conversation.history ?? []).find(
    entry => entry.speaker === "claire" && entry.text.trim()
  );
  return opening?.text ?? "";
}

/** Queues the already-persisted opening once. Does not generate or append history. */
export async function queueRelayOpeningOnce(
  conversationId: string
): Promise<{ text: string; queued: boolean }> {
  const conversation = await loadCall(conversationId);
  if (!conversation) return { text: "", queued: false };
  const text = persistedClaireOpening(conversation);
  if (conversation.relayOpeningQueued) return { text, queued: false };
  conversation.relayOpeningQueued = true;
  conversation.touchedAt = Date.now();
  await saveCall(conversationId, conversation);
  return { text, queued: true };
}

export async function noteRelayCallSid(conversationId: string, callSid: string): Promise<void> {
  const sid = callSid.trim();
  if (!sid) return;
  const conversation = await loadCall(conversationId);
  if (!conversation || conversation.relayCallSid) return;
  conversation.relayCallSid = sid;
  conversation.touchedAt = Date.now();
  await saveCall(conversationId, conversation);
}

export async function markRelayIntentionalEnd(conversationId: string): Promise<void> {
  const conversation = await loadCall(conversationId);
  if (!conversation) return;
  conversation.relayIntentionalEnd = true;
  conversation.touchedAt = Date.now();
  await saveCall(conversationId, conversation);
}

export async function authorizePersistedClaireRelayCall(token: string): Promise<
  | {
      ok: true;
      token: string;
      conversationId: string;
      tenantId: string;
      operatorUserId: string;
    }
  | { ok: false }
> {
  let claims: ReturnType<typeof verifyClaireToken>;
  try {
    claims = verifyClaireToken(token);
  } catch {
    return { ok: false };
  }
  if (claims.kind !== "pre_drive_conversation") return { ok: false };
  const conversation = await loadCall(claims.conversationId);
  if (
    !conversation ||
    conversation.tenantId !== claims.tenantId ||
    conversation.actorId !== claims.userId
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    token,
    conversationId: claims.conversationId,
    tenantId: claims.tenantId,
    operatorUserId: claims.userId,
  };
}

/**
 * Relay adapter. A final prompt is one semantic turn with fragment waiting off.
 * ConversationRelaySession does not call this.
 */
export async function runRelayAuthoritativeTurn(input: {
  conversationId: string;
  utterance: string;
  callSid?: string | null;
  token: string;
}): Promise<AuthoritativeClaireVoiceTurnResult> {
  const conversation = await loadCall(input.conversationId);
  if (!conversation) {
    throw new Error("Claire voice conversation is not loaded");
  }
  return runAuthoritativeClaireVoiceTurn({
    conversationId: input.conversationId,
    conversation,
    utterance: input.utterance,
    rawTranscript: input.utterance,
    allowFragmentWait: false,
    callSid: input.callSid ?? undefined,
    token: input.token,
    webhookReceivedAtMs: Date.now(),
  });
}

function hangupOnlyTwiml(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.hangup();
  return response.toString();
}

/**
 * Connect action callback. Uses documented SessionStatus values only.
 * ended and completed hang up. failed may return Gather once for this conversation.
 */
export async function renderConversationRelayConnectAction(input: {
  token: string;
  body: Record<string, string>;
}): Promise<string> {
  let claims: ReturnType<typeof verifyClaireToken>;
  try {
    claims = verifyClaireToken(input.token);
  } catch {
    return hangupOnlyTwiml();
  }
  if (claims.kind !== "pre_drive_conversation") return hangupOnlyTwiml();
  const conversation = await loadCall(claims.conversationId);
  if (
    !conversation ||
    conversation.tenantId !== claims.tenantId ||
    conversation.actorId !== claims.userId
  ) {
    return hangupOnlyTwiml();
  }
  const callSid = String(input.body.CallSid ?? "").trim();
  if (callSid && conversation.relayCallSid && callSid !== conversation.relayCallSid) {
    return hangupOnlyTwiml();
  }
  const sessionStatus = String(input.body.SessionStatus ?? "").trim();
  if (
    conversation.relayIntentionalEnd ||
    sessionStatus === "ended" ||
    sessionStatus === "completed"
  ) {
    if (callSid && !conversation.relayCallSid) conversation.relayCallSid = callSid;
    conversation.relayIntentionalEnd = true;
    await saveCall(claims.conversationId, conversation);
    return hangupOnlyTwiml();
  }
  if (sessionStatus === "failed") {
    if (conversation.relayGatherFallbackUsed) return hangupOnlyTwiml();
    conversation.relayGatherFallbackUsed = true;
    if (callSid) conversation.relayCallSid = callSid;
    conversation.touchedAt = Date.now();
    await saveCall(claims.conversationId, conversation);
    return preDriveConversationTwiML({
      text: "",
      token: input.token,
      hints: conversation.hints,
      listenOnly: true,
    });
  }
  return hangupOnlyTwiml();
}

export function registerClaireRoutes(app: Express): void {
  app.get(CLAIRE_XAI_TTS_PATH, handleClaireXaiTtsRequest);

  app.post(CLAIRE_CONVERSATION_RELAY_ACTION_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res.status(403).send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const twiml = await renderConversationRelayConnectAction({
        token: String(req.query.token ?? ""),
        body: (req.body ?? {}) as Record<string, string>,
      });
      return res.send(twiml);
    } catch (error) {
      console.error("[Claire] conversation relay action failed", {
        event: "relay_action_failed",
        reason: error instanceof Error ? error.message : "relay_action_failed",
      });
      return res.send(hangupOnlyTwiml());
    }
  });

  app.post(CLAIRE_INBOUND_VOICE_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res.status(403).send(speakAndHangUp("This Claire call could not be verified."));
    }
    try {
      const result = await answerInboundClaireCall(req);
      return res.status(result.status).send(result.twiml);
    } catch (error) {
      console.error("[Claire] inbound conversation webhook error", error);
      return res.send(speakAndHangUp("I couldn't take this call safely just now."));
    }
  });

  app.post(PRE_DRIVE_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    // Slice A (routing audit): the closest observable proxy for end-of-speech.
    const webhookReceivedAtMs = Date.now();
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
      // A verified webhook for this call is the next operator ASR event. It is NOT proof the previous
      // Claire TTS was heard (barge-in can cancel playback). Disclosure commit is reservation
      // accounting; heard confirmation is providerMetadata.heardConfirmed on Claire turns.
      if (isClaireProgressionEnabled(claims.tenantId)) {
        await commitPendingDisclosuresForConversation(getProgressionStore(), {
          tenantId: claims.tenantId,
          conversationId: callStateKey(claims.conversationId),
        });
      }
      const rawTranscript = String(
        ((req.body ?? {}) as Record<string, string>).SpeechResult ?? ""
      ).trim();
      let utterance = rawTranscript;
      let allowFragmentWait = true;
      if (!rawTranscript) {
        if (conversation.pendingFragment && looksUnfinished(conversation.pendingFragment)) {
          // Quiet after an unfinished thought is still a hold, not an answer.
          utterance = "";
          allowFragmentWait = true;
        } else if (conversation.pendingFragment) {
          // A finished-looking held fragment with no more speech: take it as said.
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

      const holding = Boolean(conversation.pendingBriefing || conversation.pendingProposal || conversation.pendingAccountFollowUp);
      if (shouldEndClaireCallOnUtterance(utterance, { holding })) {
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

      conversation.touchedAt = Date.now();
      const job = startVoiceTurn({
        conversationId: claims.conversationId,
        conversation,
        utterance,
        rawTranscript: rawTranscript || null,
        allowFragmentWait,
        callSid,
        token,
        webhookReceivedAtMs,
      });
      const twiml = await withinBudget(job, TURN_BUDGET_MS);
      logVoiceTurnTiming({
        tenantId: claims.tenantId,
        conversationId: claims.conversationId,
        turn: conversation.turns,
        attempt: 0,
        deferred: !twiml,
        webhookReceivedAtMs,
      });
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
    const continuationReceivedAtMs = Date.now();
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
      logVoiceTurnTiming({
        tenantId: claims.tenantId,
        conversationId: claims.conversationId,
        turn: null,
        attempt,
        deferred: !twiml,
        webhookReceivedAtMs: continuationReceivedAtMs,
      });
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
      appendClaireSpeech(
        gather,
        `I heard: ${proposal.summary}. I would record this as ${outcomeLabel(proposal.proposedOutcome)}. Say confirm to save that outcome, or cancel to leave only your raw debrief.`
      );
      appendClaireSpeech(
        response,
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
      // Two-currency progression: the visit outcome was just persisted as business truth.
      // Effort is credited regardless of result; only a won outcome is also business progress.
      await safeRecordRelationshipEvent(() =>
        recordConfirmedVisitEvidence({
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
      const confirmationContext = await assembleClaireDriveContext({
        tenantId: claims.tenantId,
        actorId: claims.userId,
        phase: "post_stop",
        missionId: claims.missionId,
      }).catch(() => null);
      const confirmationLine = await writeClaireOutcomeConfirmation({
        tenantId: claims.tenantId,
        operatorUserId: claims.userId,
        outcome: claims.proposal.proposedOutcome,
        outcomeLabel: outcomeLabel(claims.proposal.proposedOutcome),
        strategyChange,
        context: confirmationContext,
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
    void (async () => {
      try {
        await writeClaireLifecycleReceipt(body);
      } catch (error) {
        console.error(
          "[Claire] recording status receipt failed",
          error instanceof Error ? error.name : "error"
        );
      }
      await handleRecordingStatus({
        callSid: String(body.CallSid ?? ""),
        recordingSid: String(body.RecordingSid ?? ""),
        recordingStatus: String(body.RecordingStatus ?? ""),
        recordingDuration: body.RecordingDuration,
        recordingChannels: body.RecordingChannels,
        recordingTrack: body.RecordingTrack,
        accountSid,
        authToken,
      });
    })().catch(error => {
      console.error("[ClaireLedger] recording-status failed", error);
    });
  });

  app.post(CLAIRE_CALL_STATUS_PATH, async (req: Request, res: Response) => {
    if (!validTwilioRequest(req)) {
      return res.status(403).send("Forbidden");
    }
    const body = (req.body ?? {}) as Record<string, string>;
    res.status(204).end();
    void (async () => {
      try {
        await writeClaireLifecycleReceipt(body);
      } catch (error) {
        console.error(
          "[Claire] call status receipt failed",
          error instanceof Error ? error.name : "error"
        );
      }
      await handleCallCompleted({
        callSid: String(body.CallSid ?? ""),
        callStatus: String(body.CallStatus ?? body.CallStatusEvent ?? ""),
      });
    })().catch(error => {
      console.error("[ClaireLedger] call-status failed", error);
    });
  });

  app.post(CLAIRE_AMD_PATH, async (req: Request, res: Response) => {
    res.type("text/xml");
    if (!validTwilioRequest(req)) {
      return res.status(403).send(amdHangupTwiml());
    }
    const body = (req.body ?? {}) as Record<string, string>;
    try {
      const result = await amdDetectionTwiml({
        token: String(req.query.token ?? ""),
        answeredBy: body.AnsweredBy,
        callSid: body.CallSid,
        from: body.From,
        to: body.To,
      });
      return res.status(result.status).send(result.twiml);
    } catch (error) {
      console.error("[Claire] amd webhook error", error instanceof Error ? error.name : "error");
      return res.status(200).send(amdHangupTwiml());
    }
  });
}
