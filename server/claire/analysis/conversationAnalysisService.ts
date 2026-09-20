import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { dayDirectorCommitments } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";
import { ENV } from "../../_core/env";
import {
  ANALYSIS_NOTIFICATION_KIND,
  CLAIRE_EVALUATOR_VERSION,
  POST_CALL_TRANSCRIPT_SOURCE,
} from "../conversation/types";
import { productionConversationStore } from "../conversation/ledgerService";
import {
  formatDuration,
  renderAnalysisSummary,
  renderCopyAnalysisBundle,
  renderNotificationBody,
} from "./copyBundle";
import { evaluateConversationQualitative, formatLiveTranscript, MalformedConversationEvaluationError } from "./conversationEvaluator";
import { recordEvaluatorAttempt, recordEvaluatorFailure, recordEvaluatorSuccess } from "./evaluatorStats";
import { researchFlagFor, type QualitativeEvaluation } from "./conversationAnalysisSchema";

export async function readLinkedActionStats(actionIds: string[]): Promise<{
  acceptedActionCount: number;
  completedActionCount: number;
  outcomeCount: number;
  needsDetails: string[];
  titles: string[];
}> {
  if (!actionIds.length) {
    return {
      acceptedActionCount: 0,
      completedActionCount: 0,
      outcomeCount: 0,
      needsDetails: [],
      titles: [],
    };
  }
  const db = await getDb();
  if (!db) {
    return {
      acceptedActionCount: actionIds.length,
      completedActionCount: 0,
      outcomeCount: 0,
      needsDetails: [],
      titles: actionIds,
    };
  }
  try {
    const rows = await db
      .select()
      .from(dayDirectorCommitments)
      .where(inArray(dayDirectorCommitments.id, actionIds));
    const needsDetails: string[] = [];
    for (const row of rows) {
      const metadata =
        row.metadataJson && typeof row.metadataJson === "object"
          ? (row.metadataJson as Record<string, unknown>)
          : {};
      if (metadata.detailState === "NEEDS_DETAILS") {
        const missing = Array.isArray(metadata.missingDetails)
          ? metadata.missingDetails.map(String)
          : [];
        needsDetails.push(
          missing.length ? `${row.title}: ${missing.join(", ")}` : row.title
        );
      }
    }
    const completed = rows.filter(row => row.status === "completed");
    return {
      acceptedActionCount: rows.length || actionIds.length,
      completedActionCount: completed.length,
      outcomeCount: completed.length,
      needsDetails,
      titles: rows.map(row => row.title),
    };
  } catch (error) {
    if (isMysqlMissingTableError(error)) {
      return {
        acceptedActionCount: actionIds.length,
        completedActionCount: 0,
        outcomeCount: 0,
        needsDetails: [],
        titles: actionIds,
      };
    }
    throw error;
  }
}

