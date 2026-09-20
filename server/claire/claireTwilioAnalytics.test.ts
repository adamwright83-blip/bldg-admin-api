import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  return {
    tokens: [] as string[],
    create: vi.fn(async () => ({ sid: "CA_test" })),
    commitment: vi.fn(async (_input: { state: Record<string, unknown> }) => ({ kind: "not_applicable" as string, speak: "" })),
    followUp: vi.fn(async () => "Follow-up answer."),
  };
});

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
    // The single configured phone belongs to this operator; nobody else may dial it.
    ownerOpenId: "operator-1",
  },
}));
// The call path now verifies the operator is a real, persisted user of the same tenant before a
// real phone is ever dialed (see authorizedOperatorPhone). These fixtures dial as "operator-1".
vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getUserByOpenId: async (openId: string) =>
    openId === "operator-1" ? ({ openId, tenantId: "tenant-1", role: "admin" } as never) : undefined,
}));

vi.mock("twilio", async importOriginal => {
  const actual = (await importOriginal()) as { default?: Record<string, unknown> } & Record<string, unknown>;
  const real = (actual.default ?? actual) as Record<string, unknown>;
  const factory = Object.assign(() => ({ calls: { create: hoisted.create } }), real, { twiml: real.twiml });
  return { ...actual, default: factory };
});
vi.mock("./claireToken", () => ({
  issueClaireToken: (payload: Record<string, unknown>) => {
    const token = Buffer.from(JSON.stringify(payload)).toString("base64url");
    hoisted.tokens.push(token);
    return token;
  },
  verifyClaireToken: (token: string) => JSON.parse(Buffer.from(token, "base64url").toString("utf8")),
}));
vi.mock("./preDriveRuntime", () => ({
  generateClairePreDriveOutput: async (input: { actorId: string }) => ({
    brief: "Two stops today.",
    context: {
      phase: "pre_drive",
      generatedAt: "2026-09-15T02:00:00.000Z",
      businessDate: "2026-09-14",
      actorId: input.actorId,
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
    },
  }),
}));
vi.mock("./conversation/ledgerService", () => ({
  createConversationSession: vi.fn(async () => undefined),
  attachCallSid: vi.fn(async () => undefined),
  persistSpokenTurn: vi.fn(async () => undefined),
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
  endClaireCallLedger: vi.fn(async () => undefined),
}));
vi.mock("./conversation/pipeline", () => ({
  handleCallCompleted: vi.fn(async () => undefined),
  handleRecordingStatus: vi.fn(async () => undefined),
}));
vi.mock("./conversation/twilioSignature", () => ({ isValidTwilioWebhook: () => true }));
vi.mock("./voiceCommitmentLoop", async importOriginal => ({
  ...(await importOriginal<typeof import("./voiceCommitmentLoop")>()),
  handleVoiceCommitmentTurn: hoisted.commitment,
}));
vi.mock("./preDriveConversation", async importOriginal => ({
  ...(await importOriginal<typeof import("./preDriveConversation")>()),
  answerClairePreDriveFollowUp: hoisted.followUp,
}));
vi.mock("../analytics/businessQuery", async importOriginal => {
  const actual = await importOriginal<typeof import("../analytics/businessQuery")>();
  const fixture = await import("../analytics/businessLedgerFixture");
  const ledger = await import("../analytics/paidOrderLedger");
  return {
    ...actual,
    runBusinessQuery: (tenantId: string, query: Parameters<typeof actual.runBusinessQuery>[1]) =>
      actual.runBusinessQuery(tenantId, query, {
        loadLedger: input => ledger.loadPaidOrderLedger(input, fixture.fixtureLoaders()),
        loadOpenOrders: async () => ({ openTotal: 0, byStatus: {}, awaitingPayment: 0 }),
        loadCompleteness: async () => fixture.fixtureCompleteness,
        now: () => fixture.FIXTURE_NOW,
        timeZone: () => fixture.FIXTURE_TZ,
      }),
  };
});

import { FIXTURE_NOW } from "../analytics/businessLedgerFixture";
import { registerClaireRoutes, startClairePreDriveCall } from "./claireTwilio";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

