import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorAcquisitionMissionStore } from "./vendorAcquisitionMissionStore";

const MOCK_MISSION_ROW = {
  id: "mission-1",
  tenant_id: "default",
  category: "dog_walking",
  geography_label: "Hollywood / Silver Lake",
  target_quantity: 10,
  quality_gates_json: { minGoogleRating: 4.8, minYelpRating: 4.2 },
  outreach_mode: "draft_only",
  status: "draft",
  deadline_at: new Date("2099-01-01T00:00:00.000Z"),
  created_by: "operator-1",
  created_at: new Date("2026-06-24T00:00:00.000Z"),
  updated_at: new Date("2026-06-24T00:00:00.000Z"),
};

function createInput() {
  return {
    id: "mission-1",
    tenantId: "default",
    category: "dog_walking",
    geographyLabel: "Hollywood / Silver Lake",
    targetQuantity: 10,
    qualityGates: { minGoogleRating: 4.8, minYelpRating: 4.2 },
    outreachMode: "draft_only",
    deadlineAt: new Date("2099-01-01T00:00:00.000Z"),
    createdBy: "operator-1",
  };
}

function makeConnection(opts: { selectRows?: Array<Record<string, unknown>> } = {}) {
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (/^SELECT/i.test(sql.trim())) {
      return Promise.resolve([opts.selectRows ?? [MOCK_MISSION_ROW], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
  return {
    execute,
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
}

describe("VendorAcquisitionMissionStore -- creation", () => {
  it("creates a mission and commits when the definition passes policy", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorAcquisitionMissionStore(pool as any);

    const id = await store.createMission(createInput());

    expect(id).toBe("mission-1");
    expect(connection.commit).toHaveBeenCalledOnce();
    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT INTO vendor_acquisition_missions/i);
  });

  it("fails closed before ever opening a transaction when the definition is invalid", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorAcquisitionMissionStore(pool as any);

    await expect(
      store.createMission({ ...createInput(), outreachMode: "auto_send" }),
    ).rejects.toThrow(/auto_send_not_yet_enabled/);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});

describe("VendorAcquisitionMissionStore -- status transitions", () => {
  it("activates a draft mission", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorAcquisitionMissionStore(pool as any);

    await store.activateMission("default", "mission-1");

    expect(connection.commit).toHaveBeenCalledOnce();
    const updateCalls = connection.execute.mock.calls.filter(([sql]) =>
      /^\s*UPDATE/i.test(String(sql)),
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual(["active", "default", "mission-1"]);
  });

  it("refuses to activate a mission that is already active, and rolls back", async () => {
    const connection = makeConnection({ selectRows: [{ ...MOCK_MISSION_ROW, status: "active" }] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorAcquisitionMissionStore(pool as any);

    await expect(store.activateMission("default", "mission-1")).rejects.toThrow(
      /mission_not_in_draft_status/,
    );
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("fails closed when the mission does not exist", async () => {
    const connection = makeConnection({ selectRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorAcquisitionMissionStore(pool as any);

    await expect(store.completeMission("default", "missing")).rejects.toThrow(/not found/i);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("vendor acquisition mission store source isolation (Slice 70)", () => {
  it("writes only to vendor_acquisition_missions -- never to sourcing, outreach, dispatch, payment, or Stripe tables", () => {
    const source = fs.readFileSync("server/procurement/vendorAcquisitionMissionStore.ts", "utf8");
    const writeStatements =
      source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/vendor_acquisition_missions/);
    }
    expect(source).not.toMatch(/\bvendor_sourcing_candidates\b/);
    expect(source).not.toMatch(/\b(fetch|axios|stripe|dispatch)\b/i);
  });

  it("contains no route, worker, or scheduler wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorAcquisitionMissionStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)|setInterval|cron/i);
  });
});
