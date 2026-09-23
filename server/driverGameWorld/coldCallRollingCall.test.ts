import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commercialMissions,
  driverColdCallBatches,
  driverColdCallTargets,
  salesCallAttempts,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import { COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE } from "../../shared/coldCallBurst";

const OPERATOR = "+13105550111";
const CLAIRE_FROM = "+13105550000";
const PROSPECT = "+13105550123";
const COMPANY = "Kith Treats";

const mocks = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550111";
  process.env.OWNER_OPEN_ID = "adam-admin";
  return {
    getDb: vi.fn(),
    authorizedOperatorPhone: vi.fn(),
    claireTwilioFromNumber: vi.fn(),
    callsCreate: vi.fn(),
    outgoingList: vi.fn(),
    recordCommercialMissionCallAttempt: vi.fn(),
  };
});

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../_core/env", () => ({
  ENV: { adminBaseUrl: "https://admin.example.test", ownerOpenId: "adam-admin" },
}));
vi.mock("../claire/claireTwilio", () => ({
  authorizedOperatorPhone: mocks.authorizedOperatorPhone,
  claireTwilioFromNumber: mocks.claireTwilioFromNumber,
  registerClaireRoutes: () => undefined,
}));
vi.mock("../commercialMissions/commercialMissionCallService", () => ({
  recordCommercialMissionCallAttempt: mocks.recordCommercialMissionCallAttempt,
}));
vi.mock("twilio", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = (actual.default ?? actual) as Record<string, unknown> & {
    twiml?: unknown;
    validateRequest?: unknown;
    getExpectedTwilioSignature?: unknown;
  };
  const factory = Object.assign(
    function twilioFactory() {
      return {
        calls: { create: mocks.callsCreate },
        outgoingCallerIds: { list: mocks.outgoingList },
      };
    },
    real,
    {
      twiml: real.twiml,
      validateRequest: real.validateRequest,
      getExpectedTwilioSignature: real.getExpectedTwilioSignature,
    }
  );
  return { ...actual, default: factory };
});

import twilio from "twilio";
import {
  buildBridgeTwiml,
  goldlineTransportStatusFromCustomerLeg,
  handleBridgeTwiml,
  handleCallStatus,
} from "../salesCalls";
import {
  completeColdCallTarget,
  getColdCallRollingCall,
  rollColdCallTarget,
} from "./coldCallBurstService";

const input = {
  tenantId: "tenant-1",
  actorId: "adam-admin",
  batchId: "11111111-1111-4111-8111-111111111111",
  targetId: "22222222-2222-4222-8222-222222222222",
};

