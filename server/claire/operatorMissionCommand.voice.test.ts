import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.JWT_SECRET = "test-secret-long-enough-for-signing";
  process.env.CLAIRE_PROGRESSION = "off";
  delete process.env.CLAIRE_BRAIN_V2_SHADOW;
  return {
    runClaireTurn: vi.fn(),
    executeOperatorMissionCommand: vi.fn(),
    linkClaireActionIds: vi.fn(async () => undefined),
  };
});

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
    ownerOpenId: "adam-admin",
  },
}));

vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getUserByOpenId: vi.fn(),
}));

vi.mock("./turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("./turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: (...args: Parameters<typeof actual.runClaireTurn>) => hoisted.runClaireTurn(...args),
  };
});

vi.mock("./operatorArtifactDecision", () => ({
  applyOperatorArtifactDecision: vi.fn(),
}));

vi.mock("./conversation/liveCall", () => ({
  safeClaireLedger: async (work: () => Promise<unknown>) => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  },
  persistOperatorAndClaire: vi.fn(async () => undefined),
  linkClaireCallAction: vi.fn(async () => undefined),
  linkClaireActionIds: (...args: unknown[]) => hoisted.linkClaireActionIds(...args),
  endClaireCallLedger: vi.fn(async () => undefined),
}));

vi.mock("./conversation/ledgerService", () => ({
  createConversationSession: vi.fn(async () => undefined),
  attachCallSid: vi.fn(async () => undefined),
  attachConversationKind: vi.fn(async () => undefined),
  persistSpokenTurn: vi.fn(async () => undefined),
}));

vi.mock("./progression/progressionFlag", () => ({
  isClaireProgressionEnabled: () => false,
}));

vi.mock("./operatorMissionCommand", async () => {
  const actual = await vi.importActual<typeof import("./operatorMissionCommand")>("./operatorMissionCommand");
  return {
    ...actual,
    executeOperatorMissionCommand: (...args: unknown[]) => hoisted.executeOperatorMissionCommand(...args),
  };
});

import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "./turn/conversationStateStore";
import { issueClaireToken } from "./claireToken";
import { runAuthoritativeClaireVoiceTurn, runRelayAuthoritativeTurn } from "./claireTwilio";
import {
  OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK,
  OPERATOR_MISSION_CLARIFY_AMBIGUOUS_SPEAK,
  OPERATOR_MISSION_CREATED_SPEAK,
  OPERATOR_MISSION_FAILED_SPEAK,
} from "./operatorMissionCommand";

const CONVERSATION_ID = "conv-mission";

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    actorId: "adam-open-id",
    dayDirectorActorId: "day-director-42",
    brief: null,
    context: {
      phase: "pre_drive",
      generatedAt: "2026-09-22T16:00:00.000Z",
      businessDate: "2026-09-22",
      actorId: "adam-open-id",
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
      clock: { timeZone: "America/Los_Angeles", businessDate: "2026-09-22", tomorrowBusinessDate: "2026-09-23" },
    },
    turns: 0,
    touchedAt: Date.now(),
    inboundContextReady: true,
    hints: "Louise",
    history: [],
    pendingFragment: null,
    fragmentHolds: 0,
    providerFragments: [],
    ...overrides,
  };
}

async function save(state = conversation()) {
  await setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
  await (await import("./turn/conversationStateStore")).claireConversationStateStore().save(
    `claire-call:${CONVERSATION_ID}`,
    { tenantId: "tenant-1", operatorUserId: "adam-open-id", surface: "voice" },
    state,
    60 * 60 * 1000
  );
  return issueClaireToken({
    kind: "pre_drive_conversation",
    tenantId: "tenant-1",
    userId: "adam-open-id",
    conversationId: CONVERSATION_ID,
  });
}

