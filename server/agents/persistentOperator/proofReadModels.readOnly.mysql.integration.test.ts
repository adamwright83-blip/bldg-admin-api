/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";
import type { ExecutionIntelligenceItem } from "../../../shared/executionIntelligence";
import { appendGoalCycleDecision } from "./decisionStore";
import { resolveCanonicalOperatorIdentity } from "./identity";
import { processPendingOutcomeLearnings } from "./learningStore";
import { materializeGoalCycleObjective } from "./objectiveStore";
import { recordGoalCycleOutcome } from "./outcomeStore";
import { getAuthoritativeScoreboard, getLoadoutDelta } from "./proofReadModels";

/**
 * Real-MySQL proof for Stage 1 Phase 3 (b): reading the scoreboard or the
 * loadout delta never runs learning. The outcome here is settled but was never
 * learned (what a crash between the outcome insert and its inline learning
 * leaves behind); only the learning sweeper may turn it into a learned delta.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("report reads on MySQL never run learning; the sweeper owns it", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function settledUnlearnedOutcome() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `readonly-${suffix}`;
    const operator = `readonly-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Read-only test", "Read-only test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, operator, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operator]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operator }, subsystem: "read_only_test" });
    if (!resolved.ok) throw new Error("identity");
    const identity = resolved.identity;
    const runId = randomUUID();
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', 'active', '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [runId, tenantId, identity.canonicalOperatorId, operator, randomUUID()]
    );
    const technique = { key: "doctrine:door-hanger-blitz", version: 1, doctrineFamily: "outreach", title: "Door hangers" } as unknown as ExecutionIntelligenceItem;
    const { decision } = await appendGoalCycleDecision({
      tenantId, goalRunId: runId, cycleId: randomUUID(),
      canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: operator, policyVersion: "v1",
      weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: null,
      candidateIds: ["candidate:door-hangers"], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
      selectionKind: "candidate", selectedRef: "candidate:door-hangers", selectedExecutionType: "mission",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
      sourceCoverage: {}, loadout: [technique], experiment: null,
    });
    const { objective } = await materializeGoalCycleObjective({ tenantId, decision, businessDate: "2026-10-19" });
    // Recorded through the real write path while unsettled (so its inline
    // learning does not run), then settled with no learning: the state a crash
    // between the insert and its inline learning leaves.
    const { outcome } = await recordGoalCycleOutcome({
      tenantId,
      objectiveId: objective.id,
      outcomeKind: "verified_payment",
      impactClass: "commercial_revenue",
      evidenceClass: "authoritative_external",
      evidenceReference: `stripe:pi_${randomUUID().replaceAll("-", "")}`,
      sourceSystem: "stripe",
      monetaryValueCents: 4500,
      epistemicStatus: "unverified",
      observedAt: new Date(),
    });
    await sql.execute("UPDATE goal_cycle_outcomes SET epistemicStatus = 'verified' WHERE tenantId = ? AND id = ?", [tenantId, outcome.id]);
    return { tenantId, identity, runId, outcomeId: outcome.id };
  }

  async function deltaCount(tenantId: string, outcomeId: string) {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM goal_cycle_learned_deltas WHERE tenantId = ? AND outcomeId = ?",
      [tenantId, outcomeId]
    );
    return Number(rows[0]!.n);
  }

  it("a scoreboard read and a loadout-delta read leave a settled outcome unlearned", async () => {
    const t = await settledUnlearnedOutcome();
    expect(await deltaCount(t.tenantId, t.outcomeId)).toBe(0);

    const board = await getAuthoritativeScoreboard({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId, goalRunId: t.runId });
    expect(board.successfulOutcomesCount).toBe(1);
    expect(board.learnedDeltasCount).toBe(0);
    expect(await getLoadoutDelta({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId })).toBeNull();

    expect(await deltaCount(t.tenantId, t.outcomeId)).toBe(0);
  });

  it("the learning sweeper learns it, and the next read reports what it learned", async () => {
    const t = await settledUnlearnedOutcome();
    const swept = await processPendingOutcomeLearnings({ tenantId: t.tenantId });
    expect(swept).toEqual({ processedCount: 1, errors: [] });
    expect(await deltaCount(t.tenantId, t.outcomeId)).toBe(1);

    const board = await getAuthoritativeScoreboard({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId, goalRunId: t.runId });
    expect(board.learnedDeltasCount).toBe(1);
    const delta = await getLoadoutDelta({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId });
    expect(delta?.targetKey).toBe("doctrine:door-hanger-blitz");
    expect(await deltaCount(t.tenantId, t.outcomeId)).toBe(1);
  });
});
