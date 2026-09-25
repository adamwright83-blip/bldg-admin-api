/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import mysql from "mysql2/promise";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { saasRouter } from "./saasRouter";
import { customerAssetRouter } from "../customerAssets/customerAssetRouter";
import { commercialMissionRouter } from "../commercialMissions/commercialMissionRouter";
import { createContext } from "../_core/context";
import { sdk } from "../_core/sdk";

vi.mock("../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
    authenticateSessionToken: vi.fn(),
  },
}));

const enabled = process.env.SAAS_TENANT_ISOLATION_EXAM === "1";
const suite = enabled ? describe : describe.skip;

const A = {
  tenantId: "schema-release-tenant-a",
  openId: "dayforge:schema-release-owner-a",
  email: "owner-a@example.invalid",
};
const B = {
  tenantId: "schema-release-tenant-b",
  openId: "dayforge:schema-release-owner-b",
  email: "owner-b@example.invalid",
};

function callerContext(input: typeof A) {
  return {
    req: undefined,
    res: {},
    user: {
      id: input.tenantId === A.tenantId ? 91001 : 91002,
      openId: input.openId,
      role: "user",
      name: input.tenantId,
      email: input.email,
      loginMethod: "password",
      tenantId: input.tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    vendorSession: null,
    tenantId: input.tenantId,
  } as never;
}

async function insertTenant(conn: mysql.Connection, input: typeof A) {
  await conn.execute(
    `INSERT INTO dayforge_saas_tenants
      (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE businessName=VALUES(businessName)`,
    [input.tenantId,input.tenantId,input.tenantId,input.tenantId,"#000000","Owner",input.email,"America/Los_Angeles","active"]
  );
  await conn.execute(
    `INSERT INTO users
      (tenantId,openId,name,email,loginMethod,role)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE tenantId=VALUES(tenantId), role=VALUES(role)`,
    [input.tenantId,input.openId,"Owner",input.email,"password","user"]
  );
  await conn.execute(
    `INSERT INTO dayforge_saas_memberships
      (tenantId,userOpenId,role,active)
     VALUES (?,?,?,true)
     ON DUPLICATE KEY UPDATE role=VALUES(role), active=true`,
    [input.tenantId,input.openId,"owner"]
  );
  await conn.execute(
    `INSERT INTO dayforge_saas_subscriptions
      (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,lastStripeEventId,lastStripeEventCreatedAt)
     VALUES (?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE status='active', planKey=VALUES(planKey)`,
    [input.tenantId,"schema-isolation-plan",`cus_${input.tenantId}`,`sub_${input.tenantId}`,"active",`evt_${input.tenantId}`]
  );
  for (const entitlementKey of ["dayforge_core","boreslay","dayforge_field","commercial_pipeline","churn_radar"]) {
    await conn.execute(
      `INSERT INTO dayforge_saas_entitlements
        (tenantId,entitlementKey,source,enabled)
       VALUES (?,?,?,true)
       ON DUPLICATE KEY UPDATE enabled=true`,
      [input.tenantId,entitlementKey,"plan"]
    );
  }
}

suite("hostile SaaS tenant router boundary", () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    const conn = await mysql.createConnection(url);
    const [[database]] = await conn.query("SELECT DATABASE() AS name");
    const name = String((database as { name?: string })?.name ?? "");
    if (!name.includes("schema_release")) {
      await conn.end();
      throw new Error(`Refusing tenant isolation exam outside disposable schema-release database: ${name}`);
    }
    await conn.execute(
      `INSERT INTO dayforge_saas_billing_plans
        (planKey,displayName,stripePriceId,rulesJson,entitlementsJson,active)
       VALUES (?,?,?,?,?,true)
       ON DUPLICATE KEY UPDATE active=true`,
      ["schema-isolation-plan","Schema Isolation","price_schema_isolation","{}","[]"]
    );
    await insertTenant(conn,A);
    await insertTenant(conn,B);
    await conn.execute(
      `INSERT INTO orders
        (tenantId,serviceType,pickupDate,pickupTimeWindow,address,firstName,lastName,phone,status,total,paid)
       VALUES
        (?, 'wash_fold','2099-01-01','9-10','1 A St','Alice','A','+13235550001','delivered',10.00,true),
        (?, 'wash_fold','2099-01-01','9-10','2 B St','Bob','B','+13235550002','delivered',20.00,true)`,
      [A.tenantId,B.tenantId]
    );
    await conn.end();
  });

  it("binds SaaS membership to its persisted tenant even when request headers claim another tenant", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({
      id: 91001,
      openId: A.openId,
      role: "user",
      tenantId: A.tenantId,
      name: "Owner A",
      email: A.email,
      loginMethod: "password",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });
    const ctx = await createContext({
      req: {
        headers: {
          host: "admin.bldg.chat",
          "x-tenant-id": B.tenantId,
          "x-forwarded-host": "laundryfarm.bldg.chat",
        },
        protocol: "https",
      } as never,
      res: {} as never,
    });
    expect(ctx.tenantId).toBe(A.tenantId);
    expect(ctx.tenantId).not.toBe(B.tenantId);
    expect(ctx.tenantId).not.toBe("default");
  });

  it("real SaaS routers return only the caller tenant", async () => {
    const aSaas = saasRouter.createCaller(callerContext(A));
    const bSaas = saasRouter.createCaller(callerContext(B));
    expect((await aSaas.me()).tenantId).toBe(A.tenantId);
    expect((await bSaas.me()).tenantId).toBe(B.tenantId);
    const aMembers = await aSaas.members();
    const bMembers = await bSaas.members();
    expect(aMembers.map(row => row.openId)).toEqual([A.openId]);
    expect(bMembers.map(row => row.openId)).toEqual([B.openId]);
    expect(aMembers.some(row => row.openId === B.openId)).toBe(false);
    expect(bMembers.some(row => row.openId === A.openId)).toBe(false);
  });

  it("customer assets cannot be read across tenant boundaries", async () => {
    const a = customerAssetRouter.createCaller(callerContext(A));
    const b = customerAssetRouter.createCaller(callerContext(B));
    const aAssets = await a.list();
    const bAssets = await b.list();
    expect(aAssets.some(asset => asset.displayName.includes("Alice"))).toBe(true);
    expect(aAssets.some(asset => asset.displayName.includes("Bob"))).toBe(false);
    expect(bAssets.some(asset => asset.displayName.includes("Bob"))).toBe(true);
    expect(bAssets.some(asset => asset.displayName.includes("Alice"))).toBe(false);
    const bAsset = bAssets.find(asset => asset.displayName.includes("Bob"));
    expect(bAsset).toBeDefined();
    await expect(a.detail({ assetId: bAsset!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("commercial mission IDs are tenant scoped at the real router", async () => {
    const a = commercialMissionRouter.createCaller(callerContext(A));
    const b = commercialMissionRouter.createCaller(callerContext(B));
    const mission = await b.create({
      assignedTo: B.openId,
      account: {
        name: "Tenant B Property",
        accountType: "apartment",
        address: "2 B St",
        latitude: null,
        longitude: null,
        locationCount: 1,
        decisionMaker: { name: null, title: null },
      },
      opportunity: {
        estimatedAnnualValueCents: null,
        estimateConfidence: "low",
        score: 50,
        primarySignal: "Synthetic isolation proof",
        reasons: ["Tenant B only"],
        risks: [],
      },
      brief: {
        laundryOpportunity: "Synthetic",
        salesAngle: "Synthetic",
        openingLine: "Synthetic",
        discoveryQuestions: [],
        objections: [],
      },
      steps: [],
      idempotencyKey: "tenant-b-isolation-mission-0001",
    });
    const listedByA = await a.list({ limit: 100 });
    expect(listedByA.some(row => row.id === mission.id)).toBe(false);
    await expect(a.get({ missionId: mission.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});