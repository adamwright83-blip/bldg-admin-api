/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createContext, JOYSTICK_ACTIVE_TENANT_COOKIE } from "../../_core/context";
import { systemRouter } from "../../_core/systemRouter";
import { sdk } from "../../_core/sdk";

vi.mock("../../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
    authenticateSessionToken: vi.fn(),
  },
}));

const dbUrl = process.env.DATABASE_URL || "mysql://root:root@127.0.0.1:3437/phase2";

describe("Tenant Separation and Isolation Integration (Real-MySQL)", () => {
  let conn: mysql.Connection;
  const testSuffix = Date.now().toString(36);
  const testButlerTenant = "default";
  const testFarmTenant = "laundry_farm";

  // Test customers at shared buildings
  const angieRedpath = "angie-redpath-" + testSuffix;
  const abeChung = "abe-chung-" + testSuffix;
  const benChon = "ben-chon-" + testSuffix;

  beforeAll(async () => {
    conn = await mysql.createConnection(dbUrl);

    // Ensure SaaS tenants exist
    await conn.execute(`
      INSERT INTO dayforge_saas_tenants (id, slug, businessName, brandName, primaryColor, contactName, contactEmail, timeZone, status, onboardingStep, strategyVerticalKey)
      VALUES 
        ('default', 'laundry-butler', 'Laundry Butler', 'Laundry Butler', '#2563EB', 'Adam Wright', 'adam@laundrybutler.com', 'America/Los_Angeles', 'active', 'complete', 'laundry_fluff_fold'),
        ('laundry_farm', 'laundry-farm', 'Laundry Farm', 'Laundry Farm', '#1B4D3E', 'Adam Wright', 'support@laundryfarm.com', 'America/Los_Angeles', 'active', 'complete', 'laundry_fluff_fold')
      ON DUPLICATE KEY UPDATE businessName = VALUES(businessName)
    `);

    // Ensure operator memberships for adam-admin
    await conn.execute(`
      INSERT INTO dayforge_saas_memberships (tenantId, userOpenId, role, active)
      VALUES 
        ('default', 'adam-admin', 'owner', 1),
        ('laundry_farm', 'adam-admin', 'owner', 1),
        ('default', 'butler-only-driver', 'field', 1)
      ON DUPLICATE KEY UPDATE role = VALUES(role), active = 1
    `);

    // Seed shared customer orders in BOTH businesses at OPUS LA and Century Park East
    // 1. Laundry Butler orders for Angie Redpath at OPUS LA ($45.00) and Abe Chung at Century Park East ($60.00)
    await conn.execute(`
      INSERT INTO orders (
        tenantId, serviceType, pickupDate, pickupTimeWindow, address, firstName, lastName, phone, status, total, paid, stripePaymentIntentId
      ) VALUES
        ('default', 'wash_fold', '2026-10-18', 'morning', '3545 Wilshire Blvd #1201', 'Angie', '${angieRedpath}', '555-0101', 'delivered', 45.00, 1, 'pi_butler_angie_${testSuffix}'),
        ('default', 'wash_fold', '2026-10-18', 'morning', '2160 Century Park E #504', 'Abe', '${abeChung}', '555-0102', 'delivered', 60.00, 1, 'pi_butler_abe_${testSuffix}')
    `);

    // 2. Laundry Farm orders for Angie Redpath at OPUS LA ($80.00) and Ben Chon at Century Park East ($95.00)
    await conn.execute(`
      INSERT INTO orders (
        tenantId, serviceType, pickupDate, pickupTimeWindow, address, firstName, lastName, phone, status, total, paid, residentClientRequestId
      ) VALUES
        ('laundry_farm', 'wash_fold', '2026-10-18', 'afternoon', '3545 Wilshire Blvd #1201', 'Angie', '${angieRedpath}', '555-0101', 'delivered', 80.00, 1, 'goldline:cadence:angie_${testSuffix}:2026-10-18'),
        ('laundry_farm', 'wash_fold', '2026-10-18', 'afternoon', '2170 Century Park E #802', 'Ben', '${benChon}', '555-0103', 'delivered', 95.00, 1, 'goldline:cadence:ben_${testSuffix}:2026-10-18')
    `);
  });

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM orders WHERE lastName IN (?, ?, ?)`, [angieRedpath, abeChung, benChon]);
      await conn.execute(`DELETE FROM dayforge_saas_memberships WHERE userOpenId = 'butler-only-driver'`);
      await conn.end();
    }
  });

  it("1. Server-authorized operator switching between Laundry Butler and Laundry Farm", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({
      id: 1,
      openId: "adam-admin",
      role: "admin",
    } as any);

    // Operator requests Laundry Butler via header
    const butlerCtx = await createContext({
      req: {
        headers: { host: "admin.bldg.chat", "x-tenant-id": "default" },
        protocol: "https",
      } as any,
      res: {} as any,
    });
    expect(butlerCtx.tenantId).toBe("default");

    // Operator requests Laundry Farm via cookie
    const farmCtx = await createContext({
      req: {
        headers: {
          host: "admin.bldg.chat",
          cookie: `${JOYSTICK_ACTIVE_TENANT_COOKIE}=laundry_farm`,
        },
        protocol: "https",
      } as any,
      res: {} as any,
    });
    expect(farmCtx.tenantId).toBe("laundry_farm");
  });

  it("2. OPUS LA and Century Park East return distinct customer lists and order totals per business", async () => {
    // Query Laundry Butler orders
    const [butlerRows] = await conn.execute(
      `SELECT firstName, lastName, address, total, paid FROM orders WHERE tenantId = 'default' AND lastName IN (?, ?, ?) ORDER BY id`,
      [angieRedpath, abeChung, benChon]
    );
    const butlerOrders = butlerRows as any[];

    // Angie Redpath ($45) and Abe Chung ($60)
    expect(butlerOrders.length).toBe(2);
    expect(butlerOrders.some(o => o.firstName === "Angie" && o.address.includes("3545 Wilshire Blvd"))).toBe(true);
    expect(butlerOrders.some(o => o.firstName === "Abe" && o.address.includes("Century Park E"))).toBe(true);
    // Ben Chon must NOT appear in Laundry Butler
    expect(butlerOrders.some(o => o.firstName === "Ben")).toBe(false);

    // Query Laundry Farm orders
    const [farmRows] = await conn.execute(
      `SELECT firstName, lastName, address, total, paid FROM orders WHERE tenantId = 'laundry_farm' AND lastName IN (?, ?, ?) ORDER BY id`,
      [angieRedpath, abeChung, benChon]
    );
    const farmOrders = farmRows as any[];

    // Angie Redpath ($80) and Ben Chon ($95)
    expect(farmOrders.length).toBe(2);
    expect(farmOrders.some(o => o.firstName === "Angie" && o.address.includes("3545 Wilshire Blvd"))).toBe(true);
    expect(farmOrders.some(o => o.firstName === "Ben" && o.address.includes("Century Park E"))).toBe(true);
    // Abe Chung must NOT appear in Laundry Farm
    expect(farmOrders.some(o => o.firstName === "Abe")).toBe(false);
  });

  it("3. Cross-business customer Angie Redpath has strictly partitioned orders across both businesses", async () => {
    const [angieButler] = await conn.execute(
      `SELECT total, paid, stripePaymentIntentId FROM orders WHERE tenantId = 'default' AND lastName = ?`,
      [angieRedpath]
    );
    const [angieFarm] = await conn.execute(
      `SELECT total, paid, residentClientRequestId FROM orders WHERE tenantId = 'laundry_farm' AND lastName = ?`,
      [angieRedpath]
    );

    const bOrder = (angieButler as any[])[0];
    const fOrder = (angieFarm as any[])[0];

    expect(Number(bOrder.total)).toBe(45.00);
    expect(bOrder.stripePaymentIntentId).toContain("pi_butler_angie");

    expect(Number(fOrder.total)).toBe(80.00);
    expect(fOrder.residentClientRequestId).toContain("goldline:cadence:angie");
  });

  it("4. TRPC tenant router getActiveTenant returns correct business branding for each context", async () => {
    // Caller for Laundry Butler
    const butlerCaller = systemRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 1, openId: "adam-admin", role: "admin" } as any,
      vendorSession: null,
      tenantId: "default",
    });
    const butlerActive = await butlerCaller.tenant.getActiveTenant();
    expect(butlerActive.id).toBe("default");
    expect(butlerActive.businessName).toBe("Laundry Butler");
    expect(butlerActive.primaryColor).toBe("#2563EB");

    // Caller for Laundry Farm
    const farmCaller = systemRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 1, openId: "adam-admin", role: "admin" } as any,
      vendorSession: null,
      tenantId: "laundry_farm",
    });
    const farmActive = await farmCaller.tenant.getActiveTenant();
    expect(farmActive.id).toBe("laundry_farm");
    expect(farmActive.businessName).toBe("Laundry Farm");
    expect(farmActive.primaryColor).toBe("#1B4D3E");
  });

  it("5. Unauthorized tenant switching fails closed with FORBIDDEN", async () => {
    // User with membership only in default
    const restrictedCaller = systemRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 2, openId: "butler-only-driver", role: "user" } as any,
      vendorSession: null,
      tenantId: "default",
    });

    // Attempt to switch to laundry_farm must be rejected
    await expect(
      restrictedCaller.tenant.switchActiveTenant({ tenantId: "laundry_farm" })
    ).rejects.toThrow(TRPCError);

    // Attempt to switch to unknown tenant must be rejected
    await expect(
      restrictedCaller.tenant.switchActiveTenant({ tenantId: "unauthorized_tenant_xyz" })
    ).rejects.toThrow(TRPCError);
  });
});
