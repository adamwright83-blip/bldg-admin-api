import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import {
  CITY_ANCHOR_PROFILES,
  getFranchiseById,
  listFranchises,
  provisionFranchise,
} from "./franchiseService";

describe("Sovereign Truth Contract — Security, Auth, & Tenant Isolation", () => {
  it("enforces that system.franchise procedures require admin authentication", async () => {
    const caller = appRouter.createCaller({
      user: null, // Unauthenticated caller
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
  });

  it("fails closed on unsupported metros, never silently defaulting to Austin", async () => {
    // Attempt to provision an unsupported city
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
});
