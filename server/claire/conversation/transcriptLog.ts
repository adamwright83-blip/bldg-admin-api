import { and, desc, eq } from "drizzle-orm";
import { claireConversationSessions } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { productionConversationStore } from "./ledgerService";
import {
  POST_CALL_TRANSCRIPT_SOURCE,
  type ConversationSession,
  type ConversationTurn,
} from "./types";

const LOG_PREFIX = "[ClaireTranscript]";
const POST_CALL_CHUNK_SIZE = 3500;
const MAX_BOOT_BACKFILL_COUNT = 5;

export function transcriptLogBackfillCount(
  raw = process.env.CLAIRE_TRANSCRIPT_LOG_BACKFILL_COUNT ?? "1"
): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(MAX_BOOT_BACKFILL_COUNT, Math.max(1, parsed));
}

type TranscriptLogOptions = {
  includeLiveTurns?: boolean;
  includePostCall?: boolean;
  reason?: string;
};

type TranscriptLogScope = {
  tenantId: string;
  operatorUserId: string;
};

export function parseTranscriptLogScopes(
  raw = process.env.CLAIRE_TRANSCRIPT_LOG_SCOPES ?? ""
): TranscriptLogScope[] {
  return raw
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .flatMap(value => {
      const separator = value.indexOf(":");
      if (separator <= 0 || separator >= value.length - 1) return [];
      const tenantId = value.slice(0, separator).trim();
      const operatorUserId = value.slice(separator + 1).trim();
      return tenantId && operatorUserId ? [{ tenantId, operatorUserId }] : [];
    });
}

export function transcriptLoggingAllowed(
  session: Pick<ConversationSession, "tenantId" | "operatorUserId">,
  raw = process.env.CLAIRE_TRANSCRIPT_LOG_SCOPES ?? ""
): boolean {
  return parseTranscriptLogScopes(raw).some(
    scope =>
      scope.tenantId === session.tenantId &&
      scope.operatorUserId === session.operatorUserId
  );
}

function transcriptLog(payload: Record<string, unknown>): void {
  console.info(LOG_PREFIX, JSON.stringify(payload));
}

function transcriptWarn(message: string, error: unknown): void {
  console.warn(LOG_PREFIX, message, error instanceof Error ? error.message : String(error));
}

function chunks(text: string): string[] {
  if (!text) return [];
  const result: string[] = [];
  for (let offset = 0; offset < text.length; offset += POST_CALL_CHUNK_SIZE) {
    result.push(text.slice(offset, offset + POST_CALL_CHUNK_SIZE));
  }
  return result;
}

/**
 * Mirrors one newly persisted live turn immediately. Conversation Relay can
 * remain in-progress for the entire socket lifetime, so waiting for a call
 * completion callback makes its transcript invisible to Railway inspection.
 *
 * The same explicit tenant/operator scope gate and redaction policy as the
 * full-session mirror apply here. Provider ids and providerMetadata are never
 * logged.
 */
export async function emitClaireTranscriptTurnLog(
  turn: Pick<ConversationTurn, "sessionId" | "ordinal" | "speaker" | "text" | "occurredAt">,
  reason = "live_turn_persisted"
): Promise<void> {
  try {
    const store = productionConversationStore();
    const session = await store.getSession(turn.sessionId);
    if (!session || !transcriptLoggingAllowed(session)) return;
    transcriptLog({
      event: "claire_transcript_turn",
      reason,
      sessionId: session.id,
      claireConversationId: session.claireConversationId,
      tenantId: session.tenantId,
      operatorUserId: session.operatorUserId,
      ordinal: turn.ordinal,
      speaker: turn.speaker,
      text: turn.text,
      occurredAt: turn.occurredAt,
    });
  } catch (error) {
    transcriptWarn(`live turn emit failed for session ${turn.sessionId}`, error);
  }
}

