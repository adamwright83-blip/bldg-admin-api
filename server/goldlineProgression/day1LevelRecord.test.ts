import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm/table";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  DAY1_BUSINESS_DATE,
  DAY1_TARGETS,
  decodeDay1Payload,
  encodeDay1Payload,
} from "../../shared/day1TenDoors";
import { colosseumLeadHuntDefinition } from "./colosseumKingdomBinding";
import { ProgressionForgeError } from "./progressionContract";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../openChannel/openChannelService", () => ({
  ensureOpenChannelTables: vi.fn(async () => undefined),
}));
vi.mock("../saas/tenantAccess", () => ({
  resolveDayforgeMembership: vi.fn(async () => ({
    tenantId: "tenant-a",
    userOpenId: "open-7",
    role: "operator",
  })),
  hasDayforgeEntitlement: vi.fn(async () => true),
  roleAllows: (actual: string, allowed: readonly string[]) => allowed.includes(actual),
}));

import { day1TenDoorsRouter } from "../openChannel/day1TenDoorsRouter";
import {
  getDay1TenDoorsMissionReadOnly,
  getOrCreateDay1TenDoorsMission,
  recordDay1TenDoorsOutcome,
} from "../openChannel/day1TenDoorsService";

const TARGETS = [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];
const FIFTH = TARGETS[TARGETS.length - 1]!;
const dialect = new MySqlDialect();

type Row = Record<string, unknown>;

function detail(outcomes: Record<string, "pitched" | "couldnt_reach">): string {
  return encodeDay1Payload({
    kind: "day1_ten_doors",
    targets: [...DAY1_TARGETS],
    outcomes,
  });
}

function fourOutcomes(): Record<string, "pitched"> {
  return Object.fromEntries(TARGETS.slice(0, -1).map(id => [id, "pitched" as const]));
}

function matches(row: Row, predicate: unknown): boolean {
  const query = dialect.sqlToQuery(predicate as SQL);
  const token = /`[^`]+`\.`([^`]+)` (is not null|is null|= \?|in \((?:\?,\s*)*\?\))/g;
  let param = 0;
  for (const match of query.sql.matchAll(token)) {
    const column = match[1]!;
    const op = match[2]!;
    if (op === "is null") {
      if (row[column] != null) return false;
    } else if (op === "is not null") {
      if (row[column] == null) return false;
    } else if (op === "= ?") {
      if (row[column] !== query.params[param++]) return false;
    } else {
      const count = op.split("?").length - 1;
      const allowed = query.params.slice(param, param + count);
      param += count;
      if (!allowed.includes(row[column])) return false;
    }
  }
  return true;
}

function executable<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  return Object.assign(promise, {
    orderBy: () => executable(rows),
    limit: (n: number) => executable(rows.slice(0, n)),
  });
}

function memoryDb() {
  const missions: Row[] = [];
  const tasks: Row[] = [];
  const progression: Row[] = [];
  const log: string[] = [];
  const flags = { failTaskDetailUpdate: false, failLevelInsert: false, armStaleConfirm: false };
  const tables: Record<string, Row[]> = {
    open_channel_missions: missions,
    open_channel_mission_tasks: tasks,
    goldline_domain_progression: progression,
  };
  function stored(table: Parameters<typeof getTableName>[0]): { name: string; rows: Row[] } {
    const name = getTableName(table);
    const rows = tables[name];
    if (!rows) throw new Error(`unexpected table ${name}`);
    return { name, rows };
  }
  const db = {
    missions,
    tasks,
    progression,
    log,
    flags,
    select() {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const { name, rows } = stored(table);
          return {
            where(predicate: unknown) {
              if (name === "open_channel_mission_tasks") log.push("task-select");
              if (name === "goldline_domain_progression") log.push("progression-select");
              const matched = rows.filter(row => matches(row, predicate)).map(row => {
                if (
                  name === "open_channel_mission_tasks" &&
                  flags.armStaleConfirm &&
                  typeof row.staleDetail === "string"
                ) {
                  flags.armStaleConfirm = false;
                  const { staleDetail, ...rest } = row;
                  return { ...rest, detail: staleDetail };
                }
                return row;
              });
              return executable(matched);
            },
          };
        },
      };
    },
    update(table: Parameters<typeof getTableName>[0]) {
      const { name, rows } = stored(table);
      return {
        set(patch: Row) {
          return {
            where: async (predicate: unknown) => {
              if (name === "open_channel_mission_tasks" && typeof patch.detail === "string") {
                log.push("task-detail-update");
                if (flags.failTaskDetailUpdate) throw new Error("outcome persistence failed");
              }
              for (const row of rows) {
                if (!matches(row, predicate)) continue;
                if (typeof patch.detail === "string" && flags.armStaleConfirm) row.staleDetail = row.detail;
                Object.assign(row, patch);
              }
            },
          };
        },
      };
    },
    insert(table: Parameters<typeof getTableName>[0]) {
      const { name, rows } = stored(table);
      return {
        values: async (value: Row) => {
          if (name === "goldline_domain_progression") {
            log.push("level-insert");
            if (flags.failLevelInsert) throw new Error("progression write failed");
            if (rows.some(row => row.tenantId === value.tenantId && row.operatorId === value.operatorId)) {
              const error = new Error("duplicate") as Error & { code: string; errno: number };
              error.code = "ER_DUP_ENTRY";
              error.errno = 1062;
              throw error;
            }
          }
          rows.push({ ...value });
        },
      };
    },
  };
  return db;
}

