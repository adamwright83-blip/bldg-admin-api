import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commercialMissionEvents,
  communicationReceipts,
  driverColdCallTargets,
  salesCallAttempts,
} from "../../drizzle/schema";
import { ProspectLegNotConnectedError } from "../../shared/coldCallBurst";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getCommercialMission: vi.fn(),
  awardDriverSalesPoints: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("./commercialMissionStore", () => ({
  getCommercialMission: mocks.getCommercialMission,
}));
vi.mock("./driverSalesMotivationService", () => ({
  awardDriverSalesPoints: mocks.awardDriverSalesPoints,
}));

import { recordCommercialMissionCallAttempt } from "./commercialMissionCallService";

const TENANT = "tenant-1";
const MISSION = 11;
const TARGET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TARGET_OTHER_MISSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Row = Record<string, unknown>;

function chunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const value = chunk as { constructor?: { name?: string }; value?: unknown };
  if (value.constructor?.name === "StringChunk" && Array.isArray(value.value)) {
    return value.value.join("");
  }
  return "";
}

function rowField(row: Row, column: string): unknown {
  if (column in row) return row[column];
  const camel = column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return row[camel];
}

function comparison(node: unknown): { column: string; value: unknown } | null {
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return null;
  let column: string | null = null;
  let operator = "";
  for (const chunk of chunks) {
    const named = chunk as { name?: string; constructor?: { name?: string }; value?: unknown };
    if (typeof named?.name === "string" && named.constructor?.name !== "Param") {
      column = named.name;
      continue;
    }
    const text = chunkText(chunk);
    if (text.trim()) operator += text;
    if (named?.constructor?.name === "Param" && column && operator.includes("=")) {
      return { column, value: named.value };
    }
    const nested = comparison(chunk);
    if (nested) return nested;
  }
  return null;
}

function meaningfulChunks(node: unknown): unknown[] {
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks ?? [];
  return chunks.filter(chunk => {
    if ((chunk as { queryChunks?: unknown[] } | null)?.queryChunks) return true;
    const text = chunkText(chunk).trim();
    return text !== "(" && text !== ")" && text !== "";
  });
}

function splitOn(node: unknown, separator: "and" | "or"): unknown[] | null {
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return null;
  const groups: unknown[][] = [];
  let current: unknown[] = [];
  let found = false;
  for (const chunk of chunks) {
    const text = chunkText(chunk).trim().toLowerCase();
    if (text === separator) {
      found = true;
      if (current.length) groups.push(current);
      current = [];
      continue;
    }
    if (text === "(" || text === ")") continue;
    current.push(chunk);
  }
  if (current.length) groups.push(current);
  if (!found) return null;
  return groups.map(group => ({ queryChunks: group }));
}

function rowMatches(row: Row, predicate: unknown): boolean {
  const orGroups = splitOn(predicate, "or");
  if (orGroups) return orGroups.some(group => rowMatches(row, group));
  const andGroups = splitOn(predicate, "and");
  if (andGroups) return andGroups.every(group => rowMatches(row, group));
  const children = meaningfulChunks(predicate);
  if (children.length === 1 && (children[0] as { queryChunks?: unknown[] })?.queryChunks) {
    return rowMatches(row, children[0]);
  }
  const compared = comparison(predicate);
  if (!compared) return false;
  return rowField(row, compared.column) === compared.value;
}

function sqlText(node: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    const text = chunkText(value);
    if (text) parts.push(text);
    const chunks = (value as { queryChunks?: unknown[] } | null)?.queryChunks;
    if (Array.isArray(chunks)) for (const chunk of chunks) visit(chunk);
  };
  visit(node);
  return parts.join("");
}

