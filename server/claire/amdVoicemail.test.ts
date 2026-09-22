import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS } from "@shared/twilioPlatform";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.JWT_SECRET = "amd-test-secret";
  delete process.env.CLAIRE_TWILIO_AMD;
  let sid = 0;
  return {
    create: vi.fn(async () => ({ sid: `CA_amd_${++sid}` })),
    signatureOk: true,
  };
});

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
    ownerOpenId: "operator-1",
  },
}));

vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getUserByOpenId: async (openId: string) =>
    openId === "operator-1" ? ({ openId, tenantId: "tenant-1", role: "admin", id: 1 } as never) : undefined,
}));

vi.mock("twilio", async importOriginal => {
  const actual = (await importOriginal()) as { default?: Record<string, unknown> } & Record<string, unknown>;
  const real = (actual.default ?? actual) as Record<string, unknown>;
  const factory = Object.assign(() => ({ calls: { create: hoisted.create } }), real, { twiml: real.twiml });
  return { ...actual, default: factory };
});

vi.mock("./preDriveRuntime", () => ({
  generateClairePreDriveOutput: async (input: { actorId: string }) => ({
    brief: "Two stops today.",
    context: {
      phase: "pre_drive",
      generatedAt: "2026-09-22T02:00:00.000Z",
      businessDate: "2026-09-22",
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

vi.mock("./conversation/twilioSignature", () => ({
  isValidTwilioWebhook: () => hoisted.signatureOk,
}));

import type { TwilioCommunicationReceipt } from "@shared/twilioPlatform";
import {
  abandonAuthorizedAmdHandoff,
  AMD_ANSWERED_BY,
  amdCallPath,
  amdDetectionTwiml,
  answeringMachineDetectionActive,
  authorizedAmdCreateFields,
  boundedVoicemailText,
  boundedVoicemailTwiml,
  BOUNDED_VOICEMAIL_MAX_CHARS,
  BOUNDED_VOICEMAIL_TEXT,
  CLAIRE_AMD_PATH,
} from "./amdVoicemail";
import { CLAIRE_CALL_STATUS_PATH, registerClaireRoutes, startClairePreDriveCall } from "./claireTwilio";
import { issueClaireToken } from "./claireToken";
import {
  createMemoryCommunicationReceiptStore,
  setCommunicationReceiptStoreForTests,
} from "../twilioPlatform/communicationReceipts";

const BRIEF = "Two stops today.";
const LONG_FORBIDDEN = "weekly interview morning briefing sales coaching";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

function routes(): Map<string, Handler> {
  const map = new Map<string, Handler>();
  registerClaireRoutes({
    post: (path: string, handler: Handler) => map.set(path, handler),
    get: () => undefined,
  } as never);
  return map;
}

async function post(
  handlers: Map<string, Handler>,
  path: string,
  req: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
  const res = {
    statusCode: 200,
    body: "",
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
    end() {
      return this;
    },
  };
  await handlers.get(path)!(
    {
      headers: {},
      protocol: "https",
      get: () => "api.example.test",
      originalUrl: path,
      query: {},
      ...req,
    },
    res
  );
  return res;
}

let receipts: TwilioCommunicationReceipt[] = [];

function receiptEvents(): string[] {
  return receipts.map(receipt => receipt.eventType);
}

beforeEach(() => {
  hoisted.create.mockClear();
  hoisted.signatureOk = true;
  delete process.env.CLAIRE_TWILIO_AMD;
  receipts = [];
  const memory = createMemoryCommunicationReceiptStore();
  setCommunicationReceiptStoreForTests({
    async insertOrGet(receipt) {
      const result = await memory.insertOrGet(receipt);
      if (!result.duplicate) receipts.push(result.receipt);
      return result;
    },
  });
});

afterEach(() => {
  delete process.env.CLAIRE_TWILIO_AMD;
  setCommunicationReceiptStoreForTests(null);
});

describe("bounded voicemail", () => {
  it("is one short message and never the briefing", () => {
    const text = boundedVoicemailText();
    expect(text).toBe(BOUNDED_VOICEMAIL_TEXT);
    expect(text.length).toBeLessThanOrEqual(BOUNDED_VOICEMAIL_MAX_CHARS);
    expect(text).not.toMatch(/weekly interview|morning briefing|sales coaching|claude/i);
    expect(text).not.toContain(BRIEF);
    const xml = boundedVoicemailTwiml();
    expect(xml.match(/<Say\b/g)).toHaveLength(1);
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Gather");
    expect(xml).toContain(text);
    expect(xml).not.toContain(LONG_FORBIDDEN);
  });
});

describe("AMD outcomes", () => {
  it("keeps humans on the interactive path and machines on one voicemail", () => {
    expect(AMD_ANSWERED_BY).toEqual([
      "human",
      "machine_start",
      "machine_end_beep",
      "machine_end_silence",
      "machine_end_other",
      "fax",
      "unknown",
    ]);
    expect(amdCallPath("human")).toBe("interactive");
    expect(amdCallPath("unknown")).toBe("interactive");
    expect(amdCallPath(null)).toBe("interactive");
    expect(amdCallPath("fax")).toBe("hangup");
    for (const machine of ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other"] as const) {
      expect(amdCallPath(machine)).toBe("voicemail");
    }
  });
});

describe("authorized outbound calls", () => {
  it("leaves the interactive TwiML in place when AMD is off", async () => {
    expect(answeringMachineDetectionActive()).toBe(false);
    const started = await startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" });
    expect(started.brief).toBe(BRIEF);
    const params = hoisted.create.mock.calls[0]?.[0] as {
      twiml?: string;
      url?: string;
      machineDetection?: string;
      statusCallback?: string;
    };
    expect(params.machineDetection).toBeUndefined();
    expect(params.url).toBeUndefined();
    expect(params.twiml).toContain("<Gather");
    expect(params.twiml).toContain(BRIEF);
    expect(params.statusCallback).toBe("https://api.example.test/api/claire/twilio/call-status");
    expect(receiptEvents()).toContain("CALL_ATTEMPTED");
    expect(receiptEvents()).not.toContain("VOICEMAIL_DETECTED");
  });

  it("speaks one bounded voicemail and hangs up when a machine answers", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    const started = await startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" });
    const params = hoisted.create.mock.calls[0]?.[0] as { url: string; twiml?: string; machineDetection?: string };
    expect(params.machineDetection).toBe("DetectMessageEnd");
    expect(params.twiml).toBeUndefined();
    expect(params.url).toContain(`${CLAIRE_AMD_PATH}?token=`);
    const token = new URL(params.url).searchParams.get("token")!;
    const machine = await amdDetectionTwiml({
      token,
      answeredBy: "machine_end_beep",
      callSid: started.callSid,
    });
    expect(machine.status).toBe(200);
    expect(machine.twiml).toBe(boundedVoicemailTwiml());
    expect(machine.twiml).not.toContain(BRIEF);
    expect(machine.twiml).not.toContain("<Gather");
    expect(receiptEvents()).toEqual(["CALL_ATTEMPTED", "VOICEMAIL_DETECTED"]);
    const again = await amdDetectionTwiml({
      token,
      answeredBy: "machine_end_silence",
      callSid: started.callSid,
    });
    expect(again.twiml).toBe(boundedVoicemailTwiml());
    expect(receiptEvents().filter(event => event === "VOICEMAIL_DETECTED")).toHaveLength(1);
  });

  it("uses the prepared interactive path when a human answers", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    const started = await startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" });
    const params = hoisted.create.mock.calls[0]?.[0] as { url: string };
    const token = new URL(params.url).searchParams.get("token")!;
    const human = await amdDetectionTwiml({
      token,
      answeredBy: "human",
      callSid: started.callSid,
    });
    expect(human.status).toBe(200);
    expect(human.twiml).toContain("<Gather");
    expect(human.twiml).toContain(BRIEF);
    expect(human.twiml).toContain("/api/claire/twilio/pre-drive?token=");
    expect(human.twiml).not.toContain("I reached your voicemail");
    expect(receiptEvents()).not.toContain("VOICEMAIL_DETECTED");

    const unknown = await amdDetectionTwiml({
      token,
      answeredBy: "unknown",
      callSid: started.callSid,
    });
    expect(unknown.twiml).toContain("<Gather");
    expect(unknown.twiml).toContain(BRIEF);
  });

  it("hangs up on fax without leaving the briefing or a voicemail", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    const started = await startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" });
    const params = hoisted.create.mock.calls[0]?.[0] as { url: string };
    const token = new URL(params.url).searchParams.get("token")!;
    const fax = await amdDetectionTwiml({ token, answeredBy: "fax", callSid: started.callSid });
    expect(fax.status).toBe(200);
    expect(fax.twiml).toContain("<Hangup");
    expect(fax.twiml).not.toContain("<Say");
    expect(fax.twiml).not.toContain(BRIEF);
    expect(fax.twiml).not.toContain(BOUNDED_VOICEMAIL_TEXT);
    expect(receiptEvents()).not.toContain("VOICEMAIL_DETECTED");
  });

  it("records the existing completed lifecycle without inventing a business outcome", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    const started = await startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" });
    const handlers = routes();
    const res = await post(handlers, CLAIRE_CALL_STATUS_PATH, {
      body: { CallSid: started.callSid, CallStatus: "completed", CallDuration: "9" },
    });
    expect(res.statusCode).toBe(204);
    await vi.waitFor(() => {
      expect(receiptEvents()).toContain("CALL_COMPLETED");
    });
    const completed = receipts.find(receipt => receipt.eventType === "CALL_COMPLETED");
    expect(completed).toMatchObject({
      tenantId: "tenant-1",
      operatorUserId: "operator-1",
      callSid: started.callSid,
      direction: "outbound",
      durationSeconds: 9,
      provider: "twilio",
    });
    const serialized = JSON.stringify(receipts);
    for (const outcome of BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS) {
      expect(serialized).not.toContain(outcome);
    }
  });

  it("does not run AMD when the outbound attempt is not authorized", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    await expect(
      startClairePreDriveCall({ tenantId: "tenant-1", actorId: "not-the-owner" })
    ).rejects.toThrow(/will not dial|no such operator/i);
    await expect(
      startClairePreDriveCall({ tenantId: "other-tenant", actorId: "operator-1" })
    ).rejects.toThrow(/belongs to tenant/i);
    expect(hoisted.create).not.toHaveBeenCalled();
    expect(receiptEvents()).not.toContain("VOICEMAIL_DETECTED");
    expect(receiptEvents()).not.toContain("CALL_ATTEMPTED");

    const forged = await amdDetectionTwiml({
      token: "not-a-call-token",
      answeredBy: "machine_end_beep",
      callSid: "CA_forged",
    });
    expect(forged.status).toBe(403);
    expect(forged.twiml).not.toContain(BOUNDED_VOICEMAIL_TEXT);
    expect(forged.twiml).not.toContain(BRIEF);
    expect(hoisted.create).not.toHaveBeenCalled();
  });

  it("drops the handoff when the authorized create fails, so AMD cannot speak", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    hoisted.create.mockRejectedValueOnce(new Error("twilio down"));
    await expect(
      startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" })
    ).rejects.toThrow(/twilio down/);
    const params = hoisted.create.mock.calls[0]?.[0] as { url?: string };
    const token = new URL(params.url ?? "https://api.example.test/missing").searchParams.get("token") ?? "";
    const after = await amdDetectionTwiml({
      token,
      answeredBy: "machine_end_beep",
      callSid: "CA_create_failed",
    });
    expect(after.status).toBe(403);
    expect(after.twiml).not.toContain(BOUNDED_VOICEMAIL_TEXT);
    expect(after.twiml).not.toContain(BRIEF);
    expect(receiptEvents()).not.toContain("VOICEMAIL_DETECTED");
  });

  it("refuses an AMD webhook that fails signature verification", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    const started = await startClairePreDriveCall({ tenantId: "tenant-1", actorId: "operator-1" });
    const params = hoisted.create.mock.calls[0]?.[0] as { url: string };
    const token = new URL(params.url).searchParams.get("token")!;
    hoisted.signatureOk = false;
    const res = await post(routes(), CLAIRE_AMD_PATH, {
      query: { token },
      body: { AnsweredBy: "machine_end_beep", CallSid: started.callSid },
      originalUrl: `${CLAIRE_AMD_PATH}?token=${encodeURIComponent(token)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(BOUNDED_VOICEMAIL_TEXT);
    expect(res.body).not.toContain(BRIEF);
    expect(receiptEvents()).not.toContain("VOICEMAIL_DETECTED");
  });

  it("serves the post-stop interactive TwiML for a human and voicemail for a machine", async () => {
    process.env.CLAIRE_TWILIO_AMD = "true";
    const token = issueClaireToken({
      kind: "drive_call",
      tenantId: "tenant-1",
      userId: "operator-1",
      missionId: 4,
      missionAccess: "operator",
      phase: "post_stop",
    });
    const interactiveTwiml = `<Response><Gather><Say>${BRIEF}</Say></Gather><Hangup/></Response>`;
    const fields = await authorizedAmdCreateFields({
      token,
      tenantId: "tenant-1",
      operatorUserId: "operator-1",
      interactiveTwiml,
      decisionUrl: `https://api.example.test${CLAIRE_AMD_PATH}?token=${encodeURIComponent(token)}`,
    });
    expect(fields).toMatchObject({ machineDetection: "DetectMessageEnd" });
    expect(fields.twiml).toBeUndefined();
    const human = await amdDetectionTwiml({ token, answeredBy: "human", callSid: "CA_post_human" });
    expect(human.twiml).toBe(interactiveTwiml);
    const machine = await amdDetectionTwiml({
      token,
      answeredBy: "machine_end_other",
      callSid: "CA_post_machine",
    });
    expect(machine.twiml).toBe(boundedVoicemailTwiml());
    expect(machine.twiml).not.toContain(BRIEF);
    await abandonAuthorizedAmdHandoff(token);
    const after = await amdDetectionTwiml({
      token,
      answeredBy: "machine_end_beep",
      callSid: "CA_post_abandoned",
    });
    expect(after.status).toBe(403);
    expect(after.twiml).not.toContain(BOUNDED_VOICEMAIL_TEXT);
  });
});

