/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";
import type { ExecutionIntelligenceItem } from "../../../shared/executionIntelligence";
import type { WeeklyGrowthCandidate } from "../../../shared/weeklyGrowthCandidates";
import { appendGoalCycleDecision } from "../../agents/persistentOperator/decisionStore";
import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { processPendingOutcomeLearnings } from "../../agents/persistentOperator/learningStore";
import { materializeGoalCycleObjective } from "../../agents/persistentOperator/objectiveStore";
import { recordGoalCycleOutcome, type RecordOutcomeInput } from "../../agents/persistentOperator/outcomeStore";
import { computePlanningFingerprint, loadRankingContext } from "./missionDirectorService";
import { rankMissionDirectorWork } from "./rankableWork";

/**
 * Real-MySQL acceptance for Stage 1 Phase 3 (e): Mission Director ranking
 * consumes what the learning layer learned. Every lesson is recorded through
 * recordGoalCycleOutcome, learned by processPendingOutcomeLearnings, and read
 * back by the real loadRankingContext before rankMissionDirectorWork ranks.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";
const businessDate = "2026-10-19";

describeMysql("Mission Director ranking on MySQL consumes learned outcomes", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function operator() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `ranklearn-${suffix}`;
    const openId = `ranklearn-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Ranking test", "Ranking test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, openId]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: openId }, subsystem: "ranking_learning_test" });
    if (!resolved.ok) throw new Error("identity");
    const runId = randomUUID();
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', 'active', '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [runId, tenantId, resolved.identity.canonicalOperatorId, openId, randomUUID()]
    );
    return { tenantId, openId, canonicalOperatorId: resolved.identity.canonicalOperatorId, runId };
  }

  /** A real recovery candidate shape, as assemble.ts builds it from a churn snapshot. */
  function recovery(tenantId: string, customer: string, churnScore: number): WeeklyGrowthCandidate {
    const sourceId = `customer:${customer}`;
    return {
      id: `wgc:${tenantId}:churn_snapshot:${sourceId}`,
      sourceKind: "customer_recovery",
      motion: "customer_recovery",
      title: `Win back ${customer}`,
      objective: `Call ${customer} to win back their weekly order`,
      alreadyInFlight: false,
      observedDueDate: null,
      sourceRefs: [{ sourceKind: "customer_recovery", sourceType: "churn_snapshot", sourceId }],
      provenance: { reader: "churn_snapshot", sourceType: "churn_snapshot", sourceIds: [sourceId], observedAt: "2026-10-18T12:00:00.000Z" },
      prep: { leadDays: 0, condition: null, feasibleWithinHorizon: true },
      fit: { pocketKind: null, minimumMinutes: null },
      observedSignals: [{ label: "churn_score", value: String(churnScore), source: "customer_churn_snapshot", sourceIds: [sourceId] }],
      assumptions: [],
      confidence: "high",
      rankReasons: [],
    };
  }

  /**
   * Work selected as `candidate`, then an outcome on it, learned by the
   * sweeper's processPendingOutcomeLearnings. The outcome is recorded unsettled
   * and settled afterwards so the sweeper, not the inline path, derives it.
   */
  async function learnOutcome(
    op: Awaited<ReturnType<typeof operator>>,
    candidate: WeeklyGrowthCandidate,
    outcome: Omit<RecordOutcomeInput, "tenantId" | "objectiveId" | "observedAt">
  ) {
    const technique = { key: "doctrine:recovery-call", version: 1, doctrineFamily: "recovery", title: "Recovery call" } as unknown as ExecutionIntelligenceItem;
    const { decision } = await appendGoalCycleDecision({
      tenantId: op.tenantId, goalRunId: op.runId, cycleId: randomUUID(),
      canonicalOperatorId: op.canonicalOperatorId, operatorUserId: op.openId, policyVersion: "v1",
      weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: null,
      candidateIds: [candidate.id], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
      selectionKind: "candidate", selectedRef: candidate.id, selectedExecutionType: "challenge",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
      sourceCoverage: {}, loadout: [technique], experiment: null,
    });
    const { objective } = await materializeGoalCycleObjective({ tenantId: op.tenantId, decision, businessDate });
    const recorded = await recordGoalCycleOutcome({
      ...outcome,
      tenantId: op.tenantId,
      objectiveId: objective.id,
      epistemicStatus: "unverified",
      observedAt: new Date(),
    });
    await sql.execute("UPDATE goal_cycle_outcomes SET epistemicStatus = ? WHERE tenantId = ? AND id = ?", [
      outcome.epistemicStatus ?? "verified", op.tenantId, recorded.outcome.id,
    ]);
    const swept = await processPendingOutcomeLearnings({ tenantId: op.tenantId });
    expect(swept).toEqual({ processedCount: 1, errors: [] });
    return recorded.outcome.id;
  }

  const contradicted = {
    outcomeKind: "hypothesis_contradicted",
    impactClass: "operational_result" as const,
    evidenceClass: "operator_attested" as const,
    sourceSystem: "operator_review",
    explanation: "They left over price, not service; the win-back call did not bring them back.",
  };
  const payment = () => ({
    outcomeKind: "verified_payment",
    impactClass: "commercial_revenue" as const,
    evidenceClass: "authoritative_external" as const,
    sourceSystem: "stripe",
    monetaryValueCents: 4500,
    evidenceReference: `stripe:pi_${randomUUID().replaceAll("-", "")}`,
  });

  async function rank(op: Awaited<ReturnType<typeof operator>>, candidates: WeeklyGrowthCandidate[]) {
    const context = await loadRankingContext({ tenantId: op.tenantId, operatorUserIds: [op.openId], businessDate });
    const plan = rankMissionDirectorWork({ candidates, campaigns: [], campaignPrepReady: {}, context, pockets: [] });
    if (plan.status !== "ranked") throw new Error(plan.status);
    const learning = (id: string) =>
      plan.ranking.find(item => item.workId === id)?.factors.find(f => f.name === "outcome_learning_delta");
    const fingerprint = computePlanningFingerprint({
      businessDate, fieldItemIds: [], fieldScheduledAts: [], campaigns: [], prepReady: {}, rankingContext: context,
    });
    return { context, plan, learning, fingerprint };
  }

  it("with no learned deltas ranking is unchanged, and an inconclusive lesson does not move it", async () => {
    const op = await operator();
    const x = recovery(op.tenantId, "x", 80);
    const y = recovery(op.tenantId, "y", 60);
    const before = await rank(op, [x, y]);
    expect(before.context.outcomeLessons).toEqual([]);
    expect(before.plan).toEqual(
      rankMissionDirectorWork({ candidates: [x, y], campaigns: [], campaignPrepReady: {}, context: { ...before.context, outcomeLessons: undefined }, pockets: [] })
    );
    expect(before.plan.primary.workId).toBe(x.id);

    await learnOutcome(op, x, {
      outcomeKind: "customer_contacted", impactClass: "operational_result", evidenceClass: "operator_attested",
      sourceSystem: "operator_review", evidenceReference: `operator_review:${randomUUID()}`,
    });
    const after = await rank(op, [x, y]);
    expect(after.context.outcomeLessons).toEqual([]);
    expect(after.plan).toEqual(before.plan);
    expect(after.fingerprint).toBe(before.fingerprint);
  });

  it("a verified hypothesis_contradicted outcome for X demotes X behind an eligible alternative", async () => {
    const op = await operator();
    const x = recovery(op.tenantId, "x", 80);
    const y = recovery(op.tenantId, "y", 60);
    const before = await rank(op, [x, y]);
    expect(before.plan.primary.workId).toBe(x.id);

    const outcomeId = await learnOutcome(op, x, { ...contradicted, evidenceReference: `operator_review:${randomUUID()}` });
    const after = await rank(op, [x, y]);
    expect(after.plan.primary.workId).toBe(y.id);
    expect(after.context.outcomeLessons).toEqual([
      expect.objectContaining({ outcomeId, selectedRef: x.id, result: "contradicted" }),
    ]);
    const demoted = after.plan.ranking.find(item => item.workId === x.id)!;
    expect(demoted.eligible).toBe(true);
    expect(after.learning(x.id)).toMatchObject({ effect: -300, value: "contradicted:1,supported:0" });
    expect(after.learning(x.id)?.source).toContain(outcomeId);
    expect(after.learning(y.id)).toBeUndefined();
    // A new lesson re-plans.
    expect(after.fingerprint).not.toBe(before.fingerprint);

    // Lessons older than the lookback stop moving ranking.
    await sql.execute(
      "UPDATE goal_cycle_learned_deltas SET createdAt = '2026-07-01 00:00:00' WHERE tenantId = ? AND outcomeId = ?",
      [op.tenantId, outcomeId]
    );
    const aged = await rank(op, [x, y]);
    expect(aged.plan.primary.workId).toBe(x.id);
    expect(aged.fingerprint).toBe(before.fingerprint);
  });

  it("a verified revenue outcome gives a bounded boost", async () => {
    const op = await operator();
    const x = recovery(op.tenantId, "x", 60);
    const y = recovery(op.tenantId, "y", 80);
    expect((await rank(op, [x, y])).plan.primary.workId).toBe(y.id);

    await learnOutcome(op, x, payment());
    const once = await rank(op, [x, y]);
    expect(once.plan.primary.workId).toBe(x.id);
    expect(once.learning(x.id)).toMatchObject({ effect: 60, value: "contradicted:0,supported:1" });

    await learnOutcome(op, x, payment());
    await learnOutcome(op, x, payment());
    const capped = await rank(op, [x, y]);
    expect(capped.context.outcomeLessons).toHaveLength(3);
    expect(capped.learning(x.id)).toMatchObject({ effect: 120, value: "contradicted:0,supported:3" });
  });
});
