import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "./turn/conversationStateStore";
import { verifyClaireToken } from "./claireToken";
import { conservativeClaireFollowUp } from "./preDriveConversation";

const AUTH_TOKEN = "auth_test";
const INBOUND_URL = "https://api.example.test/api/claire/twilio/inbound";
const OWNER_PHONE = "+13105550001";
const OWNER_OPEN_ID = "adam-admin";

const OWNER_USER_ID = 42;

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.JWT_SECRET = "test-secret-long-enough-for-signing";
  return {
    generateBrief: vi.fn(async () => {
      throw new Error("inbound must not generate a pre-drive briefing");
    }),
    assembleContext: vi.fn(async (input: { actorId: string; dayDirectorActorId?: string }) => ({
      phase: "pre_drive",
      generatedAt: "2026-09-21T16:00:00.000Z",
      businessDate: "2026-09-21",
      actorId: input.actorId,
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
      workday: { session: "pre_drive" },
    })),
    createSession: vi.fn(async () => undefined),
    attachCallSid: vi.fn(async () => undefined),
    attachConversationKind: vi.fn(async () => undefined),
    persistSpokenTurn: vi.fn(async () => undefined),
    getUserByOpenId: vi.fn(async (openId: string) =>
      openId === "adam-admin"
        ? ({ id: 42, openId, tenantId: "tenant-1", role: "admin" } as never)
        : undefined
    ),
    runClaireTurn: vi.fn(),
    observeShadow: vi.fn(() => undefined),
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
  getUserByOpenId: (openId: string) => hoisted.getUserByOpenId(openId),
}));

vi.mock("twilio", async importOriginal => {
  const actual = (await importOriginal()) as { default?: Record<string, unknown> } & Record<string, unknown>;
  const real = (actual.default ?? actual) as Record<string, unknown>;
  const factory = Object.assign(() => ({ calls: { create: vi.fn() } }), real, { twiml: real.twiml });
  return { ...actual, default: factory };
});

vi.mock("./preDriveRuntime", () => ({
  assembleClaireVoiceCallContext: (input: { actorId: string }) => hoisted.assembleContext(input),
  generateClairePreDriveOutput: (...args: unknown[]) => hoisted.generateBrief(...args),
}));

vi.mock("./conversation/ledgerService", () => ({
  createConversationSession: (...args: unknown[]) => hoisted.createSession(...args),
  attachCallSid: (...args: unknown[]) => hoisted.attachCallSid(...args),
  attachConversationKind: (...args: unknown[]) => hoisted.attachConversationKind(...args),
  persistSpokenTurn: (...args: unknown[]) => hoisted.persistSpokenTurn(...args),
}));

vi.mock("./turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("./turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: (...args: Parameters<typeof actual.runClaireTurn>) => hoisted.runClaireTurn(...args),
  };
});

vi.mock("./brain/shadow/observeShadowTurn", () => ({
  observeShadowTurnDetached: (...args: unknown[]) => hoisted.observeShadow(...args),
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
  linkClaireActionIds: vi.fn(async () => undefined),
  endClaireCallLedger: vi.fn(async () => undefined),
}));

vi.mock("./conversation/pipeline", () => ({
  handleCallCompleted: vi.fn(async () => undefined),
  handleRecordingStatus: vi.fn(async () => undefined),
}));

import {
  CLAIRE_INBOUND_GREETING,
  CLAIRE_INBOUND_VOICE_PATH,
  registerClaireRoutes,
  resetInboundContextPrefetchForTests,
} from "./claireTwilio";
import { claireConversationStateStore } from "./turn/conversationStateStore";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

function routes(): Map<string, Handler> {
  const map = new Map<string, Handler>();
  registerClaireRoutes({
    post: (path: string, handler: Handler) => map.set(path, handler),
    get: () => undefined,
  } as never);
  return map;
}

function sign(url: string, body: Record<string, string>): string {
  return twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, body);
}

