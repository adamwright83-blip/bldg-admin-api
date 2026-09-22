import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../claire/turn/conversationStateStore";

const AUTH_TOKEN = "auth_test_secret_value";
const OWNER_PHONE = "+13105550001";
const OWNER_OPEN_ID = "adam-admin";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test_secret_value";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.JWT_SECRET = "test-secret-long-enough-for-signing";
  return {
    getUserByOpenId: vi.fn(async (openId: string) =>
      openId === "adam-admin"
        ? ({ id: 42, openId, tenantId: "tenant-1", role: "admin" } as never)
        : undefined
    ),
    assemble: vi.fn(async () => ({ phase: "pre_drive" })),
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

vi.mock("../claire/preDriveRuntime", () => ({
  assembleClaireVoiceCallContext: (...args: unknown[]) => hoisted.assemble(...args),
  generateClairePreDriveOutput: async () => {
    throw new Error("inbound must not generate a pre-drive briefing");
  },
}));

import {
  CLAIRE_INBOUND_GREETING,
  CLAIRE_INBOUND_VOICE_PATH,
  authorizedInboundOperator,
  registerClaireRoutes,
  resetInboundContextPrefetchForTests,
  resolveClaireOperatorIdForPhone,
} from "../claire/claireTwilio";

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
  body: Record<string, string>,
  signature?: string | null
) {
  const path = CLAIRE_INBOUND_VOICE_PATH;
  const url = `https://api.example.test${path}`;
  const header = signature === null ? undefined : (signature ?? sign(url, body));
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
  await handlers.get(path)!({
    query: {},
    body,
    headers: header ? { "x-twilio-signature": header } : {},
    protocol: "https",
    get: () => "api.example.test",
    originalUrl: path,
  }, res);
  return res;
}

beforeEach(() => {
  setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
  resetInboundContextPrefetchForTests();
  hoisted.getUserByOpenId.mockClear();
});

afterEach(() => {
  resetInboundContextPrefetchForTests();
  setClaireConversationStateStoreForTests(null);
  delete process.env.CLAIRE_OPERATOR_PHONES;
});

describe("existing inbound Claire voice still accepts the production call shape", () => {
  it("accepts a signed inbound call from the authorized operator", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(item => String(item)).join(" "));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(item => String(item)).join(" "));
    });
    const handlers = routes();
    const res = await post(handlers, {
      CallSid: "CA_inbound",
      From: OWNER_PHONE,
      To: "+13105550000",
      Direction: "inbound",
    });
    spy.mockRestore();
    warn.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<Gather");
    expect(res.body).toContain(CLAIRE_INBOUND_GREETING);
    expect(res.body).toContain("/api/claire/twilio/pre-drive?token=");
    expect(logs.join("\n")).not.toContain(AUTH_TOKEN);
  });

  it("rejects an invalid Twilio signature", async () => {
    const handlers = routes();
    const res = await post(
      handlers,
      { CallSid: "CA_inbound", From: OWNER_PHONE, To: "+13105550000" },
      "not-a-real-signature"
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("could not be verified");
    expect(res.body).not.toContain("<Gather");
  });

  it("rejects an unknown inbound phone", async () => {
    const handlers = routes();
    const res = await post(handlers, {
      CallSid: "CA_stranger",
      From: "+13105559999",
      To: "+13105550000",
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("<Gather");
    expect(() => resolveClaireOperatorIdForPhone("+13105559999")).toThrow(/not a configured operator/);
  });

  it("still resolves the authorized operator", async () => {
    expect(resolveClaireOperatorIdForPhone(OWNER_PHONE)).toBe(OWNER_OPEN_ID);
    await expect(authorizedInboundOperator(OWNER_PHONE)).resolves.toEqual({
      operatorUserId: OWNER_OPEN_ID,
      dayDirectorActorId: "42",
      tenantId: "tenant-1",
    });
  });
});
