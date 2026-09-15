import { and, desc, eq } from "drizzle-orm";
import {
  claireConversationAnalyses,
  claireConversationNotifications,
  claireConversationSessions,
  claireConversationTranscripts,
  claireConversationTurns,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlDuplicateKeyError, isMysqlMissingTableError } from "../../mysqlErrors";
import type { ClaireConversationStore } from "./memoryStore";
import type {
  ConversationAnalysisRow,
  ConversationNotification,
  ConversationSession,
  ConversationTranscript,
  ConversationTurn,
} from "./types";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toSession(
  row: typeof claireConversationSessions.$inferSelect
): ConversationSession {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    provider: row.provider,
    providerCallSid: row.providerCallSid ?? null,
    claireConversationId: row.claireConversationId,
    conversationKind: row.conversationKind,
    missionId: row.missionId ?? null,
    relatedActionIds: asStringArray(row.relatedActionIdsJson),
    status: row.status,
    completionReason: row.completionReason ?? null,
    recordingStatus: row.recordingStatus,
    transcriptionStatus: row.transcriptionStatus,
    analysisStatus: row.analysisStatus,
    notificationStatus: row.notificationStatus,
    recordingConsent: row.recordingConsent,
    recordingSid: row.recordingSid ?? null,
    recordingDurationSeconds: row.recordingDurationSeconds ?? null,
    recordingChannels: row.recordingChannels ?? null,
    recordingTrack: row.recordingTrack ?? null,
    recordingProviderUrl: row.recordingProviderUrl ?? null,
    audioStorageProvider: row.audioStorageProvider ?? null,
    audioStorageKey: row.audioStorageKey ?? null,
    audioCompletedAt: iso(row.audioCompletedAt),
    audioRetainUntil: iso(row.audioRetainUntil),
    transcriptRetainUntil: iso(row.transcriptRetainUntil),
    analysisRetainUntil: iso(row.analysisRetainUntil),
    claireCompilerVersion: row.claireCompilerVersion ?? null,
    claireCharacterVersion: row.claireCharacterVersion ?? null,
    llmModel: row.llmModel ?? null,
    voiceProvider: row.voiceProvider ?? null,
    voiceName: row.voiceName ?? null,
    gitSha: row.gitSha ?? null,
    frontendRelease: row.frontendRelease ?? null,
    startedAt: iso(row.startedAt) ?? new Date().toISOString(),
    endedAt: iso(row.endedAt),
  };
}

function toTurn(row: typeof claireConversationTurns.$inferSelect): ConversationTurn {
  return {
    id: Number(row.id),
    sessionId: row.sessionId,
    ordinal: row.ordinal,
    speaker: row.speaker as ConversationTurn["speaker"],
    text: row.text,
    source: row.source,
    idempotencyKey: row.idempotencyKey,
    providerMetadata: asRecord(row.providerMetadataJson),
    occurredAt: iso(row.occurredAt) ?? new Date().toISOString(),
  };
}

async function failClosed<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMysqlMissingTableError(error)) return fallback;
    throw error;
  }
}