describe("operator mission voice seam", () => {
  beforeEach(async () => {
    hoisted.runClaireTurn.mockReset();
    hoisted.executeOperatorMissionCommand.mockReset();
    hoisted.linkClaireActionIds.mockClear();
    hoisted.executeOperatorMissionCommand.mockResolvedValue({
      ok: true,
      outcome: "created",
      speak: OPERATOR_MISSION_CREATED_SPEAK,
      dayDirectorCommitmentId: "commitment-1",
      opsTaskId: null,
      actionIds: ["commitment-1"],
      receipts: [{ claimedState: "created", entityId: "commitment-1", statement: "Today's mission is set." }],
      businessDate: "2026-09-22",
      title: "Create and publish one static-image Instagram ad",
      kind: "growth",
      role: "primary",
      status: "open",
      completionCondition: "One static-image Instagram ad is published.",
      verification: "operator_reported",
      operatorMissionKey: "om:test",
      sourceCommandRef: "voice:conv-mission:turn:1",
      weeklyIntentUnchanged: true,
      weeklyIntentOverrideCode: null,
      playableTitle: "Create and publish one static-image Instagram ad",
    });
    await save();
  });

  afterEach(() => {
    setClaireConversationStateStoreForTests(null);
  });

  it("Gather executes the same command service and does not enter V1", async () => {
    const token = await save();
    hoisted.runClaireTurn.mockRejectedValue(new Error("V1 must not swallow an explicit mission command"));
    const result = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: conversation() as never,
      utterance: "Claire, create today's mission: create and publish one static-image Instagram ad.",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    expect(hoisted.executeOperatorMissionCommand).toHaveBeenCalledTimes(1);
    const request = hoisted.executeOperatorMissionCommand.mock.calls[0]?.[0] as {
      dayDirectorActorId: string;
      operatorUserId: string;
      businessDate: string;
    };
    expect(request.dayDirectorActorId).toBe("day-director-42");
    expect(request.operatorUserId).toBe("adam-open-id");
    expect(request.businessDate).toBe("2026-09-22");
    expect(result.speak).toBe(OPERATOR_MISSION_CREATED_SPEAK);
    expect(hoisted.linkClaireActionIds).toHaveBeenCalledWith(
      expect.objectContaining({ actionIds: ["commitment-1"] })
    );
  });

  it("Conversation Relay executes the same command service", async () => {
    const token = await save();
    hoisted.runClaireTurn.mockRejectedValue(new Error("V1 must not swallow an explicit mission command"));
    const result = await runRelayAuthoritativeTurn({
      conversationId: CONVERSATION_ID,
      utterance: "Make publishing the Instagram ad my mission today.",
      token,
    });
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    expect(hoisted.executeOperatorMissionCommand).toHaveBeenCalledTimes(1);
    expect(result.speak).toBe(OPERATOR_MISSION_CREATED_SPEAK);
  });

  it("holds a weak fragment and writes only the assembled command", async () => {
    const token = await save();
    const state = conversation();
    const held = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: state as never,
      utterance: "I want this Meta ad",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(held.listenOnly).toBe(true);
    expect(hoisted.executeOperatorMissionCommand).not.toHaveBeenCalled();
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    const written = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: state as never,
      utterance: "considered as my mission today.",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(hoisted.executeOperatorMissionCommand).toHaveBeenCalledTimes(1);
    const request = hoisted.executeOperatorMissionCommand.mock.calls[0]?.[0] as { utterance: string };
    expect(request.utterance).toBe("I want this Meta ad considered as my mission today.");
    expect(written.speak).toBe(OPERATOR_MISSION_CREATED_SPEAK);
  });

  it("resolves a held work item without repeating the title", async () => {
    const token = await save();
    const state = conversation();
    const held = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: state as never,
      utterance: "I want this Meta ad",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(held.listenOnly).toBe(true);
    expect(hoisted.executeOperatorMissionCommand).not.toHaveBeenCalled();
    const written = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: state as never,
      utterance: "make that today's mission",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    expect(hoisted.executeOperatorMissionCommand).toHaveBeenCalledTimes(1);
    const request = hoisted.executeOperatorMissionCommand.mock.calls[0]?.[0] as {
      utterance: string;
      resolvedMissionClause?: string;
    };
    expect(request.utterance).toBe("I want this Meta ad make that today's mission");
    expect(request.resolvedMissionClause).toBe("I want this Meta ad");
    expect(written.speak).toBe(OPERATOR_MISSION_CREATED_SPEAK);
  });

  it("asks when the referent is missing or ambiguous and does not write", async () => {
    const token = await save();
    const absent = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: conversation() as never,
      utterance: "make that today's mission",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(absent.speak).toBe(OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK);
    expect(hoisted.executeOperatorMissionCommand).not.toHaveBeenCalled();
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    const ambiguous = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: conversation({
        history: [{ speaker: "operator", text: "the postcard and the Instagram ad", at: 1 }],
      }) as never,
      utterance: "turn that into a mission",
      rawTranscript: null,
      allowFragmentWait: false,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(ambiguous.speak).toBe(OPERATOR_MISSION_CLARIFY_AMBIGUOUS_SPEAK);
    expect(hoisted.executeOperatorMissionCommand).not.toHaveBeenCalled();
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
  });

  it("Relay resolves the previous work item through the same command service", async () => {
    const token = await save(
      conversation({
        history: [
          { speaker: "operator", text: "create and publish one static-image Instagram ad", at: 1 },
        ],
      })
    );
    hoisted.runClaireTurn.mockRejectedValue(new Error("V1 must not swallow a resolved referential mission command"));
    const result = await runRelayAuthoritativeTurn({
      conversationId: CONVERSATION_ID,
      utterance: "make this a mission",
      token,
    });
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    expect(hoisted.executeOperatorMissionCommand).toHaveBeenCalledTimes(1);
    const request = hoisted.executeOperatorMissionCommand.mock.calls[0]?.[0] as {
      resolvedMissionClause?: string;
      utterance: string;
    };
    expect(request.utterance).toBe("make this a mission");
    expect(request.resolvedMissionClause).toBe("create and publish one static-image Instagram ad");
    expect(result.speak).toBe(OPERATOR_MISSION_CREATED_SPEAK);
  });

  it("leaves ordinary conversation on the V1 path", async () => {
    const token = await save();
    hoisted.runClaireTurn.mockResolvedValue({
      speak: "Okay.",
      kind: "answered",
      assembledUtterance: "I'm working on the ad today.",
      thoughtCompleteness: "complete",
    });
    const result = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: conversation() as never,
      utterance: "I'm working on the ad today.",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(hoisted.executeOperatorMissionCommand).not.toHaveBeenCalled();
    expect(hoisted.runClaireTurn).toHaveBeenCalledTimes(1);
    expect(result.speak).toBe("Okay.");
  });

  it("speaks the failure line when the command service refuses", async () => {
    const token = await save();
    hoisted.executeOperatorMissionCommand.mockResolvedValue({
      ok: false,
      speak: OPERATOR_MISSION_FAILED_SPEAK,
      actionIds: [],
      receipts: [],
    });
    const result = await runAuthoritativeClaireVoiceTurn({
      conversationId: CONVERSATION_ID,
      conversation: conversation() as never,
      utterance: "Set calling 10 property managers as today's mission.",
      rawTranscript: null,
      allowFragmentWait: true,
      token,
      webhookReceivedAtMs: Date.now(),
    });
    expect(result.speak).toBe(OPERATOR_MISSION_FAILED_SPEAK);
    expect(hoisted.linkClaireActionIds).not.toHaveBeenCalled();
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
  });
});
