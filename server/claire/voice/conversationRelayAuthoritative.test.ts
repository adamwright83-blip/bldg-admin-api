import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";

const AUTH = "auth_test";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.JWT_SECRET = "test-secret-long-enough-for-signing";
  process.env.CLAIRE_PROGRESSION = "off";
  return {
    runClaireTurn: vi.fn(),
    applyOperatorArtifactDecision: vi.fn(async () => ({
      applied: true,
      action: "send_operator_artifact" as const,
      result: {
        providerAccepted: true,
        delivered: false,
        resolvedTo: "+13105550100",
        messageSid: "SM_test",
        providerStatus: "accepted",
        receipt: null,
        receiptDuplicate: false,
        evidence: [],
      },
    })),
    persistOperatorAndClaire: vi.fn(async () => undefined),
  };
});

vi.mock("../../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
    ownerOpenId: "adam-admin",
  },
}));

vi.mock("../../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../../db")>()),
  getUserByOpenId: vi.fn(),
}));

vi.mock("../turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("../turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: (...args: Parameters<typeof actual.runClaireTurn>) => hoisted.runClaireTurn(...args),
  };
});

vi.mock("../operatorArtifactDecision", () => ({
  applyOperatorArtifactDecision: (...args: unknown[]) => hoisted.applyOperatorArtifactDecision(...args),
}));

vi.mock("../conversation/liveCall", () => ({
  safeClaireLedger: async (work: () => Promise<unknown>) => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  },
  persistOperatorAndClaire: (...args: unknown[]) => hoisted.persistOperatorAndClaire(...args),
  linkClaireCallAction: vi.fn(async () => undefined),
  linkClaireActionIds: vi.fn(async () => undefined),
  endClaireCallLedger: vi.fn(async () => undefined),
}));

vi.mock("../conversation/ledgerService", () => ({
  createConversationSession: vi.fn(async () => undefined),
  attachCallSid: vi.fn(async () => undefined),
  attachConversationKind: vi.fn(async () => undefined),
  persistSpokenTurn: vi.fn(async () => undefined),
}));

vi.mock("../brain/shadow/observeShadowTurn", () => ({
  observeShadowTurnDetached: vi.fn(),
}));

vi.mock("../progression/progressionFlag", () => ({
  isClaireProgressionEnabled: () => false,
}));

import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { issueClaireToken } from "../claireToken";
import { OPERATOR_ARTIFACT_SENT_SPEAK } from "../operatorArtifactVoice";
import {
  authorizePersistedClaireRelayCall,
  markRelayIntentionalEnd,
  queueRelayOpeningOnce,
  registerClaireRoutes,
  renderConversationRelayConnectAction,
  runRelayAuthoritativeTurn,
} from "../claireTwilio";
import { claireVoiceConversationStateKey } from "./claireVoiceSession";
import { ConversationRelaySocketRuntime } from "./conversationRelayRuntime";
import { CLAIRE_CONVERSATION_RELAY_ACTION_PATH } from "./claireVoiceTransport";

const CONVERSATION_ID = "conv-authoritative";

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    actorId: "adam-admin",
    dayDirectorActorId: "adam-admin",
    brief: null,
    context: {
      phase: "pre_drive",
      generatedAt: "2026-09-22T00:00:00.000Z",
      businessDate: "2026-09-22",
      actorId: "adam-admin",
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
    },
    turns: 0,
    touchedAt: Date.now(),
    inboundContextReady: true,
    hints: "Louise",
    history: [
      { speaker: "claire", text: "Hey Adam. What's up?", at: 1 },
      { speaker: "claire", text: "The Louise is at 1633 N Edgemont Street.", at: 2 },
    ],
    ...overrides,
  };
}

async function save(state = conversation()) {
  await setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
  await (await import("../turn/conversationStateStore")).claireConversationStateStore().save(
    claireVoiceConversationStateKey(CONVERSATION_ID),
    { tenantId: "tenant-1", operatorUserId: "adam-admin", surface: "voice" },
    state,
    60 * 60 * 1000
  );
  return issueClaireToken({
    kind: "pre_drive_conversation",
    tenantId: "tenant-1",
    userId: "adam-admin",
    conversationId: CONVERSATION_ID,
  });
}

