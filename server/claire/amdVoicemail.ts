import { createHash } from "node:crypto";
import twilio from "twilio";
import {
  communicationReceiptEventFromProviderStatus,
  type CommunicationReceiptEventType,
} from "@shared/twilioPlatform";
import { verifyClaireToken } from "./claireToken";
import { claireConversationStateStore } from "./turn/conversationStateStore";
import { evaluateTwilioCapability } from "../twilioPlatform/capabilities";
import {
  recordCommunicationReceipt,
  TwilioCommunicationReceiptError,
  type RecordTwilioCommunicationReceiptInput,
} from "../twilioPlatform/communicationReceipts";

/**
 * Answering-machine detection for an outbound call Goldline was already
 * authorized to place. This module does not dial, schedule, or repeat.
 *
 * Weekly Mission law: no autonomous repeated outbound Claire calls.
 * A machine hears one bounded voicemail, then the call hangs up.
 * A human keeps the interactive TwiML the authorized call already prepared.
 */

export const CLAIRE_AMD_PATH = "/api/claire/twilio/amd";

export const AMD_ANSWERED_BY = [
  "human",
  "machine_start",
  "machine_end_beep",
  "machine_end_silence",
  "machine_end_other",
  "fax",
  "unknown",
] as const;

export type AmdAnsweredBy = (typeof AMD_ANSWERED_BY)[number];

export type AmdCallPath = "interactive" | "voicemail" | "hangup";

/** One short message. Not a briefing, interview, or coaching script. */
export const BOUNDED_VOICEMAIL_MAX_CHARS = 180;

export const BOUNDED_VOICEMAIL_TEXT =
  "Adam. Claire here. I reached your voicemail. The note is in Goldline.";

const CLAIRE_VOICE = "Polly.Ruth-Generative";
const AMD_HANDOFF_TTL_MS = 45 * 60 * 1_000;

const MACHINE_ANSWERED_BY = new Set<AmdAnsweredBy>([
  "machine_start",
  "machine_end_beep",
  "machine_end_silence",
  "machine_end_other",
]);

type AuthorizedAmdHandoff = {
  interactiveTwiml: string;
};

type CallReceiptContext = {
  from: string;
  to: string;
};

export function boundedVoicemailText(): string {
  if (BOUNDED_VOICEMAIL_TEXT.length > BOUNDED_VOICEMAIL_MAX_CHARS) {
    throw new Error("bounded voicemail exceeds its character limit");
  }
  if (BOUNDED_VOICEMAIL_TEXT.includes("\n") || BOUNDED_VOICEMAIL_TEXT.includes("\r")) {
    throw new Error("bounded voicemail must be a single message");
  }
  return BOUNDED_VOICEMAIL_TEXT;
}

export function boundedVoicemailTwiml(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say({ voice: CLAIRE_VOICE, language: "en-US" }, boundedVoicemailText());
  response.hangup();
  return response.toString();
}

export function amdHangupTwiml(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.hangup();
  return response.toString();
}

export function parseAmdAnsweredBy(value: unknown): AmdAnsweredBy | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!(AMD_ANSWERED_BY as readonly string[]).includes(text)) return null;
  return text as AmdAnsweredBy;
}

export function amdCallPath(answeredBy: AmdAnsweredBy | null): AmdCallPath {
  if (answeredBy && MACHINE_ANSWERED_BY.has(answeredBy)) return "voicemail";
  if (answeredBy === "fax") return "hangup";
  return "interactive";
}

export function answeringMachineDetectionActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const current = evaluateTwilioCapability("answeringMachineDetection", env);
  return current.state === "CONFIGURED" || current.state === "LIVE";
}

function handoffKey(token: string): string {
  return `claire-amd:${createHash("sha256").update(token).digest("hex")}`;
}

function receiptContextKey(callSid: string): string {
  return `claire-call-receipt:${callSid.trim()}`;
}

