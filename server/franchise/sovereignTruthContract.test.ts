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

  it("successfully provisions a supported metro with correct corridor profile and macro goal", async () => {
    const result = await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 3000000,
      operatorName: "Austin Test Operator",
      operatorUserId: "admin-test-operator",
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

  it("resolves target tenants strictly through the server-side admin endpoint", async () => {
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

    // 1. Default tenant resolution
    const defaultRes = await caller.system.franchise.resolveTenant();
    expect(defaultRes.resolvedTenantId).toBe("default");
    expect(defaultRes.isCrossTenant).toBe(false);

    // 2. Existing provisioned franchise resolution
    const austinRes = await caller.system.franchise.resolveTenant({
      targetTenantId: "tenant_austin",
    });
    expect(austinRes.resolvedTenantId).toBe("tenant_austin");
    expect(austinRes.isCrossTenant).toBe(true);
    expect(austinRes.city).toBe("Austin");

    // 3. Non-existent tenant resolution fails closed with NOT_FOUND
    await expect(
      caller.system.franchise.resolveTenant({ targetTenantId: "tenant_nonexistent" })
    ).rejects.toThrow(/does not exist/);
  });

  it("enforces transactional database persistence and rollback safety via mock injection", async () => {
    const insertedTables: string[] = [];
    let transactionRolledBack = false;

    // Create a mock transaction builder that records all table operations
    const mockTx = {
      insert: vi.fn((table: any) => ({
        values: vi.fn((values: any) => {
          insertedTables.push(getTableName(table));
          return {
            onDuplicateKeyUpdate: vi.fn().mockResolvedValue([{ insertId: 1 }]),
          };
        }),
      })),
      select: vi.fn((fields?: any) => ({
        from: vi.fn((table: any) => {
          const tableName = getTableName(table);
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue(
                tableName === "commercial_accounts" ? [{ id: 42 }] : []
              ),
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          };
        }),
      })),
      update: vi.fn((table: any) => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
        })),
      })),
    };

    const mockDb = {
      transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
        try {
          return await callback(mockTx);
        } catch (error) {
          transactionRolledBack = true;
          throw error;
        }
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
    };

    setDbForTesting(mockDb as any);

    // 1. Successful transactional provisioning
    const result = await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 2500000,
      operatorName: "Transactional Test Operator",
      operatorUserId: "operator-tx-123",
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(result.franchise.tenantId).toBe("tenant_austin");

    // Verify all canonical SaaS and persistent operator tables were inserted inside tx:
    expect(insertedTables).toContain("dayforge_saas_tenants");
    expect(insertedTables).toContain("dayforge_saas_memberships");
    expect(insertedTables).toContain("dayforge_saas_subscriptions");
    expect(insertedTables).toContain("dayforge_saas_entitlements");
    expect(insertedTables).toContain("dayforge_saas_tenant_locations");
    expect(insertedTables).toContain("territory_operator_profiles");
    expect(insertedTables).toContain("commercial_accounts");
    expect(insertedTables).toContain("commercial_account_locations");
    expect(insertedTables).toContain("operator_macro_goals");
    expect(insertedTables).toContain("macro_goal_runs");
    expect(insertedTables).toContain("goal_cycle_requests");

    // 2. Transaction rollback verification
    const failingDb = {
      transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
        try {
          await callback({
            ...mockTx,
            insert: vi.fn(() => {
              throw new Error("Simulated disk full or DB constraint violation");
            }),
          });
        } catch (error) {
          transactionRolledBack = true;
          throw error;
        }
      }),
    };

    setDbForTesting(failingDb as any);

    await expect(
      provisionFranchise({
        city: "Seattle",
        state: "WA",
        vertical: "commercial_laundry",
        targetMrrCents: 3000000,
      })
    ).rejects.toThrow(/Simulated disk full/);

    expect(transactionRolledBack).toBe(true);
  });

  it("proves idempotency: re-running provisioning updates existing macro goal instead of inserting duplicate", async () => {
    let macroGoalUpdated = false;
    let macroGoalInserted = false;

    const mockTx = {
      insert: vi.fn((table: any) => ({
        values: vi.fn(() => {
          if (getTableName(table) === "operator_macro_goals") {
            macroGoalInserted = true;
          }
          return {
            onDuplicateKeyUpdate: vi.fn().mockResolvedValue([{ insertId: 1 }]),
          };
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn((table: any) => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(
              getTableName(table) === "operator_macro_goals"
                ? [{ id: "existing-austin-macro-goal-1", targetValue: "25000" }]
                : []
            ),
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([]),
            })),
          })),
        })),
      })),
      update: vi.fn((table: any) => ({
        set: vi.fn(() => {
          if (getTableName(table) === "operator_macro_goals") {
            macroGoalUpdated = true;
          }
          return {
            where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
          };
        }),
      })),
    };

    const mockDb = {
      transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    };

    setDbForTesting(mockDb as any);

    const result = await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 4500000,
    });

    expect(result.franchise.tenantId).toBe("tenant_austin");
    expect(macroGoalUpdated).toBe(true);
    expect(macroGoalInserted).toBe(false);
  });

  it("verifies cross-tenant isolation: non-admin cannot access foreign tenant data", async () => {
    // Driver caller for tenant "default"
    const driverCaller = appRouter.createCaller({
      user: {
        id: 55,
        openId: "driver-la-local",
        name: "Local Driver",
        email: "driver@la.com",
        role: "driver",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // Driver attempting to access Austin cross-tenant data must be rejected or bound to ctx.tenantId
    await expect(
      driverCaller.system.franchise.resolveTenant({ targetTenantId: "tenant_austin" })
    ).rejects.toThrow();
  });
});
