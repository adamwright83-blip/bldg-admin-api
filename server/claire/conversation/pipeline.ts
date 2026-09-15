import { storageGet, storagePut } from "../../storage";
import { transcribeAudio } from "../../_core/voiceTranscription";
import { POST_CALL_TRANSCRIPT_SOURCE } from "./types";
import {
  completeConversationSession,
  productionConversationStore,
} from "./ledgerService";
import { runConversationAnalysis } from "../analysis/conversationAnalysisService";

async function archiveTwilioRecording(input: {
  accountSid: string;
  authToken: string;
  recordingSid: string;
  sessionId: string;
}): Promise<{ key: string; bytes: number } | null> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Recordings/${input.recordingSid}.mp3`;
  const response = await fetch(url, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64"),
    },
  });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
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
          provider: "whisper",
          providerVersion: "whisper-1",
          text: transcription.text,
          payload: { recordingSid: input.recordingSid },
        });
        await store.updateSession(session.id, { transcriptionStatus: "complete" });
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
  const session = await completeConversationSession(input);
  if (!session) return;
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
