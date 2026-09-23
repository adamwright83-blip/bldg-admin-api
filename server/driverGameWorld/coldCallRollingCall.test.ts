import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commercialAccountContacts,
  commercialMissions,
  communicationReceipts,
  driverColdCallBatches,
  driverColdCallTargets,
  salesCallAttempts,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import {
  COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE,
  ProspectLegNotConnectedError,
} from "../../shared/coldCallBurst";

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
import { loadClaireCommunicationsContext } from "../claire/communicationsContextPort";
import {
  COLD_CALL_ROLL_RECOVERY_BOUND_MS,
  COLD_CALL_STALE_DIALING_REP_REASON,
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
    contactId: 9 as number | null,
    rollClaimId: null as string | null,
    position: 0,
    status: "selected" as string,
    sourceReference: "commercial_account_contacts:9",
    callAttemptEventId: null as number | null,
    outcome: null as string | null,
    completedAt: null as Date | null,
    updatedAt: new Date(),
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
  const contacts = [contact];
  const mission = {
    id: 11,
    status: "phone_ready",
    assignedTo: input.actorId,
    missionBriefJson: { openingLine: "Hello from the sourced brief." },
    createdAt: new Date("2026-09-23T00:00:00.000Z"),
  };
  const account = { id: 5, name: COMPANY };
  const attempts: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const updates: Array<{ table: unknown; vals: Record<string, unknown> }> = [];
  let reads = 0;

  function rows(state: { table: unknown; joined: boolean }) {
    if (state.table === territoryOperatorProfiles) return [];
    if (state.table === commercialMissions) {
      return contacts.map(item => ({
        mission,
        account,
        contact: item,
        location: null,
        callEventId: null,
      }));
    }
    if (state.table === commercialAccountContacts) {
      const pinned = contacts.find(item => item.id === targetRow.contactId);
      return pinned
        ? [{ contact: pinned, mission, account, location: null, callEventId: null }]
        : [];
    }
    if (state.table === driverColdCallBatches) return [batchRow];
    if (state.table === salesCallAttempts) return attempts;
    if (state.table === driverColdCallTargets && state.joined) {
      return contacts.map(item => ({ target: targetRow, mission, account, contact: item }));
    }
    if (state.table === driverColdCallTargets) return [targetRow];
    if (state.table === communicationReceipts) return receipts;
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
        limit(count?: number) {
          const size = typeof count === "number" ? count : 1;
          return Promise.resolve(rows(state).slice(0, size));
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
              createdAt: new Date(),
              ...vals,
            });
            return Promise.resolve([{ insertId: 7 }]);
          }
          if (table === communicationReceipts) {
            if (receipts.some(row => row.idempotencyKey === vals.idempotencyKey)) {
              const error = new Error("duplicate entry") as Error & { code?: string };
              error.code = "ER_DUP_ENTRY";
              return Promise.reject(error);
            }
            receipts.push(vals);
            return Promise.resolve([{ insertId: 0 }]);
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
              if (table === salesCallAttempts) {
                const recovery =
                  vals.status === "failed" &&
                  vals.failureReason === COLD_CALL_STALE_DIALING_REP_REASON;
                if (recovery) {
                  const stale = attempts.find(
                    item => item.status === "dialing_rep" && !item.repLegCallSid
                  );
                  if (!stale) return Promise.resolve([{ affectedRows: 0 }]);
                  Object.assign(stale, vals);
                  return Promise.resolve([{ affectedRows: 1 }]);
                }
                if (
                  attempts[0] &&
                  Object.keys(vals).length === 1 &&
                  Object.prototype.hasOwnProperty.call(vals, "repLegCallSid") &&
                  attempts[0].repLegCallSid
                ) {
                  return Promise.resolve([{ affectedRows: 0 }]);
                }
                if (attempts[0]) Object.assign(attempts[0], vals);
              }
              if (table === driverColdCallTargets) {
                const nextClaim = Object.prototype.hasOwnProperty.call(vals, "rollClaimId")
                  ? vals.rollClaimId
                  : undefined;
                if (typeof nextClaim === "string" && nextClaim) {
                  const takeover = Object.prototype.hasOwnProperty.call(vals, "updatedAt");
                  if (!targetRow.rollClaimId) {
                    Object.assign(targetRow, vals);
                    if (!takeover) targetRow.updatedAt = new Date();
                    return Promise.resolve([{ affectedRows: 1 }]);
                  }
                  const updatedMs =
                    targetRow.updatedAt instanceof Date ? targetRow.updatedAt.getTime() : Number.NaN;
                  const stale =
                    Number.isFinite(updatedMs) &&
                    updatedMs < Date.now() - COLD_CALL_ROLL_RECOVERY_BOUND_MS;
                  if (takeover && stale) {
                    Object.assign(targetRow, vals);
                    return Promise.resolve([{ affectedRows: 1 }]);
                  }
                  return Promise.resolve([{ affectedRows: 0 }]);
                }
                Object.assign(targetRow, vals);
                return Promise.resolve([{ affectedRows: 1 }]);
              }
              if (table === driverColdCallBatches) Object.assign(batchRow, vals);
              return Promise.resolve([{ affectedRows: 1 }]);
            },
          };
        },
      };
    },
    transaction(fn: (tx: typeof db) => Promise<unknown>) {
      return fn(db);
    },
  };

  return {
    db,
    targetRow,
    contact,
    contacts,
    attempts,
    receipts,
    updates,
    get reads() {
      return reads;
    },
  };
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

