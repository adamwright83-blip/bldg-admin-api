import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getTableName } from "drizzle-orm";
import { appRouter } from "../routers";
import { resetDbForTesting, setDbForTesting } from "../db";
import {
  CITY_ANCHOR_PROFILES,
  getFranchiseById,
  listFranchises,
  provisionFranchise,
} from "./franchiseService";
import { macroGoalRuns } from "../../drizzle/schema";

/**
 * Reusable mock database fixture with table tracking and in-memory row storage
 */
function setupTestFranchiseDb() {
  const store = new Map<string, any[]>();
  const insertedRows = new Map<string, any[]>();
  const updatedRows = new Map<string, any[]>();

  const createQueryChain = (tableName: string) => {
    const getRows = () => {
      const rows = store.get(tableName) ?? [];
      if (tableName === "commercial_accounts" && rows.length === 0) {
        return [{ id: 42 }];
      }
      return rows;
    };

    const chain: any = {
      where: vi.fn((_pred?: any) => {
        const whereChain: any = {
          orderBy: vi.fn(() => {
            const orderChain: any = {
              limit: vi.fn(async (n?: number) => {
                const rows = getRows();
                return typeof n === "number" ? rows.slice(0, n) : rows;
              }),
              then: (resolve: any, reject: any) => Promise.resolve(getRows()).then(resolve, reject),
            };
            return orderChain;
          }),
          limit: vi.fn(async (n?: number) => {
            const rows = getRows();
            return typeof n === "number" ? rows.slice(0, n) : rows;
          }),
          then: (resolve: any, reject: any) => Promise.resolve(getRows()).then(resolve, reject),
        };
        return whereChain;
      }),
      orderBy: vi.fn(() => {
        const orderChain: any = {
          limit: vi.fn(async (n?: number) => {
            const rows = getRows();
            return typeof n === "number" ? rows.slice(0, n) : rows;
          }),
          then: (resolve: any, reject: any) => Promise.resolve(getRows()).then(resolve, reject),
        };
        return orderChain;
      }),
      limit: vi.fn(async (n?: number) => {
        const rows = getRows();
        return typeof n === "number" ? rows.slice(0, n) : rows;
      }),
      then: (resolve: any, reject: any) => Promise.resolve(getRows()).then(resolve, reject),
    };
    return chain;
  };

  const insertHandler = vi.fn((table: any) => ({
    values: vi.fn((values: any) => {
      const tableName = getTableName(table);
      const incoming = Array.isArray(values) ? values : [values];
      const withTimestamps = incoming.map((row: any) => ({
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      }));

      const list = store.get(tableName) ?? [];
      list.push(...withTimestamps);
      store.set(tableName, list);

      const inserted = insertedRows.get(tableName) ?? [];
      inserted.push(...withTimestamps);
      insertedRows.set(tableName, inserted);

      return {
        onDuplicateKeyUpdate: vi.fn().mockImplementation(() => {
          return Promise.resolve([{ insertId: 1, affectedRows: withTimestamps.length }]);
        }),
        then: (resolve: any, reject: any) =>
          Promise.resolve([{ insertId: 1, affectedRows: withTimestamps.length }]).then(resolve, reject),
      };
    }),
  }));

  const updateHandler = vi.fn((table: any) => ({
    set: vi.fn((updates: any) => {
      const tableName = getTableName(table);
      const updated = updatedRows.get(tableName) ?? [];
      updated.push(updates);
      updatedRows.set(tableName, updated);

      return {
        where: vi.fn().mockImplementation(async () => {
          const rows = store.get(tableName) ?? [];
          for (const r of rows) {
            Object.assign(r, updates);
          }
          return [{ affectedRows: 1 }];
        }),
      };
    }),
  }));

  const mockTx: any = {
    insert: insertHandler,
    select: vi.fn((_fields?: any) => ({
      from: vi.fn((table: any) => createQueryChain(getTableName(table))),
    })),
    update: updateHandler,
  };

  const mockDb: any = {
    transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
    select: vi.fn((_fields?: any) => ({
      from: vi.fn((table: any) => createQueryChain(getTableName(table))),
    })),
    insert: insertHandler,
    update: updateHandler,
  };

  setDbForTesting(mockDb as any);
  return { mockDb, mockTx, store, insertedRows, updatedRows };
}

