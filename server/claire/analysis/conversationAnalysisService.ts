import { randomUUID } from "node:crypto";
import { readDayDirectorActionEvidence } from "../../planning/dayDirector/dayDirectorService";
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

export async function readLinkedActionStats(
  actionIds: string[],
  tenantId?: string
): Promise<{
  acceptedActionCount: number;
  completedActionCount: number;
  outcomeCount: number;
  needsDetails: string[];
  titles: string[];
}> {
  if (!actionIds.length || !tenantId?.trim()) {
    return {
      acceptedActionCount: 0,
      completedActionCount: 0,
      outcomeCount: 0,
      needsDetails: [],
      titles: [],
    };
  }
  const rows = await readDayDirectorActionEvidence({ tenantId, actionIds });
  const needsDetails = rows
    .filter(row => row.detailState === "NEEDS_DETAILS")
    .map(row =>
      row.missingDetails.length
        ? `${row.title}: ${row.missingDetails.join(", ")}`
        : row.title
    );
  const completed = rows.filter(row => row.status === "completed");
  return {
    acceptedActionCount: rows.length,
    completedActionCount: completed.length,
    outcomeCount: completed.length,
    needsDetails,
    titles: rows.map(row => row.title),
  };
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
  const stats = await readLinkedActionStats(session.relatedActionIds, session.tenantId);
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
      malformed
        ? `${error.detail} [attempts=${error.diagnostics.attempts} stop=${error.diagnostics.stopReason ?? "n/a"} truncated=${error.diagnostics.truncated}]`
        : error instanceof Error
          ? error.message.slice(0, 200)
          : "unknown"
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
  const stats = await readLinkedActionStats(session.relatedActionIds, session.tenantId);
  await store.upsertAnalysis({
    ...analysis,
    acceptedActionCount: stats.acceptedActionCount,
    completedActionCount: stats.completedActionCount,
    outcomeCount: stats.outcomeCount,
  });
}