function olderThanRecoveryBound(): Date {
  return new Date(Date.now() - COLD_CALL_ROLL_RECOVERY_BOUND_MS - 5_000);
}

beforeEach(() => {
  process.env.NODE_ENV = "production";
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "mysql://cold-call-fixture";
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
    expect(world.targetRow.rollClaimId).toBeNull();
  });

  it("lets one of two concurrent rolls dial", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let started = 0;
    mocks.callsCreate.mockImplementation(async () => {
      started += 1;
      await gate;
      return { sid: "CA_operator_leg" };
    });

    const pending = Promise.all([rollColdCallTarget(input), rollColdCallTarget(input)]);
    await vi.waitFor(() => expect(started).toBe(1));
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
    expect(started).toBe(1);
    expect(world.attempts).toHaveLength(1);
    expect(world.attempts[0]?.customerPhone).toBe(PROSPECT);
  });

  it("dials the pinned contact instead of another contact on the mission", async () => {
    const sibling = {
      id: 9,
      phone: "+13105550999",
      source: "provider_sourced",
      preferredChannel: "phone",
    };
    const pinned = {
      id: 10,
      phone: PROSPECT,
      source: "provider_sourced",
      preferredChannel: "phone",
    };
    world.contacts.splice(0, world.contacts.length, sibling, pinned);
    world.targetRow.contactId = 10;
    world.targetRow.sourceReference = "commercial_account_contacts:10";

    const batch = await rollColdCallTarget(input);
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
    expect(world.attempts[0]?.customerPhone).toBe(PROSPECT);
    expect(world.attempts[0]?.customerPhone).not.toBe(sibling.phone);
    expect(batch?.targets).toHaveLength(1);
    expect(batch?.targets[0]?.phoneNumber).toBe(PROSPECT);
    expect(batch?.rollingCall?.phoneNumber).toBe(PROSPECT);
    expect(batch?.targets[0]?.sourceReference).toBe("commercial_account_contacts:10");
  });

  it("refuses the pinned contact when it is ineligible even if a sibling can be called", async () => {
    const sibling = {
      id: 9,
      phone: "+13105550999",
      source: "provider_sourced",
      preferredChannel: "phone",
    };
    const pinned = {
      id: 10,
      phone: PROSPECT,
      source: "provider_sourced",
      preferredChannel: "email",
    };
    world.contacts.splice(0, world.contacts.length, sibling, pinned);
    world.targetRow.contactId = 10;
    world.targetRow.sourceReference = "commercial_account_contacts:10";

    await expect(rollColdCallTarget(input)).rejects.toThrow(/no longer eligible/);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(mocks.authorizedOperatorPhone).not.toHaveBeenCalled();
    expect(world.attempts).toHaveLength(0);
    expect(world.attempts.some(attempt => attempt.customerPhone === sibling.phone)).toBe(false);
    expect(world.targetRow.rollClaimId).toBeNull();
    expect(world.targetRow.status).toBe("selected");
  });

  it("reclaims a stale claim with no attempt and dials once", async () => {
    world.targetRow.rollClaimId = "stale-claim";
    world.targetRow.updatedAt = olderThanRecoveryBound();
    await rollColdCallTarget(input);
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
    expect(world.attempts.filter(item => item.repLegCallSid === "CA_operator_leg")).toHaveLength(1);

    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    world.targetRow.rollClaimId = "stale-claim-2";
    world.targetRow.updatedAt = olderThanRecoveryBound();
    world.targetRow.status = "selected";
    world.attempts.splice(0, world.attempts.length);
    let started = 0;
    mocks.callsCreate.mockImplementation(async () => {
      started += 1;
      await gate;
      return { sid: "CA_recovered" };
    });
    const pending = Promise.all([rollColdCallTarget(input), rollColdCallTarget(input)]);
    await vi.waitFor(() => expect(started).toBe(1));
    release();
    await pending;
    expect(started).toBe(1);
    expect(mocks.callsCreate).toHaveBeenCalledTimes(2);
  });

  it("repairs a lost operator SID from initiated or ringing and does not redial", async () => {
    const lostSid = {
      id: 7,
      tenantId: input.tenantId,
      coldCallTargetId: input.targetId,
      status: "dialing_rep",
      repLegCallSid: null as string | null,
      rewardGranted: false,
      callerId: OPERATOR,
      customerPhone: PROSPECT,
      repPhone: OPERATOR,
      createdAt: olderThanRecoveryBound(),
    };
    world.attempts.unshift({ ...lostSid });
    world.targetRow.status = "live";
    world.targetRow.rollClaimId = "lost-sid-claim";
    world.targetRow.updatedAt = olderThanRecoveryBound();

    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=rep", {
        CallSid: "CA_repaired_initiated",
        CallStatus: "initiated",
        From: CLAIRE_FROM,
        To: OPERATOR,
      }),
      mockRes() as unknown as Response
    );
    expect(world.attempts[0]?.repLegCallSid).toBe("CA_repaired_initiated");
    expect(world.attempts[0]?.status).toBe("dialing_rep");
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=rep", {
        CallSid: "CA_should_not_replace",
        CallStatus: "ringing",
        From: CLAIRE_FROM,
        To: OPERATOR,
      }),
      mockRes() as unknown as Response
    );
    expect(world.attempts[0]?.repLegCallSid).toBe("CA_repaired_initiated");

    await rollColdCallTarget(input);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();
    expect(world.targetRow.outcome).toBeNull();

    world.attempts.splice(0, world.attempts.length, { ...lostSid, repLegCallSid: null });
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=rep", {
        CallSid: "CA_repaired_ringing",
        CallStatus: "ringing",
        From: CLAIRE_FROM,
        To: OPERATOR,
      }),
      mockRes() as unknown as Response
    );
    expect(world.attempts[0]?.repLegCallSid).toBe("CA_repaired_ringing");
    expect(world.attempts[0]?.status).toBe("dialing_rep");
    await rollColdCallTarget(input);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
  });

  it("reclaims one stale dialing_rep row that never received a provider SID", async () => {
    expect(world.receipts).toHaveLength(0);
    world.attempts.unshift({
      id: 4,
      tenantId: input.tenantId,
      coldCallTargetId: input.targetId,
      status: "dialing_rep",
      repLegCallSid: null,
      rewardGranted: false,
      callerId: OPERATOR,
      customerPhone: PROSPECT,
      createdAt: olderThanRecoveryBound(),
    });
    world.targetRow.rollClaimId = "stale-claim";
    world.targetRow.updatedAt = olderThanRecoveryBound();
    await rollColdCallTarget(input);
    expect(mocks.callsCreate).toHaveBeenCalledTimes(1);
    expect(world.attempts.find(item => item.id === 4)?.status).toBe("failed");
    expect(world.attempts.find(item => item.id === 4)?.failureReason).toBe(
      COLD_CALL_STALE_DIALING_REP_REASON
    );
    expect(world.attempts.filter(item => item.repLegCallSid === "CA_operator_leg")).toHaveLength(1);

    world.attempts.splice(0, world.attempts.length, {
      id: 4,
      tenantId: input.tenantId,
      coldCallTargetId: input.targetId,
      status: "dialing_rep",
      repLegCallSid: null,
      rewardGranted: false,
      callerId: OPERATOR,
      customerPhone: PROSPECT,
      createdAt: olderThanRecoveryBound(),
    });
    world.targetRow.rollClaimId = "stale-claim";
    world.targetRow.status = "selected";
    world.targetRow.updatedAt = olderThanRecoveryBound();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let started = 0;
    mocks.callsCreate.mockImplementation(async () => {
      started += 1;
      await gate;
      return { sid: "CA_recovered" };
    });
    const pending = Promise.all([rollColdCallTarget(input), rollColdCallTarget(input)]);
    await vi.waitFor(() => expect(started).toBe(1));
    release();
    await pending;
    expect(started).toBe(1);
  });

  it("does not steal a live claim or a provider leg that is already established", async () => {
    world.targetRow.rollClaimId = "live-claim";
    world.targetRow.updatedAt = new Date();
    await rollColdCallTarget(input);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(world.targetRow.rollClaimId).toBe("live-claim");

    world.attempts.unshift({
      id: 4,
      tenantId: input.tenantId,
      coldCallTargetId: input.targetId,
      status: "dialing_rep",
      repLegCallSid: null,
      rewardGranted: false,
      createdAt: new Date(),
    });
    await rollColdCallTarget(input);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(world.attempts[0]?.status).toBe("dialing_rep");

    world.attempts[0] = {
      id: 4,
      tenantId: input.tenantId,
      coldCallTargetId: input.targetId,
      status: "dialing_rep",
      repLegCallSid: "CA_live",
      rewardGranted: false,
      createdAt: olderThanRecoveryBound(),
    };
    await rollColdCallTarget(input);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(world.attempts[0]?.repLegCallSid).toBe("CA_live");
    expect(world.attempts[0]?.status).toBe("dialing_rep");
  });

  it("writes operator and prospect provider receipts without a commercial outcome", async () => {
    await rollColdCallTarget(input);
    const ringing = signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=rep", {
      CallSid: "CA_operator_leg",
      CallStatus: "ringing",
      From: CLAIRE_FROM,
      To: OPERATOR,
    });
    await handleCallStatus(ringing, mockRes() as unknown as Response);
    await handleCallStatus(ringing, mockRes() as unknown as Response);
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "completed",
        CallDuration: "224",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=rep", {
        CallSid: "CA_operator_leg",
        CallStatus: "no-answer",
        From: CLAIRE_FROM,
        To: OPERATOR,
      }),
      mockRes() as unknown as Response
    );

    const events = world.receipts.map(row => row.eventType);
    expect(events).toContain("CALL_ATTEMPTED");
    expect(events).toContain("CALL_RINGING");
    expect(events).toContain("CALL_COMPLETED");
    expect(events).toContain("CALL_NO_ANSWER");
    expect(events.filter(event => event === "CALL_RINGING")).toHaveLength(1);
    expect(events.some(event => String(event).startsWith("MESSAGE_"))).toBe(false);
    expect(world.receipts.every(row => row.direction === "outbound")).toBe(true);
    expect(world.receipts.find(row => row.eventType === "CALL_COMPLETED")?.parentCallSid).toBe(
      "CA_operator_leg"
    );
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();
    expect(world.targetRow.outcome).toBeNull();
    expect(world.targetRow.status).not.toBe("completed");

    const context = await loadClaireCommunicationsContext({
      tenantId: input.tenantId,
      operatorUserId: input.actorId,
    });
    expect(context.access).toBe("read_only");
    expect(context.impliesBusinessOutcome).toBe(false);
    const concepts = context.evidence.map(item => item.concept);
    expect(concepts).toContain("CALL_RINGING");
    expect(concepts).toContain("CALL_COMPLETED");
    expect(context.evidence.every(item => item.goldlineEntityId === null)).toBe(true);
  });

  it("fails closed when the personal caller ID is not verified", async () => {
    mocks.outgoingList.mockResolvedValue([]);
    await expect(rollColdCallTarget(input)).rejects.toThrow(COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE);
    expect(mocks.callsCreate).not.toHaveBeenCalled();
    expect(world.attempts).toHaveLength(0);
    expect(world.targetRow.status).toBe("selected");
    expect(world.targetRow.rollClaimId).toBeNull();
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
      goldlineTransportStatusFromCustomerLeg({ callStatus: "completed", durationSec: 224 })
    ).toEqual({
      status: "completed_no_connect",
      rewardGranted: false,
      failureReason: "customer_leg_completed_224s",
    });
    expect(
      goldlineTransportStatusFromCustomerLeg({
        callStatus: "completed",
        durationSec: 224,
        prospectLegConnected: true,
      })
    ).toEqual({
      status: "completed_success",
      rewardGranted: false,
      failureReason: null,
    });
    expect(
      goldlineTransportStatusFromCustomerLeg({ callStatus: "no-answer", durationSec: 0 })
    ).toMatchObject({ status: "completed_no_connect", rewardGranted: false });
    expect(
      goldlineTransportStatusFromCustomerLeg({ callStatus: "busy", durationSec: 0 })
    ).toMatchObject({ status: "completed_no_connect", rewardGranted: false });
    expect(
      goldlineTransportStatusFromCustomerLeg({ callStatus: "failed", durationSec: 0 })
    ).toMatchObject({ status: "completed_no_connect", rewardGranted: false });

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
    expect(world.attempts[0]?.recordingEnabled).toBe(false);
  });

  it("refuses spoke when the rep answers and the prospect never does", async () => {
    await rollColdCallTarget(input);
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=rep", {
        CallSid: "CA_operator_leg",
        CallStatus: "in-progress",
        From: CLAIRE_FROM,
        To: OPERATOR,
      }),
      mockRes() as unknown as Response
    );
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "no-answer",
        CallDuration: "0",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    expect(world.attempts[0]?.status).toBe("completed_no_connect");
    expect(world.attempts[0]?.recordingEnabled).toBe(false);
    await expect(
      completeColdCallTarget({
        ...input,
        requestId: "44444444-4444-4444-8444-444444444444",
        outcome: "spoke",
        notes: "They picked up.",
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();
    expect(world.targetRow.status).toBe("live");
    expect(world.targetRow.outcome).toBeNull();

    const logged = await completeColdCallTarget({
      ...input,
      requestId: "55555555-5555-4555-8555-555555555555",
      outcome: "no_answer",
      notes: "Prospect never answered.",
    });
    expect(mocks.recordCommercialMissionCallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "no_answer" })
    );
    expect(logged?.targets[0]?.outcome).toBe("no_answer");
  });

  it("refuses spoke while the prospect is only ringing", async () => {
    await rollColdCallTarget(input);
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "ringing",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    expect(world.receipts.some(row => row.eventType === "CALL_RINGING")).toBe(true);
    expect(world.receipts.some(row => row.eventType === "CALL_CONNECTED")).toBe(false);
    await expect(
      completeColdCallTarget({
        ...input,
        requestId: "66666666-6666-4666-8666-666666666666",
        outcome: "spoke",
        notes: "Still ringing.",
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();
    expect(world.targetRow.outcome).toBeNull();
  });

  it("refuses spoke when a long completed callback never showed the prospect connect", async () => {
    await rollColdCallTarget(input);
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "completed",
        CallDuration: "224",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    expect(world.attempts[0]?.status).toBe("completed_no_connect");
    expect(world.receipts.some(row => row.eventType === "CALL_COMPLETED")).toBe(true);
    expect(world.receipts.some(row => row.eventType === "CALL_CONNECTED")).toBe(false);
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();
    await expect(
      completeColdCallTarget({
        ...input,
        requestId: "77777777-7777-4777-8777-777777777777",
        outcome: "visit_booked",
        notes: "Booked from a completed transport status.",
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(world.targetRow.status).toBe("live");
  });

  it("allows spoke and visit_booked only after the prospect leg connects", async () => {
    await rollColdCallTarget(input);
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "answered",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "answered",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    expect(world.receipts.filter(row => row.eventType === "CALL_CONNECTED")).toHaveLength(1);
    expect(world.attempts[0]?.status).toBe("customer_connected");
    expect(world.attempts[0]?.recordingEnabled).toBe(false);
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "completed",
        CallDuration: "40",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    expect(world.attempts[0]).toEqual(
      expect.objectContaining({
        status: "completed_success",
        rewardGranted: false,
        recordingEnabled: false,
      })
    );
    expect(mocks.recordCommercialMissionCallAttempt).not.toHaveBeenCalled();

    mocks.recordCommercialMissionCallAttempt.mockResolvedValueOnce({
      id: 100,
      missionId: 11,
      outcome: "visit_booked",
      notes: "Thursday at the property.",
      actorId: input.actorId,
      createdAt: "2026-09-23T00:00:00.000Z",
    });
    const booked = await completeColdCallTarget({
      ...input,
      requestId: "88888888-8888-4888-8888-888888888888",
      outcome: "visit_booked",
      notes: "Thursday at the property.",
    });
    expect(mocks.recordCommercialMissionCallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "visit_booked" })
    );
    expect(booked?.targets[0]?.outcome).toBe("visit_booked");
    expect(world.attempts[0]?.rewardGranted).toBe(false);
  });

  it("still records voicemail, busy, and failed without turning them into a connected conversation", async () => {
    await rollColdCallTarget(input);
    await handleCallStatus(
      signedRequest("/api/saleslay/twilio/call-status?attemptId=7&leg=customer", {
        CallSid: "CA_prospect_leg",
        CallStatus: "busy",
        From: OPERATOR,
        To: PROSPECT,
      }),
      mockRes() as unknown as Response
    );
    expect(world.receipts.some(row => row.eventType === "CALL_BUSY")).toBe(true);
    const voicemail = await completeColdCallTarget({
      ...input,
      requestId: "99999999-9999-4999-8999-999999999999",
      outcome: "left_voicemail",
      notes: "Left a voicemail.",
    });
    expect(mocks.recordCommercialMissionCallAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "left_voicemail" })
    );
    expect(voicemail?.targets[0]?.outcome).toBe("left_voicemail");
    expect(world.attempts[0]?.rewardGranted).toBe(false);
    expect(world.attempts[0]?.recordingEnabled).toBe(false);
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
    const contactMigration = readFileSync(
      new URL("../../drizzle/0096_cold_call_target_contact.sql", import.meta.url),
      "utf8"
    );
    expect(contactMigration).toContain("contactId");
    expect(contactMigration).toContain("rollClaimId");
    expect(contactMigration).toContain("commercial_account_contacts:%");
    expect(migrate).toContain("ADD COLUMN contactId");
    expect(migrate).toContain("ADD COLUMN rollClaimId");
    expect(roll).toContain("claimColdCallRoll");
    expect(roll).toContain("loadPinnedColdCallContact");
    expect(roll).not.toContain("eligibleColdCallRows");
  });
});
