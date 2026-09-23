import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProspectLegNotConnectedError } from "../../shared/coldCallBurst";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getCommercialMission: vi.fn(),
  awardDriverSalesPoints: vi.fn(),
  assertMissionConversationOutcome: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("./commercialMissionStore", () => ({
  getCommercialMission: mocks.getCommercialMission,
}));
vi.mock("./driverSalesMotivationService", () => ({
  awardDriverSalesPoints: mocks.awardDriverSalesPoints,
}));
vi.mock("../salesCalls", () => ({
  assertMissionConversationOutcome: mocks.assertMissionConversationOutcome,
}));

import { recordCommercialMissionCallAttempt } from "./commercialMissionCallService";

const input = {
  tenantId: "tenant-1",
  missionId: 11,
  actorId: "adam-admin",
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  notes: "Logged from the field.",
};

function eventDb() {
  const events: Array<Record<string, unknown>> = [];
  let id = 1;
  const db = {
    insert() {
      return {
        values(vals: Record<string, unknown>) {
          return {
            onDuplicateKeyUpdate() {
              const duplicate = events.find(
                row => row.tenantId === vals.tenantId && row.idempotencyKey === vals.idempotencyKey
              );
              if (!duplicate) {
                events.push({
                  id: id++,
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
      const self = {
        from() {
          return self;
        },
        where() {
          return self;
        },
        orderBy() {
          return self;
        },
        limit() {
          return Promise.resolve(events.slice(0, 1));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(events).then(resolve, reject);
        },
      };
      return self;
    },
  };
  return { db, events };
}

let world: ReturnType<typeof eventDb>;

beforeEach(() => {
  world = eventDb();
  mocks.getDb.mockReset();
  mocks.getDb.mockImplementation(async () => world.db);
  mocks.getCommercialMission.mockReset();
  mocks.getCommercialMission.mockResolvedValue({ id: 11, status: "phone_ready" });
  mocks.awardDriverSalesPoints.mockReset();
  mocks.awardDriverSalesPoints.mockResolvedValue(undefined);
  mocks.assertMissionConversationOutcome.mockReset();
  mocks.assertMissionConversationOutcome.mockResolvedValue(undefined);
});

describe("commercial call outcomes and prospect connection", () => {
  it("does not award spoke or visit_booked when the prospect leg never connected", async () => {
    mocks.assertMissionConversationOutcome.mockRejectedValue(new ProspectLegNotConnectedError());
    await expect(
      recordCommercialMissionCallAttempt({ ...input, outcome: "spoke" })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    await expect(
      recordCommercialMissionCallAttempt({ ...input, outcome: "visit_booked" })
    ).rejects.toBeInstanceOf(ProspectLegNotConnectedError);
    expect(world.events).toHaveLength(0);
    expect(mocks.awardDriverSalesPoints).not.toHaveBeenCalled();
  });

  it("still records voicemail and no answer without a connected-conversation bonus", async () => {
    const logged = await recordCommercialMissionCallAttempt({
      ...input,
      outcome: "left_voicemail",
      coldCallTargetId: "22222222-2222-4222-8222-222222222222",
    });
    expect(logged.outcome).toBe("left_voicemail");
    expect(mocks.assertMissionConversationOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "left_voicemail",
        missionId: 11,
        coldCallTargetId: "22222222-2222-4222-8222-222222222222",
      })
    );
    expect(mocks.awardDriverSalesPoints).toHaveBeenCalledWith(
      expect.objectContaining({
        points: 4,
        dedupeKey: `score:cold-call:${input.requestId}`,
        metadata: { outcome: "left_voicemail" },
      })
    );
  });

  it("awards the connected bonus when the gate allows the named attempt", async () => {
    const spoke = await recordCommercialMissionCallAttempt({
      ...input,
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      outcome: "spoke",
      salesCallAttemptId: 41,
    });
    expect(spoke.outcome).toBe("spoke");
    expect(mocks.assertMissionConversationOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "spoke", salesCallAttemptId: 41 })
    );
    expect(mocks.awardDriverSalesPoints).toHaveBeenCalledWith(
      expect.objectContaining({ points: 10, metadata: { outcome: "spoke" } })
    );

    world = eventDb();
    mocks.getDb.mockImplementation(async () => world.db);
    mocks.awardDriverSalesPoints.mockClear();
    const booked = await recordCommercialMissionCallAttempt({
      ...input,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      outcome: "visit_booked",
    });
    expect(booked.outcome).toBe("visit_booked");
    expect(mocks.awardDriverSalesPoints).toHaveBeenCalledWith(
      expect.objectContaining({ points: 22, metadata: { outcome: "visit_booked" } })
    );
  });

  it("replays the original outcome and does not upgrade it on retry", async () => {
    const first = await recordCommercialMissionCallAttempt({
      ...input,
      outcome: "no_answer",
    });
    mocks.assertMissionConversationOutcome.mockRejectedValue(new ProspectLegNotConnectedError());
    const replay = await recordCommercialMissionCallAttempt({
      ...input,
      outcome: "spoke",
    });
    expect(replay.id).toBe(first.id);
    expect(replay.outcome).toBe("no_answer");
    expect(world.events).toHaveLength(1);
    expect(mocks.awardDriverSalesPoints).toHaveBeenLastCalledWith(
      expect.objectContaining({
        points: 4,
        metadata: { outcome: "no_answer" },
        dedupeKey: `score:cold-call:${input.requestId}`,
      })
    );
  });
});
