import { TRPCError } from "@trpc/server";
import { storageGet } from "../../storage";
import { renderFullTranscript } from "../analysis/copyBundle";
import { enrichAnalysisCounts } from "../analysis/conversationAnalysisService";
import {
  qualitativeEvaluationSchema,
  type QualitativeEvaluation,
} from "../analysis/conversationAnalysisSchema";
import { POST_CALL_TRANSCRIPT_SOURCE } from "./types";
import { productionConversationStore } from "./ledgerService";
import type { ConversationSession } from "./types";

function publicSession(session: ConversationSession): Omit<
  ConversationSession,
  "recordingProviderUrl"
> {
  const { recordingProviderUrl: _hidden, ...rest } = session;
  return rest;
}

export async function requireClaireCallSession(input: {
  tenantId: string;
  operatorUserId: string;
  isAdmin: boolean;
  sessionId?: string;
  callSid?: string;
}): Promise<ConversationSession> {
  const store = productionConversationStore();
  const session = input.sessionId
    ? await store.getSession(input.sessionId)
    : input.callSid
      ? await store.getSessionByCallSid(input.callSid)
      : null;
  if (!session || session.tenantId !== input.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Claire call not found" });
  }
  if (!input.isAdmin && session.operatorUserId !== input.operatorUserId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Claire call not found" });
  }
  return session;
}

export async function listClaireAnalysisInbox(input: {
  tenantId: string;
  operatorUserId: string;
}) {
  const store = productionConversationStore();
  const rows = await store.listNotifications(input);
  return rows.filter(row => row.readAt == null);
}

export async function markClaireAnalysisNotificationRead(input: {
  tenantId: string;
  operatorUserId: string;
  id: string;
}) {
  const store = productionConversationStore();
  return store.markNotificationRead(input);
}

export async function getClaireCallAnalysis(input: {
  tenantId: string;
  operatorUserId: string;
  isAdmin: boolean;
  sessionId?: string;
  callSid?: string;
}) {
  const session = await requireClaireCallSession(input);
  await enrichAnalysisCounts(session.id);
  const store = productionConversationStore();
  const [turns, postCall, analysis] = await Promise.all([
    store.listTurns(session.id),
    store.getTranscript(session.id, POST_CALL_TRANSCRIPT_SOURCE),
    store.getAnalysis(session.id),
  ]);
  const evaluation = analysis
    ? qualitativeEvaluationSchema.safeParse(analysis.result)
    : null;
  return {
    session: publicSession(session),
    turns,
    postCallTranscript: postCall?.text ?? null,
    analysis: analysis
      ? {
          ...analysis,
          result: (evaluation?.success
            ? evaluation.data
            : analysis.result) as QualitativeEvaluation | Record<string, unknown>,
        }
      : null,
    copyBundleText: analysis?.copyBundleText ?? "",
    fullTranscriptText: renderFullTranscript(turns),
    audioAvailable: Boolean(session.audioStorageKey),
  };
}

export async function getClaireCallAudio(input: {
  tenantId: string;
  operatorUserId: string;
  isAdmin: boolean;
  sessionId: string;
}): Promise<{ url: string } | null> {
  const session = await requireClaireCallSession(input);
  if (!session.audioStorageKey) return null;
  try {
    const stored = await storageGet(session.audioStorageKey);
    return { url: stored.url };
  } catch {
    return null;
  }
}

export async function markClaireCallReviewed(input: {
  tenantId: string;
  operatorUserId: string;
  isAdmin: boolean;
  sessionId: string;
}) {
  const session = await requireClaireCallSession(input);
  const store = productionConversationStore();
  const analysis = await store.getAnalysis(session.id);
  if (!analysis) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Analysis not ready" });
  }
  return store.upsertAnalysis({
    ...analysis,
    humanReviewStatus: "reviewed",
    reviewedAt: new Date().toISOString(),
    reviewedByUserId: input.operatorUserId,
  });
}

export async function markClaireCallAnalysisWrong(input: {
  tenantId: string;
  operatorUserId: string;
  isAdmin: boolean;
  sessionId: string;
  note: string;
}) {
  const session = await requireClaireCallSession(input);
  const store = productionConversationStore();
  const analysis = await store.getAnalysis(session.id);
  if (!analysis) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Analysis not ready" });
  }
  const turns = await store.listTurns(session.id);
  await store.upsertAnalysis({
    ...analysis,
    humanReviewStatus: "disputed",
    humanFeedbackKind: "analysis_is_wrong",
    humanFeedbackNote: input.note.slice(0, 1000),
    reviewedAt: new Date().toISOString(),
    reviewedByUserId: input.operatorUserId,
  });
  const after = await store.listTurns(session.id);
  return {
    analysis: await store.getAnalysis(session.id),
    transcriptUnchanged: JSON.stringify(turns) === JSON.stringify(after),
  };
}
