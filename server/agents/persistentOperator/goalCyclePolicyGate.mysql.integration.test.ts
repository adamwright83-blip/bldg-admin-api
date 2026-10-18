/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { runGoalCycleStep } from "./goalCycleStep";

/**
 * Real-MySQL proof for Stage 1 1C-ii: the goal-cycle step asks the persistent
 * action policy (real identity, membership and entitlement rows) before it
 * prepares, and the decision it stores records the answer. Only the metric read
 * and the model-backed proposal preparation are stubbed.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

let sql: mysql.Connection;

async function tenantFixture(input: {
  role: "owner" | "field";
  entitled: boolean;
  runStatus?: "active" | "paused";
}) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `gate-${suffix}`;
  const openId = `op-${suffix}`;
  const runId = randomUUID();
  await sql.execute(
    "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
    [tenantId, tenantId, "Gate", "Gate", "#123456", "Op", "op@example.invalid", "America/Los_Angeles"]
  );
  await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
  await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,?,true)", [tenantId, openId, input.role]);
  if (input.entitled) {
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
  }
  await sql.execute(
    `INSERT INTO macro_goal_runs
      (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
       status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
       baselineCoverage, policyVersion)
     VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', ?, '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
    [runId, tenantId, `tenant:${tenantId}:operator:${openId}`, openId, runId, input.runStatus ?? "active"]
  );
  return { tenantId, openId, runId };
}

async function step(fixture: { tenantId: string; runId: string }) {
  const prepare = vi.fn(async () => ({ id: `proposal-${fixture.runId}` }));
  const cycleId = randomUUID();
  const result = await runGoalCycleStep(
    { tenantId: fixture.tenantId, runId: fixture.runId, cycleId },
    {
      registry: defaultVerticalRegistry,
      appointmentStore: {} as never,
      evaluateRun: (async () => {
        const [rows] = await sql.query<mysql.RowDataPacket[]>("SELECT * FROM macro_goal_runs WHERE tenantId = ? AND id = ?", [fixture.tenantId, fixture.runId]);
        return { run: { ...rows[0], nextEvaluationAt: new Date(Date.now() + 3_600_000) }, completed: false, observation: null };
      }) as never,
      prepare: prepare as never,
      scheduleCall: (async () => ({ scheduled: false, reason: "no_authorized_channel" })) as never,
    }
  );
  const [rows] = await sql.query<mysql.RowDataPacket[]>(
    "SELECT selectionKind, selectedReasonCode, sourceCoverageJson FROM goal_cycle_decisions WHERE tenantId = ? AND cycleId = ?",
    [fixture.tenantId, cycleId]
  );
  const decision = rows[0]!;
  const coverage = typeof decision.sourceCoverageJson === "string" ? JSON.parse(decision.sourceCoverageJson) : decision.sourceCoverageJson;
  const [objectives] = await sql.query<mysql.RowDataPacket[]>("SELECT id FROM goal_cycle_objectives WHERE tenantId = ?", [fixture.tenantId]);
  const [commitments] = await sql.query<mysql.RowDataPacket[]>("SELECT id FROM day_director_commitments WHERE tenantId = ?", [fixture.tenantId]);
  return { result, prepare, decision, coverage, objectives, commitments };
}

describeMysql("goal-cycle policy gate on MySQL", () => {
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => sql?.end());

  it("allowed: an entitled owner's cycle prepares and records the INTERNAL_REVERSIBLE answer, with no Day Line write", async () => {
    const { result, prepare, coverage, commitments } = await step(await tenantFixture({ role: "owner", entitled: true }));
    expect(result.actionPolicy).toBe("allowed");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(coverage.actionPolicy).toEqual({
      status: "allowed",
      authority: "automatic",
      exactAction: "persistent_operator.goal_cycle.prepare",
      riskClass: "INTERNAL_REVERSIBLE",
    });
    // INTERNAL_REVERSIBLE allows preparation only; it never puts work on the Day Line.
    expect(commitments).toHaveLength(0);
  });

  it("missing entitlement: a recorded wait with the reason, nothing prepared or materialized", async () => {
    const { prepare, decision, coverage, objectives } = await step(await tenantFixture({ role: "owner", entitled: false }));
    expect(prepare).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ selectionKind: "wait", selectedReasonCode: "ACTION_POLICY_DENIED" });
    expect(coverage.actionPolicy).toMatchObject({ status: "denied", reason: "entitlement_required" });
    expect(coverage.missionDirector).toBeUndefined();
    expect(objectives).toHaveLength(0);
  });

  it("wrong role: a field member cannot have Claire prepare for the goal", async () => {
    const { prepare, decision, coverage } = await step(await tenantFixture({ role: "field", entitled: true }));
    expect(prepare).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ selectionKind: "wait", selectedReasonCode: "ACTION_POLICY_DENIED" });
    expect(coverage.actionPolicy).toMatchObject({ status: "denied", reason: "role_not_allowed" });
  });

  it("paused run: nothing is prepared and the wait records that the policy was not asked", async () => {
    const { prepare, decision, coverage } = await step(await tenantFixture({ role: "owner", entitled: true, runStatus: "paused" }));
    expect(prepare).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ selectionKind: "wait", selectedReasonCode: "GOAL_RUN_INACTIVE" });
    expect(coverage.actionPolicy).toMatchObject({ status: "not_evaluated", reason: "goal_run_inactive" });
  });
});
