import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "./turn/conversationStateStore";
import { verifyClaireToken } from "./claireToken";

const AUTH_TOKEN = "auth_test";
const INBOUND_URL = "https://api.example.test/api/claire/twilio/inbound";
const OWNER_PHONE = "+13105550001";
const OWNER_OPEN_ID = "adam-admin";

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
    assembleContext: vi.fn(async (input: { actorId: string }) => ({
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
    persistSpokenTurn: vi.fn(async () => undefined),
    getUserByOpenId: vi.fn(async (openId: string) =>
      openId === "adam-admin" ? ({ openId, tenantId: "tenant-1", role: "admin" } as never) : undefined
    ),
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
  persistSpokenTurn: (...args: unknown[]) => hoisted.persistSpokenTurn(...args),
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

beforeEach(() => {
  setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
  hoisted.generateBrief.mockClear();
  hoisted.assembleContext.mockClear();
  hoisted.createSession.mockClear();
  hoisted.attachCallSid.mockClear();
  hoisted.persistSpokenTurn.mockClear();
  hoisted.getUserByOpenId.mockClear();
  hoisted.getUserByOpenId.mockImplementation(async (openId: string) =>
    openId === OWNER_OPEN_ID ? ({ openId, tenantId: "tenant-1", role: "admin" } as never) : undefined
  );
});

afterEach(() => {
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
    expect(hoisted.assembleContext).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", actorId: OWNER_OPEN_ID })
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
      brief: string;
      history: Array<{ speaker: string; text: string }>;
    }>(`claire-call:${claims.conversationId}`);
    expect(stored?.state).toMatchObject({
      tenantId: "tenant-1",
      actorId: OWNER_OPEN_ID,
      brief: "No opening briefing was spoken.",
    });
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
});
