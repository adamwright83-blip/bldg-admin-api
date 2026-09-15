import { randomUUID } from "node:crypto";
import type {
  ConversationAnalysisRow,
  ConversationNotification,
  ConversationSession,
  ConversationTranscript,
  ConversationTurn,
} from "./types";
import { ANALYSIS_NOTIFICATION_KIND } from "./types";

export type ClaireConversationStore = {
  insertSession(session: ConversationSession): Promise<ConversationSession>;
  updateSession(
    id: string,
    patch: Partial<ConversationSession>
  ): Promise<ConversationSession | null>;
  getSession(id: string): Promise<ConversationSession | null>;
  getSessionByCallSid(callSid: string): Promise<ConversationSession | null>;
  getSessionByClaireId(claireConversationId: string): Promise<ConversationSession | null>;
  appendTurn(turn: Omit<ConversationTurn, "id">): Promise<ConversationTurn>;
  listTurns(sessionId: string): Promise<ConversationTurn[]>;
  nextOrdinal(sessionId: string): Promise<number>;
  insertTranscript(row: ConversationTranscript): Promise<ConversationTranscript>;
  getTranscript(sessionId: string, source: string): Promise<ConversationTranscript | null>;
  upsertAnalysis(row: ConversationAnalysisRow): Promise<ConversationAnalysisRow>;
  getAnalysis(sessionId: string): Promise<ConversationAnalysisRow | null>;
  insertNotification(
    row: Omit<ConversationNotification, "id" | "createdAt" | "readAt"> & {
      id?: string;
    }
  ): Promise<ConversationNotification>;
  listNotifications(input: {
    tenantId: string;
    operatorUserId: string;
  }): Promise<ConversationNotification[]>;
  markNotificationRead(input: {
    tenantId: string;
    operatorUserId: string;
    id: string;
  }): Promise<ConversationNotification | null>;
};

export function createMemoryClaireConversationStore(): ClaireConversationStore {
  const sessions = new Map<string, ConversationSession>();
  const turns: ConversationTurn[] = [];
  const transcripts: ConversationTranscript[] = [];
  const analyses = new Map<string, ConversationAnalysisRow>();
  const notifications: ConversationNotification[] = [];
  let turnId = 1;

  return {
    async insertSession(session) {
      sessions.set(session.id, { ...session });
      return { ...session };
    },
    async updateSession(id, patch) {
      const current = sessions.get(id);
      if (!current) return null;
      const next = { ...current, ...patch, id: current.id };
      sessions.set(id, next);
      return { ...next };
    },
    async getSession(id) {
      const row = sessions.get(id);
      return row ? { ...row } : null;
    },
    async getSessionByCallSid(callSid) {
      const row = [...sessions.values()].find(item => item.providerCallSid === callSid);
      return row ? { ...row } : null;
    },
    async getSessionByClaireId(claireConversationId) {
      const row = [...sessions.values()].find(
        item => item.claireConversationId === claireConversationId
      );
      return row ? { ...row } : null;
    },
    async appendTurn(turn) {
      const existing = turns.find(item => item.idempotencyKey === turn.idempotencyKey);
      if (existing) return { ...existing };
      const stored: ConversationTurn = { ...turn, id: turnId++ };
      turns.push(stored);
      return { ...stored };
    },
    async listTurns(sessionId) {
      return turns
        .filter(item => item.sessionId === sessionId)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map(item => ({ ...item }));
    },
    async nextOrdinal(sessionId) {
      const max = turns
        .filter(item => item.sessionId === sessionId)
        .reduce((highest, item) => Math.max(highest, item.ordinal), 0);
      return max + 1;
    },
    async insertTranscript(row) {
      const existing = transcripts.find(
        item => item.sessionId === row.sessionId && item.source === row.source
      );
      if (existing) return { ...existing };
      transcripts.push({ ...row });
      return { ...row };
    },
    async getTranscript(sessionId, source) {
      const row = transcripts.find(
        item => item.sessionId === sessionId && item.source === source
      );
      return row ? { ...row } : null;
    },
    async upsertAnalysis(row) {
      const existing = analyses.get(row.sessionId);
      const next = existing ? { ...existing, ...row, id: existing.id } : { ...row };
      analyses.set(row.sessionId, next);
      return { ...next };
    },
    async getAnalysis(sessionId) {
      const row = analyses.get(sessionId);
      return row ? { ...row } : null;
    },
    async insertNotification(row) {
      const existing = notifications.find(
        item => item.sessionId === row.sessionId && item.kind === row.kind
      );
      if (existing) return { ...existing };
      const stored: ConversationNotification = {
        id: row.id ?? randomUUID(),
        tenantId: row.tenantId,
        operatorUserId: row.operatorUserId,
        sessionId: row.sessionId,
        kind: row.kind || ANALYSIS_NOTIFICATION_KIND,
        title: row.title,
        body: row.body,
        ctaLabel: row.ctaLabel,
        href: row.href,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      notifications.push(stored);
      return { ...stored };
    },
    async listNotifications(input) {
      return notifications
        .filter(
          item =>
            item.tenantId === input.tenantId &&
            item.operatorUserId === input.operatorUserId
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(item => ({ ...item }));
    },
    async markNotificationRead(input) {
      const row = notifications.find(
        item =>
          item.id === input.id &&
          item.tenantId === input.tenantId &&
          item.operatorUserId === input.operatorUserId
      );
      if (!row) return null;
      row.readAt = new Date().toISOString();
      return { ...row };
    },
  };
}

let shared: ClaireConversationStore | null = null;

export function getClaireConversationStore(): ClaireConversationStore {
  if (!shared) {
    throw new Error("Claire conversation store is not configured");
  }
  return shared;
}

export function setClaireConversationStoreForTesting(
  store: ClaireConversationStore | null
): void {
  shared = store;
}

export function ensureClaireConversationStore(
  factory: () => ClaireConversationStore
): ClaireConversationStore {
  if (!shared) shared = factory();
  return shared;
}
