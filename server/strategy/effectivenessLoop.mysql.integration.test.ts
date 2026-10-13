/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/* Claire + Daphne business-effectiveness loop on real MySQL. Laundry
 * Farm-shaped synthetic data only; no provider, phone, or production access. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { and, eq, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { admitNativeStripePayment } from "../domains/payment/paymentAdmission";
import { setActiveMacroGoal } from "../claire/macroGoalService";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "../agents/persistentOperator/identity";
import { activateMacroGoalAndQueue } from "../agents/persistentOperator/goalCycleService";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
import { configureTenantStrategyVertical } from "./marketContext";
import { _clearSnapshotStore } from "./snapshotBuilder";
import { prepareStrategicProposal, refreshStrategicDiagnosis } from "./strategicPreparation";
import { respondToStrategicProposal } from "./strategicApproval";
import { getDayDirectorState } from "../planning/dayDirector/dayDirectorService";
import {
  answerMissionFollowUp,
  revokeMissionPresentation,
  syncMissionFollowUp,
} from "../agents/daphne/missionFollowUp";
import { setDaphneMetaPreference } from "../agents/daphne/goalsPreferences";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { addDaysYmd } from "../analytics/businessPeriods";

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Chicago";
const DAY = 86_400_000;

describeMysql("Claire + Daphne business effectiveness loop", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `effect-${suffix}`;
  const operator = `effect-owner-${suffix}`;
  // Mission Director plans against the wall clock, so the journey does too.
  const now = new Date();
  const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
  let sql: mysql.Connection;
  let identity: CanonicalOperatorIdentity;
  let phoneSeq = 0;

  async function paidOrder(daysAgo: number, phone: string, cents: number) {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const at = new Date(now.getTime() - daysAgo * DAY);
    const created = at.toISOString().slice(0, 19).replace("T", " ");
    const total = (cents / 100).toFixed(2);
    await db.execute(dsql`
      INSERT INTO orders (tenantId, serviceType, pickupDate, pickupTimeWindow, address,
        firstName, lastName, phone, status, paid, total, createdAt)
      VALUES (${tenantId}, 'wash_fold', ${created.slice(0, 10)}, '9am-11am',
        '100 Test St, Des Moines, IA', ${`Cust${phone.slice(-3)}`}, 'Fixture',
        ${phone}, 'delivered', 0, ${total}, ${created})`);
    const [order] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.createdAt, new Date(created + "Z"))))
      .orderBy(dsql`id DESC`)
      .limit(1);
    const [row] = order
      ? [order]
      : await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), eq(orders.phone, phone)))
          .orderBy(dsql`id DESC`)
          .limit(1);
    if (!row) throw new Error("fixture order insert failed");
    const paymentIntentId = `pi_effect_${row.id}`;
    await admitNativeStripePayment({
      tenantId,
      orderId: row.id,
      paymentIntentId,
      paidAt: at,
      capture: { paymentIntentId, status: "succeeded", amountReceivedCents: cents, currency: "usd" },
      orderPatch: { total },
    });
  }
  const phone = () => `515555${String(1000 + phoneSeq++).padStart(4, "0")}`;

  beforeAll(async () => {
    await mkdir("artifacts/claire-strategy", { recursive: true });
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Laundry Farm test", "Laundry Farm test", "#123456", "Test operator", "operator@example.invalid", zone]
    );
    await sql.execute(
      "INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')",
      [tenantId, operator, "Test operator", "operator@example.invalid"]
    );
    await sql.execute(
      "INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)",
      [tenantId, operator]
    );
    await sql.execute(
      "INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)",
      [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]
    );
    await sql.execute(
      "INSERT INTO dayforge_saas_tenant_locations (tenantId,locationKey,label,address,latitude,longitude,serviceRadiusMiles,maxPoundsPerDay,maxPoundsByWeekdayJson,openCapacityPoundsPerWeek,pickupDaysJson,routeWindowsJson,turnaroundHours,deliveryEnabled,isPrimary) VALUES (?,'primary','Des Moines test territory','Des Moines, IA',41.59,-93.62,5,100,'{}',300,'[1,2,3,4,5]','[]',48,true,true)",
      [tenantId]
    );
    const resolved = await resolveCanonicalOperatorIdentity({
      tenantId,
      source: { type: "open_id", value: operator },
      subsystem: "effectiveness_acceptance",
    });
    if (!resolved.ok) throw new Error("Test canonical identity did not resolve");
    identity = resolved.identity;
    await configureTenantStrategyVertical({ identity, verticalKey: "laundry_fluff_fold" });
    await setActiveMacroGoal({
      tenantId,
      operatorUserId: operator,
      objective: "Recover monthly sales to the prior level",
      metricKey: "paid_orders_per_period",
      targetValue: 40,
      unit: "orders",
      targetDate: addDaysYmd(today, 60),
      source: "operator_attested",
      sourceNote: "Controlled acceptance goal",
    });
    await activateMacroGoalAndQueue({
      tenantId,
      identity,
      verticalKey: "laundry_fluff_fold",
      policyVersion: "v1",
      registry: defaultVerticalRegistry,
    });
    // Prior 30 days: 12 customers, two orders each at $40.
    const regulars = Array.from({ length: 12 }, phone);
    for (const p of regulars) {
      await paidOrder(55, p, 4000);
      await paidOrder(40, p, 4000);
    }
    // Current 30 days: only four of them returned, plus one new customer.
    for (const p of regulars.slice(0, 4)) await paidOrder(10, p, 4000);
    await paidOrder(5, phone(), 4000);
    _clearSnapshotStore();
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  // Remaining-week planning has no weekday horizon on weekends (as in the #575 journey).
  it.skipIf(Number(formatInTimeZone(new Date(), zone, "i")) >= 6)("diagnoses from observed revenue and retention, prepares, approves, learns from noncompletion, and changes the next mission", async () => {
    // 1–2. Claire reads actual revenue/retention evidence and compares approaches.
    const proposal = await prepareStrategicProposal({ identity, timeZone: zone, now });
    const d = proposal.diagnosis;
    const evidenceIds = new Set(d.evidence.map(e => e.unit));
    for (const key of ["net_sales_cents", "prior_net_sales_cents", "new_customers_30d", "returning_customers_30d", "dormant_customers"])
      expect(evidenceIds.has(key), key).toBe(true);
    expect(d.quality.structuralErrors).toEqual([]);
    expect(d.options.length).toBeGreaterThanOrEqual(2);
    for (const o of d.options) {
      expect(o.observedBasis).toBeTruthy();
      expect(o.expectedBenefit).toBeTruthy();
      expect(o.uncertainty).toBeTruthy();
      expect(o.nextMeasurableAction).toBeTruthy();
    }
    const comparisonEvidence = Object.fromEntries(
      d.evidence.filter(e => typeof e.value === "number").map(e => [e.unit, { value: e.value, quality: e.quality }])
    );
    await writeFile(
      "artifacts/claire-strategy/effectiveness-diagnosis.json",
      JSON.stringify({ comparisonEvidence, currentCondition: d.currentCondition, primaryConstraint: d.primaryConstraint, diagnosis: d.diagnosis, options: d.options, uncertainty: d.uncertainty }, null, 2)
    );
    expect(d.primaryConstraint).toBe("retention");
    expect(d.currentCondition).toContain("Recorded sales last 30 days $200.00 vs $960.00 the prior 30 (down 79%)");
    expect(d.currentCondition).toContain("Paid orders 5 vs 24.");
    expect(d.currentCondition).toContain("1 new and 4 returning customers");
    expect(d.options[0]!.approach).toMatch(/dormant customers/i);
    expect(d.options[0]!.expectedBenefit).toContain("$200.00");
    expect(d.options[1]!.reason).toMatch(/^Not preferred/);
    expect(JSON.stringify(d)).not.toMatch(/\bROI\b|profit will|will (increase|grow) profit|competitor [A-Z]/);

    // 3–4. A specific prepared mission goes through exact approval into the Day Line.
    expect(proposal.items.length).toBeGreaterThan(0);
    const item = proposal.items[0]!;
    expect(item.missionType).toBeTruthy();
    const approved = await respondToStrategicProposal({
      identity,
      proposalId: proposal.id,
      revision: proposal.revision,
      action: "approve",
      itemIds: [item.id],
      source: "authenticated_app",
    });
    expect(approved.failedItems).toEqual([]);
    const commitmentId = approved.actionIds[0]!;
    const stateArgs = {
      tenantId,
      actorId: identity.dayDirectorActorId,
      actorIds: identity.dayDirectorActorIds,
      canonicalOperatorId: identity.canonicalOperatorId,
    };
    const onDay = await getDayDirectorState({ ...stateArgs, businessDate: item.businessDate });
    const mission = onDay.commitments.find(c => c.id === commitmentId)!;
    expect(mission).toMatchObject({ title: item.title, missionType: item.missionType, status: "open", presentation: null });

    // 5. Day passes with the work still open: unresolved work, not a skip.
    const scope = {
      tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      operatorUserId: identity.canonicalOpenId,
      actorIds: identity.dayDirectorActorIds,
    };
    const nextDay = addDaysYmd(item.businessDate, 1);
    const followUp = await syncMissionFollowUp({ ...scope, today: nextDay });
    expect(followUp).toMatchObject({ commitmentId, title: item.title });
    expect(followUp!.question).toMatch(/^What happened with that .+\?$/);
    // Idempotent: a second sync neither duplicates the observation nor re-asks differently.
    expect(await syncMissionFollowUp({ ...scope, today: nextDay })).toEqual(followUp);
    const [unresolvedObs] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM daphne_observations WHERE tenantId = ? AND sourceType = 'day_director_commitment'",
      [tenantId]
    );
    expect(unresolvedObs).toHaveLength(1);
    expect(unresolvedObs[0]!.evidenceChannel).toBe("system_record");

    // 6–7. Operator explains; Daphne durably records stated reason and adjustment.
    const answered = await answerMissionFollowUp({
      ...scope,
      commitmentId,
      answer: "Honestly it was too much at once and I didn't know where to start.",
    });
    expect(answered.classification).toMatchObject({ reason: "task_size", epistemic: "explicit" });
    expect(answered.adjustmentApplied).toBe(true);
    const [statements] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM daphne_observations WHERE tenantId = ? AND sourceType IN ('day_line_unresolved_explanation','daphne_mission_presentation') ORDER BY occurredAt",
      [tenantId]
    );
    expect(statements.map(r => [r.observationKind, r.evidenceChannel])).toEqual([
      ["user_statement", "stated"],
      ["preference_declaration", "stated"],
    ]);
    // The unresolved item itself is untouched: still open, same title, date, objective.
    const [origRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM day_director_commitments WHERE tenantId = ? AND id = ?",
      [tenantId, commitmentId]
    );
    expect(origRows[0]).toMatchObject({ status: "open", title: item.title, businessDate: item.businessDate, sourceText: item.objective });
    expect(await syncMissionFollowUp({ ...scope, today: nextDay })).toBeNull();

    // 8–9. Claire's next preparation; the next matching mission carries Daphne's adjustment.
    // Claire's next preparation cycle, after the explanation.
    const nextNow = new Date();
    // The autonomous worker refreshes the diagnosis before preparation.
    await refreshStrategicDiagnosis({ identity, timeZone: zone, now: nextNow });
    const next = await prepareStrategicProposal({ identity, timeZone: zone, now: nextNow });
    const nextItem = next.items.find(i => i.missionType === item.missionType && i.id !== item.id)!;
    if (!nextItem) console.log("NEXT", JSON.stringify({ first: item, items: next.items, uncertainty: next.uncertainty.slice(-6) }, null, 1));
    expect(nextItem).toBeTruthy();
    const approvedNext = await respondToStrategicProposal({
      identity,
      proposalId: next.id,
      revision: next.revision,
      action: "approve",
      itemIds: [nextItem.id],
      source: "authenticated_app",
    });
    expect(approvedNext.failedItems).toEqual([]);
    const nextId = approvedNext.actionIds[0]!;
    const nextState = await getDayDirectorState({ ...stateArgs, businessDate: nextItem.businessDate });
    const adjusted = nextState.commitments.find(c => c.id === nextId)!;
    expect(adjusted.title).toBe(nextItem.title);
    expect(adjusted.sourceText).toBe(nextItem.objective);
    expect(adjusted.presentation).toMatchObject({
      adjustment: { kind: "task_size", firstStepOnly: true },
      missionType: item.missionType,
      sourceObservationId: answered.adjustmentObservationId,
    });

    // 10. Admin and Driver read the same canonical row; tenant isolation holds.
    const foreign = await getDayDirectorState({ ...stateArgs, tenantId: `foreign-${suffix}`, businessDate: nextItem.businessDate });
    expect(foreign.commitments).toEqual([]);

    // Consent and revocation: revoking adaptation removes the adjustment immediately.
    const sourceObservationId = answered.explanationObservationId;
    await setDaphneMetaPreference({ tenantId, canonicalOperatorId: identity.canonicalOperatorId, preferenceKey: "adaptation_enabled", value: false, sourceObservationId });
    const revokedConsent = await getDayDirectorState({ ...stateArgs, businessDate: nextItem.businessDate });
    expect(revokedConsent.commitments.find(c => c.id === nextId)!.presentation).toBeNull();
    await setDaphneMetaPreference({ tenantId, canonicalOperatorId: identity.canonicalOperatorId, preferenceKey: "adaptation_enabled", value: true, sourceObservationId });
    expect((await getDayDirectorState({ ...stateArgs, businessDate: nextItem.businessDate })).commitments.find(c => c.id === nextId)!.presentation).not.toBeNull();
    await revokeMissionPresentation({ ...scope, missionType: item.missionType!, now: new Date(nextNow.getTime() + 60_000) });
    expect((await getDayDirectorState({ ...stateArgs, businessDate: nextItem.businessDate })).commitments.find(c => c.id === nextId)!.presentation).toBeNull();

    await writeFile(
      "artifacts/claire-strategy/effectiveness-journey.json",
      JSON.stringify({
        tenantId,
        diagnosis: { constraint: d.primaryConstraint, currentCondition: d.currentCondition, selected: d.selectedApproach, options: d.options },
        firstMission: { commitmentId, title: item.title, missionType: item.missionType, businessDate: item.businessDate },
        followUp,
        explanation: answered,
        nextMission: { commitmentId: nextId, title: adjusted.title, presentation: adjusted.presentation },
      }, null, 2)
    );
  }, 120_000);
});
