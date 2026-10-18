/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";
import type { ExecutionIntelligenceItem } from "../../../shared/executionIntelligence";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { readStrategicDiagnosisInputs } from "../../strategy/strategicEvidenceReaders";
import { appendGoalCycleDecision } from "./decisionStore";
import { resolveCanonicalOperatorIdentity } from "./identity";
import { processPendingOutcomeLearnings } from "./learningStore";
import { materializeGoalCycleObjective } from "./objectiveStore";
import { recordGoalCycleOutcome } from "./outcomeStore";
import { getAuthoritativeScoreboard } from "./proofReadModels";

/**
 * Real-MySQL proof for Stage 1 Phase 3 (a): one outcome reading drives
 * learning, the proof scoreboard and the strategic diagnosis. Every outcome is
 * recorded through recordGoalCycleOutcome and learned through the worker's
 * processPendingOutcomeLearnings, never hand-built.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("outcome polarity on MySQL: a contradicted hypothesis suppresses, never boosts", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function operatorObjective(selectedRef: string, techniqueKey: string) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `polarity-${suffix}`;
    const operator = `polarity-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Polarity test", "Polarity test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, operator, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operator]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operator }, subsystem: "polarity_test" });
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
    const technique = { key: techniqueKey, version: 1, doctrineFamily: "outreach", title: techniqueKey } as unknown as ExecutionIntelligenceItem;
    const { decision } = await appendGoalCycleDecision({
      tenantId, goalRunId: runId, cycleId: randomUUID(),
      canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: operator, policyVersion: "v1",
      weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: null,
      candidateIds: [selectedRef], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
      selectionKind: "candidate", selectedRef, selectedExecutionType: "mission",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
      sourceCoverage: {}, loadout: [technique], experiment: null,
    });
    const { objective } = await materializeGoalCycleObjective({ tenantId, decision, businessDate: "2026-10-19" });
    return { tenantId, identity, runId, objective };
  }

  async function deltaFor(tenantId: string, outcomeId: string) {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT learningKind, deltaType, targetKey, afterStateJson FROM goal_cycle_learned_deltas WHERE tenantId = ? AND outcomeId = ?",
      [tenantId, outcomeId]
    );
    return rows.map(row => ({ ...row, afterState: typeof row.afterStateJson === "string" ? JSON.parse(row.afterStateJson) : row.afterStateJson }));
  }

  it("an operator-attested hypothesis_contradicted outcome learns a suppression; verified revenue learns a boost", async () => {
    const t = await operatorObjective("candidate:door-hangers-silver-lake", "doctrine:door-hanger-blitz");
    const contradicted = await recordGoalCycleOutcome({
      tenantId: t.tenantId,
      objectiveId: t.objective.id,
      outcomeKind: "hypothesis_contradicted",
      impactClass: "operational_result",
      evidenceClass: "operator_attested",
      evidenceReference: `operator_review:${randomUUID()}`,
      sourceSystem: "operator_review",
      explanation: "Door hangers did not bring Silver Lake customers back; the dormancy driver was price, not awareness.",
      observedAt: new Date(),
    });
    const processed = await processPendingOutcomeLearnings({ tenantId: t.tenantId });
    expect(processed.errors).toEqual([]);
    const [suppression] = await deltaFor(t.tenantId, contradicted.outcome.id);
    expect(suppression).toMatchObject({
      learningKind: "execution_constraint",
      deltaType: "suppress",
      targetKey: "doctrine:door-hanger-blitz",
    });
    expect(suppression!.afterState).toMatchObject({ interpretation: "contradicted", interpretationBasis: "outcome_reports_contradiction" });
    expect(suppression!.afterState.doctrineWeight).toBeLessThan(1);

    const revenue = await recordGoalCycleOutcome({
      tenantId: t.tenantId,
      objectiveId: t.objective.id,
      outcomeKind: "verified_payment",
      impactClass: "commercial_revenue",
      evidenceClass: "authoritative_external",
      evidenceReference: `stripe:pi_${randomUUID().replaceAll("-", "")}`,
      sourceSystem: "stripe",
      monetaryValueCents: 4500,
      observedAt: new Date(),
    });
    await processPendingOutcomeLearnings({ tenantId: t.tenantId });
    const [boost] = await deltaFor(t.tenantId, revenue.outcome.id);
    expect(boost).toMatchObject({ learningKind: "doctrine_weight", deltaType: "boost" });

    // The scoreboard reads the same way: one failure, one success.
    const board = await getAuthoritativeScoreboard({ tenantId: t.tenantId, goalRunId: t.runId });
    expect(board.failedOutcomesCount).toBe(1);
    expect(board.successfulOutcomesCount).toBe(1);
  });

  it("an authoritative rejection suppresses even a commercial_revenue outcome", async () => {
    const t = await operatorObjective("candidate:price-test", "doctrine:price-test");
    const rejected = await recordGoalCycleOutcome({
      tenantId: t.tenantId,
      objectiveId: t.objective.id,
      outcomeKind: "verified_payment",
      impactClass: "commercial_revenue",
      evidenceClass: "authoritative_external",
      evidenceReference: `stripe:refund_${randomUUID()}`,
      sourceSystem: "stripe",
      monetaryValueCents: 4500,
      epistemicStatus: "rejected",
      observedAt: new Date(),
    });
    await processPendingOutcomeLearnings({ tenantId: t.tenantId });
    const [delta] = await deltaFor(t.tenantId, rejected.outcome.id);
    expect(delta).toMatchObject({ deltaType: "suppress" });
  });

  it("the strategic diagnosis reads contradicted and supported from the same outcome rows", async () => {
    const diagnosisId = `diagnosis_${randomUUID().replaceAll("-", "").slice(0, 40)}`;
    const t = await operatorObjective(`${diagnosisId}:strategy-recovery`, "doctrine:recovery-call");
    await sql.execute(
      "INSERT INTO strategic_diagnoses (id, tenantId, canonicalOperatorId, businessDate, payloadJson) VALUES (?, ?, ?, ?, ?)",
      [diagnosisId, t.tenantId, t.identity.canonicalOperatorId, "2026-10-19", JSON.stringify({ id: diagnosisId, primaryConstraint: "retention" })]
    );
    const contradicted = await recordGoalCycleOutcome({
      tenantId: t.tenantId, objectiveId: t.objective.id, outcomeKind: "hypothesis_contradicted",
      impactClass: "operational_result", evidenceClass: "operator_attested",
      evidenceReference: `operator_review:${randomUUID()}`, sourceSystem: "operator_review", observedAt: new Date(Date.now() - 60_000),
    });
    const supported = await recordGoalCycleOutcome({
      tenantId: t.tenantId, objectiveId: t.objective.id, outcomeKind: "account_reactivation_payment",
      impactClass: "commercial_revenue", evidenceClass: "authoritative_external", monetaryValueCents: 3200,
      evidenceReference: `stripe:pi_${randomUUID().replaceAll("-", "")}`, sourceSystem: "stripe", observedAt: new Date(Date.now() - 30_000),
    });
    const inputs = await readStrategicDiagnosisInputs({
      identity: t.identity,
      registry: defaultVerticalRegistry,
      businessDate: "2026-10-19",
      timeZone: zone,
      now: new Date(),
    });
    const byId = new Map(inputs.outcomes.map(o => [o.id, o]));
    expect(byId.get(contradicted.outcome.id)).toMatchObject({ result: "contradicted", actionDriver: "retention" });
    expect(byId.get(supported.outcome.id)).toMatchObject({ result: "supported", actionDriver: "retention" });
  });
});
