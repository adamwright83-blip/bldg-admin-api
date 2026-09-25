/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customerAssetRouter } from "../customerAssets/customerAssetRouter";
import { teamRouter } from "../team/teamRouter";
import { saasRouter } from "./saasRouter";

const databaseUrl = process.env.DATABASE_URL;
const describeMysql = databaseUrl ? describe : describe.skip;

describeMysql("JOYSTICK hostile two-tenant router boundary", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantA = `hostile-a-${suffix}`;
  const tenantB = `hostile-b-${suffix}`;
  const ownerA = `dayforge:owner-a-${suffix}`;
  const ownerB = `dayforge:owner-b-${suffix}`;
  const workerA = `dayforge:worker-a-${suffix}`;
  const workerB = `dayforge:worker-b-${suffix}`;
  let db: mysql.Connection;

  const ctx = (tenantId: string, openId: string) =>
    ({
      req: { headers: { host: "admin.bldg.chat" }, protocol: "https" },
      res: {},
      user: {
        id: tenantId === tenantA ? 910001 : 910002,
        openId,
        role: "user",
        tenantId,
        name: openId,
        email: `${openId.replace(/[^a-z0-9]/gi, "-")}@example.invalid`,
        loginMethod: "password",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      vendorSession: null,
      tenantId,
    }) as never;

  beforeAll(async () => {
    db = await mysql.createConnection(databaseUrl!);
    for (const [tenantId, ownerOpenId, workerOpenId, label] of [
      [tenantA, ownerA, workerA, "Tenant A"],
      [tenantB, ownerB, workerB, "Tenant B"],
    ] as const) {
      await db.execute(
        `INSERT INTO dayforge_saas_tenants
          (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
         VALUES (?,?,?,?,?,?,?,?, 'active')`,
        [tenantId, tenantId, label, label, "#111111", label, `${tenantId}@example.invalid`, "America/Los_Angeles"]
      );
      for (const [openId, role] of [[ownerOpenId, "owner"], [workerOpenId, "field"]] as const) {
        await db.execute(
          `INSERT INTO users (tenantId,openId,name,email,role,loginMethod)
           VALUES (?,?,?,?, 'user','password')`,
          [tenantId, openId, openId, `${openId.replace(/[^a-z0-9]/gi, "-")}@example.invalid`]
        );
        await db.execute(
          `INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active)
           VALUES (?,?,?,true)`,
          [tenantId, openId, role]
        );
      }
      await db.execute(
        `INSERT INTO orders
          (tenantId,serviceType,pickupDate,pickupTimeWindow,address,firstName,lastName,phone,status,total,paid)
         VALUES (?,'wash_fold','2099-01-01','8-10','123 Test St',?,?,?,'new',25.00,false)`,
        [tenantId, label, "Customer", tenantId === tenantA ? "3105550101" : "3105550202"]
      );
    }
  });

  afterAll(async () => {
    if (!db) return;
    for (const tenantId of [tenantA, tenantB]) {
      await db.execute("DELETE FROM employee_operating_profile_events WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM employee_operating_profiles WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM orders WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM dayforge_saas_memberships WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM users WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM dayforge_saas_tenants WHERE id = ?", [tenantId]);
    }
    await db.end();
  });

  it("real customer router lists only the authenticated tenant's customers", async () => {
    const a = customerAssetRouter.createCaller(ctx(tenantA, ownerA));
    const b = customerAssetRouter.createCaller(ctx(tenantB, ownerB));
    const [assetsA, assetsB] = await Promise.all([a.list(), b.list()]);
    expect(assetsA).toHaveLength(1);
    expect(assetsB).toHaveLength(1);
    expect(assetsA[0]?.displayName).toContain("Tenant A");
    expect(assetsB[0]?.displayName).toContain("Tenant B");
    expect(assetsA[0]?.id).not.toBe(assetsB[0]?.id);
  });

  it("rejects a cross-tenant customer object id through the actual router", async () => {
    const a = customerAssetRouter.createCaller(ctx(tenantA, ownerA));
    const b = customerAssetRouter.createCaller(ctx(tenantB, ownerB));
    const bAsset = (await b.list())[0]!;
    await expect(a.detail({ assetId: bAsset.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("real SaaS members router never returns another tenant's users", async () => {
    const a = saasRouter.createCaller(ctx(tenantA, ownerA));
    const b = saasRouter.createCaller(ctx(tenantB, ownerB));
    const [membersA, membersB] = await Promise.all([a.members(), b.members()]);
    expect(membersA.map(row => row.openId).sort()).toEqual([ownerA, workerA].sort());
    expect(membersB.map(row => row.openId).sort()).toEqual([ownerB, workerB].sort());
    expect(membersA.some(row => row.openId === workerB)).toBe(false);
    expect(membersB.some(row => row.openId === workerA)).toBe(false);
  });

  it("tenant A cannot mutate tenant B's team member through an actual mutation", async () => {
    const a = teamRouter.createCaller(ctx(tenantA, ownerA));
    await expect(
      a.saveProfile({
        userOpenId: workerB,
        displayName: "Cross tenant write",
        employmentStatus: "active",
        skills: ["laundry"],
        weeklyCapacityUnits: 10,
        requestId: randomUUID(),
      })
    ).rejects.toThrow(/real active non-owner tenant membership/);
    const [rows] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM employee_operating_profiles WHERE tenantId = ? AND userOpenId = ?",
      [tenantA, workerB]
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  it("team projection is tenant-scoped through the actual router", async () => {
    const a = teamRouter.createCaller(ctx(tenantA, ownerA));
    const b = teamRouter.createCaller(ctx(tenantB, ownerB));
    const [teamA, teamB] = await Promise.all([a.get(), b.get()]);
    expect(teamA.members.map(member => member.userOpenId)).toEqual([workerA]);
    expect(teamB.members.map(member => member.userOpenId)).toEqual([workerB]);
  });

  it("SaaS me binds configuration to caller tenant, not another tenant", async () => {
    const a = saasRouter.createCaller(ctx(tenantA, ownerA));
    const b = saasRouter.createCaller(ctx(tenantB, ownerB));
    const [meA, meB] = await Promise.all([a.me(), b.me()]);
    expect(meA.tenantId).toBe(tenantA);
    expect(meA.configuration?.tenant.id).toBe(tenantA);
    expect(meB.tenantId).toBe(tenantB);
    expect(meB.configuration?.tenant.id).toBe(tenantB);
  });
});