function fixture() {
  const targetRow = {
    id: input.targetId,
    batchId: input.batchId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    missionId: 11,
    accountId: 5,
    position: 0,
    status: "selected" as string,
    sourceReference: "commercial_account_contacts:9",
    callAttemptEventId: null as number | null,
    outcome: null as string | null,
    completedAt: null as Date | null,
  };
  const batchRow = {
    id: input.batchId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    status: "active" as string,
    combo: 0,
    completedCount: 0,
    totalTargets: 1,
    sourceReferencesJson: ["commercial_account_contacts:9"],
    createdAt: new Date("2026-09-23T00:00:00.000Z"),
    updatedAt: new Date("2026-09-23T00:00:00.000Z"),
  };
  const contact = {
    id: 9,
    phone: PROSPECT,
    source: "provider_sourced",
    preferredChannel: "phone",
  };
  const mission = {
    id: 11,
    status: "phone_ready",
    assignedTo: input.actorId,
    missionBriefJson: { openingLine: "Hello from the sourced brief." },
    createdAt: new Date("2026-09-23T00:00:00.000Z"),
  };
  const account = { id: 5, name: COMPANY };
  const attempts: Array<Record<string, unknown>> = [];
  const updates: Array<{ table: unknown; vals: Record<string, unknown> }> = [];
  let reads = 0;

  function rows(state: { table: unknown; joined: boolean }) {
    if (state.table === territoryOperatorProfiles) return [];
    if (state.table === commercialMissions) {
      return [
        {
          mission,
          account,
          contact,
          location: null,
          callEventId: null,
        },
      ];
    }
    if (state.table === driverColdCallBatches) return [batchRow];
    if (state.table === salesCallAttempts) return attempts;
    if (state.table === driverColdCallTargets && state.joined) {
      return [{ target: targetRow, mission, account, contact }];
    }
    if (state.table === driverColdCallTargets) return [targetRow];
    return [];
  }

  const db = {
    select() {
      reads += 1;
      const state = { table: null as unknown, joined: false };
      const self: Record<string, unknown> = {
        from(table: unknown) {
          state.table = table;
          return self;
        },
        innerJoin() {
          state.joined = true;
          return self;
        },
        leftJoin() {
          state.joined = true;
          return self;
        },
        where() {
          return self;
        },
        orderBy() {
          return self;
        },
        limit() {
          return Promise.resolve(rows(state).slice(0, 1));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(rows(state)).then(resolve, reject);
        },
      };
      return self;
    },
    insert(table: unknown) {
      return {
        values(vals: Record<string, unknown>) {
          if (table === salesCallAttempts) {
            attempts.unshift({
              id: 7,
              rewardGranted: false,
              recordingEnabled: false,
              status: "dialing_rep",
              failureReason: null,
              repLegCallSid: null,
              customerLegCallSid: null,
              customerLegDurationSec: null,
              ...vals,
            });
            return Promise.resolve([{ insertId: 7 }]);
          }
          return Promise.resolve([{ insertId: 1 }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(vals: Record<string, unknown>) {
          return {
            where() {
              updates.push({ table, vals });
              if (table === salesCallAttempts && attempts[0]) Object.assign(attempts[0], vals);
              if (table === driverColdCallTargets) Object.assign(targetRow, vals);
              if (table === driverColdCallBatches) Object.assign(batchRow, vals);
              return Promise.resolve();
            },
          };
        },
      };
    },
    transaction(fn: (tx: typeof db) => Promise<unknown>) {
      return fn(db);
    },
  };

  return { db, targetRow, contact, attempts, updates, get reads() { return reads; } };
}

let world: ReturnType<typeof fixture>;

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    type() {
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    send(body: unknown) {
      res.body = body;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function signedRequest(urlPath: string, body: Record<string, string>, params?: Record<string, string>) {
  const url = `https://admin.example.test${urlPath}`;
  const signature = twilio.getExpectedTwilioSignature("auth_test", url, body);
  return {
    headers: { "x-twilio-signature": signature },
    body,
    originalUrl: urlPath,
    protocol: "https",
    params: params ?? {},
    query: Object.fromEntries(new URL(url).searchParams.entries()),
    get(name: string) {
      return name.toLowerCase() === "host" ? "admin.example.test" : undefined;
    },
  } as unknown as Request;
}

beforeEach(() => {
  process.env.NODE_ENV = "production";
  world = fixture();
  mocks.getDb.mockImplementation(async () => world.db);
  mocks.authorizedOperatorPhone.mockClear();
  mocks.authorizedOperatorPhone.mockImplementation(async (value: { tenantId: string; actorId: string }) => {
    if (value.tenantId !== input.tenantId || value.actorId !== input.actorId) {
      throw new Error("refusing an unbound operator phone");
    }
    return OPERATOR;
  });
  mocks.claireTwilioFromNumber.mockReturnValue(CLAIRE_FROM);
  mocks.callsCreate.mockReset();
  mocks.callsCreate.mockResolvedValue({ sid: "CA_operator_leg" });
  mocks.outgoingList.mockReset();
  mocks.outgoingList.mockResolvedValue([{ phoneNumber: OPERATOR }]);
  mocks.recordCommercialMissionCallAttempt.mockReset();
  mocks.recordCommercialMissionCallAttempt.mockResolvedValue({
    id: 99,
    missionId: 11,
    outcome: "spoke",
    notes: "Spoke with the buyer.",
    actorId: input.actorId,
    createdAt: "2026-09-23T00:00:00.000Z",
  });
});

describe("Cold Call Burst operator-first roll", () => {
  it("resolves both numbers on the server and dials only the operator leg", async () => {
    const browserInput = { ...input };
    const batch = await rollColdCallTarget(browserInput);

    expect(browserInput).toEqual(input);
    expect(JSON.stringify(browserInput)).not.toContain(OPERATOR);
    expect(JSON.stringify(browserInput)).not.toContain(PROSPECT);
    expect(mocks.authorizedOperatorPhone).toHaveBeenCalledWith({
      tenantId: input.tenantId,
      actorId: input.actorId,
    });
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
    expect(mocks.callsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OPERATOR,
        from: CLAIRE_FROM,
        record: false,
        method: "POST",
      })
    );
    const created = mocks.callsCreate.mock.calls[0]?.[0] as { to: string; url: string };
    expect(created.to).not.toBe(PROSPECT);
    expect(created.url).toContain("/api/saleslay/twilio/bridge-twiml/7");
    expect(world.attempts[0]).toEqual(
      expect.objectContaining({
        coldCallTargetId: input.targetId,
        repPhone: OPERATOR,
        customerPhone: PROSPECT,
        callerId: OPERATOR,
        recordingEnabled: false,
        rewardGranted: false,
        status: "dialing_rep",
        repLegCallSid: "CA_operator_leg",
      })
    );
    expect(world.attempts[0]?.callerId).not.toBe(CLAIRE_FROM);
    expect(batch?.rollingCall).toEqual(
      expect.objectContaining({
        attemptId: 7,
        targetId: input.targetId,
        status: "dialing_rep",
        companyName: COMPANY,
        phoneNumber: PROSPECT,
      })
    );
    expect(batch?.targets[0]?.status).toBe("live");
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();

    const polled = await getColdCallRollingCall(input);
    expect(polled?.status).toBe("dialing_rep");
    expect(polled?.companyName).toBe(COMPANY);
    expect(polled?.phoneNumber).toBe(PROSPECT);

    await rollColdCallTarget(input);
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
  });

  it("does not dial when the owned target no longer has an eligible phone", async () => {
    world.contact.phone = "";
    await expect(rollColdCallTarget(input)).rejects.toThrow(/no longer eligible/);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(mocks.authorizedOperatorPhone).not.toHaveBeenCalled();
    expect(world.targetRow.status).toBe("selected");
  });

  it("fails closed when the personal caller ID is not verified", async () => {
    mocks.outgoingList.mockResolvedValue([]);
    await expect(rollColdCallTarget(input)).rejects.toThrow(COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(world.attempts).toHaveLength(0);
    expect(world.targetRow.status).toBe("selected");
    expect(world.updates.some(update => update.vals.status === "live")).toBe(false);
  });

  it("fails closed when Twilio cannot confirm the outgoing caller ID", async () => {
    mocks.outgoingList.mockRejectedValue(new Error("twilio unavailable"));
    await expect(rollColdCallTarget(input)).rejects.toThrow(COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
  });

  it("dials the prospect only from bridge TwiML fetched after the operator answers", async () => {
    await rollColdCallTarget(input);
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);

    const attempt = world.attempts[0] as {
      id: number;
      callerId: string;
      customerPhone: string;
      coldCallTargetId: string;
    };
    const xml = buildBridgeTwiml(attempt);
    expect(xml.indexOf("<Say")).toBeLessThan(xml.indexOf("<Dial"));
    expect(xml).toContain("Connecting your next call.");
    expect(xml).toContain(`callerId="${OPERATOR}"`);
    expect(xml).not.toContain(`callerId="${CLAIRE_FROM}"`);
    expect(xml).toContain(PROSPECT);
    expect(xml).toContain('record="do-not-record"');
    expect(xml).not.toContain("<Gather");
    expect(xml).not.toContain("<Record");

    const readsBefore = world.reads;
    const missing = mockRes();
    await handleBridgeTwiml(
      {
        headers: {},
        body: {},
        originalUrl: "/api/saleslay/twilio/bridge-twiml/7",
        protocol: "https",
        params: { attemptId: "7" },
        query: {},
        get: () => "admin.example.test",
      } as unknown as Request,
      missing as unknown as Response
    );
    expect(missing.statusCode).toBe(403);
    expect(String(missing.body)).not.toContain("<Dial");
    expect(String(missing.body)).not.toContain(PROSPECT);
    expect(world.reads).toBe(readsBefore);

    const invalid = mockRes();
    await handleBridgeTwiml(
      {
        headers: { "x-twilio-signature": "not-a-signature" },
        body: {},
        originalUrl: "/api/saleslay/twilio/bridge-twiml/7",
        protocol: "https",
        params: { attemptId: "7" },
        query: {},
        get: () => "admin.example.test",
      } as unknown as Request,
      invalid as unknown as Response
    );
    expect(invalid.statusCode).toBe(403);
    expect(String(invalid.body)).not.toContain("<Dial");
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);

    const valid = mockRes();
    await handleBridgeTwiml(
      signedRequest("/api/saleslay/twilio/bridge-twiml/7", {}, { attemptId: "7" }),
      valid as unknown as Response
    );
    expect(valid.statusCode).toBe(200);
    expect(String(valid.body)).toContain("<Dial");
    expect(String(valid.body)).toContain(PROSPECT);
    expect(String(valid.body)).toContain(`callerId="${OPERATOR}"`);
    expect(world.attempts[0]?.status).toBe("dialing_customer");
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps a long prospect connection from becoming a Goldline commercial outcome", async () => {
    expect(
      goldlineTransportStatusFromCustomerLeg({ callStatus: "completed", durationSec: 224 }).rewardGranted
    ).toBe(false);
    expect(
      goldlineTransportStatusFromCustomerLeg({ callStatus: "completed", durationSec: 5 }).rewardGranted
    ).toBe(false);

    world.attempts.unshift({
      id: 7,
      tenantId: input.tenantId,
      coldCallTargetId: input.targetId,
      status: "customer_connected",
      rewardGranted: false,
      recordingEnabled: false,
      customerPhone: PROSPECT,
      callerId: OPERATOR,
    });
    const res = mockRes();
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallStatus: "completed",
        CallDuration: "224",
      }),
      res as unknown as Response
    );
    expect(world.attempts[0]).toEqual(
      expect.objectContaining({
        status: "completed_success",
        rewardGranted: false,
        customerLegDurationSec: 224,
      })
    );
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();
    expect(world.targetRow.status).toBe("selected");
    expect(world.targetRow.outcome).toBeNull();

    world.targetRow.status = "live";
    const completed = await completeColdCallTarget({
      ...input,
      requestId: "33333333-3333-4333-8333-333333333333",
      outcome: "spoke",
      notes: "Spoke with the buyer.",
    });
    expect(mocks.recordCommercialMissionCallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: input.tenantId,
        actorId: input.actorId,
        missionId: 11,
        outcome: "spoke",
        notes: "Spoke with the buyer.",
      })
    );
    expect(completed?.targets[0]?.status).toBe("completed");
    expect(completed?.targets[0]?.outcome).toBe("spoke");
    expect(world.attempts[0]?.rewardGranted).toBe(false);
  });

  it("still applies the Saleslay 20-second reward only when the attempt is not a cold call", async () => {
    world.attempts.unshift({
      id: 8,
      tenantId: input.tenantId,
      coldCallTargetId: null,
      status: "customer_connected",
      rewardGranted: false,
    });
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=8&leg=customer", {
        CallStatus: "completed",
        CallDuration: "45",
      }),
      mockRes() as unknown as Response
    );
    expect(world.attempts[0]).toEqual(
      expect.objectContaining({
        status: "completed_success",
        rewardGranted: true,
        customerLegDurationSec: 45,
      })
    );
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();
  });
});

