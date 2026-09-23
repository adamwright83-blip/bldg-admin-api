import { readFileSync } from "node:fs";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm/table";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import {
  ROOK_CONTACT_CAPABILITY_ID,
  WAYWARD_ROOK_CONTACT_CONSEQUENCE,
} from "../../shared/rookContact";
import type { TrpcContext } from "../_core/context";
import { rookContactRouter } from "../rookContact/rookContactRouter";
import { colosseumLeadHuntDefinition } from "./colosseumKingdomBinding";
import { ProgressionNotPermittedError } from "./progressionContract";
import {
  acknowledgeWaywardRookContact,
  readGoldlineProgression,
} from "./progressionService";
import { acknowledgeColosseumAuthoredFinale } from "./progressionService";
import { recordLevelFromOutcomes } from "./progressionWrites";

const access = vi.hoisted(() => ({ resolveMembership: vi.fn() }));
const mocks = vi.hoisted(() => ({
  readMission: vi.fn(),
  isCompanionEarned: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../saas/tenantAccess", () => ({
  resolveDayforgeMembership: access.resolveMembership,
  hasDayforgeEntitlement: vi.fn(),
  roleAllows: (actual: string, allowed: readonly string[]) => allowed.includes(actual),
}));
vi.mock("../openChannel/day1TenDoorsService", () => ({
  getDay1TenDoorsMissionReadOnly: mocks.readMission,
}));
vi.mock("../companions/companionService", () => ({
  isCompanionEarned: mocks.isCompanionEarned,
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

const TARGETS = [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];
const five = () => Object.fromEntries(TARGETS.map(id => [id, "pitched"]));
const dialect = new MySqlDialect();

type Row = Record<string, unknown>;

function matches(row: Row, predicate: unknown): boolean {
  const query = dialect.sqlToQuery(predicate as SQL);
  const token = /`[^`]+`\.`([^`]+)` (is not null|is null|= \?)/g;
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
    }
  }
  return true;
}

function duplicate(): never {
  const error = new Error("duplicate") as Error & { code: string; errno: number };
  error.code = "ER_DUP_ENTRY";
  error.errno = 1062;
  throw error;
}

function memoryDb() {
  const progression: Row[] = [];
  const grants: Row[] = [];
  const unlocks: Row[] = [];
  const missions: Row[] = [
    { id: "mission-1", tenantId: "tenant-a", status: "active", completedAt: null },
  ];
  const challenges: Row[] = [
    { id: "challenge-1", tenantId: "tenant-a", status: "open", completedAt: null },
  ];
  const queried: string[] = [];
  const flags = { grantTableMissing: false };
  const tables: Record<string, Row[]> = {
    goldline_domain_progression: progression,
    goldline_domain_capability_grants: grants,
    goldline_companion_unlocks: unlocks,
    open_channel_missions: missions,
    commercial_missions: missions,
  };
  function stored(table: Parameters<typeof getTableName>[0]) {
    const name = getTableName(table);
    queried.push(name);
    if (name === "goldline_domain_capability_grants" && flags.grantTableMissing) {
      const error = new Error(
        "Table 'goldline_domain_capability_grants' doesn't exist"
      ) as Error & { code: string; errno: number };
      error.code = "ER_NO_SUCH_TABLE";
      error.errno = 1146;
      throw error;
    }
    const rows = tables[name];
    if (!rows) throw new Error(`unexpected table ${name}`);
    return { name, rows };
  }
  const db = {
    progression,
    grants,
    unlocks,
    missions,
    challenges,
    queried,
    flags,
    select() {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const { rows } = stored(table);
          return {
            where(predicate: unknown) {
              const found = rows.filter(row => matches(row, predicate));
              return { limit: async (n: number) => found.slice(0, n) };
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
            if (rows.some(row => row.tenantId === value.tenantId && row.operatorId === value.operatorId)) {
              duplicate();
            }
          }
          if (name === "goldline_domain_capability_grants") {
            if (
              rows.some(
                row =>
                  row.tenantId === value.tenantId &&
                  row.operatorId === value.operatorId &&
                  row.capabilityId === value.capabilityId
              )
            ) {
              duplicate();
            }
          }
          rows.push({ ...value });
        },
      };
    },
    update(table: Parameters<typeof getTableName>[0]) {
      const { rows } = stored(table);
      return {
        set(patch: Row) {
          return {
            where: async (predicate: unknown) => {
              for (const row of rows) {
                if (matches(row, predicate)) Object.assign(row, patch);
              }
            },
          };
        },
      };
    },
    transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  };
  return db;
}

function context(tenantId: string, userId: number): TrpcContext {
  return {
    req: { headers: {} } as never,
    res: undefined as never,
    vendorSession: null,
    tenantId,
    user: {
      id: userId,
      tenantId,
      openId: `open-${userId}`,
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

async function ownRook(tenantId = "tenant-a", operatorId = "op-a") {
  await acknowledgeColosseumAuthoredFinale({
    tenantId,
    operatorId,
    authoredConsequence: COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE,
  });
}

describe("capability.rook.contact grant", () => {
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.isCompanionEarned.mockResolvedValue(true);
    mocks.readMission.mockImplementation(async ({ tenantId, driverId }: { tenantId: string; driverId: string }) => {
      if (tenantId === "tenant-a" && (driverId === "op-a" || driverId === "open-7")) return { outcomes: five() };
      return { outcomes: {} };
    });
    access.resolveMembership.mockImplementation(async ({ tenantId, userOpenId }: { tenantId: string; userOpenId: string }) => ({
      tenantId,
      userOpenId,
      role: "operator",
    }));
  });

  it("1. five Greystar outcomes do not grant CONTACT", async () => {
    expect(TARGETS).toHaveLength(5);
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "7",
    });
    expect(Object.keys(five())).toHaveLength(5);
    expect(read.kingdomBinding.recordedTargetIds).toHaveLength(5);
    expect(read.capabilityRookContact).toMatchObject({
      granted: false,
      readable: true,
      status: "ungranted",
      grantsCompanionOwnership: false,
    });
    expect(db.grants).toHaveLength(0);
  });

  it("2. a satisfied kingdom binding does not grant CONTACT", async () => {
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: null,
    });
    expect(read.kingdomBinding.status).toBe("satisfied");
    expect(read.capabilityRookContact.granted).toBe(false);
    expect(read.capabilityRookContact.status).toBe("ungranted");
    expect(db.grants).toHaveLength(0);
  });

  it("3. level.colosseum resolved without Rook does not grant CONTACT", async () => {
    await recordLevelFromOutcomes({
      tenantId: "tenant-a",
      operatorId: "op-a",
      outcomes: five(),
      outcomesAvailable: true,
    });
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "7",
    });
    expect(read.levelColosseumResolved).toEqual({ status: "earned", value: true });
    expect(read.companionRookOwned.value).toBe(false);
    expect(read.capabilityRookContact.granted).toBe(false);
    expect(db.grants).toHaveLength(0);
  });

  it("4. Rook owned without the Wayward acknowledgement does not grant CONTACT", async () => {
    await ownRook();
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "7",
    });
    expect(read.levelColosseumResolved).toEqual({ status: "earned", value: true });
    expect(read.companionRookOwned).toEqual({ status: "earned", value: true });
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(read.capabilityRookContact).toMatchObject({
      readable: true,
      granted: false,
      status: "ungranted",
      grantsCompanionOwnership: false,
      implementationCapabilityId: "rook.outreach_drafting",
    });
    expect(db.grants).toHaveLength(0);
    expect(mocks.isCompanionEarned).not.toHaveBeenCalled();
  });

  it("5. a legacy goldline_companion_unlocks Rook row is not CONTACT authority", async () => {
    db.unlocks.push({
      id: "unlock-1",
      tenantId: "tenant-a",
      operatorId: "7",
      companionId: "rook",
      earnedAt: new Date(),
      earnedViaKingdomId: "brass-republic",
      earnedViaCampaignId: "colosseum",
      evidenceOpsTaskId: 1,
    });
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "7",
    });
    expect(mocks.isCompanionEarned).not.toHaveBeenCalled();
    expect(db.queried).not.toContain("goldline_companion_unlocks");
    expect(read.capabilityRookContact.granted).toBe(false);
    expect(read.companionRookOwned.value).toBe(false);
    expect(db.grants).toHaveLength(0);
    const service = readFileSync(new URL("./progressionService.ts", import.meta.url), "utf8");
    expect(service).not.toMatch(/isCompanionEarned/);
  });

  it("6. localStorage cannot grant CONTACT", async () => {
    await ownRook();
    await expect(
      acknowledgeWaywardRookContact({
        tenantId: "tenant-a",
        operatorId: "op-a",
        authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
        localStorage: { contactGranted: true },
      } as never)
    ).rejects.toThrow(/localStorage/);
    expect(db.grants).toHaveLength(0);
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: null,
    });
    expect(read.capabilityRookContact.granted).toBe(false);
    expect(read.localStorage).toBe("cache_and_present_only");
  });

  it("7. acknowledgement before Rook is owned is rejected", async () => {
    await expect(
      acknowledgeWaywardRookContact({
        tenantId: "tenant-a",
        operatorId: "op-a",
        authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
      })
    ).rejects.toBeInstanceOf(ProgressionNotPermittedError);
    await recordLevelFromOutcomes({
      tenantId: "tenant-a",
      operatorId: "op-a",
      outcomes: five(),
      outcomesAvailable: true,
    });
    await expect(
      acknowledgeWaywardRookContact({
        tenantId: "tenant-a",
        operatorId: "op-a",
        authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
      })
    ).rejects.toThrow(/companion\.rook/);
    expect(db.grants).toHaveLength(0);
    expect(db.progression[0]?.companionRookOwnedAt).toBeNull();
  });

  it("8. a wrong consequence literal is rejected", async () => {
    await ownRook();
    for (const authoredConsequence of [
      "wayward.entered",
      COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE,
      "rook",
      "capability.rook.contact",
    ]) {
      await expect(
        acknowledgeWaywardRookContact({
          tenantId: "tenant-a",
          operatorId: "op-a",
          authoredConsequence,
        })
      ).rejects.toBeInstanceOf(ProgressionNotPermittedError);
    }
    expect(db.grants).toHaveLength(0);
  });

  it("9. wayward.rook_contact_demonstrated grants CONTACT when Rook is owned", async () => {
    await ownRook();
    const before = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: null,
    });
    expect(before.capabilityRookContact.granted).toBe(false);
    const granted = await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    expect(granted.levelColosseumResolved.value).toBe(true);
    expect(granted.companionRookOwned.value).toBe(true);
    expect(granted.capabilityRookContact).toMatchObject({
      readable: true,
      granted: true,
      status: "granted",
      grantsCompanionOwnership: false,
      implementationCapabilityId: "rook.outreach_drafting",
    });
    expect(db.grants).toHaveLength(1);
    expect(db.grants[0]?.capabilityId).toBe(ROOK_CONTACT_CAPABILITY_ID);
    expect(db.grants[0]?.capabilityId).not.toBe("rook");
    expect(db.grants[0]?.grantSource).toBe(WAYWARD_ROOK_CONTACT_CONSEQUENCE);
  });

  it("10. replaying the acknowledgement is idempotent", async () => {
    await ownRook();
    await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    const stamp = db.grants[0]?.grantedAt;
    const id = db.grants[0]?.id;
    const again = await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    expect(again.capabilityRookContact.granted).toBe(true);
    expect(db.grants).toHaveLength(1);
    expect(db.grants[0]?.id).toBe(id);
    expect(db.grants[0]?.grantedAt).toBe(stamp);
    expect(db.grants[0]?.grantSource).toBe(WAYWARD_ROOK_CONTACT_CONSEQUENCE);
  });

  it("11. a tenant A grant is invisible to tenant B", async () => {
    await ownRook();
    await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    const other = await readGoldlineProgression({
      tenantId: "tenant-b",
      operatorId: "op-a",
      capabilityOperatorId: null,
    });
    expect(other.capabilityRookContact.granted).toBe(false);
    expect(other.companionRookOwned.value).toBe(false);
    expect(db.grants.map(row => row.tenantId)).toEqual(["tenant-a"]);
  });

  it("12. an operator A grant is invisible to operator B", async () => {
    await ownRook();
    await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    const other = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-b",
      capabilityOperatorId: null,
    });
    expect(other.capabilityRookContact.granted).toBe(false);
    expect(other.companionRookOwned.value).toBe(false);
    expect(db.grants.map(row => row.operatorId)).toEqual(["op-a"]);
  });

  it("13. the grant does not mutate companion.rook", async () => {
    await ownRook();
    const stamp = db.progression[0]?.companionRookOwnedAt;
    await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    expect(db.progression[0]?.companionRookOwnedAt).toBe(stamp);
    expect(db.progression).toHaveLength(1);
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: null,
    });
    expect(read.companionRookOwned).toEqual({ status: "earned", value: true });
    expect(read.capabilityRookContact.grantsCompanionOwnership).toBe(false);
  });

  it("14. the grant does not resolve Colosseum", async () => {
    await ownRook();
    const stamp = db.progression[0]?.levelColosseumResolvedAt;
    await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    expect(db.progression[0]?.levelColosseumResolvedAt).toBe(stamp);
    expect(db.progression).toHaveLength(1);
  });

  it("15. the grant does not complete Brass Republic", async () => {
    await ownRook();
    const granted = await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    expect(db.progression[0]?.kingdomBrassRepublicCompletedAt).toBeNull();
    expect(granted.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(granted.kingdomBrassRepublicCompleted.impliedByLevelColosseum).toBe(false);
  });

  it("16. the grant does not complete a Mission or a Challenge", async () => {
    await ownRook();
    const missionBefore = JSON.stringify(db.missions);
    const challengeBefore = JSON.stringify(db.challenges);
    await expect(
      acknowledgeWaywardRookContact({
        tenantId: "tenant-a",
        operatorId: "op-a",
        authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
        waywardComplete: true,
      } as never)
    ).rejects.toThrow(/waywardComplete/);
    expect(db.grants).toHaveLength(0);
    await acknowledgeWaywardRookContact({
      tenantId: "tenant-a",
      operatorId: "op-a",
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    expect(JSON.stringify(db.missions)).toBe(missionBefore);
    expect(JSON.stringify(db.challenges)).toBe(challengeBefore);
    expect(db.missions[0]?.status).toBe("active");
    expect(db.challenges[0]?.status).toBe("open");
    const store = readFileSync(new URL("./capabilityGrantStore.ts", import.meta.url), "utf8");
    expect(store).not.toMatch(/levelColosseumResolvedAt|companionRookOwnedAt|kingdomBrassRepublicCompletedAt/);
  });

  it("keeps an unreadable grant table uncertain and does not fall back to companion unlocks", async () => {
    await ownRook();
    db.flags.grantTableMissing = true;
    mocks.isCompanionEarned.mockResolvedValue(true);
    const read = await readGoldlineProgression({
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityOperatorId: "7",
    });
    expect(read.companionRookOwned.value).toBe(true);
    expect(read.capabilityRookContact).toMatchObject({
      granted: false,
      readable: false,
      status: "uncertain",
    });
    expect(mocks.isCompanionEarned).not.toHaveBeenCalled();
  });

  it("takes tenant and operator from the session and refuses client grant flags", async () => {
    await ownRook("tenant-a", "open-7");
    const caller = rookContactRouter.createCaller(context("tenant-a", 7));
    await expect(
      caller.acknowledge({
        authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
        contactGranted: true,
      } as never)
    ).rejects.toThrow();
    await expect(
      caller.acknowledge({
        authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
        capabilityId: "rook",
        tenantId: "tenant-b",
        operatorId: "open-8",
      } as never)
    ).rejects.toThrow();
    expect(db.grants).toHaveLength(0);
    const granted = await caller.acknowledge({
      authoredConsequence: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    expect(granted.tenantId).toBe("tenant-a");
    expect(granted.operatorId).toBe("open-7");
    expect(granted.capabilityRookContact.granted).toBe(true);
    expect(db.grants[0]?.operatorId).toBe("open-7");
    expect(db.grants[0]?.tenantId).toBe("tenant-a");
  });
});
