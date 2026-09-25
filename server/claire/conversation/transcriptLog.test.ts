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
  redactClaireTranscriptText,
  transcriptLogBackfillCount,
  transcriptLoggingAllowed,
} from "./transcriptLog";
import { POST_CALL_TRANSCRIPT_SOURCE } from "./types";
import { persistOperatorAndClaire } from "./liveCall";

beforeEach(() => {
  setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
});

afterEach(() => {
  setClaireConversationStoreForTesting(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Claire transcript Railway log mirror", () => {
  it("redacts phone, provider, recording, and auth-shaped content before runtime logging", () => {
    const raw =
      "Call 323-555-1212. CA0123456789abcdef0123456789abcdef " +
      "sk-proj-0123456789abcdefghijklmnop Bearer abcdefghijklmnopqrstuvwxyz " +
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE123";
    const safe = redactClaireTranscriptText(raw);

    expect(safe).toContain("[REDACTED_PHONE]");
    expect(safe).toContain("[REDACTED_PROVIDER_ID]");
    expect(safe).toContain("[REDACTED_SECRET]");
    expect(safe).toContain("[REDACTED_AUTH]");
    expect(safe).toContain("[REDACTED_RECORDING_URL]");
    expect(safe).not.toContain("323-555-1212");
    expect(safe).not.toContain("sk-proj-0123456789abcdefghijklmnop");
    expect(safe).not.toContain("api.twilio.com");
  });

  it("bounds boot backfill count to a safe recent window", () => {
    expect(transcriptLogBackfillCount("2")).toBe(2);
    expect(transcriptLogBackfillCount("0")).toBe(1);
    expect(transcriptLogBackfillCount("99")).toBe(5);
    expect(transcriptLogBackfillCount("nope")).toBe(1);
  });

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
      textLength: "How many sales did I have?".length,
    });
    expect(payloads[2]).toMatchObject({
      speaker: "CLAIRE",
      textLength: "I can verify the paid sales I have coverage for.".length,
    });
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toContain("How many sales did I have?");
    expect(serialized).not.toContain("I can verify the paid sales I have coverage for.");
    expect(serialized).not.toContain("CA-secret-call-sid");
    expect(serialized).not.toContain("providerMetadata");
  });

  it("mirrors the live persistence path immediately, before a Relay call finalizes", async () => {
    vi.stubEnv("CLAIRE_TRANSCRIPT_LOG_SCOPES", "default:adam-admin");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await createConversationSession({
      tenantId: "default",
      operatorUserId: "adam-admin",
      claireConversationId: "conv-relay-live",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-relay-live",
    });

    await persistOperatorAndClaire({
      callSid: "CA-relay-live",
      claireConversationId: "conv-relay-live",
      operatorText: "Are you sure?",
      claireText: "I rechecked it.",
      turnKey: 1,
      operatorMetadata: { provider: "conversation_relay", callSid: "secret" },
      claireMetadata: { provider: "conversation_relay", recordingUrl: "secret" },
    });

    const payloads = info.mock.calls
      .filter(call => call[0] === "[ClaireTranscript]")
      .map(call => JSON.parse(String(call[1])));

    expect(payloads).toHaveLength(2);
    expect(payloads.map(row => [row.speaker, row.textLength])).toEqual([
      ["OPERATOR", "Are you sure?".length],
      ["CLAIRE", "I rechecked it.".length],
    ]);
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toContain("Are you sure?");
    expect(serialized).not.toContain("I rechecked it.");
    expect(serialized).not.toContain("CA-relay-live");
    expect(serialized).not.toContain("recordingUrl");
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

  it("logs post-call transcript metadata without transcript bodies", async () => {
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

    const summaries = info.mock.calls
      .filter(call => call[0] === "[ClaireTranscript]")
      .map(call => JSON.parse(String(call[1])))
      .filter(row => row.event === "claire_post_call_transcript_summary");

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      textLength: text.length,
      source: POST_CALL_TRANSCRIPT_SOURCE,
    });
    expect(JSON.stringify(summaries)).not.toContain(text);
    expect(JSON.stringify(summaries)).not.toContain("RE-secret");
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