async function post(
  handlers: Map<string, Handler>,
  path: string,
  input: {
    body: Record<string, string>;
    signature?: string | null;
    originalUrl?: string;
  }
) {
  const originalUrl = input.originalUrl ?? path;
  const url = `https://api.example.test${originalUrl}`;
  const signature =
    input.signature === null ? undefined : (input.signature ?? sign(url, input.body));
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
    send(body: string) {
      this.body = body;
      return this;
    },
  };
  await handlers.get(path)!({
    query: Object.fromEntries(new URL(url).searchParams),
    body: input.body,
    headers: signature ? { "x-twilio-signature": signature } : {},
    protocol: "https",
    get: () => "api.example.test",
    originalUrl,
  }, res);
  return res;
}

function tokenFromTwiml(xml: string): string {
  const match = xml.match(/\/api\/claire\/twilio\/pre-drive\?token=([^"&<]+)/);
  expect(match?.[1]).toBeTruthy();
  return decodeURIComponent(match![1]!.replace(/&amp;/g, "&"));
}

function persistedOperator(openId = OWNER_OPEN_ID) {
  return { id: OWNER_USER_ID, openId, tenantId: "tenant-1", role: "admin" } as never;
}

function stubContext(
  input: { actorId: string; dayDirectorActorId?: string },
  extras: Record<string, unknown> = {}
) {
  return {
    phase: "pre_drive",
    generatedAt: "2026-09-21T16:00:00.000Z",
    businessDate: "2026-09-21",
    actorId: input.actorId,
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment: null,
    blockers: [],
    relevantTimeline: [],
    mission: null,
    workday: { session: "pre_drive" },
    ...extras,
  };
}

function enrichedMorningContext(input: { actorId: string; dayDirectorActorId?: string }) {
  const item = {
    id: "line-1",
    kind: "commitment",
    title: "Call Dana",
    subtitle: "THE LINE",
    urgency: "today",
    scheduledAt: null,
    destination: null,
    sourceReference: "day_director",
    whySurfaced: null,
    actions: [],
  };
  return stubContext(input, {
    nextFixedCommitment: item,
    relevantTimeline: [item],
    macroGoalKnown: true,
    workday: {
      session: "morning_reconciliation",
      eveningSpeak: "",
      morningSpeak: "reconcile yesterday",
      tomorrowCount: 2,
      deltaCount: 0,
      hasConfirmedPlan: true,
    },
  });
}

function installTurnStub() {
  hoisted.runClaireTurn.mockImplementation(async (input: {
    operatorUserId: string;
    dayDirectorActorId: string;
    utterance: string;
    context: { workday?: { session?: string }; relevantTimeline?: unknown[] };
    brief: string | null;
    state: {
      history?: Array<{ speaker: string; text: string; at: number }>;
      pendingProposal?: unknown;
    };
  }) => {
    const now = Date.now();
    input.state.history = [
      ...(input.state.history ?? []),
      { speaker: "operator", text: input.utterance, at: now },
      { speaker: "claire", text: "Got it.", at: now },
    ];
    input.state.pendingProposal = { id: "first-turn-pending", source: "test" };
    return {
      speak: "Got it.",
      assembledUtterance: input.utterance,
      endCall: false,
    };
  });
}

let settleHungAssembly: ((value: unknown) => void) | undefined;

beforeEach(() => {
  setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
  resetInboundContextPrefetchForTests();
  hoisted.generateBrief.mockClear();
  hoisted.assembleContext.mockReset();
  hoisted.assembleContext.mockImplementation(async (input: { actorId: string; dayDirectorActorId?: string }) =>
    stubContext(input)
  );
  hoisted.createSession.mockClear();
  hoisted.attachCallSid.mockClear();
  hoisted.attachConversationKind.mockClear();
  hoisted.persistSpokenTurn.mockClear();
  hoisted.getUserByOpenId.mockClear();
  hoisted.getUserByOpenId.mockImplementation(async (openId: string) =>
    openId === OWNER_OPEN_ID ? persistedOperator(openId) : undefined
  );
  hoisted.runClaireTurn.mockReset();
  hoisted.observeShadow.mockClear();
  installTurnStub();
});

afterEach(() => {
  settleHungAssembly?.(stubContext({ actorId: OWNER_OPEN_ID, dayDirectorActorId: String(OWNER_USER_ID) }));
  settleHungAssembly = undefined;
  resetInboundContextPrefetchForTests();
  setClaireConversationStateStoreForTests(null);
  delete process.env.CLAIRE_OPERATOR_PHONES;
});

describe("inbound Claire voice uses the existing conversation stack", () => {
  it("resolves the owner's phone, persists call state, attaches CallSid, and greets into the live loop", async () => {
    const handlers = routes();
    const res = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_inbound", From: OWNER_PHONE, To: "+13105550000", Direction: "inbound" },
    });

    expect(res.statusCode).toBe(200);
    expect(hoisted.generateBrief).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(hoisted.assembleContext).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          actorId: OWNER_OPEN_ID,
          dayDirectorActorId: String(OWNER_USER_ID),
        })
      )
    );
    expect(hoisted.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        operatorUserId: OWNER_OPEN_ID,
        conversationKind: "pre_drive",
      })
    );
    expect(hoisted.attachCallSid).toHaveBeenCalledWith({
      claireConversationId: expect.any(String),
      callSid: "CA_inbound",
    });
    expect(hoisted.persistSpokenTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: "CA_inbound",
        speaker: "CLAIRE",
        text: CLAIRE_INBOUND_GREETING,
        turnKey: 0,
      })
    );

    expect(res.body).toContain(CLAIRE_INBOUND_GREETING);
    expect(res.body).toContain("<Gather");
    expect(res.body).toContain("/api/claire/twilio/pre-drive?token=");
    expect(res.body).toContain('input="speech"');
    expect(res.body).not.toContain("Adam. Claire here.");
    expect(res.body).not.toMatch(/Two stops today|Your next stop/i);

    const token = tokenFromTwiml(res.body);
    const claims = verifyClaireToken(token);
    expect(claims).toMatchObject({
      kind: "pre_drive_conversation",
      tenantId: "tenant-1",
      userId: OWNER_OPEN_ID,
    });
    if (claims.kind !== "pre_drive_conversation") throw new Error("expected conversation token");

    const stored = await claireConversationStateStore().load<{
      tenantId: string;
      actorId: string;
      dayDirectorActorId: string;
      brief: string | null;
      history: Array<{ speaker: string; text: string }>;
    }>(`claire-call:${claims.conversationId}`);
    expect(stored?.state).toMatchObject({
      tenantId: "tenant-1",
      actorId: OWNER_OPEN_ID,
      dayDirectorActorId: String(OWNER_USER_ID),
      brief: null,
    });
    expect(stored?.state.brief).toBeNull();
    expect(JSON.stringify(stored?.state)).not.toContain("No opening briefing was spoken");
    expect(stored?.state.history[0]).toMatchObject({
      speaker: "claire",
      text: CLAIRE_INBOUND_GREETING,
    });
  });

  it("follow-up speech gathers into the existing pre-drive conversation endpoint", async () => {
    const handlers = routes();
    const started = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_inbound", From: OWNER_PHONE, To: "+13105550000" },
    });
    const token = tokenFromTwiml(started.body);
    const continueUrl = `/api/claire/twilio/pre-drive?token=${encodeURIComponent(token)}`;
    const follow = await post(handlers, "/api/claire/twilio/pre-drive", {
      originalUrl: continueUrl,
      body: { CallSid: "CA_inbound", SpeechResult: "" },
    });
    expect(follow.statusCode).toBe(200);
    expect(follow.body).toContain("<Gather");
    expect(follow.body).toContain("/api/claire/twilio/pre-drive?token=");
    expect(follow.body).toContain("Go ahead, I'm listening.");
  });

  it("returns pickup TwiML without waiting for slow context assembly", async () => {
    hoisted.assembleContext.mockImplementation(
      () =>
        new Promise(resolve => {
          settleHungAssembly = resolve;
        })
    );
    const handlers = routes();
    const startedAt = Date.now();
    const res = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_slow", From: OWNER_PHONE, To: "+13105550000" },
    });
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(CLAIRE_INBOUND_GREETING);
    expect(res.body).toContain("<Gather");
    const token = tokenFromTwiml(res.body);
    const claims = verifyClaireToken(token);
    if (claims.kind !== "pre_drive_conversation") throw new Error("expected conversation token");
    const stored = await claireConversationStateStore().load<{ brief: string | null }>(
      `claire-call:${claims.conversationId}`
    );
    expect(stored?.state.brief).toBeNull();
  });

  it("follow-up generation and conservative fallback see no opening brief", async () => {
    const handlers = routes();
    const started = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_inbound", From: OWNER_PHONE, To: "+13105550000" },
    });
    const claims = verifyClaireToken(tokenFromTwiml(started.body));
    if (claims.kind !== "pre_drive_conversation") throw new Error("expected conversation token");
    const stored = await claireConversationStateStore().load<{
      brief: string | null;
      context: Parameters<typeof conservativeClaireFollowUp>[0]["context"];
    }>(`claire-call:${claims.conversationId}`);
    expect(stored?.state.brief).toBeNull();

    const fallbacks = ["hello", "What did you say?", "asdfghjkl"].map(utterance =>
      conservativeClaireFollowUp({
        utterance,
        brief: stored!.state.brief,
        context: stored!.state.context,
      })
    );
    for (const spoken of fallbacks) {
      expect(spoken).not.toContain("No opening briefing was spoken");
      expect(spoken).not.toMatch(/the brief is:/i);
      expect(spoken).not.toMatch(/^I mean this:/);
      expect(spoken).not.toMatch(/^I'm here\. No opening/);
    }
  });

  it("fails closed for an unknown caller", async () => {
    const handlers = routes();
    const res = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_stranger", From: "+13105559999", To: "+13105550000" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("<Hangup");
    expect(res.body).not.toContain("<Gather");
    expect(hoisted.createSession).not.toHaveBeenCalled();
    expect(hoisted.attachCallSid).not.toHaveBeenCalled();
    expect(hoisted.assembleContext).not.toHaveBeenCalled();
  });

  it("fails closed when the caller maps to an unpersisted identity", async () => {
    hoisted.getUserByOpenId.mockResolvedValue(undefined);
    const handlers = routes();
    const res = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_ghost", From: OWNER_PHONE, To: "+13105550000" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("<Gather");
    expect(hoisted.createSession).not.toHaveBeenCalled();
    expect(hoisted.attachCallSid).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid Twilio signature", async () => {
    const handlers = routes();
    const res = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_inbound", From: OWNER_PHONE, To: "+13105550000" },
      signature: "not-a-real-signature",
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("could not be verified");
    expect(res.body).not.toContain("<Gather");
    expect(hoisted.createSession).not.toHaveBeenCalled();
    expect(hoisted.attachCallSid).not.toHaveBeenCalled();
    expect(hoisted.assembleContext).not.toHaveBeenCalled();
  });

  it("fails closed when the Twilio signature is missing", async () => {
    const handlers = routes();
    const res = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_inbound", From: OWNER_PHONE, To: "+13105550000" },
      signature: null,
    });
    expect(res.statusCode).toBe(403);
    expect(hoisted.createSession).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted operator has no Day Director id", async () => {
    hoisted.getUserByOpenId.mockResolvedValue({ openId: OWNER_OPEN_ID, tenantId: "tenant-1", role: "admin" } as never);
    const handlers = routes();
    const res = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_noid", From: OWNER_PHONE, To: "+13105550000" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("<Gather");
    expect(hoisted.createSession).not.toHaveBeenCalled();
  });
});

