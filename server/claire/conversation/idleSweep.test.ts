/**
 * D17 — 18 sessions of kinds pre_drive, evening_planning and morning_reconciliation sat
 * `in_progress` with no `endedAt` from 2026-10-01 to 2026-10-20 (production ledger). Only
 * scheduled calls, which receive Twilio's `completed` status callback, were ever completed.
 */
import { describe, expect, it } from "vitest";
import { createMemoryClaireConversationStore } from "./memoryStore";
import { CLAIRE_SESSION_IDLE_MS, IDLE_TIMEOUT_REASON, sweepIdleConversationSessions } from "./ledgerService";
import type { ConversationSession } from "./types";

function session(over: Partial<ConversationSession>): ConversationSession {
  return {
    id: "s",
    tenantId: "laundry_farm",
    operatorUserId: "adam-admin",
    provider: "twilio",
    providerCallSid: null,
    claireConversationId: "c",
    conversationKind: "pre_drive",
    missionId: null,
    relatedActionIds: [],
    status: "in_progress",
    completionReason: null,
    recordingStatus: "skipped",
    transcriptionStatus: "skipped",
    analysisStatus: "pending",
    notificationStatus: "pending",
    recordingConsent: "none",
    recordingSid: null,
    recordingDurationSeconds: null,
    recordingChannels: null,
    recordingTrack: null,
    recordingProviderUrl: null,
    audioStorageProvider: null,
    audioStorageKey: null,
    audioCompletedAt: null,
    audioRetainUntil: null,
    transcriptRetainUntil: null,
    analysisRetainUntil: null,
    claireCompilerVersion: "t",
    claireCharacterVersion: "t",
    llmModel: null,
    voiceProvider: "twilio_polly",
    voiceName: "x",
    gitSha: "t",
    frontendRelease: null,
    startedAt: "2026-10-01T00:28:00.000Z",
    endedAt: null,
    ...over,
  } as ConversationSession;
}

describe("idle sweep closes sessions nobody ended", () => {
  it("completes stale in-progress sessions of every kind at their last activity, and leaves live ones alone", async () => {
    const store = createMemoryClaireConversationStore();
    await store.insertSession(session({ id: "stale-pre-drive", claireConversationId: "a", conversationKind: "pre_drive", startedAt: "2026-10-01T00:28:00.000Z" }));
    await store.insertSession(session({ id: "stale-evening", claireConversationId: "b", conversationKind: "evening_planning", startedAt: "2026-10-19T01:00:00.000Z" }));
    await store.insertSession(session({ id: "stale-morning", claireConversationId: "c", conversationKind: "morning_reconciliation", startedAt: "2026-10-13T15:51:00.000Z" }));
    await store.insertSession(session({ id: "live", claireConversationId: "d", conversationKind: "pre_drive", startedAt: "2026-10-20T14:00:00.000Z" }));
    await store.insertSession(session({ id: "done", claireConversationId: "e", status: "complete", completionReason: "remote_hangup", endedAt: "2026-10-18T00:35:00.000Z" }));

    // The evening call ran 13 turns and then went quiet at 01:09. Its endedAt must be that moment.
    for (let ordinal = 1; ordinal <= 13; ordinal++) {
      await store.appendTurn({
        sessionId: "stale-evening",
        ordinal,
        speaker: ordinal % 2 ? "CLAIRE" : "OPERATOR",
        text: `turn ${ordinal}`,
        source: "live",
        idempotencyKey: `k${ordinal}`,
        providerMetadata: null,
        occurredAt: new Date(Date.parse("2026-10-19T01:00:00.000Z") + ordinal * 40_000).toISOString(),
      });
    }
    await store.appendTurn({ sessionId: "live", ordinal: 1, speaker: "CLAIRE", text: "hi", source: "live", idempotencyKey: "live1", providerMetadata: null, occurredAt: "2026-10-20T14:20:00.000Z" });

    const nowMs = Date.parse("2026-10-20T14:35:00.000Z");
    const { closed } = await sweepIdleConversationSessions({ store, nowMs });

    expect(closed.sort()).toEqual(["stale-evening", "stale-morning", "stale-pre-drive"]);
    const evening = await store.getSession("stale-evening");
    expect(evening).toMatchObject({ status: "complete", completionReason: IDLE_TIMEOUT_REASON });
    expect(evening?.endedAt).toBe(new Date(Date.parse("2026-10-19T01:00:00.000Z") + 13 * 40_000).toISOString());
    // A session with no turns ends at its start, never "now".
    expect((await store.getSession("stale-pre-drive"))?.endedAt).toBe("2026-10-01T00:28:00.000Z");

    // 15 minutes of silence is not 30.
    expect((await store.getSession("live"))?.status).toBe("in_progress");
    // Already-complete sessions keep their own reason.
    expect(await store.getSession("done")).toMatchObject({ completionReason: "remote_hangup", endedAt: "2026-10-18T00:35:00.000Z" });

    // Idempotent.
    expect((await sweepIdleConversationSessions({ store, nowMs })).closed).toEqual([]);
  });

  it("the idle window is thirty minutes", () => {
    expect(CLAIRE_SESSION_IDLE_MS).toBe(30 * 60 * 1000);
  });
});
