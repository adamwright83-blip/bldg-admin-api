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
}): Promise<void> {
  try {
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
    await recordProviderEvent({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      eventType: communicationReceiptEventFromProviderStatus({
        channel: "voice",
        status: "initiated",
      }),
      callSid: input.callSid,
      from: input.from,
      to: input.to,
      status: "initiated",
    });
  } catch (error) {
    const code = error instanceof TwilioCommunicationReceiptError ? error.code : "unexpected";
    console.warn("[Claire] call attempt receipt was not stored", code);
  }
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