describe("inbound Day Director identity is not OpenID", () => {
  it("reads and writes THE LINE as String(user.id) while Claire ownership stays OpenID", async () => {
    hoisted.assembleContext.mockImplementation(async (input: { actorId: string; dayDirectorActorId?: string }) =>
      enrichedMorningContext(input)
    );
    const handlers = routes();
    const started = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: "CA_identity", From: OWNER_PHONE, To: "+13105550000" },
    });
    const token = tokenFromTwiml(started.body);
    const claims = verifyClaireToken(token);
    expect(claims).toMatchObject({ userId: OWNER_OPEN_ID, tenantId: "tenant-1" });
    if (claims.kind !== "pre_drive_conversation") throw new Error("expected conversation token");

    const pickup = await claireConversationStateStore().load<{
      actorId: string;
      dayDirectorActorId: string;
    }>(`claire-call:${claims.conversationId}`);
    expect(pickup?.state.actorId).toBe(OWNER_OPEN_ID);
    expect(pickup?.state.dayDirectorActorId).toBe("42");
    expect(pickup?.state.dayDirectorActorId).not.toBe(OWNER_OPEN_ID);

    const follow = await post(handlers, "/api/claire/twilio/pre-drive", {
      originalUrl: `/api/claire/twilio/pre-drive?token=${encodeURIComponent(token)}`,
      body: { CallSid: "CA_identity", SpeechResult: "What's on THE LINE today?" },
    });
    expect(follow.statusCode).toBe(200);
    expect(follow.body).toContain("Got it.");

    expect(hoisted.assembleContext).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_OPEN_ID,
        dayDirectorActorId: "42",
      })
    );
    expect(hoisted.runClaireTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorUserId: OWNER_OPEN_ID,
        dayDirectorActorId: "42",
        tenantId: "tenant-1",
      }),
      expect.objectContaining({
        confirmPlan: expect.any(Function),
      })
    );
    const turnInput = hoisted.runClaireTurn.mock.calls[0]![0] as {
      context: { actorId: string; workday?: { session?: string } };
    };
    expect(turnInput.context.actorId).toBe(OWNER_OPEN_ID);
    expect(turnInput.context.workday?.session).toBe("morning_reconciliation");

    expect(hoisted.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ operatorUserId: OWNER_OPEN_ID, conversationKind: "pre_drive" })
    );
    expect(hoisted.attachConversationKind).toHaveBeenCalledWith({
      claireConversationId: claims.conversationId,
      conversationKind: "morning_reconciliation",
    });

    await vi.waitFor(() => expect(hoisted.observeShadow).toHaveBeenCalled());
    expect(hoisted.observeShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorUserId: OWNER_OPEN_ID,
        live: expect.objectContaining({
          operatorUserId: OWNER_OPEN_ID,
          dayDirectorActorId: "42",
        }),
      })
    );
  });
});

