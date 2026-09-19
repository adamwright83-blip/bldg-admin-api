import { createHash, randomUUID } from "node:crypto";
import { claireModelId } from "../claireModel";
import { CLAIRE_CHARACTER_VERSION } from "../character/characterDefinition";
import { CLAIRE_COMPILER_VERSION } from "../character/compiler";
import { ENV } from "../../_core/env";
import { recordingConsentLabel } from "./consent";
import {
  ensureClaireConversationStore,
  getClaireConversationStore,
  type ClaireConversationStore,
} from "./memoryStore";
import { createDrizzleClaireConversationStore } from "./drizzleStore";
import {
  LIVE_TURN_SOURCE,
  type ConversationKind,
  type ConversationSession,
  type ConversationSpeaker,
  type ConversationTurn,
} from "./types";

export function deployedGitSha(): string {
  return (
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "unknown"
  );
}

export function productionConversationStore(): ClaireConversationStore {
  return ensureClaireConversationStore(createDrizzleClaireConversationStore);
}

/**
 * Identity of one spoken turn. Two separate "yes" replies in the same call are
 * different turns, so the key includes the conversation's turn position; a
 * retried webhook for the same turn reuses the same turnKey and stays idempotent.
 */
export function turnIdempotencyKey(input: {
  callSid: string;
  speaker: ConversationSpeaker;
  text: string;
  turnKey?: string | number | null;
}): string {
  return createHash("sha256")
    .update(`${input.callSid}|${input.speaker}|${input.turnKey ?? ""}|${input.text}`)
    .digest("hex")
    .slice(0, 64);
}

export async function createConversationSession(input: {
  tenantId: string;
  operatorUserId: string;
  claireConversationId: string;
  conversationKind: ConversationKind | string;
  missionId?: number | null;
  recordingEnabled: boolean;
  providerCallSid?: string | null;
}): Promise<ConversationSession> {
  const store = productionConversationStore();
  const now = new Date().toISOString();
  return store.insertSession({
    id: randomUUID(),
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    provider: "twilio",
    providerCallSid: input.providerCallSid ?? null,
    claireConversationId: input.claireConversationId,
    conversationKind: input.conversationKind,
    missionId: input.missionId ?? null,
    relatedActionIds: [],
    status: "in_progress",
    completionReason: null,
    recordingStatus: input.recordingEnabled ? "pending" : "skipped",
    transcriptionStatus: input.recordingEnabled ? "pending" : "skipped",
    analysisStatus: "pending",
    notificationStatus: "pending",
    recordingConsent: recordingConsentLabel(input.recordingEnabled),
    recordingSid: null,
    recordingDurationSeconds: null,
    recordingChannels: input.recordingEnabled ? "dual" : null,
    recordingTrack: input.recordingEnabled ? "both" : null,
    recordingProviderUrl: null,
    audioStorageProvider: null,
    audioStorageKey: null,
    audioCompletedAt: null,
    audioRetainUntil: null,
    transcriptRetainUntil: null,
    analysisRetainUntil: null,
    claireCompilerVersion: CLAIRE_COMPILER_VERSION,
    claireCharacterVersion: CLAIRE_CHARACTER_VERSION,
    // Slice B: the call ledger labels the call with the model Claire is
    // configured to request. Before the Claire model authority existed this
    // read the generic variable, which would have mislabelled every call the
    // moment ANTHROPIC_MODEL_CLAIRE was set.
    llmModel: claireModelId() || null,
    voiceProvider: "twilio_polly",
    voiceName: "Polly.Ruth-Generative",
    gitSha: deployedGitSha(),
    frontendRelease: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    startedAt: now,
    endedAt: null,
  });
}

export async function attachCallSid(input: {
  claireConversationId: string;
  callSid: string;
}): Promise<ConversationSession | null> {
  const store = productionConversationStore();
  const session = await store.getSessionByClaireId(input.claireConversationId);
  if (!session) return null;
  return store.updateSession(session.id, { providerCallSid: input.callSid });
}

export async function persistSpokenTurn(input: {
  claireConversationId?: string;
  callSid?: string;
  speaker: ConversationSpeaker;
  text: string;
  providerMetadata?: Record<string, unknown> | null;
  /** The live conversation's turn number. Without it, a retried identical turn stays idempotent by text. */
  turnKey?: string | number | null;
}): Promise<ConversationTurn | null> {
  const text = input.text.trim();
  if (!text) return null;
  const store = productionConversationStore();
  const session = input.callSid
    ? await store.getSessionByCallSid(input.callSid)
    : input.claireConversationId
      ? await store.getSessionByClaireId(input.claireConversationId)
      : null;
  if (!session) return null;
  const callSid = session.providerCallSid ?? input.callSid ?? session.id;
  const ordinal = await store.nextOrdinal(session.id);
  return store.appendTurn({
    sessionId: session.id,
    ordinal,
    speaker: input.speaker,
    text,
    source:
      input.speaker === "OPERATOR"
        ? LIVE_TURN_SOURCE.OPERATOR
        : LIVE_TURN_SOURCE.CLAIRE,
    idempotencyKey: turnIdempotencyKey({
      callSid,
      speaker: input.speaker,
      text,
      turnKey: input.turnKey ?? null,
    }),
    providerMetadata: input.providerMetadata ?? null,
    occurredAt: new Date().toISOString(),
  });
}

export async function linkRelatedAction(input: {
  claireConversationId?: string;
  callSid?: string;
  actionId: string;
}): Promise<void> {
  const store = productionConversationStore();
  const session = input.callSid
    ? await store.getSessionByCallSid(input.callSid)
    : input.claireConversationId
      ? await store.getSessionByClaireId(input.claireConversationId)
      : null;
  if (!session) return;
  if (session.relatedActionIds.includes(input.actionId)) return;
  await store.updateSession(session.id, {
    relatedActionIds: [...session.relatedActionIds, input.actionId],
  });
}

export async function completeConversationSession(input: {
  claireConversationId?: string;
  callSid?: string;
  reason: string;
}): Promise<ConversationSession | null> {
  const store = productionConversationStore();
  const session = input.callSid
    ? await store.getSessionByCallSid(input.callSid)
    : input.claireConversationId
      ? await store.getSessionByClaireId(input.claireConversationId)
      : null;
  if (!session) return null;
  if (session.status === "complete") return session;
  return store.updateSession(session.id, {
    status: "complete",
    completionReason: input.reason,
    endedAt: new Date().toISOString(),
  });
}

export { getClaireConversationStore };
