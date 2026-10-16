import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  transcribe: vi.fn(async () => ({ task: "transcribe", language: "en", duration: 0, text: "The girl kicked the ball.", segments: [] })),
}));

vi.mock("../../twilioPlatform/recordingProvider", () => ({
  fetchTwilioRecordingMp3: async () => Buffer.from([0xff, 0xfb, 0x90, 0x00]),
}));
vi.mock("../../storage", () => ({
  storagePut: async (key: string) => ({ key, url: `data:audio/mpeg;base64,AAAA` }),
  storageGet: async (key: string) => ({ key, url: `data:audio/mpeg;base64,AAAA` }),
}));
vi.mock("../../_core/voiceTranscription", () => ({
  transcribeAudio: hoisted.transcribe,
  activeTranscriptionProvider: () => ({ provider: "gemini", providerVersion: "gemini-flash-latest" }),
}));
vi.mock("../analysis/conversationAnalysisService", () => ({ runConversationAnalysis: async () => ({ ok: true }) }));
vi.mock("./transcriptLog", () => ({ emitClaireTranscriptLog: async () => undefined }));

import { createConversationSession, persistSpokenTurn, productionConversationStore } from "./ledgerService";
import { createMemoryClaireConversationStore, setClaireConversationStoreForTesting } from "./memoryStore";
import { handleRecordingStatus } from "./pipeline";
import { POST_CALL_TRANSCRIPT_SOURCE } from "./types";

describe("post-call transcription of a call the operator never spoke in", () => {
  beforeEach(() => {
    hoisted.transcribe.mockClear();
    setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
  });

  it("skips a short silent call instead of storing an invented sentence (2026-10-15 debrief)", async () => {
    const session = await createConversationSession({
      tenantId: "tenant-1", operatorUserId: "adam", claireConversationId: "silent-debrief",
      conversationKind: "evening_debrief", recordingEnabled: true, providerCallSid: "CA-silent",
    });
    await persistSpokenTurn({ callSid: "CA-silent", speaker: "CLAIRE", text: "Hi, it's Claire for today's wrap. How did it go?" });
    await handleRecordingStatus({
      callSid: "CA-silent", recordingSid: "RE-silent", recordingStatus: "completed", recordingDuration: "9",
      accountSid: "AC", authToken: "token",
    });
    expect(hoisted.transcribe).not.toHaveBeenCalled();
    expect((await productionConversationStore().getSession(session.id))?.transcriptionStatus).toBe("skipped");
    expect(await productionConversationStore().getTranscript(session.id, POST_CALL_TRANSCRIPT_SOURCE)).toBeNull();
  });

  it("still transcribes a call where the operator spoke, and labels the provider that actually ran", async () => {
    const session = await createConversationSession({
      tenantId: "tenant-1", operatorUserId: "adam", claireConversationId: "spoken-call",
      conversationKind: "pre_drive", recordingEnabled: true, providerCallSid: "CA-spoken",
    });
    await persistSpokenTurn({ callSid: "CA-spoken", speaker: "OPERATOR", text: "I have 3 dry cleaning orders." });
    await handleRecordingStatus({
      callSid: "CA-spoken", recordingSid: "RE-spoken", recordingStatus: "completed", recordingDuration: "9",
      accountSid: "AC", authToken: "token",
    });
    expect(hoisted.transcribe).toHaveBeenCalledTimes(1);
    const transcript = await productionConversationStore().getTranscript(session.id, POST_CALL_TRANSCRIPT_SOURCE);
    expect(transcript?.provider).toBe("gemini");
    expect(transcript?.providerVersion).toBe("gemini-flash-latest");
  });
});