export async function runConversationAnalysis(
  sessionId: string,
  dependencies: {
    evaluate?: typeof evaluateConversationQualitative;
  } = {}
): Promise<{ ok: boolean; reason?: string }> {
  const store = productionConversationStore();
  const session = await store.getSession(sessionId);
  if (!session) return { ok: false, reason: "session_missing" };
  const existing = await store.getAnalysis(sessionId);
  if (existing && session.analysisStatus === "complete") {
    await enrichAnalysisCounts(sessionId);
    return { ok: true, reason: "already_complete" };
  }

  const turns = await store.listTurns(sessionId);
  const postCall = await store.getTranscript(sessionId, POST_CALL_TRANSCRIPT_SOURCE);
  const stats = await readLinkedActionStats(session.relatedActionIds);
  const evaluate = dependencies.evaluate ?? evaluateConversationQualitative;

  let evaluation: QualitativeEvaluation;
  recordEvaluatorAttempt();
  try {
    evaluation = await evaluate({
      tenantId: session.tenantId,
      conversationKind: session.conversationKind,
      liveTranscript: formatLiveTranscript(turns),
      postCallTranscript: postCall?.text ?? null,
      deterministic: {
        durationLabel: formatDuration(session.startedAt, session.endedAt),
        turnCount: turns.length,
        acceptedActionCount: stats.acceptedActionCount,
        completedActionCount: stats.completedActionCount,
        needsDetails: stats.needsDetails,
      },
    });
  } catch (error) {
    const malformed = error instanceof MalformedConversationEvaluationError;
    recordEvaluatorFailure(
      sessionId,
      malformed ? error.category : "provider_error",
      malformed ? error.detail : error instanceof Error ? error.message.slice(0, 200) : "unknown"
    );
    await store.updateSession(sessionId, { analysisStatus: "failed" });
    return { ok: false, reason: malformed ? `evaluator_failed:${error.category}` : "evaluator_failed" };
  }
  recordEvaluatorSuccess();

  const usefulNextStep =
    stats.acceptedActionCount > 0 ? true : evaluation.usefulNextStepReached;
  const researchFlag = researchFlagFor({
    evaluation,
    acceptedActionCount: stats.acceptedActionCount,
    usefulNextStepReached: usefulNextStep,
  });
  const summaryText = renderAnalysisSummary({
    session,
    evaluation,
    acceptedActionCount: stats.acceptedActionCount,
    completedActionCount: stats.completedActionCount,
    needsDetails: stats.needsDetails,
  });
  const copyBundleText = renderCopyAnalysisBundle({
    session,
    evaluation,
    turns,
    acceptedActionCount: stats.acceptedActionCount,
    completedActionCount: stats.completedActionCount,
    outcomeCount: stats.outcomeCount,
    needsDetails: stats.needsDetails,
  });

  await store.upsertAnalysis({
    id: existing?.id ?? randomUUID(),
    sessionId,
    evaluatorVersion: CLAIRE_EVALUATOR_VERSION,
    model: ENV.anthropicModel || "unknown",
    researchFlag,
    result: evaluation as unknown as Record<string, unknown>,
    summaryText,
    copyBundleText,
    acceptedActionCount: stats.acceptedActionCount,
    completedActionCount: stats.completedActionCount,
    outcomeCount: stats.outcomeCount,
    humanReviewStatus: existing?.humanReviewStatus ?? "unreviewed",
    humanFeedbackKind: existing?.humanFeedbackKind ?? null,
    humanFeedbackNote: existing?.humanFeedbackNote ?? null,
    reviewedAt: existing?.reviewedAt ?? null,
    reviewedByUserId: existing?.reviewedByUserId ?? null,
  });
  await store.updateSession(sessionId, { analysisStatus: "complete" });

  const durationLabel = formatDuration(session.startedAt, session.endedAt);
  await store.insertNotification({
    tenantId: session.tenantId,
    operatorUserId: session.operatorUserId,
    sessionId,
    kind: ANALYSIS_NOTIFICATION_KIND,
    title: "Claire Call Analysis Ready",
    body: renderNotificationBody({
      durationLabel,
      evaluation,
      acceptedActionCount: stats.acceptedActionCount,
    }).slice(0, 512),
    ctaLabel: "VIEW ANALYSIS",
    href: `/claire/calls/${sessionId}`,
  });
  await store.updateSession(sessionId, { notificationStatus: "sent" });
  return { ok: true };
}

export async function enrichAnalysisCounts(sessionId: string): Promise<void> {
  const store = productionConversationStore();
  const session = await store.getSession(sessionId);
  const analysis = await store.getAnalysis(sessionId);
  if (!session || !analysis) return;
  const stats = await readLinkedActionStats(session.relatedActionIds);
  await store.upsertAnalysis({
    ...analysis,
    acceptedActionCount: stats.acceptedActionCount,
    completedActionCount: stats.completedActionCount,
    outcomeCount: stats.outcomeCount,
  });
}