export async function authorizedAmdCreateFields(input: {
  token: string;
  tenantId: string;
  operatorUserId: string;
  interactiveTwiml: string;
  decisionUrl: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ twiml?: string; url?: string; machineDetection?: "DetectMessageEnd" }> {
  if (!answeringMachineDetectionActive(input.env)) {
    return { twiml: input.interactiveTwiml };
  }
  const handoff: AuthorizedAmdHandoff = { interactiveTwiml: input.interactiveTwiml };
  await claireConversationStateStore().save(
    handoffKey(input.token),
    {
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      surface: "voice",
    },
    handoff,
    AMD_HANDOFF_TTL_MS
  );
  return {
    url: input.decisionUrl,
    machineDetection: "DetectMessageEnd",
  };
}

export async function abandonAuthorizedAmdHandoff(token: string): Promise<void> {
  await claireConversationStateStore()
    .remove(handoffKey(token))
    .catch(() => undefined);
}

async function recordClaireCommunicationReceipt(
  input: RecordTwilioCommunicationReceiptInput
): Promise<void> {
  try {
    await recordCommunicationReceipt(input);
  } catch (error) {
    if (error instanceof TwilioCommunicationReceiptError && error.code === "persistence_unconfigured") {
      return;
    }
    console.warn(
      "[Claire] communication receipt was not stored",
      error instanceof TwilioCommunicationReceiptError ? error.code : "unexpected"
    );
  }
}

async function recordProviderEvent(input: {
  tenantId: string;
  operatorUserId: string;
  eventType: CommunicationReceiptEventType | null;
  callSid?: string | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  durationSeconds?: number | null;
  completedAt?: string | null;
}): Promise<void> {
  if (!input.eventType || !input.callSid?.trim()) return;
  await recordClaireCommunicationReceipt({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    eventType: input.eventType,
    callSid: input.callSid,
    direction: "outbound",
    from: input.from,
    to: input.to,
    status: input.status,
    durationSeconds: input.durationSeconds,
    completedAt: input.completedAt,
  });
}

export async function recordAuthorizedCallAttempted(input: {
  tenantId: string;
  operatorUserId: string;
  callSid: string;
  from: string;
  to: string;
}): Promise<{ communicationReceiptId: string }> {
  await claireConversationStateStore().save(
    receiptContextKey(input.callSid),
    {
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      surface: "voice",
    },
    { from: input.from, to: input.to } satisfies CallReceiptContext,
    AMD_HANDOFF_TTL_MS
  );

  const eventType = communicationReceiptEventFromProviderStatus({
    channel: "voice",
    status: "initiated",
  });
  if (!eventType) {
    throw new Error("Claire call attempt has no provider receipt event mapping");
  }
  const recorded = await recordCommunicationReceipt({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    eventType,
    callSid: input.callSid,
    direction: "outbound",
    from: input.from,
    to: input.to,
    status: "initiated",
  });
  return { communicationReceiptId: recorded.receipt.id };
}

export async function recordExistingCallStatusReceipt(
  body: Record<string, string>
): Promise<void> {
  const callSid = String(body.CallSid ?? "").trim();
  const status = String(body.CallStatus ?? body.CallStatusEvent ?? "").trim();
  if (!callSid || !status) return;
  const stored = await claireConversationStateStore().load<CallReceiptContext>(
    receiptContextKey(callSid)
  );
  if (!stored) return;
  const durationRaw = String(body.CallDuration ?? "").trim();
  const durationSeconds = /^\d+$/.test(durationRaw) ? Number(durationRaw) : null;
  await recordProviderEvent({
    tenantId: stored.tenantId,
    operatorUserId: stored.operatorUserId,
    eventType: communicationReceiptEventFromProviderStatus({
      channel: "voice",
      status,
    }),
    callSid,
    from: body.From || stored.state.from,
    to: body.To || stored.state.to,
    status,
    durationSeconds,
    completedAt: status.toLowerCase() === "completed" ? new Date().toISOString() : null,
  });
}

export async function amdDetectionTwiml(input: {
  token: string;
  answeredBy: unknown;
  callSid?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<{ status: number; twiml: string }> {
  let claims: ReturnType<typeof verifyClaireToken>;
  try {
    claims = verifyClaireToken(input.token);
  } catch {
    return { status: 403, twiml: amdHangupTwiml() };
  }
  if (claims.kind !== "pre_drive_conversation" && claims.kind !== "drive_call") {
    return { status: 403, twiml: amdHangupTwiml() };
  }
  const stored = await claireConversationStateStore().load<AuthorizedAmdHandoff>(handoffKey(input.token));
  if (
    !stored ||
    stored.tenantId !== claims.tenantId ||
    stored.operatorUserId !== claims.userId ||
    !stored.state.interactiveTwiml.trim()
  ) {
    return { status: 403, twiml: amdHangupTwiml() };
  }

  const answeredBy = parseAmdAnsweredBy(input.answeredBy);
  const path = amdCallPath(answeredBy);
  if (path === "voicemail") {
    await recordProviderEvent({
      tenantId: claims.tenantId,
      operatorUserId: claims.userId,
      eventType: communicationReceiptEventFromProviderStatus({
        channel: "voice",
        status: "answered",
        answeredBy,
      }),
      callSid: input.callSid,
      from: input.from,
      to: input.to,
      status: answeredBy,
    });
    return { status: 200, twiml: boundedVoicemailTwiml() };
  }
  if (path === "hangup") {
    return { status: 200, twiml: amdHangupTwiml() };
  }
  return { status: 200, twiml: stored.state.interactiveTwiml };
}

/**
 * In-conversation voicemail recognition.
 *
 * Twilio AMD is a pre-connect hint. It can be off, can answer "human"/"unknown", and a
 * greeting that is long enough can still be transcribed as an operator turn. Production
 * call 2026-10-19 07:30 PT (session 453795a2) spoke eight more times to voicemail prompts
 * across 19 turns. The words themselves settle it: a greeting or menu from a mailbox is
 * not the operator, and Claire must not talk to it a second time.
 *
 * Only strong phrases count. A bare "voicemail" or "message" does not: a human saying
 * "did you get my voicemail?" must not hang the call up.
 */
const VOICEMAIL_PROMPT_PATTERNS: readonly RegExp[] = [
  /\byou(?:'ve|\s+have)\s+reached\b(?!\s+(?:me|us|the\s+(?:limit|point|end|cap)))/i,
  /\bleave\s+(?:me\s+)?(?:a|your)\s+(?:brief\s+)?message\b(?!\s+(?:for|with|to)\b)/i,
  /\b(?:at|after)\s+the\s+(?:tone|beep)\b/i,
  /\bpress\s+(?:\d|(?:one|two|three|pound|star)\b(?!\s+(?:more|time|thing|button|key)))/i,
  /\b(?:maximum|max)\s+(?:time|length)\b[^.?!]{0,40}\b(?:permitted|allowed|recording)\b/i,
  /\byour\s+message\s+has\s+been\s+(?:sent|recorded|saved|delivered)\b/i,
  /\bto\s+(?:listen\s+to|review|hear)\s+your\s+message\b/i,
  /\berase\s+and\s+re-?record\b/i,
  /\bif\s+you(?:'re|\s+are)\s+satisfied\s+with\s+(?:the|your)\s+message\b/i,
  /\b(?:is\s+not|isn'?t|is\s+unable\s+to)\s+(?:available\s+to\s+)?(?:take\s+your\s+call|come\s+to\s+the\s+phone|answer\s+(?:your\s+call|the\s+phone))\b/i,
  /\brecord\s+your\s+message\b/i,
  /\bthe\s+(?:person|party|subscriber|number)\s+you(?:'re|\s+are|\s+have)\s+(?:trying\s+to\s+reach|calling|dialed)\b/i,
  /\bmailbox\s+(?:is\s+)?(?:full|not\s+set\s+up)\b/i,
];

export function looksLikeVoicemailPrompt(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return VOICEMAIL_PROMPT_PATTERNS.some(pattern => pattern.test(value));
}

export const VOICEMAIL_DETECTED_REASON = "voicemail_detected";

export type VoicemailTurnDecision =
  | { action: "none" }
  /** First recognition on an outbound call: speak the one bounded line, then end. */
  | { action: "leave_message"; speak: string; reason: typeof VOICEMAIL_DETECTED_REASON }
  /** Recognised before and the line is already spent: say nothing and end. */
  | { action: "hang_up_silently"; reason: typeof VOICEMAIL_DETECTED_REASON };

export function voicemailTurnDecision(input: {
  utterance: string;
  /** Claire placed this call. An inbound caller cannot be a mailbox. */
  outbound: boolean;
  alreadyDetected: boolean;
}): VoicemailTurnDecision {
  if (!input.outbound) return { action: "none" };
  if (input.alreadyDetected) return { action: "hang_up_silently", reason: VOICEMAIL_DETECTED_REASON };
  if (!looksLikeVoicemailPrompt(input.utterance)) return { action: "none" };
  return { action: "leave_message", speak: boundedVoicemailText(), reason: VOICEMAIL_DETECTED_REASON };
}

/** What the AMD webhook decided, for the log. No transcript, no number. */
export function amdDecisionLog(input: {
  callSid?: string | null;
  answeredBy: unknown;
}): { event: "claire_amd_decision"; callSid: string | null; answeredBy: AmdAnsweredBy | "unparsed"; path: AmdCallPath; raw: string } {
  const parsed = parseAmdAnsweredBy(input.answeredBy);
  return {
    event: "claire_amd_decision",
    callSid: input.callSid?.trim() || null,
    answeredBy: parsed ?? "unparsed",
    path: amdCallPath(parsed),
    raw: String(input.answeredBy ?? "").slice(0, 32),
  };
}
