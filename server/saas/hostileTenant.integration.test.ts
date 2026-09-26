import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { customerAssetRouter } from "../customerAssets/customerAssetRouter";
import { strategyRouter } from "../strategy/strategyRouter";

const enabled = process.env.SAAS_HOSTILE_TENANT_DB_TEST === "1";
const describeDb = enabled ? describe : describe.skip;

const suffix = Date.now().toString(36);
const tenantA = `hostile-a-${suffix}`;
const tenantB = `hostile-b-${suffix}`;
const userA = `dayforge:hostile-a-${suffix}`;
const userB = `dayforge:hostile-b-${suffix}`;

const dbUrl = process.env.DATABASE_URL ?? "";

function user(openId: string, tenantId: string) {
  return {
    id: openId === userA ? 910001 : 910002,
    openId,
    role: "user" as const,
    name: openId,
    email: `${openId.replace(/[^a-z0-9]/gi, "-")}@example.invalid`,
    loginMethod: "membership",
    tenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function ctx(openId: string, tenantId: string) {
  return {
    req: undefined,
    res: {} as never,
    user: user(openId, tenantId),
    vendorSession: null,
    tenantId,
  } as never;
}

describeDb("hostile SaaS tenant boundary through real routers", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(dbUrl);
    for (const [tenantId, businessName] of [
      [tenantA, "Hostile Tenant A Laundry"],
      [tenantB, "Hostile Tenant B Laundry"],
    ] as const) {
      await conn.execute(
        `INSERT INTO dayforge_saas_tenants
          (id, slug, businessName, brandName, primaryColor, contactName, contactEmail, timeZone, status)
         VALUES (?, ?, ?, ?, '#000000', 'Owner', ?, 'America/Los_Angeles', 'active')`,
        [tenantId, tenantId, businessName, businessName, `${tenantId}@example.invalid`]
      );
    }
    for (const [tenantId, openId] of [
      [tenantA, userA],
      [tenantB, userB],
    ] as const) {
      await conn.execute(
        `INSERT INTO users (tenantId, openId, name, email, loginMethod, role)
         VALUES (?, ?, ?, ?, 'membership', 'user')`,
        [tenantId, openId, openId, `${openId.replace(/[^a-z0-9]/gi, "-")}@example.invalid`]
      );
      await conn.execute(
        `INSERT INTO dayforge_saas_memberships (tenantId, userOpenId, role, active)
         VALUES (?, ?, 'owner', true)`,
        [tenantId, openId]
      );
    }

    await conn.execute(
      `INSERT INTO orders
        (tenantId, serviceType, pickupDate, pickupTimeWindow, address, firstName, lastName, phone, status, total, paid)
       VALUES
        (?, 'wash_fold', '2099-01-01', '9-11', '1 Tenant A Way', 'Alice', 'A', '5550000001', 'delivered', 25.00, false),
        (?, 'wash_fold', '2099-01-01', '9-11', '2 Tenant B Way', 'Bob', 'B', '5550000002', 'delivered', 40.00, false)`,
      [tenantA, tenantB]
    );
  });

  afterAll(async () => {
    if (!conn) return;
    await conn.execute("DELETE FROM orders WHERE tenantId IN (?, ?)", [tenantA, tenantB]);
    await conn.execute("DELETE FROM dayforge_saas_memberships WHERE tenantId IN (?, ?)", [tenantA, tenantB]);
    await conn.execute("DELETE FROM users WHERE tenantId IN (?, ?)", [tenantA, tenantB]);
    await conn.execute("DELETE FROM dayforge_saas_tenants WHERE id IN (?, ?)", [tenantA, tenantB]);
    await conn.end();
  });

  it("customer assets return only the authenticated tenant's business book", async () => {
    const callerA = customerAssetRouter.createCaller(ctx(userA, tenantA));
    const callerB = customerAssetRouter.createCaller(ctx(userB, tenantB));

    const [assetsA, assetsB] = await Promise.all([callerA.list(), callerB.list()]);
    expect(assetsA.some(asset => asset.displayName === "Alice A")).toBe(true);
    expect(assetsA.some(asset => asset.displayName === "Bob B")).toBe(false);
    expect(assetsB.some(asset => asset.displayName === "Bob B")).toBe(true);
    expect(assetsB.some(asset => asset.displayName === "Alice A")).toBe(false);
  });

  it("rejects a member whose request context is switched to the other tenant", async () => {
    const forgedCustomerCaller = customerAssetRouter.createCaller(ctx(userA, tenantB));
    await expect(forgedCustomerCaller.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const forgedStrategyCaller = strategyRouter.createCaller(ctx(userA, tenantB));
    await expect(forgedStrategyCaller.recovery.state()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows the same SaaS owner through Strategy on their persisted tenant", async () => {
    const caller = strategyRouter.createCaller(ctx(userA, tenantA));
    await expect(caller.recovery.state()).resolves.toBeDefined();
  });
});