function seed(
  db: ReturnType<typeof memoryDb>,
  input: {
    tenantId: string;
    driverId: string;
    missionId: string;
    taskId: string;
    outcomes: Record<string, "pitched" | "couldnt_reach">;
  }
) {
  db.missions.push({
    id: input.missionId,
    tenantId: input.tenantId,
    driverId: input.driverId,
    businessDate: DAY1_BUSINESS_DATE,
    title: "Day 1",
    operatorBriefing: "brief",
    status: "active",
  });
  db.tasks.push({
    id: input.taskId,
    missionId: input.missionId,
    tenantId: input.tenantId,
    detail: detail(input.outcomes),
    status: "pending",
  });
}

function taskDetail(db: ReturnType<typeof memoryDb>, taskId: string): string {
  const task = db.tasks.find(row => row.id === taskId);
  if (!task || typeof task.detail !== "string") throw new Error("missing task");
  return task.detail;
}

function outcomesOf(db: ReturnType<typeof memoryDb>, taskId: string) {
  return decodeDay1Payload(taskDetail(db, taskId))?.outcomes ?? {};
}

function assertLevelFollowsConfirmedWrite(log: string[]) {
  const updateAt = log.indexOf("task-detail-update");
  const levelAt = log.indexOf("level-insert");
  expect(updateAt).toBeGreaterThanOrEqual(0);
  expect(levelAt).toBeGreaterThan(updateAt);
  const confirmAt = log.findIndex((entry, index) => index > updateAt && entry === "task-select");
  expect(confirmAt).toBeGreaterThan(updateAt);
  expect(levelAt).toBeGreaterThan(confirmAt);
}