describe("no new autonomous dialer", () => {
  it("searches this slice and finds no repeated operator, reminder, or planning dialer", () => {
    const production = readFileSync("server/claire/amdVoicemail.ts", "utf8");
    const twilio = readFileSync("server/claire/claireTwilio.ts", "utf8");
    const dialerHits = execSync(
      "grep -nE 'setInterval|setTimeout|node-cron|every fifteen|packet reminder|weekly planning dial|nag loop|calls\\.create|startClairePreDriveCall|startClairePostStopCall' server/claire/amdVoicemail.ts || true",
      { encoding: "utf8" }
    );
    expect(dialerHits).toBe("");
    expect(production).toMatch(/no autonomous repeated outbound Claire calls/);
    expect(production).not.toMatch(/twilio\s*\(/);
    expect(production).not.toMatch(/getTwilioPlatformClient/);
    expect(production).not.toMatch(/weeklyMission|nightShift|autonomousTriggers/);
    expect(twilio.match(/client!\.calls\.create\(/g)).toHaveLength(2);
    expect(twilio).not.toMatch(/setInterval\s*\(/);
    expect(twilio).not.toMatch(/every fifteen/i);
    const preDrive = twilio.slice(
      twilio.indexOf("export async function startClairePreDriveCall"),
      twilio.indexOf("export async function startClairePostStopCall")
    );
    const postStop = twilio.slice(
      twilio.indexOf("export async function startClairePostStopCall"),
      twilio.indexOf("export function registerClaireRoutes")
    );
    expect(preDrive.indexOf("authorizedOperatorPhone")).toBeLessThan(preDrive.indexOf("authorizedAmdCreateFields"));
    expect(postStop.indexOf("authorizedOperatorPhone")).toBeLessThan(postStop.indexOf("authorizedAmdCreateFields"));
    expect(twilio).toContain('const PRE_DRIVE_PATH = "/api/claire/twilio/pre-drive"');
    expect(twilio).toContain('export const CLAIRE_CALL_STATUS_PATH = "/api/claire/twilio/call-status"');
    expect(twilio).toContain('export const CLAIRE_INBOUND_VOICE_PATH = "/api/claire/twilio/inbound"');
    expect(twilio).toContain("if (!validTwilioRequest(req))");
  });
});