export function createDrizzleClaireConversationStore(): ClaireConversationStore {
  return {
    async insertSession(session) {
      const db = await getDb();
      if (!db) return session;
      return failClosed(async () => {
        await db.insert(claireConversationSessions).values({
          id: session.id,
          tenantId: session.tenantId,
          operatorUserId: session.operatorUserId,
          provider: session.provider,
          providerCallSid: session.providerCallSid,
          claireConversationId: session.claireConversationId,
          conversationKind: session.conversationKind,
          missionId: session.missionId,
          relatedActionIdsJson: session.relatedActionIds,
          status: session.status,
          completionReason: session.completionReason,
          recordingStatus: session.recordingStatus,
          transcriptionStatus: session.transcriptionStatus,
          analysisStatus: session.analysisStatus,
          notificationStatus: session.notificationStatus,
          recordingConsent: session.recordingConsent,
          recordingSid: session.recordingSid,
          recordingDurationSeconds: session.recordingDurationSeconds,
          recordingChannels: session.recordingChannels,
          recordingTrack: session.recordingTrack,
          recordingProviderUrl: session.recordingProviderUrl,
          audioStorageProvider: session.audioStorageProvider,
          audioStorageKey: session.audioStorageKey,
          audioCompletedAt: session.audioCompletedAt
            ? new Date(session.audioCompletedAt)
            : null,
          audioRetainUntil: session.audioRetainUntil
            ? new Date(session.audioRetainUntil)
            : null,
          transcriptRetainUntil: session.transcriptRetainUntil
            ? new Date(session.transcriptRetainUntil)
            : null,
          analysisRetainUntil: session.analysisRetainUntil
            ? new Date(session.analysisRetainUntil)
            : null,
          claireCompilerVersion: session.claireCompilerVersion,
          claireCharacterVersion: session.claireCharacterVersion,
          llmModel: session.llmModel,
          voiceProvider: session.voiceProvider,
          voiceName: session.voiceName,
          gitSha: session.gitSha,
          frontendRelease: session.frontendRelease,
          startedAt: new Date(session.startedAt),
          endedAt: session.endedAt ? new Date(session.endedAt) : null,
        });
        return session;
      }, session);
    },

    async updateSession(id, patch) {
      const db = await getDb();
      if (!db) return null;
      return failClosed(async () => {
        const values: Record<string, unknown> = {};
        if (patch.providerCallSid !== undefined) values.providerCallSid = patch.providerCallSid;
        if (patch.relatedActionIds !== undefined)
          values.relatedActionIdsJson = patch.relatedActionIds;
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.completionReason !== undefined)
          values.completionReason = patch.completionReason;
        if (patch.recordingStatus !== undefined) values.recordingStatus = patch.recordingStatus;
        if (patch.transcriptionStatus !== undefined)
          values.transcriptionStatus = patch.transcriptionStatus;
        if (patch.analysisStatus !== undefined) values.analysisStatus = patch.analysisStatus;
        if (patch.notificationStatus !== undefined)
          values.notificationStatus = patch.notificationStatus;
        if (patch.recordingSid !== undefined) values.recordingSid = patch.recordingSid;
        if (patch.recordingDurationSeconds !== undefined)
          values.recordingDurationSeconds = patch.recordingDurationSeconds;
        if (patch.recordingChannels !== undefined)
          values.recordingChannels = patch.recordingChannels;
        if (patch.recordingTrack !== undefined) values.recordingTrack = patch.recordingTrack;
        if (patch.recordingProviderUrl !== undefined)
          values.recordingProviderUrl = patch.recordingProviderUrl;
        if (patch.audioStorageProvider !== undefined)
          values.audioStorageProvider = patch.audioStorageProvider;
        if (patch.audioStorageKey !== undefined) values.audioStorageKey = patch.audioStorageKey;
        if (patch.audioCompletedAt !== undefined)
          values.audioCompletedAt = patch.audioCompletedAt
            ? new Date(patch.audioCompletedAt)
            : null;
        if (patch.endedAt !== undefined)
          values.endedAt = patch.endedAt ? new Date(patch.endedAt) : null;
        if (Object.keys(values).length) {
          await db
            .update(claireConversationSessions)
            .set(values)
            .where(eq(claireConversationSessions.id, id));
        }
        const [row] = await db
          .select()
          .from(claireConversationSessions)
          .where(eq(claireConversationSessions.id, id))
          .limit(1);
        return row ? toSession(row) : null;
      }, null);
    },

    async getSession(id) {
      const db = await getDb();
      if (!db) return null;
      return failClosed(async () => {
        const [row] = await db
          .select()
          .from(claireConversationSessions)
          .where(eq(claireConversationSessions.id, id))
          .limit(1);
        return row ? toSession(row) : null;
      }, null);
    },

    async getSessionByCallSid(callSid) {
      const db = await getDb();
      if (!db) return null;
      return failClosed(async () => {
        const [row] = await db
          .select()
          .from(claireConversationSessions)
          .where(eq(claireConversationSessions.providerCallSid, callSid))
          .limit(1);
        return row ? toSession(row) : null;
      }, null);
    },

    async getSessionByClaireId(claireConversationId) {
      const db = await getDb();
      if (!db) return null;
      return failClosed(async () => {
        const [row] = await db
          .select()
          .from(claireConversationSessions)
          .where(eq(claireConversationSessions.claireConversationId, claireConversationId))
          .limit(1);
        return row ? toSession(row) : null;
      }, null);
    },

    async appendTurn(turn) {
      const db = await getDb();
      if (!db) return { ...turn, id: 0 };
      return failClosed(async () => {
        try {
          const [result] = await db.insert(claireConversationTurns).values({
            sessionId: turn.sessionId,
            ordinal: turn.ordinal,
            speaker: turn.speaker,
            text: turn.text,
            source: turn.source,
            idempotencyKey: turn.idempotencyKey,
            providerMetadataJson: turn.providerMetadata,
            occurredAt: new Date(turn.occurredAt),
          });
          const insertedId = Number((result as { insertId?: number }).insertId ?? 0);
          return { ...turn, id: insertedId };
        } catch (error) {
          if (!isMysqlDuplicateKeyError(error)) throw error;
          const [existing] = await db
            .select()
            .from(claireConversationTurns)
            .where(eq(claireConversationTurns.idempotencyKey, turn.idempotencyKey))
            .limit(1);
          if (existing) return toTurn(existing);
          throw error;
        }
      }, { ...turn, id: 0 });
    },

    async listTurns(sessionId) {
      const db = await getDb();
      if (!db) return [];
      return failClosed(async () => {
        const rows = await db
          .select()
          .from(claireConversationTurns)
          .where(eq(claireConversationTurns.sessionId, sessionId))
          .orderBy(claireConversationTurns.ordinal);
        return rows.map(toTurn);
      }, []);
    },

    async nextOrdinal(sessionId) {
      const turns = await this.listTurns(sessionId);
      return turns.reduce((highest, item) => Math.max(highest, item.ordinal), 0) + 1;
    },

    async insertTranscript(row) {
      const db = await getDb();
      if (!db) return row;
      return failClosed(async () => {
        try {
          await db.insert(claireConversationTranscripts).values({
            sessionId: row.sessionId,
            source: row.source,
            provider: row.provider,
            providerVersion: row.providerVersion,
            text: row.text,
            payloadJson: row.payload,
          });
          return row;
        } catch (error) {
          if (!isMysqlDuplicateKeyError(error)) throw error;
          const existing = await this.getTranscript(row.sessionId, row.source);
          return existing ?? row;
        }
      }, row);
    },

    async getTranscript(sessionId, source) {
      const db = await getDb();
      if (!db) return null;
      return failClosed(async () => {
        const [row] = await db
          .select()
          .from(claireConversationTranscripts)
          .where(
            and(
              eq(claireConversationTranscripts.sessionId, sessionId),
              eq(claireConversationTranscripts.source, source)
            )
          )
          .limit(1);
        return row
          ? {
              sessionId: row.sessionId,
              source: row.source,
              provider: row.provider,
              providerVersion: row.providerVersion ?? null,
              text: row.text,
              payload: asRecord(row.payloadJson),
            }
          : null;
      }, null);
    },

    async upsertAnalysis(row) {
      const db = await getDb();
      if (!db) return row;
      return failClosed(async () => {
        const values = {
          id: row.id,
          sessionId: row.sessionId,
          evaluatorVersion: row.evaluatorVersion,
          model: row.model,
          researchFlag: row.researchFlag,
          resultJson: row.result,
          summaryText: row.summaryText,
          copyBundleText: row.copyBundleText,
          acceptedActionCount: row.acceptedActionCount,
          completedActionCount: row.completedActionCount,
          outcomeCount: row.outcomeCount,
          humanReviewStatus: row.humanReviewStatus,
          humanFeedbackKind: row.humanFeedbackKind,
          humanFeedbackNote: row.humanFeedbackNote,
          reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
          reviewedByUserId: row.reviewedByUserId,
        };
        await db
          .insert(claireConversationAnalyses)
          .values(values)
          .onDuplicateKeyUpdate({
            set: {
              evaluatorVersion: values.evaluatorVersion,
              model: values.model,
              researchFlag: values.researchFlag,
              resultJson: values.resultJson,
              summaryText: values.summaryText,
              copyBundleText: values.copyBundleText,
              acceptedActionCount: values.acceptedActionCount,
              completedActionCount: values.completedActionCount,
              outcomeCount: values.outcomeCount,
              humanReviewStatus: values.humanReviewStatus,
              humanFeedbackKind: values.humanFeedbackKind,
              humanFeedbackNote: values.humanFeedbackNote,
              reviewedAt: values.reviewedAt,
              reviewedByUserId: values.reviewedByUserId,
            },
          });
        return row;
      }, row);
    },

    async getAnalysis(sessionId) {
      const db = await getDb();
      if (!db) return null;
      return failClosed(async () => {
        const [row] = await db
          .select()
          .from(claireConversationAnalyses)
          .where(eq(claireConversationAnalyses.sessionId, sessionId))
          .limit(1);
        return row
          ? {
              id: row.id,
              sessionId: row.sessionId,
              evaluatorVersion: row.evaluatorVersion,
              model: row.model,
              researchFlag: row.researchFlag,
              result: asRecord(row.resultJson) ?? {},
              summaryText: row.summaryText,
              copyBundleText: row.copyBundleText,
              acceptedActionCount: row.acceptedActionCount,
              completedActionCount: row.completedActionCount,
              outcomeCount: row.outcomeCount,
              humanReviewStatus: row.humanReviewStatus,
              humanFeedbackKind: row.humanFeedbackKind ?? null,
              humanFeedbackNote: row.humanFeedbackNote ?? null,
              reviewedAt: iso(row.reviewedAt),
              reviewedByUserId: row.reviewedByUserId ?? null,
            }
          : null;
      }, null);
    },

    async insertNotification(row) {
      const db = await getDb();
      const fallback: ConversationNotification = {
        id: row.id ?? "unavailable",
        tenantId: row.tenantId,
        operatorUserId: row.operatorUserId,
        sessionId: row.sessionId,
        kind: row.kind,
        title: row.title,
        body: row.body,
        ctaLabel: row.ctaLabel,
        href: row.href,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      if (!db) return fallback;
      return failClosed(async () => {
        const id = row.id ?? crypto.randomUUID();
        try {
          await db.insert(claireConversationNotifications).values({
            id,
            tenantId: row.tenantId,
            operatorUserId: row.operatorUserId,
            sessionId: row.sessionId,
            kind: row.kind,
            title: row.title,
            body: row.body,
            ctaLabel: row.ctaLabel,
            href: row.href,
          });
        } catch (error) {
          if (!isMysqlDuplicateKeyError(error)) throw error;
        }
        const [existing] = await db
          .select()
          .from(claireConversationNotifications)
          .where(
            and(
              eq(claireConversationNotifications.sessionId, row.sessionId),
              eq(claireConversationNotifications.kind, row.kind)
            )
          )
          .limit(1);
        return existing
          ? {
              id: existing.id,
              tenantId: existing.tenantId,
              operatorUserId: existing.operatorUserId,
              sessionId: existing.sessionId,
              kind: existing.kind,
              title: existing.title,
              body: existing.body,
              ctaLabel: existing.ctaLabel,
              href: existing.href,
              readAt: iso(existing.readAt),
              createdAt: iso(existing.createdAt) ?? new Date().toISOString(),
            }
          : { ...fallback, id };
      }, fallback);
    },

    async listNotifications(input) {
      const db = await getDb();
      if (!db) return [];
      return failClosed(async () => {
        const rows = await db
          .select()
          .from(claireConversationNotifications)
          .where(
            and(
              eq(claireConversationNotifications.tenantId, input.tenantId),
              eq(claireConversationNotifications.operatorUserId, input.operatorUserId)
            )
          )
          .orderBy(desc(claireConversationNotifications.createdAt));
        return rows.map(row => ({
          id: row.id,
          tenantId: row.tenantId,
          operatorUserId: row.operatorUserId,
          sessionId: row.sessionId,
          kind: row.kind,
          title: row.title,
          body: row.body,
          ctaLabel: row.ctaLabel,
          href: row.href,
          readAt: iso(row.readAt),
          createdAt: iso(row.createdAt) ?? new Date().toISOString(),
        }));
      }, []);
    },

    async markNotificationRead(input) {
      const db = await getDb();
      if (!db) return null;
      return failClosed(async () => {
        await db
          .update(claireConversationNotifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(claireConversationNotifications.id, input.id),
              eq(claireConversationNotifications.tenantId, input.tenantId),
              eq(claireConversationNotifications.operatorUserId, input.operatorUserId)
            )
          );
        const [row] = await db
          .select()
          .from(claireConversationNotifications)
          .where(eq(claireConversationNotifications.id, input.id))
          .limit(1);
        return row
          ? {
              id: row.id,
              tenantId: row.tenantId,
              operatorUserId: row.operatorUserId,
              sessionId: row.sessionId,
              kind: row.kind,
              title: row.title,
              body: row.body,
              ctaLabel: row.ctaLabel,
              href: row.href,
              readAt: iso(row.readAt),
              createdAt: iso(row.createdAt) ?? new Date().toISOString(),
            }
          : null;
      }, null);
    },
  };
}