function context(): TrpcContext {
  return {
    req: { headers: {} } as never,
    res: undefined as never,
    vendorSession: null,
    tenantId: "tenant-a",
    user: {
      id: 7,
      tenantId: "tenant-a",
      openId: "open-7",
      name: "Operator",
      email: "operator@example.test",
      loginMethod: "test",
      role: "operator",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  };
}

describe("Day 1 level.colosseum recording", () => {
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = memoryDb();
    mocks.getDb.mockResolvedValue(db);
  });

  it("(A) does not record the level when fifth-outcome persistence fails", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: fourOutcomes(),
    });
    const before = taskDetail(db, "task-1");
    db.flags.failTaskDetailUpdate = true;

    await expect(
      recordDay1TenDoorsOutcome({
        tenantId: "tenant-a",
        driverId: "open-7",
        missionId: "mission-1",
        targetId: FIFTH,
        outcome: "couldnt_reach",
      })
    ).rejects.toThrow(/outcome persistence failed/);

    expect(taskDetail(db, "task-1")).toBe(before);
    expect(outcomesOf(db, "task-1")[FIFTH]).toBeUndefined();
    expect(db.progression).toEqual([]);
    expect(db.log).not.toContain("level-insert");
  });

  it("(B) keeps the committed outcome when the progression write fails", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: fourOutcomes(),
    });
    db.flags.failLevelInsert = true;

    const mission = await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "couldnt_reach",
    });

    expect(mission.outcomes[FIFTH]).toBe("couldnt_reach");
    expect(outcomesOf(db, "task-1")[FIFTH]).toBe("couldnt_reach");
    expect(db.progression).toEqual([]);
    assertLevelFollowsConfirmedWrite(db.log);
  });

  it("(C) retries the level from the committed row, not from a guessed map", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: fourOutcomes(),
    });
    db.flags.failLevelInsert = true;
    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "pitched",
    });
    const committed = taskDetail(db, "task-1");
    db.flags.failLevelInsert = false;
    db.log.length = 0;

    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "pitched",
    });

    expect(taskDetail(db, "task-1")).toBe(committed);
    expect(db.log).not.toContain("task-detail-update");
    expect(db.log.indexOf("task-select")).toBeGreaterThanOrEqual(0);
    expect(db.log.indexOf("level-insert")).toBeGreaterThan(db.log.indexOf("task-select"));
    expect(db.progression).toHaveLength(1);
    expect(db.progression[0]).toMatchObject({
      tenantId: "tenant-a",
      operatorId: "open-7",
      companionRookOwnedAt: null,
      kingdomBrassRepublicCompletedAt: null,
    });
    expect(db.progression[0]?.levelColosseumResolvedAt).toBeInstanceOf(Date);
  });

  it("(D) keeps the first level timestamp on a second retry", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: fourOutcomes(),
    });
    db.flags.failLevelInsert = true;
    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "pitched",
    });
    db.flags.failLevelInsert = false;
    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "pitched",
    });
    const stamp = db.progression[0]?.levelColosseumResolvedAt;
    const inserts = db.log.filter(entry => entry === "level-insert").length;

    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "pitched",
    });

    expect(db.progression).toHaveLength(1);
    expect(db.progression[0]?.levelColosseumResolvedAt).toBe(stamp);
    expect(db.progression[0]?.kingdomBrassRepublicCompletedAt).toBeNull();
    expect(db.log.filter(entry => entry === "level-insert")).toHaveLength(inserts);
  });

  it("(E) does not let tenant A evidence resolve tenant B", async () => {
    const sharedMissionId = "mission-shared";
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-a",
      missionId: sharedMissionId,
      taskId: "task-a",
      outcomes: { ...fourOutcomes(), [FIFTH]: "pitched" },
    });
    seed(db, {
      tenantId: "tenant-b",
      driverId: "open-b",
      missionId: sharedMissionId,
      taskId: "task-b",
      outcomes: fourOutcomes(),
    });
    const tenantABefore = taskDetail(db, "task-a");

    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-b",
      driverId: "open-b",
      missionId: sharedMissionId,
      targetId: "onsunset",
      outcome: "pitched",
    });
    expect(db.progression).toEqual([]);
    expect(taskDetail(db, "task-a")).toBe(tenantABefore);

    const mission = await recordDay1TenDoorsOutcome({
      tenantId: "tenant-b",
      driverId: "open-b",
      missionId: sharedMissionId,
      targetId: FIFTH,
      outcome: "couldnt_reach",
    });

    expect(mission.outcomes[FIFTH]).toBe("couldnt_reach");
    expect(taskDetail(db, "task-a")).toBe(tenantABefore);
    expect(outcomesOf(db, "task-b")[FIFTH]).toBe("couldnt_reach");
    expect(db.progression).toHaveLength(1);
    expect(db.progression[0]).toMatchObject({
      tenantId: "tenant-b",
      operatorId: "open-b",
      kingdomBrassRepublicCompletedAt: null,
    });
    expect(db.progression.some(row => row.tenantId === "tenant-a")).toBe(false);
  });

  it("(F) does not let a client forge payload create progression", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: fourOutcomes(),
    });
    const before = taskDetail(db, "task-1");

    await expect(
      recordDay1TenDoorsOutcome({
        tenantId: "tenant-a",
        driverId: "open-7",
        missionId: "mission-1",
        targetId: FIFTH,
        outcome: "pitched",
        resolved: true,
        localStorage: { levelColosseumResolved: true },
      } as never)
    ).rejects.toBeInstanceOf(ProgressionForgeError);

    expect(taskDetail(db, "task-1")).toBe(before);
    expect(db.progression).toEqual([]);
    expect(db.log).not.toContain("level-insert");

    const caller = day1TenDoorsRouter.createCaller(context());
    await expect(
      caller.recordOutcome({
        missionId: "11111111-1111-4111-8111-111111111111",
        targetId: FIFTH,
        outcome: "pitched",
        resolved: true,
      } as never)
    ).rejects.toThrow();
    expect(db.progression).toEqual([]);
    expect(taskDetail(db, "task-1")).toBe(before);
  });

  it("accepts the field client's outcome payload without creating a level", async () => {
    const missionId = "11111111-1111-4111-8111-111111111111";
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId,
      taskId: "task-client",
      outcomes: {},
    });
    const caller = day1TenDoorsRouter.createCaller(context());
    const mission = await caller.recordOutcome({
      missionId,
      targetId: TARGETS[0]!,
      outcome: "pitched",
      requestId: "22222222-2222-4222-8222-222222222222",
      decisionMaker: "not_recorded",
      followUpNeeded: false,
      source: "operator_confirmed",
    });
    expect(mission.outcomes[TARGETS[0]!]).toBe("pitched");
    expect(db.progression).toEqual([]);
  });

  it("does not record the level when the committed row does not contain the outcome", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: fourOutcomes(),
    });
    db.flags.armStaleConfirm = true;

    await expect(
      recordDay1TenDoorsOutcome({
        tenantId: "tenant-a",
        driverId: "open-7",
        missionId: "mission-1",
        targetId: FIFTH,
        outcome: "pitched",
      })
    ).rejects.toThrow(/not committed/);

    expect(outcomesOf(db, "task-1")[FIFTH]).toBe("pitched");
    expect(db.progression).toEqual([]);
    expect(db.log).not.toContain("level-insert");
  });

  it("does not complete the mission from the in-memory map when the committed row is stale", async () => {
    const last = DAY1_TARGETS[DAY1_TARGETS.length - 1]!.id;
    const prior = Object.fromEntries(DAY1_TARGETS.slice(0, -1).map(target => [target.id, "pitched" as const]));
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: prior,
    });
    db.flags.armStaleConfirm = true;

    await expect(
      recordDay1TenDoorsOutcome({
        tenantId: "tenant-a",
        driverId: "open-7",
        missionId: "mission-1",
        targetId: last,
        outcome: "pitched",
      })
    ).rejects.toThrow(/not committed/);

    expect(outcomesOf(db, "task-1")[last]).toBe("pitched");
    expect(db.missions[0]?.status).toBe("active");
    expect(db.progression).toEqual([]);
    expect(db.log).not.toContain("level-insert");
  });

  it("does not record the level for an outcome that leaves the binding unsatisfied", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: {},
    });

    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: TARGETS[0]!,
      outcome: "pitched",
    });

    expect(outcomesOf(db, "task-1")[TARGETS[0]!]).toBe("pitched");
    expect(db.progression).toEqual([]);
    expect(db.log).not.toContain("level-insert");
  });

  it("does not backfill a historically satisfied hunt by reading it", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: { ...fourOutcomes(), [FIFTH]: "pitched" },
    });

    const read = await getDay1TenDoorsMissionReadOnly({ tenantId: "tenant-a", driverId: "open-7" });
    const loaded = await getOrCreateDay1TenDoorsMission({ tenantId: "tenant-a", driverId: "open-7" });

    expect(read?.outcomes[FIFTH]).toBe("pitched");
    expect(loaded.outcomes[FIFTH]).toBe("pitched");
    expect(db.progression).toEqual([]);
    expect(db.log).not.toContain("level-insert");
  });

  it("does not repair a level when a retry's committed row is no longer satisfied", async () => {
    seed(db, {
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      taskId: "task-1",
      outcomes: fourOutcomes(),
    });
    db.flags.failLevelInsert = true;
    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "pitched",
    });
    const task = db.tasks[0]!;
    const decoded = decodeDay1Payload(String(task.detail));
    if (!decoded) throw new Error("missing committed payload");
    delete decoded.outcomes[TARGETS[0]!];
    task.detail = encodeDay1Payload(decoded);
    db.flags.failLevelInsert = false;

    await recordDay1TenDoorsOutcome({
      tenantId: "tenant-a",
      driverId: "open-7",
      missionId: "mission-1",
      targetId: FIFTH,
      outcome: "pitched",
    });

    expect(db.progression).toEqual([]);
  });
});