describe("Relay authoritative voice turn", () => {
  beforeEach(async () => {
    hoisted.runClaireTurn.mockReset();
    hoisted.applyOperatorArtifactDecision.mockClear();
    hoisted.persistOperatorAndClaire.mockClear();
    await save();
  });

  afterEach(() => {
    setClaireConversationStateStoreForTests(null);
  });

  it("sends Claire, text me that through the shared turn once", async () => {
    const token = await save();
    hoisted.runClaireTurn.mockImplementation(async () => {
      throw new Error("artifact utility must not call the model");
    });
    const sent: unknown[] = [];
    const session = new ConversationRelaySocketRuntime({
      identity: {
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
        conversationId: CONVERSATION_ID,
        conversationStateKey: claireVoiceConversationStateKey(CONVERSATION_ID),
      },
      token,
      send: message => sent.push(message),
      loadOpening: async () => ({ text: "", queued: false }),
      noteCallSid: async () => undefined,
      runTurn: async input => {
        expect(input.allowFragmentWait).toBe(false);
        const result = await runRelayAuthoritativeTurn({
          conversationId: input.conversationId,
          utterance: input.utterance,
          callSid: input.callSid,
          token: input.token,
        });
        return { speak: result.speak, endCall: result.endCall, listenOnly: result.listenOnly };
      },
      markIntentionalEnd: async () => undefined,
    });
    session.accept({ type: "prompt", voicePrompt: "Claire, text me that", last: true });
    await session.idle();
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    expect(hoisted.applyOperatorArtifactDecision).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      { type: "text", token: OPERATOR_ARTIFACT_SENT_SPEAK, last: true, preemptible: false },
    ]);
    const decision = hoisted.applyOperatorArtifactDecision.mock.calls[0]?.[0] as {
      artifact?: { text?: string };
    };
    expect(decision.artifact?.text).toBe("The Louise is at 1633 N Edgemont Street.");
  });

  it("does not run Gather continuation holding for one final prompt", async () => {
    const token = await save();
    hoisted.runClaireTurn.mockResolvedValue({
      speak: "The Louise is quiet.",
      kind: "answered",
      assembledUtterance: "What's up at the Louise?",
      thoughtCompleteness: "forced_flush",
    });
    const result = await runRelayAuthoritativeTurn({
      conversationId: CONVERSATION_ID,
      utterance: "What's up at the Louise?",
      token,
    });
    expect(hoisted.runClaireTurn).toHaveBeenCalledTimes(1);
    expect(hoisted.runClaireTurn.mock.calls[0]?.[0].allowFragmentWait).toBe(false);
    expect(result.listenOnly).toBe(false);
    expect(result.speak).toBe("The Louise is quiet.");
    expect(result.gatherTwiml).not.toContain("listenOnly");
  });

  it("queues the persisted opening once and does not append it again", async () => {
    await save(conversation({ history: [{ speaker: "claire", text: "Hey Adam. What's up?", at: 1 }] }));
    const first = await queueRelayOpeningOnce(CONVERSATION_ID);
    const second = await queueRelayOpeningOnce(CONVERSATION_ID);
    expect(first).toEqual({ text: "Hey Adam. What's up?", queued: true });
    expect(second.queued).toBe(false);
    const stored = await (await import("../turn/conversationStateStore"))
      .claireConversationStateStore()
      .load<{ history: unknown[]; relayOpeningQueued?: boolean }>(
        claireVoiceConversationStateKey(CONVERSATION_ID)
      );
    expect(stored?.state.history).toHaveLength(1);
    expect(stored?.state.relayOpeningQueued).toBe(true);
  });

  it("requires the persisted Goldline identity as well as a Claire token", async () => {
    const token = await save();
    expect((await authorizePersistedClaireRelayCall(token)).ok).toBe(true);
    expect((await authorizePersistedClaireRelayCall("not-a-token")).ok).toBe(false);
    const other = issueClaireToken({
      kind: "pre_drive_conversation",
      tenantId: "someone-else",
      userId: "adam-admin",
      conversationId: CONVERSATION_ID,
    });
    expect((await authorizePersistedClaireRelayCall(other)).ok).toBe(false);
  });

  it("falls back to Gather once and then hangs up without a new conversation", async () => {
    const token = await save();
    const failed = {
      CallSid: "CA_same",
      SessionStatus: "failed",
      ErrorCode: "39001",
      ErrorMessage: "Network connection to WebSocket server failed.",
    };
    const first = await renderConversationRelayConnectAction({ token, body: failed });
    expect(first).toContain("<Gather");
    expect(first).toContain(encodeURIComponent(token));
    expect(first).not.toContain("ConversationRelay");
    expect(first).not.toContain("Hey Adam");
    const second = await renderConversationRelayConnectAction({ token, body: failed });
    expect(second).not.toContain("<Gather");
    expect(second).not.toContain("ConversationRelay");
    expect(second).toContain("<Hangup");
    const stored = await (await import("../turn/conversationStateStore"))
      .claireConversationStateStore()
      .load<{ relayGatherFallbackUsed?: boolean }>(claireVoiceConversationStateKey(CONVERSATION_ID));
    expect(stored?.state.relayGatherFallbackUsed).toBe(true);
  });

  it("does not enter Gather after an intentional end", async () => {
    const token = await save();
    await markRelayIntentionalEnd(CONVERSATION_ID);
    const twiml = await renderConversationRelayConnectAction({
      token,
      body: {
        CallSid: "CA_end",
        SessionStatus: "ended",
        HandoffData: JSON.stringify({ reason: "claire_end_call" }),
      },
    });
    expect(twiml).toContain("<Hangup");
    expect(twiml).not.toContain("<Gather");
    expect(twiml).not.toContain("ConversationRelay");
  });

  it("validates the Connect action with the existing HTTP signature check", async () => {
    const token = await save();
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<unknown>>();
    registerClaireRoutes({
      post: (path: string, handler: (req: unknown, res: unknown) => Promise<unknown>) => {
        handlers.set(path, handler);
      },
      get: () => undefined,
    } as never);
    const originalUrl = `${CLAIRE_CONVERSATION_RELAY_ACTION_PATH}?token=${encodeURIComponent(token)}`;
    const url = `https://api.example.test${originalUrl}`;
    const body = { CallSid: "CA_same", SessionStatus: "completed" };
    const res = {
      body: "",
      statusCode: 200,
      type() {
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      send(payload: string) {
        this.body = payload;
        return this;
      },
    };
    await handlers.get(CLAIRE_CONVERSATION_RELAY_ACTION_PATH)!({
      query: { token },
      body,
      headers: {},
      protocol: "https",
      get: () => "api.example.test",
      originalUrl,
    }, res);
    expect(res.statusCode).toBe(403);

    res.statusCode = 200;
    res.body = "";
    await handlers.get(CLAIRE_CONVERSATION_RELAY_ACTION_PATH)!({
      query: { token },
      body,
      headers: { "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, url, body) },
      protocol: "https",
      get: () => "api.example.test",
      originalUrl,
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Hangup");
    expect(res.body).not.toContain("ConversationRelay");
    expect(res.body).not.toContain(token);
  });
});