/**
 * Mirrors only explicitly configured operator scopes into Railway runtime logs.
 *
 * Why this exists: the authoritative Claire transcript already lives in MySQL,
 * but the Railway ChatGPT connector can read runtime logs and cannot issue SQL.
 * This is therefore a narrow, configuration-gated read mirror — not a second
 * transcript store and not a public API.
 *
 * Deliberately omitted from logs: provider call SID, recording SID/URL,
 * provider metadata, phone numbers, auth material, and environment secrets.
 */
export async function emitClaireTranscriptLog(
  sessionId: string,
  options: TranscriptLogOptions = {}
): Promise<void> {
  const includeLiveTurns = options.includeLiveTurns ?? true;
  const includePostCall = options.includePostCall ?? false;

  try {
    const store = productionConversationStore();
    const session = await store.getSession(sessionId);
    if (!session || !transcriptLoggingAllowed(session)) return;

    if (includeLiveTurns) {
      transcriptLog({
        event: "claire_transcript_session",
        reason: options.reason ?? "unspecified",
        sessionId: session.id,
        claireConversationId: session.claireConversationId,
        tenantId: session.tenantId,
        operatorUserId: session.operatorUserId,
        conversationKind: session.conversationKind,
        status: session.status,
        completionReason: session.completionReason,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      });

      const turns = await store.listTurns(session.id);
      for (const turn of turns) {
        transcriptLog({
          event: "claire_transcript_turn",
          reason: options.reason ?? "unspecified",
          sessionId: session.id,
          claireConversationId: session.claireConversationId,
          tenantId: session.tenantId,
          operatorUserId: session.operatorUserId,
          ordinal: turn.ordinal,
          speaker: turn.speaker,
          text: turn.text,
          occurredAt: turn.occurredAt,
        });
      }
    }

    if (includePostCall) {
      const transcript = await store.getTranscript(
        session.id,
        POST_CALL_TRANSCRIPT_SOURCE
      );
      if (transcript?.text) {
        const parts = chunks(transcript.text);
        for (let index = 0; index < parts.length; index += 1) {
          transcriptLog({
            event: "claire_post_call_transcript_chunk",
            reason: options.reason ?? "unspecified",
            sessionId: session.id,
            claireConversationId: session.claireConversationId,
            tenantId: session.tenantId,
            operatorUserId: session.operatorUserId,
            chunkIndex: index,
            chunkCount: parts.length,
            text: parts[index],
          });
        }
      }
    }
  } catch (error) {
    transcriptWarn(`emit failed for session ${sessionId}`, error);
  }
}

/**
 * Boot-time backfill used only when explicitly enabled. It logs the latest
 * configured number of Claire calls for each scoped operator so a newly
 * deployed connector can inspect recent calls without any manual copy/paste.
 */
export async function emitLatestConfiguredClaireTranscripts(): Promise<void> {
  if (process.env.CLAIRE_TRANSCRIPT_LOG_BACKFILL_ON_BOOT !== "true") return;

  const scopes = parseTranscriptLogScopes();
  if (!scopes.length) return;
  const backfillCount = transcriptLogBackfillCount();

  const db = await getDb();
  if (!db) return;

  for (const scope of scopes) {
    try {
      const rows = await db
        .select({ id: claireConversationSessions.id })
        .from(claireConversationSessions)
        .where(
          and(
            eq(claireConversationSessions.tenantId, scope.tenantId),
            eq(claireConversationSessions.operatorUserId, scope.operatorUserId)
          )
        )
        .orderBy(desc(claireConversationSessions.startedAt))
        .limit(backfillCount);

      for (const row of rows) {
        if (!row?.id) continue;
        await emitClaireTranscriptLog(row.id, {
          includeLiveTurns: true,
          includePostCall: true,
          reason: "boot_backfill",
        });
      }
    } catch (error) {
      transcriptWarn(
        `boot backfill failed for ${scope.tenantId}:${scope.operatorUserId}`,
        error
      );
    }
  }
}