describe("Cold Call Burst client contract", () => {
  const ui = readFileSync(
    new URL("../../client/src/game/encounters/coldCall/ColdCallBurst.tsx", import.meta.url),
    "utf8"
  );
  const controller = readFileSync(
    new URL("../../client/src/pages/driver/GoldlineDriverController.tsx", import.meta.url),
    "utf8"
  );
  const router = readFileSync(new URL("./driverGameWorldRouter.ts", import.meta.url), "utf8");
  const salesCalls = readFileSync(new URL("../salesCalls.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../drizzle/0095_cold_call_attempt_link.sql", import.meta.url),
    "utf8"
  );
  const migrate = readFileSync(new URL("../../scripts/migrate.mjs", import.meta.url), "utf8");

  it("sends target identity only and has no tel fallback", () => {
    expect(ui).not.toMatch(/tel\s*:/);
    expect(ui).not.toContain("window.location");
    expect(ui).toContain("coldCallRollingStatusCopy");
    expect(ui).toContain("isColdCallRollingTerminal");
    expect(ui).toContain("This target no longer has an eligible sourced phone.");
    expect(ui).toContain("truthCompany");
    expect(ui).toContain("truthPhone");
    expect(ui).toContain("LIVE CALL · NO GAME TIMER");
    expect(ui).toContain("Combo timing is paused");

    const start = controller.slice(
      controller.indexOf("async function handleStartColdCall"),
      controller.indexOf("async function handlePollColdCall")
    );
    expect(start).toContain("batchId: batch.id");
    expect(start).toContain("targetId: target.id");
    expect(start).not.toMatch(/phone|callerId|repPhone|customerPhone/i);

    const poll = controller.slice(
      controller.indexOf("async function handlePollColdCall"),
      controller.indexOf("async function handleCompleteColdCall")
    );
    expect(poll).toContain("coldCallRollingCall.fetch");
    expect(poll).toContain("batchId: batch.id");
    expect(poll).toContain("targetId: target.id");
    expect(poll).not.toMatch(/phone|callerId/i);

    const procedure = router.slice(
      router.indexOf("startColdCallTarget:"),
      router.indexOf("coldCallRollingCall:")
    );
    expect(procedure).toContain("batchId: z.string().uuid()");
    expect(procedure).toContain("targetId: z.string().uuid()");
    expect(procedure).toContain("rollColdCallTarget");
    expect(procedure).toContain("ColdCallCallerIdUnverifiedError");
    expect(procedure).not.toMatch(/phone/i);
  });

  it("keeps provider truth, recording, and commercial outcome on their existing owners", () => {
    expect(salesCalls).toContain("isValidTwilioWebhook");
    expect(salesCalls).toContain("record: false");
    expect(salesCalls).toContain('record: "do-not-record"');
    expect(salesCalls).not.toContain("recordCommercialMissionCallAttempt");
    expect(salesCalls).not.toContain("completeColdCallTarget");
    expect(salesCalls).not.toContain("completeWeaponAction");
    expect(salesCalls).not.toContain("<Gather");
    expect(salesCalls).not.toContain("<Record");
    const service = readFileSync(new URL("./coldCallBurstService.ts", import.meta.url), "utf8");
    const roll = service.slice(
      service.indexOf("export async function rollColdCallTarget"),
      service.indexOf("export async function getColdCallRollingCall")
    );
    expect(roll).toContain("authorizedOperatorPhone");
    expect(roll).not.toContain("recordCommercialMissionCallAttempt");
    const complete = service.slice(service.indexOf("export async function completeColdCallTarget"));
    expect(complete).toContain("recordCommercialMissionCallAttempt");
    expect(migration).toContain("cold_call_target_id");
    expect(migrate).toContain("ADD COLUMN cold_call_target_id");
  });
});