function fakeDb(input: {
  attempts: Row[];
  targets: Row[];
  receipts: Row[];
  events: Row[];
}) {
  let nextEventId = 1;
  const db = {
    insert() {
      return {
        values(vals: Row) {
          return {
            onDuplicateKeyUpdate() {
              const duplicate = input.events.find(
                row => row.tenantId === vals.tenantId && row.idempotencyKey === vals.idempotencyKey
              );
              if (!duplicate) {
                input.events.push({
                  id: nextEventId++,
                  createdAt: new Date("2026-09-23T00:00:00.000Z"),
                  ...vals,
                });
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
    select() {
      let table: unknown = null;
      let predicate: unknown = null;
      let descending = false;
      let ordered = false;
      const rowsFor = () => {
        const source =
          table === salesCallAttempts
            ? input.attempts
            : table === driverColdCallTargets
              ? input.targets
              : table === communicationReceipts
                ? input.receipts
                : table === commercialMissionEvents
                  ? input.events
                  : [];
        let rows = predicate ? source.filter(row => rowMatches(row, predicate)) : source.slice();
        if (ordered) {
          rows = [...rows].sort((left, right) => {
            const delta = Number(left.id) - Number(right.id);
            return descending ? -delta : delta;
          });
        }
        return rows;
      };
      const api = {
        from(next: unknown) {
          table = next;
          return api;
        },
        innerJoin() {
          return api;
        },
        leftJoin() {
          return api;
        },
        where(next: unknown) {
          predicate = next;
          return api;
        },
        orderBy(...orders: unknown[]) {
          ordered = true;
          descending = orders.some(order => /desc/i.test(sqlText(order)));
          return api;
        },
        limit(count: number) {
          return Promise.resolve(rowsFor().slice(0, count));
        },
        then(resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(rowsFor()).then(resolve, reject);
        },
      };
      return api;
    },
  };
  return db;
}

function target(id: string, missionId: number, tenantId = TENANT): Row {
  return { id, tenantId, missionId };
}

function attempt(input: {
  id: number;
  tenantId?: string;
  coldCallTargetId: string;
  status: string;
  repLegCallSid: string;
  customerLegCallSid: string;
}): Row {
  return {
    id: input.id,
    tenantId: input.tenantId ?? TENANT,
    coldCallTargetId: input.coldCallTargetId,
    status: input.status,
    repLegCallSid: input.repLegCallSid,
    customerLegCallSid: input.customerLegCallSid,
    recordingEnabled: false,
    rewardGranted: false,
  };
}

function receipt(input: {
  tenantId?: string;
  eventType: string;
  callSid: string;
  parentCallSid?: string | null;
}): Row {
  return {
    id: `receipt-${input.callSid}-${input.eventType}`,
    tenantId: input.tenantId ?? TENANT,
    eventType: input.eventType,
    callSid: input.callSid,
    parentCallSid: input.parentCallSid ?? null,
  };
}

const baseLog = {
  tenantId: TENANT,
  missionId: MISSION,
  actorId: "adam-admin",
  notes: "Logged from the field.",
};

describe("legacy connected outcomes name one attempt", () => {
  const attempts: Row[] = [];
  const targets: Row[] = [];
  const receipts: Row[] = [];
  const events: Row[] = [];

  beforeEach(() => {
    attempts.splice(0, attempts.length);
    targets.splice(0, targets.length);
    receipts.splice(0, receipts.length);
    events.splice(0, events.length);
    targets.push(target(TARGET_A, MISSION), target(TARGET_B, MISSION), target(TARGET_OTHER_MISSION, 99));
    attempts.push(
      attempt({
        id: 1,
        coldCallTargetId: TARGET_A,
        status: "completed_no_connect",
        repLegCallSid: "CA_REP_A",
        customerLegCallSid: "CA_PROSPECT_A",
      }),
      attempt({
        id: 2,
        coldCallTargetId: TARGET_B,
        status: "completed_no_connect",
        repLegCallSid: "CA_REP_B",
        customerLegCallSid: "CA_PROSPECT_B",
      }),
      attempt({
        id: 8,
        coldCallTargetId: TARGET_OTHER_MISSION,
        status: "customer_connected",
        repLegCallSid: "CA_REP_OTHER_MISSION",
        customerLegCallSid: "CA_PROSPECT_OTHER_MISSION",
      }),
      attempt({
        id: 9,
        tenantId: "other-tenant",
        coldCallTargetId: TARGET_A,
        status: "customer_connected",
        repLegCallSid: "CA_REP_OTHER_TENANT",
        customerLegCallSid: "CA_PROSPECT_OTHER_TENANT",
      })
    );
    receipts.push(
      receipt({ eventType: "CALL_CONNECTED", callSid: "CA_PROSPECT_A", parentCallSid: "CA_REP_A" }),
      receipt({ eventType: "CALL_CONNECTED", callSid: "CA_REP_B" }),
      receipt({
        tenantId: "other-tenant",
        eventType: "CALL_CONNECTED",
        callSid: "CA_PROSPECT_B",
        parentCallSid: "CA_REP_B",
      })
    );
    mocks.getDb.mockReset();
    mocks.getDb.mockImplementation(async () => fakeDb({ attempts, targets, receipts, events }));
    mocks.getCommercialMission.mockReset();
    mocks.getCommercialMission.mockResolvedValue({ id: MISSION, status: "phone_ready" });
    mocks.awardDriverSalesPoints.mockReset();
    mocks.awardDriverSalesPoints.mockResolvedValue(undefined);
  });

  it("rejects unbound spoke and visit_booked even when an earlier attempt connected", async () => {
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "11111111-1111-4111-8111-111111111111",
        outcome: "spoke",
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "11111111-1111-4111-8111-111111111112",
        outcome: "visit_booked",
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(events).toHaveLength(0);
    expect(mocks.awardDriverSalesPoints).not.toHaveBeenCalled();
    expect(attempts.every(row => row.recordingEnabled === false)).toBe(true);
  });

  it("rejects spoke for the later unconnected attempt and does not borrow the earlier one", async () => {
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "22222222-2222-4222-8222-222222222222",
        outcome: "spoke",
        salesCallAttemptId: 2,
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "22222222-2222-4222-8222-222222222223",
        outcome: "visit_booked",
        coldCallTargetId: TARGET_B,
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(events).toHaveLength(0);
  });

  it("accepts spoke and visit_booked for the exact connected attempt and names its prospect leg", async () => {
    const spoke = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "33333333-3333-4333-8333-333333333333",
      outcome: "spoke",
      salesCallAttemptId: 1,
    });
    expect(spoke.outcome).toBe("spoke");
    expect(spoke.transportEvidence).toEqual({
      tenantId: TENANT,
      missionId: MISSION,
      coldCallTargetId: TARGET_A,
      salesCallAttemptId: 1,
      prospectLegCallSid: "CA_PROSPECT_A",
    });
    expect(mocks.awardDriverSalesPoints).toHaveBeenCalledWith(
      expect.objectContaining({ points: 10, metadata: { outcome: "spoke" } })
    );

    const booked = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "33333333-3333-4333-8333-333333333334",
      outcome: "visit_booked",
      salesCallAttemptId: 1,
    });
    expect(booked.outcome).toBe("visit_booked");
    expect(booked.transportEvidence?.salesCallAttemptId).toBe(1);
    expect(booked.transportEvidence?.prospectLegCallSid).toBe("CA_PROSPECT_A");
    expect(events).toHaveLength(2);
  });

  it("replays the same request id without a second row or an upgraded outcome", async () => {
    const first = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "44444444-4444-4444-8444-444444444444",
      outcome: "spoke",
      salesCallAttemptId: 1,
    });
    const replay = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "44444444-4444-4444-8444-444444444444",
      outcome: "visit_booked",
    });
    expect(replay.id).toBe(first.id);
    expect(replay.outcome).toBe("spoke");
    expect(replay.transportEvidence).toEqual(first.transportEvidence);
    expect(events).toHaveLength(1);
    expect(mocks.awardDriverSalesPoints).toHaveBeenLastCalledWith(
      expect.objectContaining({
        points: 10,
        metadata: { outcome: "spoke" },
        dedupeKey: "score:cold-call:44444444-4444-4444-8444-444444444444",
      })
    );
  });

  it("rejects a cross-tenant attempt id and an attempt from another mission", async () => {
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "55555555-5555-4555-8555-555555555555",
        outcome: "spoke",
        salesCallAttemptId: 9,
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "55555555-5555-4555-8555-555555555556",
        outcome: "visit_booked",
        salesCallAttemptId: 8,
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(events).toHaveLength(0);
    expect(mocks.awardDriverSalesPoints).not.toHaveBeenCalled();
  });

  it("still records no_answer and voicemail without a connected attempt", async () => {
    const missed = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "66666666-6666-4666-8666-666666666666",
      outcome: "no_answer",
    });
    expect(missed.outcome).toBe("no_answer");
    expect(missed.transportEvidence).toBeNull();
    const voicemail = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "66666666-6666-4666-8666-666666666667",
      outcome: "left_voicemail",
    });
    expect(voicemail.outcome).toBe("left_voicemail");
    expect(voicemail.transportEvidence).toBeNull();
    expect(mocks.awardDriverSalesPoints).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ points: 4, metadata: { outcome: "no_answer" } })
    );
    expect(mocks.awardDriverSalesPoints).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ points: 2, metadata: { outcome: "left_voicemail" } })
    );
  });

  it("does not let Cold Call Burst borrow an older connected attempt on the same target", async () => {
    attempts.push(
      attempt({
        id: 3,
        coldCallTargetId: TARGET_A,
        status: "completed_no_connect",
        repLegCallSid: "CA_REP_A_REDIAL",
        customerLegCallSid: "CA_PROSPECT_A_REDIAL",
      })
    );
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "77777777-7777-4777-8777-777777777777",
        outcome: "spoke",
        coldCallTargetId: TARGET_A,
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(events).toHaveLength(0);
  });

  it("does not treat completed_success alone as that attempt's prospect leg", async () => {
    attempts.push(
      attempt({
        id: 10,
        coldCallTargetId: TARGET_B,
        status: "completed_success",
        repLegCallSid: "CA_REP_SUCCESS",
        customerLegCallSid: "CA_PROSPECT_SUCCESS",
      })
    );
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
        outcome: "spoke",
        salesCallAttemptId: 10,
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(events).toHaveLength(0);
  });

  it("accepts a Cold Call Burst spoke only for that target's connected attempt", async () => {
    const spoke = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "88888888-8888-4888-8888-888888888888",
      outcome: "spoke",
      coldCallTargetId: TARGET_A,
    });
    expect(spoke.transportEvidence).toEqual({
      tenantId: TENANT,
      missionId: MISSION,
      coldCallTargetId: TARGET_A,
      salesCallAttemptId: 1,
      prospectLegCallSid: "CA_PROSPECT_A",
    });
  });
});

