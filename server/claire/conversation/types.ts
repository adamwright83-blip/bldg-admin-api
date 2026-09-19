export const CLAIRE_EVALUATOR_VERSION = "goldline-call-eval-1";
export const LIVE_TURN_SOURCE = {
  OPERATOR: "twilio_speech_result",
  CLAIRE: "goldline_generated_speech",
} as const;
/** CLAIRE source is generated speech queued for TTS, not confirmed-heard audio. See speechDelivery.ts. */
export const POST_CALL_TRANSCRIPT_SOURCE = "post_call_audio";
export const ANALYSIS_NOTIFICATION_KIND = "claire_call_analysis_ready";

export type ConversationSpeaker = "OPERATOR" | "CLAIRE";
export type ConversationKind =
  | "pre_drive"
  | "evening_planning"
  | "morning_reconciliation"
  | "field_debrief";

export type PipelineStatus =
  | "not_started"
  | "pending"
  | "complete"
  | "failed"
  | "skipped"
  | "sent";

export type ConversationSession = {
  id: string;
  tenantId: string;
  operatorUserId: string;
  provider: string;
  providerCallSid: string | null;
  claireConversationId: string;
  conversationKind: ConversationKind | string;
  missionId: number | null;
  relatedActionIds: string[];
  status: string;
  completionReason: string | null;
  recordingStatus: string;
  transcriptionStatus: string;
  analysisStatus: string;
  notificationStatus: string;
  recordingConsent: string;
  recordingSid: string | null;
  recordingDurationSeconds: number | null;
  recordingChannels: string | null;
  recordingTrack: string | null;
  recordingProviderUrl: string | null;
  audioStorageProvider: string | null;
  audioStorageKey: string | null;
  audioCompletedAt: string | null;
  audioRetainUntil: string | null;
  transcriptRetainUntil: string | null;
  analysisRetainUntil: string | null;
  claireCompilerVersion: string | null;
  claireCharacterVersion: string | null;
  llmModel: string | null;
  voiceProvider: string | null;
  voiceName: string | null;
  gitSha: string | null;
  frontendRelease: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type ConversationTurn = {
  id: number;
  sessionId: string;
  ordinal: number;
  speaker: ConversationSpeaker;
  text: string;
  source: string;
  idempotencyKey: string;
  providerMetadata: Record<string, unknown> | null;
  occurredAt: string;
};

export type ConversationTranscript = {
  sessionId: string;
  source: string;
  provider: string;
  providerVersion: string | null;
  text: string;
  payload: Record<string, unknown> | null;
};

export type ConversationAnalysisRow = {
  id: string;
  sessionId: string;
  evaluatorVersion: string;
  model: string;
  researchFlag: string;
  result: Record<string, unknown>;
  summaryText: string;
  copyBundleText: string;
  acceptedActionCount: number;
  completedActionCount: number;
  outcomeCount: number;
  humanReviewStatus: string;
  humanFeedbackKind: string | null;
  humanFeedbackNote: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
};

export type ConversationNotification = {
  id: string;
  tenantId: string;
  operatorUserId: string;
  sessionId: string;
  kind: string;
  title: string;
  body: string;
  ctaLabel: string;
  href: string;
  readAt: string | null;
  createdAt: string;
};
