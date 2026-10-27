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

export async function attachConversationKind(input: {
  claireConversationId: string;
  conversationKind: string;
}): Promise<ConversationSession | null> {
  const store = productionConversationStore();
  const session = await store.getSessionByClaireId(input.claireConversationId);
  if (!session) return null;
  if (session.conversationKind === input.conversationKind) return session;
  return store.updateSession(session.id, { conversationKind: input.conversationKind });
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
  /** When the call really ended, if known (the idle sweep passes the last activity). Defaults to now. */
  endedAt?: string;
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
    endedAt: input.endedAt ?? new Date().toISOString(),
  });
}

/** No call goes thirty minutes without a word. Past that, nobody is on the line. */
export const CLAIRE_SESSION_IDLE_MS = 30 * 60 * 1_000;
export const IDLE_TIMEOUT_REASON = "idle_timeout";

/**
 * Close sessions nobody ended.
 *
 * An inbound call reaches Claire through the phone number's own webhooks, so Twilio's
 * `completed` status callback (which is attached only to calls Claire places) never arrives,
 * and a hangup on the Gather path is just a webhook that stops. 18 sessions of kinds
 * pre_drive, evening_planning and morning_reconciliation sat `in_progress` with no
 * `endedAt` from 2026-10-01 to 2026-10-20. A session with no activity for 30 minutes is
 * complete: `endedAt` is its last turn (or its start), `completionReason` is `idle_timeout`.
 *
 * This only closes the session row. It does NOT run transcript logging or analysis: those
 * belong to a hangup the pipeline actually saw, and re-running them for old calls would
 * spend model budget and notify the operator about calls from weeks ago.
 */
export async function sweepIdleConversationSessions(
  input: { nowMs?: number; idleMs?: number; limit?: number; store?: ClaireConversationStore } = {}
): Promise<{ closed: string[] }> {
  const store = input.store ?? productionConversationStore();
  const nowMs = input.nowMs ?? Date.now();
  const idleMs = input.idleMs ?? CLAIRE_SESSION_IDLE_MS;
  const closed: string[] = [];
  for (const session of await store.listInProgressSessions(input.limit ?? 200)) {
    const turns = await store.listTurns(session.id);
    const last = turns.reduce<string>(
      (latest, turn) => (turn.occurredAt > latest ? turn.occurredAt : latest),
      session.startedAt
    );
    if (nowMs - new Date(last).getTime() < idleMs) continue;
    const done = await store.updateSession(session.id, {
      status: "complete",
      completionReason: IDLE_TIMEOUT_REASON,
      endedAt: last,
    });
    if (done) closed.push(session.id);
  }
  return { closed };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Production schedule: every five minutes, never throws, never holds the process open. */
export function startClaireSessionIdleSweep(intervalMs = 5 * 60 * 1_000): () => void {
  if (sweepTimer) return () => undefined;
  const run = () =>
    void sweepIdleConversationSessions().then(
      result => {
        if (result.closed.length) {
          console.info("[ClaireLedger] idle sessions closed", { event: "claire_session_idle_sweep", count: result.closed.length });
        }
      },
      error => console.warn("[ClaireLedger] idle sweep failed", error instanceof Error ? error.message : error)
    );
  run();
  sweepTimer = setInterval(run, intervalMs);
  sweepTimer.unref?.();
  return () => {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  };
}

export { getClaireConversationStore };