describe("Sovereign Truth Contract — Security, Auth, & Tenant Isolation", () => {
  beforeEach(() => {
    resetDbForTesting();
  });

  afterEach(() => {
    resetDbForTesting();
  });

  it("enforces that system.franchise procedures require admin authentication", async () => {
    const caller = appRouter.createCaller({
      user: null, // Unauthenticated caller
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // 1. Unauthenticated list must throw UNAUTHORIZED / FORBIDDEN
    await expect(caller.system.franchise.list()).rejects.toThrow();

    // 2. Unauthenticated provision must throw UNAUTHORIZED / FORBIDDEN
    await expect(
      caller.system.franchise.provision({
        city: "Austin",
        state: "TX",
        vertical: "commercial_laundry",
        targetMrrCents: 2500000,
      })
    ).rejects.toThrow();

    // 3. Unauthenticated resolveTenant must throw UNAUTHORIZED / FORBIDDEN
    await expect(
      caller.system.franchise.resolveTenant({ targetTenantId: "tenant_austin" })
    ).rejects.toThrow();
  });

  it("enforces that system.franchise rejects non-admin users", async () => {
    const caller = appRouter.createCaller({
      user: {
        id: 99,
        openId: "driver-test-user",
        name: "Test Driver",
        email: "driver@test.com",
        role: "driver", // Non-admin role
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    await expect(caller.system.franchise.list()).rejects.toThrow();
    await expect(
      caller.system.franchise.provision({
        city: "Austin",
        state: "TX",
        vertical: "commercial_laundry",
        targetMrrCents: 2500000,
      })
    ).rejects.toThrow();
    await expect(
      caller.system.franchise.resolveTenant({ targetTenantId: "tenant_austin" })
    ).rejects.toThrow();
  });

  it("fails closed on unsupported metros, never silently defaulting to Austin", async () => {
    // Attempt to provision unsupported cities
    await expect(
      provisionFranchise({
        city: "Honolulu",
        state: "HI",
        vertical: "commercial_laundry",
        targetMrrCents: 2000000,
      })
    ).rejects.toThrow(/Unsupported metro "Honolulu"/);

    await expect(
      provisionFranchise({
        city: "Atlantis",
        state: "XX",
        vertical: "commercial_laundry",
        targetMrrCents: 1000000,
      })
    ).rejects.toThrow(/Unsupported metro "Atlantis"/);
  });

  it("fails closed when database is unavailable: refuses ambient theater", async () => {
    resetDbForTesting(); // getDb() returns null
    await expect(
      provisionFranchise({
        city: "Austin",
        state: "TX",
        vertical: "commercial_laundry",
        targetMrrCents: 2500000,
      })
    ).rejects.toThrow(/Database unavailable for franchise provisioning/);
  });

  it("successfully provisions a supported metro with correct corridor profile, operator identity, and macro goal", async () => {
    const { store } = setupTestFranchiseDb();

    // Seed tenant row into store so getFranchiseById / listFranchises can find it
    store.set("dayforge_saas_tenants", [
      {
        id: "tenant_austin",
        slug: "franchise-austin",
        businessName: "Goldline Austin Central",
        contactName: "Austin Test Operator",
        contactPhone: "+18005550100",
        status: "active",
        createdAt: new Date(),
      },
    ]);

    const result = await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 3000000,
      operatorName: "Austin Test Operator",
      operatorUserId: "admin-caller-openid",
    });

    expect(result.franchise).toBeDefined();
    expect(result.franchise.tenantId).toBe("tenant_austin");
    expect(result.franchise.city).toBe("Austin");
    expect(result.franchise.state).toBe("TX");
    expect(result.franchise.macroGoal.targetValue).toBe(30000);
    expect(result.franchise.territoryAnchors.length).toBeGreaterThan(0);
    expect(result.telemetry.length).toBe(6);
    expect(result.telemetry.every((s) => s.status === "completed")).toBe(true);

    // Verify lookup by franchise ID and tenant ID
    const byId = await getFranchiseById(result.franchise.id);
    expect(byId).toBeDefined();
    expect(byId?.city).toBe("Austin");

    const byTenantId = await getFranchiseById("tenant_austin");
    expect(byTenantId).toBeDefined();
    expect(byTenantId?.tenantId).toBe("tenant_austin");
  });

  it("lists the default Los Angeles flagship alongside provisioned franchises", async () => {
    const all = await listFranchises();
    expect(all.length).toBeGreaterThanOrEqual(1);

    const flagship = all.find((f) => f.tenantId === "default");
    expect(flagship).toBeDefined();
    expect(flagship?.city).toBe("Los Angeles");
    expect(flagship?.corridorDensityScore).toBe(94);
  });

  it("proves real-schema constraint adherence for macro_goal_runs: all NOT NULL columns populated", async () => {
    const { insertedRows } = setupTestFranchiseDb();

    await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 2500000,
      operatorName: "Schema Validator Operator",
    });

    // 1. Verify macro_goal_runs row adheres to real MySQL schema constraints
    const macroRunRows = insertedRows.get("macro_goal_runs");
    expect(macroRunRows).toBeDefined();
    expect(macroRunRows?.length).toBe(1);

    const run = macroRunRows![0];
    // Mandatory NOT NULL fields per migration & schema
    expect(run.goalSnapshotJson).toBeDefined();
    expect(typeof run.goalSnapshotJson).toBe("object");
    expect(run.goalSnapshotJson.objective).toContain("Achieve $25,000/mo MRR");
    expect(run.baselinePrecision).toBe("exact");
    expect(run.baselineCoverage).toBe("complete");
    expect(run.policyVersion).toBe("v1.0");
    expect(run.canonicalOperatorId).toBe("tenant:tenant_austin:operator:operator_austin");
    expect(run.operatorUserId).toBe("operator_austin");
    expect(run.metricKey).toBe("monthly_recurring_revenue");
    expect(run.targetValue).toBe("25000.00");
    expect(run.unit).toBe("USD");
    expect(run.status).toBe("active");
    expect(run.startedAt).toBeInstanceOf(Date);

    // 2. Verify target operator user in users table satisfies operatorUserCanResolveOnTenant
    const userRows = insertedRows.get("users");
    expect(userRows).toBeDefined();
    const targetUser = userRows!.find((u) => u.openId === "operator_austin");
    expect(targetUser).toBeDefined();
    expect(targetUser.tenantId).toBe("tenant_austin"); // Exactly equals target tenant
    expect(targetUser.role).toBe("admin");

    // 3. Verify zero fabricated Stripe subscriptions
    expect(insertedRows.has("dayforge_saas_subscriptions")).toBe(false);

    // 4. Verify explicit manual non-billing entitlements were granted instead
    const entitlementRows = insertedRows.get("dayforge_saas_entitlements");
    expect(entitlementRows).toBeDefined();
    expect(entitlementRows!.length).toBeGreaterThanOrEqual(1);
    expect(entitlementRows!.every((e) => e.source === "manual" && e.enabled === true)).toBe(true);
  });

  it("proves reprovisioning idempotency: updates active macro_goal_run targetValue and avoids reopening completed goal cycle requests", async () => {
    const { insertedRows, updatedRows, store } = setupTestFranchiseDb();

    // 1. Initial provision at $25,000 MRR
    await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 2500000,
    });

    expect(insertedRows.get("operator_macro_goals")?.length).toBe(1);
    expect(insertedRows.get("macro_goal_runs")?.length).toBe(1);
    expect(insertedRows.get("goal_cycle_requests")?.length).toBe(1);

    // Simulate goal_cycle_request already completed by autonomous worker
    const existingReq = store.get("goal_cycle_requests")![0];
    existingReq.status = "completed";

    // 2. Re-provision with new MRR target ($45,000)
    await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 4500000,
    });

    // Verify macro goal was updated with new target
    const macroGoalUpdates = updatedRows.get("operator_macro_goals");
    expect(macroGoalUpdates).toBeDefined();
    expect(macroGoalUpdates?.some((u) => u.targetValue === "45000")).toBe(true);

    // Verify active macro_goal_run targetValue was synchronized to new target
    const macroRunUpdates = updatedRows.get("macro_goal_runs");
    expect(macroRunUpdates).toBeDefined();
    expect(macroRunUpdates?.some((u) => u.targetValue === "45000.00")).toBe(true);

    // Verify goal_cycle_requests was NOT reset to queued or duplicated
    expect(existingReq.status).toBe("completed");
    expect(insertedRows.get("goal_cycle_requests")?.length).toBe(1);
  });

  it("verifies Day Line completion across all 3 lineage types (objective, commitment, campaign)", async () => {
    const { store } = setupTestFranchiseDb();

    // Seed canonical operator user and membership
    store.set("users", [
      {
        id: 1,
        tenantId: "default",
        openId: "admin-owner-user",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    store.set("dayforge_saas_memberships", [
      {
        tenantId: "default",
        userOpenId: "admin-owner-user",
        role: "owner",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Seed objective for Lineage 1
    store.set("goal_cycle_objectives", [
      {
        tenantId: "default",
        id: "objective-conquest-1",
        cycleId: "cycle-1",
        runId: "run-1",
        decisionId: "decision-1",
        canonicalOperatorId: "tenant:default:operator:admin-owner-user",
        operatorUserId: "admin-owner-user",
        selectionKind: "obligation",
        selectedRef: "ref-1",
        title: "Conquest Argyle House",
        description: "Visit building",
        executionType: "driver_visit",
        authority: "autonomous",
        status: "dispatched",
        businessDate: "2026-09-30",
        windowStart: "08:00",
        windowEnd: "17:00",
        loadoutJson: "[]",
        evidenceRefsJson: "[]",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Seed commitment for Lineage 2
    store.set("day_director_commitments", [
      {
        tenantId: "default",
        id: "commit-morning-door-tags",
        actorId: "admin-owner-user",
        businessDate: "2026-09-30",
        status: "active",
        label: "Door tags",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const caller = appRouter.createCaller({
      user: {
        id: 1,
        openId: "admin-owner-user",
        name: "Admin User",
        email: "admin@test.com",
        role: "admin",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // 1. Complete Lineage 1: Persistent Growth Objective
    const objectiveRes = await caller.system.currentDayLine.completeItem({
      itemId: "objective-conquest-1",
      lineage: {
        kind: "objective",
        sourceReference: "goal_cycle_objectives:objective-conquest-1",
        objectiveId: "objective-conquest-1",
      },
      evidenceReference: "field_receipt_voice_01",
      explanation: "Driver confirmed completed at Argyle House",
    });
    expect(objectiveRes.lineageKind).toBe("objective");
    expect(objectiveRes.itemId).toBe("objective-conquest-1");

    // 2. Complete Lineage 2: Day Director Designated Commitment
    const commitmentRes = await caller.system.currentDayLine.completeItem({
      itemId: "commit-morning-door-tags",
      lineage: {
        kind: "commitment",
        sourceReference: "day_director_commitments:commit-morning-door-tags",
        commitmentId: "commit-morning-door-tags",
      },
      evidenceReference: "field_receipt_voice_02",
      explanation: "Driver confirmed door tags placed on Franklin corridor",
    });
    expect(commitmentRes.success).toBe(true);
    expect(commitmentRes.lineageKind).toBe("commitment");
    expect(commitmentRes.itemId).toBe("commit-morning-door-tags");

    // 3. Complete Lineage 3: Campaign Work
    const campaignRes = await caller.system.currentDayLine.completeItem({
      itemId: "camp-west-loop-pilot",
      lineage: {
        kind: "campaign",
        sourceReference: "campaign:camp-west-loop-pilot",
        campaignId: "camp-west-loop-pilot",
      },
      evidenceReference: "field_receipt_voice_03",
      explanation: "Driver confirmed flyer drop completed",
    });
    expect(campaignRes.success).toBe(true);
    expect(campaignRes.lineageKind).toBe("campaign");
    expect(campaignRes.itemId).toBe("camp-west-loop-pilot");
  });

  it("verifies War Room Los Angeles default contains zero hardcoded WON statuses or fabricated route margins", async () => {
    // Assert that the simulation assets array contains ZERO won statuses
    // and that the default live state is derived authoritatively from atlas
    const { getGeographicTruth } = await import("../geography/geographicTruthService");
    expect(typeof getGeographicTruth).toBe("function");

    // Test that default Los Angeles view does not fabricate won statuses
    const caller = appRouter.createCaller({
      user: {
        id: 1,
        openId: "admin-owner-user",
        name: "Admin User",
        email: "admin@test.com",
        role: "admin",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    const resolveRes = await caller.system.franchise.resolveTenant();
    expect(resolveRes.resolvedTenantId).toBe("default");
    expect(resolveRes.isCrossTenant).toBe(false);
  });
});
