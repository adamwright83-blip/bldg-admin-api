/* LEGACY DAYFORGE COMPATIBILITY: retained historical table literals only; canonical product is JOYSTICK. */
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saasRouter } from "./saasRouter";
import {
  activateOnboardingOwner,
  provisionTenantFromSubscription,
  saveOnboardingConfiguration,
  startSaasOnboarding,
} from "./saasStore";

const enabled = process.env.SAAS_LAUNCH_EXAM === "1";
const suite = enabled ? describe : describe.skip;

suite("JOYSTICK two-fresh-customer launch exam", () => {
  let db: Connection;
  const suffix = Date.now().toString(36);
  const planKey = `launch-${suffix}`;
  const businesses: Array<{
    label: string;
    sessionId: string;
    resumeToken: string;
    tenantId: string;
    openId: string;
    customerName: string;
  }> = [];

  const configuration = (label: string, slug: string, email: string) => ({
    businessName: label,
    slug,
    contactName: `${label} Owner`,
    contactEmail: email,
    contactPhone: null,
    website: null,
    timeZone: "America/Los_Angeles",
    brandName: label,
    logoUrl: null,
    primaryColor: "#111111",
    proposalTemplateKey: null,
    importProviderKey: "csv",
    locations: [{
      label: "Main",
      address: `1 ${label} Street`,
      latitude: null,
      longitude: null,
      serviceRadiusMiles: 10,
      maxPoundsPerDay: 500,
      maxPoundsByWeekday: { monday: 500 },
      openCapacityPoundsPerWeek: 1000,
      pickupDays: ["monday"],
      routeWindows: ["09:00-12:00"],
      turnaroundHours: 24,
      deliveryEnabled: true,
    }],
    services: [{
      locationKey: "Main",
      serviceKey: "wash_fold",
      name: "Wash & Fold",
      enabled: true,
      commercialEnabled: false,
      pricePerPoundCents: 250,
      minimumOrderCents: null,
      terms: null,
    }],
  });

  const ctx = (tenantId: string, openId: string) =>
    ({
      req: {
        headers: { host: "admin.bldg.chat", origin: "https://admin.bldg.chat" },
        protocol: "https",
      },
      res: {},
      user: {
        id: tenantId.endsWith("a") ? 920001 : 920002,
        openId,
        role: "user",
        tenantId,
        name: openId,
        email: `${openId.replace(/[^a-z0-9]/gi, "-")}@example.invalid`,
        loginMethod: "dayforge_password",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      vendorSession: null,
      tenantId,
    }) as never;

  function csv(customerName: string, customerId: string): string {
    return [
      "Order ID,Customer,Customer ID,Email,Phone,Address,Payment Date,Paid,Payment Type,Card Payment Type,Total after Credit Used,Status",
      `1001,${customerName},${customerId},${customerId}@example.invalid,3105550101,123 Test St,12 May 2026 21:38,1,Card,Clearent Saved Card,33.75,collected`,
    ].join("\n");
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    db = await mysql.createConnection(process.env.DATABASE_URL);
    const [[database]] = await db.query("SELECT DATABASE() AS name");
    const name = String((database as { name?: string })?.name ?? "");
    if (!name.includes("launch_two_tenants")) {
      throw new Error(`Refusing launch exam outside disposable DB: ${name}`);
    }

    await db.execute(
      `INSERT INTO dayforge_saas_billing_plans
        (planKey,displayName,stripePriceId,trialDays,rulesJson,entitlementsJson,active)
       VALUES (?,?,?,7,?, ?,true)`,
      [
        planKey,
        "Launch Exam Plan",
        `price_${planKey}`,
        JSON.stringify({
          usageBudgets: {
            aiWarningCents: 100,
            aiHardCents: 200,
            totalWarningCents: 200,
            totalHardCents: 400,
          },
        }),
        JSON.stringify([
          "dayforge_core",
          "dayforge_field",
          "commercial_pipeline",
          "churn_radar",
        ]),
      ]
    );

    for (const [index, label] of ["Launch Laundry A", "Launch Laundry B"].entries()) {
      const key = index === 0 ? "a" : "b";
      const ownerEmail = `owner-${key}-${suffix}@example.invalid`;
      const started = await startSaasOnboarding({
        businessName: label,
        slug: `launch-${key}-${suffix}`,
        ownerEmail,
        requestId: randomUUID(),
      });
      await saveOnboardingConfiguration({
        sessionId: started.session.id,
        resumeToken: started.resumeToken!,
        expectedVersion: 1,
        currentStep: "review",
        configuration: configuration(label, `launch-${key}-${suffix}`, ownerEmail),
      });
      const eventTime = new Date(Date.now() + index * 1000);
      const provisioned = await provisionTenantFromSubscription({
        onboardingSessionId: started.session.id,
        stripeCustomerId: `cus_launch_${key}_${suffix}`,
        stripeSubscriptionId: `sub_launch_${key}_${suffix}`,
        planKey,
        status: "trialing",
        eventId: `evt_launch_${key}_${suffix}`,
        eventCreatedAt: eventTime,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(eventTime.getTime() + 30 * 86400_000),
        trialEnd: new Date(eventTime.getTime() + 7 * 86400_000),
        latestInvoiceId: `in_launch_${key}_${suffix}`,
      });
      const activated = await activateOnboardingOwner({
        sessionId: started.session.id,
        resumeToken: started.resumeToken!,
        name: `${label} Owner`,
        passwordHash: "launch-exam-password-hash-not-real",
      });
      expect(activated.tenantId).toBe(provisioned.tenantId);
      businesses.push({
        label,
        sessionId: started.session.id,
        resumeToken: started.resumeToken!,
        tenantId: activated.tenantId,
        openId: activated.openId,
        customerName: `Customer ${key.toUpperCase()}`,
      });
    }
  });

  afterAll(async () => {
    if (db) await db.end();
  });

  it("binds each fresh owner to only their own tenant configuration", async () => {
    expect(businesses).toHaveLength(2);
    const [a, b] = businesses;
    expect(a!.tenantId).not.toBe(b!.tenantId);
    const callerA = saasRouter.createCaller(ctx(a!.tenantId, a!.openId));
    const callerB = saasRouter.createCaller(ctx(b!.tenantId, b!.openId));
    const [meA, meB] = await Promise.all([callerA.me(), callerB.me()]);
    expect(meA.tenantId).toBe(a!.tenantId);
    expect(meB.tenantId).toBe(b!.tenantId);
    expect(meA.configuration?.tenant.brandName).toBe(a!.label);
    expect(meB.configuration?.tenant.brandName).toBe(b!.label);
    expect(meA.configuration?.tenant.brandName).not.toBe(meB.configuration?.tenant.brandName);
  });

  it("imports two independent books through the real SaaS router with colliding external order ids", async () => {
    const [a, b] = businesses;
    const callerA = saasRouter.createCaller(ctx(a!.tenantId, a!.openId));
    const callerB = saasRouter.createCaller(ctx(b!.tenantId, b!.openId));

    const [resultA, resultB] = await Promise.all([
      callerA.importCsv({
        providerKey: "cleancloud_csv",
        sourceFileName: "tenant-a.csv",
        payload: csv(a!.customerName, "customer-a"),
        reportType: "orders_sales",
      }),
      callerB.importCsv({
        providerKey: "cleancloud_csv",
        sourceFileName: "tenant-b.csv",
        payload: csv(b!.customerName, "customer-b"),
        reportType: "orders_sales",
      }),
    ]);
    expect(resultA.importedCustomers).toBe(1);
    expect(resultB.importedCustomers).toBe(1);
    expect(resultA.importedOrders).toBe(1);
    expect(resultB.importedOrders).toBe(1);

    for (const business of businesses) {
      const [customers] = await db.execute<RowDataPacket[]>(
        `SELECT tenantId,name,externalId
           FROM dayforge_saas_external_customers
          WHERE tenantId = ?`,
        [business.tenantId]
      );
      const [orders] = await db.execute<RowDataPacket[]>(
        `SELECT tenantId,externalId,totalCents
           FROM dayforge_saas_external_orders
          WHERE tenantId = ?`,
        [business.tenantId]
      );
      const [paidOrders] = await db.execute<RowDataPacket[]>(
        `SELECT tenantId,cleancloudOrderId,customerName
           FROM cleancloud_paid_orders
          WHERE tenantId = ?`,
        [business.tenantId]
      );
      expect(customers).toHaveLength(1);
      expect(customers[0]?.tenantId).toBe(business.tenantId);
      expect(customers[0]?.name).toBe(business.customerName);
      expect(orders).toHaveLength(1);
      expect(orders[0]?.tenantId).toBe(business.tenantId);
      expect(orders[0]?.externalId).toBe("1001");
      expect(paidOrders).toHaveLength(1);
      expect(paidOrders[0]?.tenantId).toBe(business.tenantId);
      expect(paidOrders[0]?.cleancloudOrderId).toBe("1001");
      expect(paidOrders[0]?.customerName).toBe(business.customerName);
    }
  });

  it("keeps member and imported-book reads isolated between the two fresh tenants", async () => {
    const [a, b] = businesses;
    const callerA = saasRouter.createCaller(ctx(a!.tenantId, a!.openId));
    const callerB = saasRouter.createCaller(ctx(b!.tenantId, b!.openId));
    const [membersA, membersB] = await Promise.all([callerA.members(), callerB.members()]);
    expect(membersA.map(member => member.openId)).toEqual([a!.openId]);
    expect(membersB.map(member => member.openId)).toEqual([b!.openId]);
    expect(membersA.some(member => member.openId === b!.openId)).toBe(false);
    expect(membersB.some(member => member.openId === a!.openId)).toBe(false);

    const [crossA] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_external_customers WHERE tenantId = ? AND name = ?",
      [a!.tenantId, b!.customerName]
    );
    const [crossB] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_external_customers WHERE tenantId = ? AND name = ?",
      [b!.tenantId, a!.customerName]
    );
    expect(Number(crossA[0]?.count ?? 0)).toBe(0);
    expect(Number(crossB[0]?.count ?? 0)).toBe(0);
  });
});
