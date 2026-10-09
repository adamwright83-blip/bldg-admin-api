/* LEGACY DAYFORGE COMPATIBILITY: retained historical database, route and environment literals only; canonical product is JOYSTICK. */
import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import superjson from "superjson";
import { businessDateInZone } from "../../shared/currentDayLine";
import { database, provisionOwner, cleanupOwner, login, rpc as authenticatedRpc } from "./helpers";

// Every request below uses cookies issued by the actual password login route.
// The response ledger is attached even on failure so denied HTTP responses are reviewable.
test("real authenticated two-tenant HTTP isolation and denied-write persistence", async ({ browser }, testInfo) => {
  const db = await database();
  const owners: Awaited<ReturnType<typeof provisionOwner>>[] = [];
  const contexts: BrowserContext[] = [];
  const evidence: unknown[] = [];
  const rpc = async (request: APIRequestContext, procedure: string, input?: unknown, mutation = false) => {
    const result = await authenticatedRpc(request, procedure, input, mutation);
    evidence.push({ procedure, input, status: 200, result });
    return result;
  };
  const denied = async (request: APIRequestContext, procedure: string, input: unknown, mutation = false) => {
    const payload = superjson.serialize(input);
    const response = mutation
      ? await request.post(`/api/trpc/${procedure}`, { data: payload })
      : await request.get(`/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(payload))}`);
    const body = await response.json();
    evidence.push({ procedure, input, status: response.status(), body });
    expect(response.ok(), `Cross-tenant ${procedure} must be denied`).toBe(false);
    const error = body.error?.json ?? body.error;
    if (error?.data?.code === "INTERNAL_SERVER_ERROR") {
      // Legacy domain services throw plain errors for absent tenant records.
      // A generic server failure alone is never sufficient denial evidence.
      expect(error.message).toMatch(/not found.*tenant|mission not found/i);
    } else {
      expect(["NOT_FOUND", "FORBIDDEN", "BAD_REQUEST", "UNAUTHORIZED"]).toContain(error?.data?.code);
    }
  };
  const snapshot = async (tenantId: string) => {
    const result: Record<string, unknown> = {};
    for (const table of ["commercial_missions", "commercial_mission_events", "orders", "day_director_commitments", "dayforge_saas_subscriptions", "goldline_onboarding_sessions", "goldline_world_events"]) {
      const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE tenantId = ? ORDER BY id`, [tenantId]);
      result[table] = rows;
    }
    return result;
  };
  try {
    for (const label of ["Isolation A", "Isolation B"]) {
      const owner = await provisionOwner(label);
      owners.push(owner);
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await login(page, owner);
      await page.screenshot({ path: testInfo.outputPath(`${owners.length}-authenticated.png`), fullPage: true });
    }
    const [a, b] = owners;
    const [ca, cb] = contexts;
    const records = [];
    for (const [owner, context, marker] of [[a, ca, "A"], [b, cb, "B"]] as const) {
      const [insert] = await db.execute<ResultSetHeader>(`INSERT INTO orders
        (tenantId,serviceType,pickupDate,pickupTimeWindow,address,firstName,lastName,phone,status,total,paid)
        VALUES (?,'wash_fold','2099-01-01','8-10','123 Acceptance St',?,'Customer',?,'new',25,false)`,
        [owner.tenantId, `Isolation ${marker}`, marker === "A" ? "3105550101" : "3105550202"]);
      await db.execute(`INSERT INTO dayforge_saas_subscriptions
        (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,lastStripeEventId,lastStripeEventCreatedAt)
        VALUES (?,?,?,?,'active',?,CURRENT_TIMESTAMP)`, [owner.tenantId, `isolation-plan-${marker}`, `cus_${owner.tenantId}`, `sub_${owner.tenantId}`, `evt_${owner.tenantId}`]);
      await rpc(context.request, "system.commercialMission.create", {
        assignedTo: owner.openId,
        account: { providerName: null, providerAccountId: null, name: `Isolation ${marker} Prospect`, accountType: "apartment", website: null, address: `100 Isolation ${marker} Avenue`, latitude: null, longitude: null, locationCount: 1, decisionMaker: { name: null, title: null } },
        opportunity: { estimatedAnnualValueCents: 120000, estimateConfidence: "medium", score: 60, primarySignal: `Isolation ${marker} opportunity`, reasons: ["real tenant isolation"], risks: [], evidence: [] },
        brief: { laundryOpportunity: `Isolation ${marker} laundry`, salesAngle: "Test", openingLine: "Hello", discoveryQuestions: [], objections: [] },
        steps: [], idempotencyKey: randomUUID(),
      }, true);
      const nowIso = new Date().toISOString();
      const businessDate = businessDateInZone(new Date(), "America/Los_Angeles");
      await db.execute(`INSERT INTO day_director_commitments
        (id,tenantId,actorId,businessDate,idempotencyKey,title,kind,provenance,status,sourceText,metadataJson)
        VALUES (?,?,?,?,?,?,'growth','manual','open',?,?)`, [randomUUID(), owner.tenantId, String(owner.userId), businessDate, randomUUID(), `Isolation ${marker} Primary`, `Isolation ${marker} explicit primary work`, JSON.stringify({
          command: { role: "primary", designatedBy: "operator", designatedAt: nowIso, demotedAt: null, demotedReason: null, promisedTo: null, promisedDeadline: null, identityUnknown: false, cargoLink: null, recurrenceRuleId: null, constraints: { windowStart: null, windowEnd: null, scheduleLabel: null } },
          operatorMission: { version: 1, source: "operator_explicit", scope: "today_only", completionCondition: `Complete Isolation ${marker} primary`, verification: "operator_reported", operatorMissionKey: `isolation-${owner.tenantId}`, requestedAt: nowIso, weeklyIntentDisplacement: true, sourceCommandRef: `isolation:${owner.tenantId}`, evidenceQuote: `make Isolation ${marker} primary`, businessDate },
        })]);
      const missions = await rpc(context.request, "system.commercialMission.list", { limit: 100 });
      expect(missions.length).toBeGreaterThan(0);
      const assets = await rpc(context.request, "system.customerAssets.list");
      const asset = assets.find((row: any) => row.displayName === `Isolation ${marker} Customer`);
      expect(asset).toBeDefined();
      records.push({ orderId: insert.insertId, assetId: asset.id, missionId: missions[0].id, version: missions[0].version });
    }
    for (const [owner, foreign, context, own, other] of [[a,b,ca,records[0],records[1]], [b,a,cb,records[1],records[0]]] as const) {
      const request = context.request;
      const onboarding = await rpc(request, "system.goldlineOnboarding.state", { tenantId: foreign.tenantId, sessionId: foreign.session.id });
      expect(onboarding.session.tenantId).toBe(owner.tenantId);
      expect(onboarding.session.mission.id).toBe(owner.missionId);
      expect(onboarding.session.world).toEqual(owner.session.world);
      const me = await rpc(request, "system.saas.me");
      expect(me.tenantId).toBe(owner.tenantId);
      expect(me.configuration.tenant.id).toBe(owner.tenantId);
      expect(me.billing.planKey).toBe(owner === a ? "isolation-plan-A" : "isolation-plan-B");
      const members = await rpc(request, "system.saas.members");
      expect(members.some((row: any) => row.openId === owner.openId)).toBe(true);
      expect(members.some((row: any) => row.openId === foreign.openId)).toBe(false);
      const missions = await rpc(request, "system.commercialMission.list", { limit: 100 });
      expect(missions.some((row: any) => row.id === own.missionId)).toBe(true);
      expect(missions.some((row: any) => row.id === other.missionId)).toBe(false);
      expect((await rpc(request, "system.commercialMission.get", { missionId: own.missionId })).id).toBe(own.missionId);
      const line = await rpc(request, "system.currentDayLine.today");
      expect(line.designated?.title).toBe(owner === a ? "Isolation A Primary" : "Isolation B Primary");
      expect(JSON.stringify(line)).not.toContain(foreign.tenantId);
      const world = await rpc(request, "system.businessWorld.get");
      expect(world.business.tenantId).toBe(owner.tenantId);
      const claire = await rpc(request, "system.claire.driveContext", { phase: "pre_drive" });
      expect(claire.identityTruth.tenant.tenantId).toBe(owner.tenantId);
      expect(claire.identityTruth.tenant.businesses[0].registeredName).toBe(owner === a ? "Isolation A" : "Isolation B");
      const missionContext = await rpc(request, "system.claire.driveContext", { phase: "pre_drive", missionId: own.missionId });
      expect(missionContext.mission.id).toBe(own.missionId);
      expect(missionContext.identityTruth.tenant.tenantId).toBe(owner.tenantId);
      const assets = await rpc(request, "system.customerAssets.list");
      expect(assets.some((row: any) => row.id === own.assetId)).toBe(true);
      expect(assets.some((row: any) => row.id === other.assetId)).toBe(false);
      expect((await rpc(request, "system.customerAssets.detail", { assetId: own.assetId })).id).toBe(own.assetId);
      await denied(request, "system.customerAssets.detail", { assetId: other.assetId });
      // Order administration is restricted to platform/driver/vendor roles; tenant
      // owners receive their scoped order history through customerAssets instead.
      await denied(request, "orders.getOrder", { id: other.orderId });
      const beforeOwn = await snapshot(owner.tenantId);
      const beforeForeign = await snapshot(foreign.tenantId);
      await denied(request, "system.goldlineOnboarding.fieldOutcome", { missionId: foreign.missionId, text: "Cross tenant observation must never persist", confirmedPresence: true, gps: null }, true);
      await denied(request, "system.commercialMission.get", { missionId: other.missionId });
      await denied(request, "system.commercialMission.transition", { missionId: other.missionId, expectedVersion: other.version, toStatus: "selected", idempotencyKey: randomUUID() }, true);
      await denied(request, "system.currentDayLine.today", { targetTenantId: foreign.tenantId });
      await denied(request, "system.currentDayLine.completeItem", { targetTenantId: foreign.tenantId, itemId: String(other.missionId), evidenceReference: "cross-tenant forbidden attempt" }, true);
      await denied(request, "system.claire.driveContext", { phase: "pre_drive", missionId: other.missionId });
      await denied(request, "orders.updateStatus", { orderId: other.orderId, status: "collected" }, true);
      // These procedures accept no tenant identifier. Supplying a foreign identity must
      // not replace the authenticated identity or disclose its configuration/billing/world.
      expect((await rpc(request, "system.saas.me", { tenantId: foreign.tenantId })).tenantId).toBe(owner.tenantId);
      expect((await rpc(request, "system.businessWorld.get", { tenantId: foreign.tenantId })).business.tenantId).toBe(owner.tenantId);
      expect(await snapshot(owner.tenantId)).toEqual(beforeOwn);
      expect(await snapshot(foreign.tenantId)).toEqual(beforeForeign);
      evidence.push({ tenantId: owner.tenantId, ownMission: own.missionId, ownOrder: own.orderId, dayLine: line, billing: me.billing, worldTenant: world.business.tenantId, claireTenant: claire.identityTruth.tenant.tenantId, deniedWritesHadNoEffect: true });
    }
  } finally {
    await testInfo.attach("authenticated-isolation-http-and-db-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    for (const context of contexts) await context.close();
    await db.end();
    for (const owner of owners) await cleanupOwner(owner);
  }
});