function routes(): Map<string, Handler> {
  const map = new Map<string, Handler>();
  registerClaireRoutes({ post: (path: string, handler: Handler) => map.set(path, handler), get: () => undefined } as never);
  return map;
}

async function startCall(): Promise<string> {
  await startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" });
  return hoisted.tokens[hoisted.tokens.length - 1]!;
}

async function say(handlers: Map<string, Handler>, token: string, speech: string): Promise<string> {
  const res = {
    body: "",
    type() {
      return this;
    },
    status() {
      return this;
    },
    send(body: string) {
      this.body = body;
      return this;
    },
  };
  await handlers.get("/api/claire/twilio/pre-drive")!(
    {
      query: { token },
      body: { SpeechResult: speech, CallSid: "CA_test" },
      headers: {},
      protocol: "https",
      get: () => "api.example.test",
      originalUrl: `/api/claire/twilio/pre-drive?token=${token}`,
    },
    res
  );
  return res.body;
}

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW, toFake: ["Date"] });
  hoisted.commitment.mockClear();
  hoisted.followUp.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("live Claire call answers business questions in the call (U)", () => {
  it("revenue → previous 30 → which had more orders, all inside one call", async () => {
    const handlers = routes();
    const token = await startCall();

    const first = await say(handlers, token, "What was revenue in the last 30 days?");
    expect(first).toContain("Paid revenue in the last 30 days is $190 across 5 orders.");
    expect(first).toContain("<Gather");

    const second = await say(handlers, token, "What about the 30 before that?");
    expect(second).toContain("paid revenue was $95.00 across 2 orders");

    const third = await say(handlers, token, "Which period had more orders?");
    expect(third).toContain("so the last 30 days had 3 more");

    expect(hoisted.commitment).not.toHaveBeenCalled();
    expect(hoisted.followUp).not.toHaveBeenCalled();
  });

  it("keeps each call's analytical context to that call", async () => {
    const handlers = routes();
    const callA = await startCall();
    const callB = await startCall();
    expect(await say(handlers, callA, "How many active customers do we have?")).toContain("3 customer identities");
    expect(await say(handlers, callB, "Who are they?")).toContain("Follow-up answer.");
    expect(await say(handlers, callA, "Who are they?")).toContain("Ava Stone");
  });

  it("single work goes to the work loop; a new question supersedes the stale proposal", async () => {
    const handlers = routes();
    const token = await startCall();
    hoisted.commitment.mockImplementationOnce(async input => {
      input.state.pendingProposal = { title: "Review revenue", sourceText: "Add reviewing last month's revenue." };
      return { kind: "proposed", speak: "I heard: Review revenue. Should I add that to today's plan? Say yes or no." };
    });
    const proposed = await say(handlers, token, "Add reviewing last month's revenue.");
    expect(proposed).toContain("Should I add that");
    expect(hoisted.commitment).toHaveBeenCalledTimes(1);

    const answered = await say(handlers, token, "What was revenue last month?");
    expect(answered).toContain("Paid revenue last month was");
    expect(answered).not.toMatch(/still holding|say yes to add/i);
    expect(hoisted.commitment).toHaveBeenCalledTimes(1);

    const staleYes = await say(handlers, token, "Yes.");
    expect(staleYes).not.toContain("Added: Review revenue.");
    expect(hoisted.commitment).toHaveBeenCalledTimes(1);
  });

  it("dated work becomes one briefing proposal, and a save that fails is never spoken as saved", async () => {
    const handlers = routes();
    const token = await startCall();
    const proposed = await say(handlers, token, "Add reviewing last month's revenue tomorrow.");
    expect(proposed).toContain("Tomorrow: add reviewing last month's revenue.");
    expect(proposed).toContain("Want me to put that on the Day Line?");
    expect(hoisted.commitment).not.toHaveBeenCalled();
    const saved = await say(handlers, token, "Yes.");
    expect(saved).toContain("nothing saved");
    expect(saved).not.toMatch(/\bDone\b/);
  });

  it("ordinary conversation still reaches Claire's normal follow-up", async () => {
    const handlers = routes();
    const token = await startCall();
    expect(await say(handlers, token, "Who am I meeting today?")).toContain("Follow-up answer.");
    expect(hoisted.followUp).toHaveBeenCalledTimes(1);
  });
});
