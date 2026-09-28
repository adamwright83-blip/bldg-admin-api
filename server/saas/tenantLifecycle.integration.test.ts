/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteTenantData,
  exportTenantData,
  planTenantDeletion,
} from "./tenantLifecycle";

const enabled = process.env.SAAS_TENANT_LIFECYCLE_EXAM === "1";
const suite = enabled ? describe : describe.skip;

suite("JOYSTICK tenant lifecycle", () => {
  const tenantId = `lifecycle-${Date.now().toString(36)}`;
  let db: Connection;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    db = await mysql.createConnection(process.env.DATABASE_URL);
    const [[database]] = await db.query("SELECT DATABASE() AS name");
    const name = String((database as { name?: string })?.name ?? "");
    if (!name.includes("tenant_lifecycle")) {
      throw new Error(`Refusing lifecycle exam outside disposable DB: ${name}`);
    }
    await db.execute(
      `INSERT INTO dayforge_saas_tenants
        (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
       VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [tenantId, tenantId, "Lifecycle Laundry", "Lifecycle Laundry", "#111111", "Owner", "owner@example.invalid", "America/Los_Angeles"]
    );
    await db.execute(
      `INSERT INTO users (tenantId,openId,name,email,loginMethod,role)
       VALUES (?,?,?,?, 'dayforge_password','user')`,
      [tenantId, `dayforge:${tenantId}`, "Owner", "owner@example.invalid"]
    );
    await db.execute(
      `INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active)
       VALUES (?,?, 'owner',true)`,
      [tenantId, `dayforge:${tenantId}`]
    );
    await db.execute(
      `INSERT INTO dayforge_saas_user_credentials
       (tenantId,userOpenId,emailNormalized,passwordHash)
       VALUES (?,?,?,?)`,
      [tenantId, `dayforge:${tenantId}`, "owner@example.invalid", "SHOULD_NOT_EXPORT"]
    );
    await db.execute(
      `INSERT INTO dayforge_saas_external_customers
       (tenantId,connectionId,providerKey,externalId,name,factsJson,sourceCapturedAt,importRunId)
       VALUES (?,1,'csv','cust-1','Customer One','{}',NOW(),'run-1')`,
      [tenantId]
    );
  });

  afterAll(async () => {
    if (!db) return;
    for (const table of [
      "dayforge_saas_user_credentials",
      "dayforge_saas_memberships",
      "dayforge_saas_external_customers",
      "users",
    ]) {
      await db.execute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [tenantId]);
    }
    await db.execute("DELETE FROM dayforge_saas_tenants WHERE id = ?", [tenantId]);
    await db.end();
  });

  it("exports only the requested tenant and redacts credential material", async () => {
    const exported = await exportTenantData(tenantId);
    expect(exported.tenant?.id).toBe(tenantId);
    expect(exported.tables.users).toHaveLength(1);
    expect(exported.tables.dayforge_saas_external_customers).toHaveLength(1);
    expect(exported.tables.dayforge_saas_user_credentials?.[0]?.passwordHash).toBe("[REDACTED]");
    expect(JSON.stringify(exported)).not.toContain("SHOULD_NOT_EXPORT");
  });

  it("requires a fresh dry-run count and exact tenant confirmation before deletion", async () => {
    const plan = await planTenantDeletion(tenantId);
    expect(plan.totalRows).toBeGreaterThanOrEqual(5);
    await expect(
      deleteTenantData({
        tenantId,
        expectedTotalRows: plan.totalRows,
        confirmation: "wrong-tenant",
      })
    ).rejects.toThrow(/confirmation/);
    await expect(
      deleteTenantData({
        tenantId,
        expectedTotalRows: plan.totalRows + 1,
        confirmation: tenantId,
      })
    ).rejects.toThrow(/plan changed/);

    const result = await deleteTenantData({
      tenantId,
      expectedTotalRows: plan.totalRows,
      confirmation: tenantId,
    });
    expect(result.totalRows).toBe(0);
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  it("protects Adam's legacy tenant ids from generic deletion", async () => {
    const plan = await planTenantDeletion("default");
    await expect(
      deleteTenantData({
        tenantId: "default",
        expectedTotalRows: plan.totalRows,
        confirmation: "default",
      })
    ).rejects.toThrow(/protected tenant/);
  });
});