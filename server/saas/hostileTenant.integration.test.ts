/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDateInZone } from "../../shared/currentDayLine";
import { churnRadarRouter } from "../churnRadar/churnRadarRouter";
import { claireRouter } from "../claire/claireRouter";
import { createConversationSession } from "../claire/conversation/ledgerService";
import { commercialMissionRouter } from "../commercialMissions/commercialMissionRouter";
import { commercialPipelineRouter } from "../commercialPipeline/commercialPipelineRouter";
import { customerAssetRouter } from "../customerAssets/customerAssetRouter";
import { getDashboardTimeZone } from "../dashboardZoned";
import { currentDayLineRouter } from "../goldline/dayline/currentDayLineRouter";
import { teamRouter } from "../team/teamRouter";
import { saasRouter } from "./saasRouter";
import { deleteTenantData, planTenantDeletion } from "./tenantLifecycle";

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
  const ownerNumericIdA = 910001;
  const ownerNumericIdB = 910002;
  let db: mysql.Connection;
  let missionAId = 0;
  let missionBId = 0;
  let pipelineAId = 0;
  let pipelineBId = 0;
  let claireSessionAId = "";
  let claireSessionBId = "";

  const ctx = (tenantId: string, openId: string) =>
    ({
      req: { headers: { host: "admin.bldg.chat" }, protocol: "https" },
      res: {},
      user: {
        id: tenantId === tenantA ? ownerNumericIdA : ownerNumericIdB,
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

  const missionInput = (label: string, assignedTo: string) => ({
    assignedTo,
    account: {
      providerName: null,
      providerAccountId: null,
      name: `${label} Prospect`,
      accountType: "apartment",
      website: null,
      address: `100 ${label} Avenue`,
      latitude: null,
      longitude: null,
      locationCount: 1,
      decisionMaker: {
        name: null,
        title: null,
      },
    },
    opportunity: {
      estimatedAnnualValueCents: 120000,
      estimateConfidence: "medium" as const,
      score: 60,
      primarySignal: `${label} test opportunity`,
      reasons: ["hostile tenant isolation test"],
      risks: [],
      evidence: [],
    },
    brief: {
      laundryOpportunity: `${label} laundry opportunity`,
      salesAngle: "Tenant-isolated test angle",
      openingLine: "Tenant-isolated test opener",
      discoveryQuestions: [],
      objections: [],
    },
    steps: [],
    idempotencyKey: `hostile-mission-${label.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
  });

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
        `INSERT INTO dayforge_saas_subscriptions
          (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,lastStripeEventId,lastStripeEventCreatedAt)
         VALUES (?, 'hostile-test-plan', ?, ?, 'active', ?, CURRENT_TIMESTAMP)`,
        [
          tenantId,
          `cus_${tenantId}`,
          `sub_${tenantId}`,
          `evt_${tenantId}`,
        ]
      );
      for (const entitlement of [
        "boreslay",
        "dayforge_field",
        "commercial_pipeline",
        "churn_radar",
      ]) {
        await db.execute(
          `INSERT INTO dayforge_saas_entitlements
            (tenantId,entitlementKey,source,enabled)
           VALUES (?,?,'manual',true)`,
          [tenantId, entitlement]
        );
      }
      await db.execute(
        `INSERT INTO orders
          (tenantId,serviceType,pickupDate,pickupTimeWindow,address,firstName,lastName,phone,status,total,paid)
         VALUES (?,'wash_fold','2099-01-01','8-10','123 Test St',?,?,?,'new',25.00,false)`,
        [tenantId, label, "Customer", tenantId === tenantA ? "3105550101" : "3105550202"]
      );
    }

    const missionCallerA = commercialMissionRouter.createCaller(ctx(tenantA, ownerA));
    const missionCallerB = commercialMissionRouter.createCaller(ctx(tenantB, ownerB));
    // Commercial mission creation opens transactions that touch shared auto-increment
    // indexes. Run the two tenant fixtures sequentially so this isolation exam tests
    // authorization rather than occasionally losing to a MySQL lock-order deadlock.
    const missionA = await missionCallerA.create(missionInput("Tenant A", ownerA));
    const missionB = await missionCallerB.create(missionInput("Tenant B", ownerB));
    missionAId = missionA.id;
    missionBId = missionB.id;

    const pipelineCallerA = commercialPipelineRouter.createCaller(ctx(tenantA, ownerA));
    const pipelineCallerB = commercialPipelineRouter.createCaller(ctx(tenantB, ownerB));
    const [pipelinesA, pipelinesB] = await Promise.all([
      pipelineCallerA.list(),
      pipelineCallerB.list(),
    ]);
    pipelineAId = pipelinesA.find(row => row.mission.id === missionAId)?.id ?? 0;
    pipelineBId = pipelinesB.find(row => row.mission.id === missionBId)?.id ?? 0;
    if (!pipelineAId || !pipelineBId) {
      throw new Error("Synthetic commercial pipeline was not created");
    }

    const businessDate = businessDateInZone(new Date(), getDashboardTimeZone());
    const nowIso = new Date().toISOString();
    for (const [tenantId, actorId, label] of [
      [tenantA, String(ownerNumericIdA), "Tenant A"],
      [tenantB, String(ownerNumericIdB), "Tenant B"],
    ] as const) {
      const commitmentId = randomUUID();
      await db.execute(
        `INSERT INTO day_director_commitments
          (id,tenantId,actorId,businessDate,idempotencyKey,title,kind,provenance,status,sourceText,metadataJson)
         VALUES (?,?,?,?,?,?, 'growth','manual','open',?,?)`,
        [
          commitmentId,
          tenantId,
          actorId,
          businessDate,
          `hostile-dayline-${tenantId}`,
          `${label} Primary`,
          `${label} explicit primary work`,
          JSON.stringify({
            command: {
              role: "primary",
              designatedBy: "operator",
              designatedAt: nowIso,
              demotedAt: null,
              demotedReason: null,
              promisedTo: null,
              promisedDeadline: null,
              identityUnknown: false,
              cargoLink: null,
              recurrenceRuleId: null,
              constraints: {
                windowStart: null,
                windowEnd: null,
                scheduleLabel: null,
              },
            },
            operatorMission: {
              version: 1,
              source: "operator_explicit",
              scope: "today_only",
              completionCondition: `Complete ${label} primary work`,
              verification: "operator_reported",
              operatorMissionKey: `hostile-${tenantId}`,
              requestedAt: nowIso,
              weeklyIntentDisplacement: true,
              sourceCommandRef: `hostile:${tenantId}`,
              evidenceQuote: `make ${label} primary`,
              businessDate,
            },
          }),
        ]
      );

      await db.execute(
        `INSERT INTO customer_churn_scans
          (id,tenantId,requestId,status,sourceOrderCount,customerCount,atRiskCount,computedAt,createdBy)
         VALUES (?,?,?,'completed',?,?,?,CURRENT_TIMESTAMP,?)`,
        [
          randomUUID(),
          tenantId,
          randomUUID(),
          tenantId === tenantA ? 11 : 22,
          tenantId === tenantA ? 3 : 5,
          tenantId === tenantA ? 1 : 2,
          actorId,
        ]
      );
    }

    const [sessionA, sessionB] = await Promise.all([
      createConversationSession({
        tenantId: tenantA,
        operatorUserId: ownerA,
        claireConversationId: randomUUID(),
        conversationKind: "hostile_tenant_exam",
        recordingEnabled: false,
      }),
      createConversationSession({
        tenantId: tenantB,
        operatorUserId: ownerB,
        claireConversationId: randomUUID(),
        conversationKind: "hostile_tenant_exam",
        recordingEnabled: false,
      }),
    ]);
    claireSessionAId = sessionA.id;
    claireSessionBId = sessionB.id;
  });

  afterAll(async () => {
    if (db) await db.end();
    for (const tenantId of [tenantA, tenantB]) {
      const plan = await planTenantDeletion(tenantId);
      if (plan.totalRows > 0) {
        await deleteTenantData({
          tenantId,
          expectedTotalRows: plan.totalRows,
          confirmation: tenantId,
        });
      }
    }
  });

  it("real customer router lists only the authenticated tenant's customers", async () => {
    const a = customerAssetRouter.createCaller(ctx(tenantA, ownerA));
    const b = customerAssetRouter.createCaller(ctx(tenantB, ownerB));
    const [assetsA, assetsB] = await Promise.all([a.list(), b.list()]);
    const residentialA = assetsA.find(
      asset => asset.kind === "residential" && asset.displayName === "Tenant A Customer"
    );
    const residentialB = assetsB.find(
      asset => asset.kind === "residential" && asset.displayName === "Tenant B Customer"
    );
    const commercialA = assetsA.find(
      asset => asset.kind === "commercial" && asset.displayName === "Tenant A Prospect"
    );
    const commercialB = assetsB.find(
      asset => asset.kind === "commercial" && asset.displayName === "Tenant B Prospect"
    );

    expect(residentialA).toBeDefined();
    expect(residentialB).toBeDefined();
    expect(commercialA).toBeDefined();
    expect(commercialB).toBeDefined();
    expect(assetsA.some(asset => asset.displayName.startsWith("Tenant B"))).toBe(false);
    expect(assetsB.some(asset => asset.displayName.startsWith("Tenant A"))).toBe(false);
    expect(residentialA?.id).not.toBe(residentialB?.id);
    expect(commercialA?.id).not.toBe(commercialB?.id);
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

  it("commercial mission routers isolate reads and reject cross-tenant mission mutation", async () => {
    const a = commercialMissionRouter.createCaller(ctx(tenantA, ownerA));
    const b = commercialMissionRouter.createCaller(ctx(tenantB, ownerB));
    const [missionsA, missionsB] = await Promise.all([
      a.list({ limit: 100 }),
      b.list({ limit: 100 }),
    ]);
    expect(missionsA.some(row => row.id === missionAId)).toBe(true);
    expect(missionsA.some(row => row.id === missionBId)).toBe(false);
    expect(missionsB.some(row => row.id === missionBId)).toBe(true);
    expect(missionsB.some(row => row.id === missionAId)).toBe(false);

    await expect(a.get({ missionId: missionBId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      a.transition({
        missionId: missionBId,
        expectedVersion: 1,
        toStatus: "selected",
        idempotencyKey: `hostile-cross-mission-${suffix}`,
      })
    ).rejects.toThrow();
  });

  it("commercial pipeline routers isolate lists and cross-tenant detail ids", async () => {
    const a = commercialPipelineRouter.createCaller(ctx(tenantA, ownerA));
    const b = commercialPipelineRouter.createCaller(ctx(tenantB, ownerB));
    const [rowsA, rowsB] = await Promise.all([a.list(), b.list()]);
    expect(rowsA.some(row => row.id === pipelineAId)).toBe(true);
    expect(rowsA.some(row => row.id === pipelineBId)).toBe(false);
    expect(rowsB.some(row => row.id === pipelineBId)).toBe(true);
    expect(rowsB.some(row => row.id === pipelineAId)).toBe(false);
    expect(await a.detail({ pipelineId: pipelineBId })).toBeNull();
    expect(await b.detail({ pipelineId: pipelineAId })).toBeNull();
  });

  it("churn radar reads only the authenticated tenant's latest scan", async () => {
    const a = churnRadarRouter.createCaller(ctx(tenantA, ownerA));
    const b = churnRadarRouter.createCaller(ctx(tenantB, ownerB));
    const [scanA, scanB] = await Promise.all([a.latestScan(), b.latestScan()]);
    expect(scanA?.sourceOrderCount).toBe(11);
    expect(scanB?.sourceOrderCount).toBe(22);
    expect(scanA?.sourceOrderCount).not.toBe(scanB?.sourceOrderCount);
  });

  it("Day Line designation is tenant-scoped through the actual router", async () => {
    const a = currentDayLineRouter.createCaller(ctx(tenantA, ownerA));
    const b = currentDayLineRouter.createCaller(ctx(tenantB, ownerB));
    const [lineA, lineB] = await Promise.all([a.today(), b.today()]);
    expect(lineA.designated?.title).toBe("Tenant A Primary");
    expect(lineB.designated?.title).toBe("Tenant B Primary");
    expect(lineA.designated?.title).not.toBe(lineB.designated?.title);
  });

  it("Claire call analysis rejects another tenant's conversation session id", async () => {
    const a = claireRouter.createCaller(ctx(tenantA, ownerA));
    const b = claireRouter.createCaller(ctx(tenantB, ownerB));
    const ownA = await a.callAnalysis({ sessionId: claireSessionAId });
    const ownB = await b.callAnalysis({ sessionId: claireSessionBId });
    expect(ownA.session.id).toBe(claireSessionAId);
    expect(ownB.session.id).toBe(claireSessionBId);
    await expect(
      a.callAnalysis({ sessionId: claireSessionBId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      b.callAnalysis({ sessionId: claireSessionAId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});