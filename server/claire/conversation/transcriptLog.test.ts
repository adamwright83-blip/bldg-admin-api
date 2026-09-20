import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConversationSession,
  persistSpokenTurn,
  productionConversationStore,
} from "./ledgerService";
import {
  createMemoryClaireConversationStore,
  setClaireConversationStoreForTesting,
} from "./memoryStore";
import {
  emitClaireTranscriptLog,
  parseTranscriptLogScopes,
  transcriptLoggingAllowed,
} from "./transcriptLog";
import { POST_CALL_TRANSCRIPT_SOURCE } from "./types";

beforeEach(() => {
  setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
});

afterEach(() => {
  setClaireConversationStoreForTesting(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Claire transcript Railway log mirror", () => {
  it("parses explicit tenant/operator scopes and rejects malformed entries", () => {
    expect(
      parseTranscriptLogScopes("default:adam-admin, tenant-2:operator-2, bad")
    ).toEqual([
      { tenantId: "default", operatorUserId: "adam-admin" },
      { tenantId: "tenant-2", operatorUserId: "operator-2" },
    ]);
    expect(
      transcriptLoggingAllowed(
        { tenantId: "default", operatorUserId: "adam-admin" },
        "default:adam-admin"
      )
    ).toBe(true);
    expect(
      transcriptLoggingAllowed(
        { tenantId: "default", operatorUserId: "driver-primary" },
        "default:adam-admin"
      )
    ).toBe(false);
  });

  it("logs only the configured operator's speaker-attributed turns and omits provider secrets", async () => {
    vi.stubEnv("CLAIRE_TRANSCRIPT_LOG_SCOPES", "default:adam-admin");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const session = await createConversationSession({
      tenantId: "default",
      operatorUserId: "adam-admin",
      claireConversationId: "conv-log-1",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-secret-call-sid",
    });
    await persistSpokenTurn({
      callSid: "CA-secret-call-sid",
      speaker: "OPERATOR",
      text: "How many sales did I have?",
      turnKey: 1,
    });
    await persistSpokenTurn({
      callSid: "CA-secret-call-sid",
      speaker: "CLAIRE",
      text: "I can verify the paid sales I have coverage for.",
      turnKey: 1,
    });

    await emitClaireTranscriptLog(session.id, {
      includeLiveTurns: true,
      includePostCall: false,
      reason: "test",
    });

    const payloads = info.mock.calls
      .filter(call => call[0] === "[ClaireTranscript]")
      .map(call => JSON.parse(String(call[1])));

    expect(payloads.map(row => row.event)).toEqual([
      "claire_transcript_session",
      "claire_transcript_turn",
      "claire_transcript_turn",
    ]);
    expect(payloads[1]).toMatchObject({
      claireConversationId: "conv-log-1",
      speaker: "OPERATOR",
      text: "How many sales did I have?",
    });
    expect(payloads[2]).toMatchObject({
      speaker: "CLAIRE",
      text: "I can verify the paid sales I have coverage for.",
    });
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toContain("CA-secret-call-sid");
    expect(serialized).not.toContain("providerMetadata");
  });

  it("does not log a different operator in the same tenant", async () => {
    vi.stubEnv("CLAIRE_TRANSCRIPT_LOG_SCOPES", "default:adam-admin");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const session = await createConversationSession({
      tenantId: "default",
      operatorUserId: "driver-primary",
      claireConversationId: "conv-driver",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-driver",
    });
    await persistSpokenTurn({
      callSid: "CA-driver",
      speaker: "OPERATOR",
      text: "Private driver call",
    });

    await emitClaireTranscriptLog(session.id);

    expect(
      info.mock.calls.filter(call => call[0] === "[ClaireTranscript]")
    ).toHaveLength(0);
  });

  it("chunks the post-call Whisper transcript so Railway log lines stay bounded", async () => {
    vi.stubEnv("CLAIRE_TRANSCRIPT_LOG_SCOPES", "default:adam-admin");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const session = await createConversationSession({
      tenantId: "default",
      operatorUserId: "adam-admin",
      claireConversationId: "conv-post-call",
      conversationKind: "pre_drive",
      recordingEnabled: true,
      providerCallSid: "CA-post-call",
    });
    const text = "x".repeat(8000);
    await productionConversationStore().insertTranscript({
      sessionId: session.id,
      source: POST_CALL_TRANSCRIPT_SOURCE,
      provider: "whisper",
      providerVersion: "whisper-1",
      text,
      payload: { recordingSid: "RE-secret" },
    });

    await emitClaireTranscriptLog(session.id, {
      includeLiveTurns: false,
      includePostCall: true,
      reason: "test_post_call",
    });

    const chunks = info.mock.calls
      .filter(call => call[0] === "[ClaireTranscript]")
      .map(call => JSON.parse(String(call[1])))
      .filter(row => row.event === "claire_post_call_transcript_chunk");

    expect(chunks).toHaveLength(3);
    expect(chunks.map(row => row.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks.every(row => row.chunkCount === 3)).toBe(true);
    expect(chunks.map(row => row.text).join("")).toBe(text);
    expect(JSON.stringify(chunks)).not.toContain("RE-secret");
  });

  it("is disabled when no transcript log scopes are configured", async () => {
    vi.stubEnv("CLAIRE_TRANSCRIPT_LOG_SCOPES", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const session = await createConversationSession({
      tenantId: "default",
      operatorUserId: "adam-admin",
      claireConversationId: "conv-disabled",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-disabled",
    });

    await emitClaireTranscriptLog(session.id);

    expect(
      info.mock.calls.filter(call => call[0] === "[ClaireTranscript]")
    ).toHaveLength(0);
  });
});
