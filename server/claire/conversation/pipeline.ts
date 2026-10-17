import { storageGet, storagePut } from "../../storage";
import { activeTranscriptionProvider, transcribeAudio } from "../../_core/voiceTranscription";
import { fetchTwilioRecordingMp3 } from "../../twilioPlatform/recordingProvider";
import { POST_CALL_TRANSCRIPT_SOURCE } from "./types";
import {
  completeConversationSession,
  productionConversationStore,
} from "./ledgerService";
import { runConversationAnalysis } from "../analysis/conversationAnalysisService";
import { emitClaireTranscriptLog } from "./transcriptLog";

async function archiveTwilioRecording(input: {
  accountSid: string;
  authToken: string;
  recordingSid: string;
  sessionId: string;
}): Promise<{ key: string; bytes: number } | null> {
  const bytes = await fetchTwilioRecordingMp3({
    accountSid: input.accountSid,
    authToken: input.authToken,
    recordingSid: input.recordingSid,
  });
  if (!bytes) return null;
  const key = `claire-calls/${input.sessionId}/${input.recordingSid}.mp3`;
  await storagePut(key, bytes, "audio/mpeg");
  return { key, bytes: bytes.length };
}

export async function handleRecordingStatus(input: {
  callSid: string;
  recordingSid: string;
  recordingStatus: string;
  recordingDuration?: string;
  recordingChannels?: string;
  recordingTrack?: string;
  accountSid: string;
  authToken: string;
}): Promise<void> {
  const store = productionConversationStore();
  const session = await store.getSessionByCallSid(input.callSid);
  if (!session) return;

  const status = input.recordingStatus.toLowerCase();
  if (status === "absent") {
    await store.updateSession(session.id, {
      recordingStatus: "failed",
      transcriptionStatus: "skipped",
    });
    if (session.status === "complete") {
      await runConversationAnalysis(session.id);
    }
    return;
  }

  if (status !== "completed") {
    await store.updateSession(session.id, { recordingStatus: "pending" });
    return;
  }

  await store.updateSession(session.id, {
    recordingStatus: "complete",
    recordingSid: input.recordingSid,
    recordingDurationSeconds: input.recordingDuration
      ? Number(input.recordingDuration)
      : null,
    recordingChannels: input.recordingChannels || session.recordingChannels,
    recordingTrack: input.recordingTrack || session.recordingTrack,
    audioCompletedAt: new Date().toISOString(),
  });

  try {
    const archived = await archiveTwilioRecording({
      accountSid: input.accountSid,
      authToken: input.authToken,
      recordingSid: input.recordingSid,
      sessionId: session.id,
    });
    if (archived) {
      await store.updateSession(session.id, {
        audioStorageProvider: "private_storage_objects",
        audioStorageKey: archived.key,
      });
      // A short call in which the operator never said anything has nothing to transcribe but
      // silence, and transcription models invent sentences for silence (2026-10-15: a 9-second
      // dropped debrief came back as "The girl kicked the ball."). Record that, not a transcript.
      const liveTurns = await store.listTurns(session.id).catch(() => []);
      const operatorSpoke = liveTurns.some(turn => String(turn.speaker).toUpperCase() === "OPERATOR");
      const seconds = Number(input.recordingDuration ?? "");
      if (!operatorSpoke && Number.isFinite(seconds) && seconds > 0 && seconds < 20) {
        await store.updateSession(session.id, { transcriptionStatus: "skipped" });
        if (session.status === "complete") await runConversationAnalysis(session.id);
        return;
      }
      const provenance = activeTranscriptionProvider() ?? { provider: "whisper" as const, providerVersion: "whisper-1" };
      const stored = await storageGet(archived.key);
      const transcription = await transcribeAudio({
        audioUrl: stored.url,
        language: "en",
        mimeType: "audio/mpeg",
        fileName: `${input.recordingSid}.mp3`,
      });
      if ("text" in transcription && transcription.text.trim()) {
        await store.insertTranscript({
          sessionId: session.id,
          source: POST_CALL_TRANSCRIPT_SOURCE,
          provider: provenance.provider,
          providerVersion: provenance.providerVersion,
          text: transcription.text,
          payload: { recordingSid: input.recordingSid, liveOperatorTurns: liveTurns.filter(turn => String(turn.speaker).toUpperCase() === "OPERATOR").length },
        });
        await store.updateSession(session.id, { transcriptionStatus: "complete" });
        await emitClaireTranscriptLog(session.id, {
          includeLiveTurns: false,
          includePostCall: true,
          reason: "post_call_transcription",
        });
      } else {
        await store.updateSession(session.id, { transcriptionStatus: "failed" });
      }
    } else {
      await store.updateSession(session.id, { transcriptionStatus: "failed" });
    }
  } catch (error) {
    console.error("[ClaireLedger] recording archive/transcribe failed", error);
    await store.updateSession(session.id, { transcriptionStatus: "failed" });
  }

  const latest = await store.getSession(session.id);
  if (latest?.status === "complete") {
    await runConversationAnalysis(session.id);
  }
}

export async function finishConversationAndMaybeAnalyze(input: {
  claireConversationId?: string;
  callSid?: string;
  reason: string;
}): Promise<void> {
  const store = productionConversationStore();
  const prior = input.callSid
    ? await store.getSessionByCallSid(input.callSid)
    : input.claireConversationId
      ? await store.getSessionByClaireId(input.claireConversationId)
      : null;
  if (prior?.status === "complete") return;
  const session = await completeConversationSession(input);
  if (!session) return;
  await emitClaireTranscriptLog(session.id, {
    includeLiveTurns: true,
    includePostCall: false,
    reason: "call_complete",
  });
  const waitingOnRecording =
    session.recordingStatus === "pending" &&
    session.recordingConsent === "dogfood_explicit";
  if (!waitingOnRecording) {
    await runConversationAnalysis(session.id);
  }
}

export async function handleCallCompleted(input: {
  callSid: string;
  callStatus: string;
}): Promise<void> {
  const status = input.callStatus.toLowerCase();
  const reason =
    status === "completed"
      ? "remote_hangup"
      : status === "failed" || status === "busy" || status === "no-answer"
        ? `twilio_${status}`
        : `twilio_${status}`;
  await finishConversationAndMaybeAnalyze({
    callSid: input.callSid,
    reason,
  });
}
