import { getTableName } from "drizzle-orm/table";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAY1_TARGETS, encodeDay1Payload } from "../../shared/day1TenDoors";
import { colosseumLeadHuntDefinition } from "./colosseumKingdomBinding";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  recordLevel: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../openChannel/openChannelService", () => ({
  ensureOpenChannelTables: vi.fn(async () => undefined),
}));
vi.mock("./progressionWrites", () => ({
  recordLevelFromOutcomes: mocks.recordLevel,
}));

import { recordDay1TenDoorsOutcome } from "../openChannel/day1TenDoorsService";

const TARGETS = [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];

function detail(outcomes: Record<string, "pitched" | "couldnt_reach">): string {
  return encodeDay1Payload({
    kind: "day1_ten_doors",
    targets: [...DAY1_TARGETS],
    outcomes,
  });
}

function missionDb(stored: { detail: string }) {
  const writes: string[] = [];
  const mission = {
    id: "mission-1",
    tenantId: "tenant-a",
    driverId: "open-7",
    title: "Day 1",
    operatorBriefing: "brief",
    status: "active",
  };
  return {
    writes,
    select() {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const name = getTableName(table);
          const chain = {
            where: () => chain,
            orderBy: () => chain,
            limit: async () => {
              if (name === "open_channel_missions") return [mission];
              if (name === "open_channel_mission_tasks") {
                return [{ id: "task-1", missionId: mission.id, tenantId: mission.tenantId, detail: stored.detail }];
              }
              return [];
            },
          };
          return chain;
        },
      };
    },
    update(table: Parameters<typeof getTableName>[0]) {
      return {
        set(patch: { detail?: string }) {
          return {
            where: async () => {
              if (getTableName(table) === "open_channel_mission_tasks" && typeof patch.detail === "string") {
                writes.push("outcome");
                stored.detail = patch.detail;
              }
            },
          };
        },
      };
    },
  };
}

describe("Day 1 level.colosseum recording", () => {
  const fifth = TARGETS[TARGETS.length - 1]!;
  const four = Object.fromEntries(TARGETS.slice(0, -1).map(id => [id, "pitched" as const]));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordLevel.mockResolvedValue(undefined);
  });

  it("records the level before the outcome commits, and a transient failure leaves the outcome unwritten", async () => {
    const stored = { detail: detail(four) };
    const db = missionDb(stored);
    mocks.getDb.mockResolvedValue(db);
    let recordedWhileUncommitted = false;
    mocks.recordLevel.mockImplementation(async () => {
      recordedWhileUncommitted = db.writes.length === 0;
      throw new Error("connection closed");
    });

    await expect(
      recordDay1TenDoorsOutcome({
        tenantId: "tenant-a",
        driverId: "open-7",
        missionId: "mission-1",
        targetId: fifth,
        outcome: "couldnt_reach",
      })
    ).rejects.toThrow(/connection closed/);

    expect(recordedWhileUncommitted).toBe(true);
    expect(db.writes).toEqual([]);
    expect(stored.detail).toBe(detail(four));
    expect(mocks.recordLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        operatorId: "open-7",
        outcomesAvailable: true,
        outcomes: expect.objectContaining({ [fifth]: "couldnt_reach" }),
      })
    );
  });

  it("still saves the business outcome when the progression table is missing", async () => {
    const stored = { detail: detail(four) };
    const db = missionDb(stored);
    mocks.getDb.mockResolvedValue(db);
    const blocked = new Error("goldline_domain_progression is not present");
    blocked.name = "ProgressionSchemaBlockedError";
    mocks.recordLevel.mockRejectedValue(blocked);

    const mission = await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: fifth,
      outcome: "couldnt_reach",
    });

    expect(mission.outcomes[fifth]).toBe("couldnt_reach");
    expect(db.writes).toEqual(["outcome"]);
  });

  it("does not record the level again when the outcome was already saved", async () => {
    const already = { ...four, [fifth]: "pitched" as const };
    const stored = { detail: detail(already) };
    const db = missionDb(stored);
    mocks.getDb.mockResolvedValue(db);

    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: fifth,
      outcome: "pitched",
    });

    expect(mocks.recordLevel).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("does not record the level for an outcome that leaves the binding unsatisfied", async () => {
    const stored = { detail: detail({}) };
    const db = missionDb(stored);
    mocks.getDb.mockResolvedValue(db);

    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: TARGETS[0]!,
      outcome: "pitched",
    });

    expect(mocks.recordLevel).not.toHaveBeenCalled();
    expect(db.writes).toEqual(["outcome"]);
  });
});