describe("inbound context prefetch is not a concurrent conversation writer", () => {
  async function pickupAndToken(handlers: Map<string, Handler>, callSid: string) {
    const startedAt = Date.now();
    const started = await post(handlers, CLAIRE_INBOUND_VOICE_PATH, {
      body: { CallSid: callSid, From: OWNER_PHONE, To: "+13105550000" },
    });
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(started.statusCode).toBe(200);
    const token = tokenFromTwiml(started.body);
    const claims = verifyClaireToken(token);
    if (claims.kind !== "pre_drive_conversation") throw new Error("expected conversation token");
    return { token, conversationId: claims.conversationId };
  }

  async function speak(
    handlers: Map<string, Handler>,
    token: string,
    callSid: string,
    speech: string
  ) {
    return post(handlers, "/api/claire/twilio/pre-drive", {
      originalUrl: `/api/claire/twilio/pre-drive?token=${encodeURIComponent(token)}`,
      body: { CallSid: callSid, SpeechResult: speech },
    });
  }

  it("first speech waits for delayed enrichment, then saves turn state with it; late prefetch cannot clobber", async () => {
    const inner = createMemoryConversationStateStore();
    const savedStates: Array<{ turns: number; historyLength: number; sessionKind?: string }> = [];
    setClaireConversationStateStoreForTests({
      load: inner.load.bind(inner),
      remove: inner.remove.bind(inner),
      async save(key, owner, state, ttlMs, now) {
        const snapshot = state as {
          turns: number;
          history?: unknown[];
          sessionKind?: string;
          pendingProposal?: unknown;
          context?: { workday?: { session?: string } };
        };
        savedStates.push({
          turns: snapshot.turns,
          historyLength: snapshot.history?.length ?? 0,
          sessionKind: snapshot.sessionKind,
        });
        return inner.save(key, owner, state, ttlMs, now);
      },
    });

    hoisted.assembleContext.mockImplementation(
      () =>
        new Promise(resolve => {
          settleHungAssembly = resolve;
        })
    );

    const handlers = routes();
    const { token, conversationId } = await pickupAndToken(handlers, "CA_race");
    const pickupSaves = savedStates.length;
    expect(pickupSaves).toBeGreaterThanOrEqual(1);

    await new Promise(resolve => setTimeout(resolve, 40));
    expect(savedStates.length).toBe(pickupSaves);

    const storedWhilePending = await claireConversationStateStore().load<{
      turns: number;
      inboundContextReady?: boolean;
      context: { relevantTimeline: unknown[]; workday?: unknown; macroGoalKnown?: boolean };
      history: unknown[];
    }>(`claire-call:${conversationId}`);
    expect(storedWhilePending?.state.inboundContextReady).toBe(false);
    expect(storedWhilePending?.state.context.relevantTimeline).toEqual([]);
    expect(storedWhilePending?.state.context.workday).toBeUndefined();
    expect(storedWhilePending?.state.turns).toBe(0);
    expect(storedWhilePending?.state.history).toHaveLength(1);

    const firstTurn = speak(handlers, token, "CA_race", "What's on THE LINE today?");
    await vi.waitFor(() => expect(hoisted.assembleContext).toHaveBeenCalled());
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();

    settleHungAssembly?.(
      enrichedMorningContext({ actorId: OWNER_OPEN_ID, dayDirectorActorId: "42" })
    );
    settleHungAssembly = undefined;
    const follow = await firstTurn;
    expect(follow.statusCode).toBe(200);
    expect(follow.body).toContain("Got it.");

    const turnInput = hoisted.runClaireTurn.mock.calls[0]![0] as {
      context: { relevantTimeline: Array<{ title: string }>; workday?: { session?: string }; macroGoalKnown?: boolean };
      dayDirectorActorId: string;
      operatorUserId: string;
    };
    expect(turnInput.operatorUserId).toBe(OWNER_OPEN_ID);
    expect(turnInput.dayDirectorActorId).toBe("42");
    expect(turnInput.context.workday?.session).toBe("morning_reconciliation");
    expect(turnInput.context.relevantTimeline[0]?.title).toBe("Call Dana");
    expect(turnInput.context.macroGoalKnown).toBe(true);

    const stored = await claireConversationStateStore().load<{
      turns: number;
      inboundContextReady?: boolean;
      pendingProposal?: { id: string };
      history: Array<{ speaker: string; text: string }>;
      context: { workday?: { session?: string }; relevantTimeline: Array<{ title: string }> };
    }>(`claire-call:${conversationId}`);
    expect(stored?.state.inboundContextReady).toBe(true);
    expect(stored?.state.turns).toBe(1);
    expect(stored?.state.pendingProposal).toMatchObject({ id: "first-turn-pending" });
    expect(stored?.state.history.some(entry => entry.speaker === "operator" && entry.text.includes("THE LINE"))).toBe(
      true
    );
    expect(stored?.state.context.workday?.session).toBe("morning_reconciliation");
    expect(stored?.state.context.relevantTimeline[0]?.title).toBe("Call Dana");

    const afterTurnSaves = savedStates.length;
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(savedStates.length).toBe(afterTurnSaves);
    expect(
      savedStates.some(row => row.sessionKind === "morning_reconciliation" && row.historyLength === 1)
    ).toBe(false);
    expect(hoisted.attachConversationKind).toHaveBeenCalledWith({
      claireConversationId: conversationId,
      conversationKind: "morning_reconciliation",
    });
  });

  it("consumes enrichment that finished before first speech without a prefetch rewrite", async () => {
    const inner = createMemoryConversationStateStore();
    const savedKinds: Array<string | undefined> = [];
    setClaireConversationStateStoreForTests({
      load: inner.load.bind(inner),
      remove: inner.remove.bind(inner),
      async save(key, owner, state, ttlMs, now) {
        savedKinds.push((state as { sessionKind?: string }).sessionKind);
        return inner.save(key, owner, state, ttlMs, now);
      },
    });
    hoisted.assembleContext.mockImplementation(async (input: { actorId: string; dayDirectorActorId?: string }) =>
      enrichedMorningContext(input)
    );

    const handlers = routes();
    const { token, conversationId } = await pickupAndToken(handlers, "CA_ready");
    await vi.waitFor(() => expect(hoisted.assembleContext).toHaveBeenCalled());
    await Promise.resolve();

    const beforeSpeech = await claireConversationStateStore().load<{
      inboundContextReady?: boolean;
      turns: number;
      context: { workday?: unknown; relevantTimeline: unknown[] };
    }>(`claire-call:${conversationId}`);
    expect(beforeSpeech?.state.inboundContextReady).toBe(false);
    expect(beforeSpeech?.state.turns).toBe(0);
    expect(beforeSpeech?.state.context.workday).toBeUndefined();
    expect(beforeSpeech?.state.context.relevantTimeline).toEqual([]);
    expect(savedKinds.every(kind => kind !== "morning_reconciliation")).toBe(true);

    const follow = await speak(handlers, token, "CA_ready", "Walk me through this morning.");
    expect(follow.body).toContain("Got it.");
    const turnInput = hoisted.runClaireTurn.mock.calls[0]![0] as {
      context: { workday?: { session?: string } };
    };
    expect(turnInput.context.workday?.session).toBe("morning_reconciliation");

    const after = await claireConversationStateStore().load<{
      inboundContextReady?: boolean;
      turns: number;
      pendingProposal?: { id: string };
      context: { workday?: { session?: string } };
    }>(`claire-call:${conversationId}`);
    expect(after?.state.inboundContextReady).toBe(true);
    expect(after?.state.turns).toBe(1);
    expect(after?.state.pendingProposal).toMatchObject({ id: "first-turn-pending" });
    expect(after?.state.context.workday?.session).toBe("morning_reconciliation");
  });

  it("assembles on the first turn when process-local prefetch is missing (replica)", async () => {
    hoisted.assembleContext.mockImplementation(async (input: { actorId: string; dayDirectorActorId?: string }) =>
      enrichedMorningContext(input)
    );
    const handlers = routes();
    const { token, conversationId } = await pickupAndToken(handlers, "CA_replica");
    await vi.waitFor(() => expect(hoisted.assembleContext).toHaveBeenCalled());
    resetInboundContextPrefetchForTests();
    hoisted.assembleContext.mockClear();

    const follow = await speak(handlers, token, "CA_replica", "What's on the day line?");
    expect(follow.body).toContain("Got it.");
    expect(hoisted.assembleContext).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: OWNER_OPEN_ID, dayDirectorActorId: "42" })
    );
    const stored = await claireConversationStateStore().load<{
      context: { workday?: { session?: string } };
    }>(`claire-call:${conversationId}`);
    expect(stored?.state.context.workday?.session).toBe("morning_reconciliation");
  });

  it("keeps bootstrap context when enrichment fails and does not treat emptiness as assembled workday truth", async () => {
    hoisted.assembleContext.mockRejectedValue(new Error("day line unavailable"));
    const handlers = routes();
    const { token, conversationId } = await pickupAndToken(handlers, "CA_fail");
    const follow = await speak(handlers, token, "CA_fail", "What should I do first?");
    expect(follow.statusCode).toBe(200);
    expect(hoisted.runClaireTurn).toHaveBeenCalled();
    const turnInput = hoisted.runClaireTurn.mock.calls[0]![0] as {
      context: { relevantTimeline: unknown[]; workday?: unknown; macroGoalKnown?: boolean };
    };
    expect(turnInput.context.workday).toBeUndefined();
    expect(turnInput.context.relevantTimeline).toEqual([]);
    expect(hoisted.attachConversationKind).not.toHaveBeenCalled();
    const stored = await claireConversationStateStore().load<{
      inboundContextReady?: boolean;
      sessionKind?: string;
      context: { workday?: unknown };
    }>(`claire-call:${conversationId}`);
    expect(stored?.state.inboundContextReady).toBe(true);
    expect(stored?.state.sessionKind).toBeUndefined();
    expect(stored?.state.context.workday).toBeUndefined();
  });
});
