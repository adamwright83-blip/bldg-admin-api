/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import type { ProactiveObligation } from "../../shared/claireProactive";
import { appendGoalCycleDecision } from "../agents/persistentOperator/decisionStore";
import { resolveCanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import {
  attachObligationDecisionLineage,
  upsertPersistentOperatorObligation,
} from "../agents/persistentOperator/obligationStore";
import { rankMissionDirectorWork } from "../planning/missionDirector/rankableWork";
import { loadWeeklyGrowthCandidates } from "./loadWeeklyGrowthCandidates";

/**
 * Real-MySQL proof for Stage 1 Phase 3 (d): an obligation's execution type,
 * stored by the goal-cycle decision that selected it, reaches Mission Director
 * through the production candidate feed instead of being re-derived from text.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("obligation reader on MySQL passes the stored execution type through", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("a stored challenge stays a challenge; an obligation with none stays unknown, never invented", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `obltype-${suffix}`;
    const openId = `obltype-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Obligation type test", "Obligation type test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, openId]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: openId }, subsystem: "obligation_type_test" });
    if (!resolved.ok) throw new Error("identity");
    const identity = resolved.identity;
    const runId = randomUUID();
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', 'active', '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [runId, tenantId, identity.canonicalOperatorId, openId, randomUUID()]
    );
    const now = new Date();
    const day = formatInTimeZone(now, zone, "yyyy-MM-dd");
    // Titles text classification cannot type, as in production.
    const obligation = (customer: string): ProactiveObligation => ({
      id: `dormant_recovery:${customer}:${suffix}`,
      kind: "dormant_recovery",
      subjectKey: `customer:${customer}`,
      subjectName: customer,
      status: "scheduled",
      dueDate: day,
      title: `Win back ${customer}`,
      why: `${customer} has not ordered in 40 days.`,
      draft: null,
      historyIntact: true,
      moveCount: 0,
    });
    const ines = obligation("Ines");
    const joaquin = obligation("Joaquin");
    for (const o of [ines, joaquin]) await upsertPersistentOperatorObligation({ tenantId, operatorUserId: openId, obligation: o });

    // The goal cycle selected Ines's obligation as a challenge and stored that lineage.
    const { decision } = await appendGoalCycleDecision({
      tenantId, goalRunId: runId, cycleId: randomUUID(),
      canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: openId, policyVersion: "v1",
      weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: null,
      candidateIds: [], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
      selectionKind: "obligation", selectedRef: ines.id, selectedExecutionType: "challenge",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
      sourceCoverage: {}, loadout: [], experiment: null,
    });
    expect(await attachObligationDecisionLineage({
      tenantId, obligationId: ines.id, canonicalOperatorId: identity.canonicalOperatorId,
      goalRunId: runId, cycleId: decision.cycleId, decisionId: decision.id, executionType: decision.selectedExecutionType,
    })).toBe(true);

    const feed = await loadWeeklyGrowthCandidates({
      tenantId,
      operatorUserId: openId,
      dayDirectorActorId: identity.dayDirectorActorId,
      remainingDates: [day],
      businessDate: day,
      now,
      timeZone: zone,
    });
    const fromObligation = (id: string) =>
      feed.candidates.find(candidate => candidate.sourceRefs.some(ref => ref.sourceId === id));
    expect(fromObligation(ines.id)?.storedExecutionType).toBe("challenge");
    expect(fromObligation(joaquin.id)?.storedExecutionType).toBeUndefined();

    const plan = rankMissionDirectorWork({
      candidates: feed.candidates,
      campaigns: [],
      campaignPrepReady: {},
      context: { businessDate: day, macroGoal: null, openTasks: [] },
      pockets: [],
    });
    const ranked = (id: string) => plan.ranking.find(item => item.workId === fromObligation(id)!.id)!;
    expect(ranked(ines.id)).toMatchObject({ executionType: "challenge", eligible: true, blockedReasons: [] });
    expect(ranked(joaquin.id).blockedReasons).toContain("EXECUTION_TYPE_UNKNOWN");
  });
});