describe("a connected latest attempt is not legacy authorization", () => {
  const attempts: Row[] = [];
  const targets: Row[] = [];
  const events: Row[] = [];

  beforeEach(() => {
    attempts.splice(0, attempts.length);
    targets.splice(0, targets.length);
    events.splice(0, events.length);
    targets.push(target(TARGET_A, MISSION));
    attempts.push(
      attempt({
        id: 1,
        coldCallTargetId: TARGET_A,
        status: "completed_no_connect",
        repLegCallSid: "CA_REP_OLD",
        customerLegCallSid: "CA_PROSPECT_OLD",
      }),
      attempt({
        id: 4,
        coldCallTargetId: TARGET_A,
        status: "customer_connected",
        repLegCallSid: "CA_REP_LIVE",
        customerLegCallSid: "CA_PROSPECT_LIVE",
      })
    );
    mocks.getDb.mockReset();
    mocks.getDb.mockImplementation(async () =>
      fakeDb({ attempts, targets, receipts: [], events })
    );
    mocks.getCommercialMission.mockResolvedValue({ id: MISSION, status: "phone_ready" });
    mocks.awardDriverSalesPoints.mockReset();
    mocks.awardDriverSalesPoints.mockResolvedValue(undefined);
  });

  it("rejects unbound spoke when the mission's latest attempt is connected", async () => {
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "99999999-9999-4999-8999-999999999999",
        outcome: "spoke",
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(events).toHaveLength(0);
  });

  it("accepts spoke only when that latest connected attempt is named", async () => {
    await expect(
      recordCommercialMissionCallAttempt({
        ...baseLog,
        requestId: "99999999-9999-4999-8999-999999999998",
        outcome: "spoke",
        salesCallAttemptId: 1,
      })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    const spoke = await recordCommercialMissionCallAttempt({
      ...baseLog,
      requestId: "99999999-9999-4999-8999-999999999997",
      outcome: "spoke",
      salesCallAttemptId: 4,
    });
    expect(spoke.transportEvidence).toEqual({
      tenantId: TENANT,
      missionId: MISSION,
      coldCallTargetId: TARGET_A,
      salesCallAttemptId: 4,
      prospectLegCallSid: "CA_PROSPECT_LIVE",
    });
  });
});
