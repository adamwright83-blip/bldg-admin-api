/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { evaluatePersistentActionPolicy } from "./actionPolicy";
import { decideGoalCycle } from "./decisionEngine";
import { defaultGoalCycleOccurrenceDeps, runGoalCycleOccurrence } from "./goalCycleOccurrence";
import { OperatorAppointmentStore } from "./operatorAppointmentStore";

/**
 * Real-MySQL proof for Stage 1 · 1C-ii: the goal-cycle occurrence runs the
 * real evaluatePersistentActionPolicy against real tenant, membership and
 * entitlement rows, and the real decideGoalCycle records the receipt. Only the
 * metric read and the strategic preparation are stubbed, so the test can see
 * whether preparation ran.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("goal-cycle occurrence policy gate on MySQL", () => {
  let sql: mysql.Connection;
  let pool: mysql.Pool;

  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 4 });
  });
  afterAll(async () => {
    await sql?.end();
    await pool?.end();
  });

  async function tenant(options: { entitled: boolean; role: "owner" | "field"; runStatus?: "active" | "paused" }) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `cycle-1cii-${suffix}`;
    const operator = `cycle-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Cycle test", "Cycle test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, operator, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,?,true)", [tenantId, operator, options.role]);
    if (options.entitled) {
      await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    }
    const runId = randomUUID();
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', ?, '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [runId, tenantId, `tenant:${tenantId}:operator:${operator}`, operator, randomUUID(), options.runStatus ?? "active"]
    );
    return { tenantId, operator, runId };
  }

  function deps(prepare: ReturnType<typeof vi.fn>) {
    const real = defaultGoalCycleOccurrenceDeps({
      registry: defaultVerticalRegistry,
      appointmentStore: new OperatorAppointmentStore(pool),
    });
    return {
      ...real,
      evaluatePolicy: evaluatePersistentActionPolicy,
      decide: real.decide,
      evaluateRun: async ({ runId }: { runId: string }) => ({
        run: { id: runId, status: "active", operatorUserId: "", nextEvaluationAt: new Date(Date.now() + 3_600_000) },
        completed: false,
        observation: null,
      }),
      prepare,
    };
  }

  async function decisionRow(tenantId: string, cycleId: string) {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT selectionKind, selectedReasonCode, sourceCoverageJson FROM goal_cycle_decisions WHERE tenantId = ? AND cycleId = ?",
      [tenantId, cycleId]
    );
    expect(rows).toHaveLength(1);
    const coverage = typeof rows[0]!.sourceCoverageJson === "string" ? JSON.parse(rows[0]!.sourceCoverageJson) : rows[0]!.sourceCoverageJson;
    return { ...rows[0]!, coverage };
  }

  it("allowed: preparation runs and the decision records the automatic INTERNAL_REVERSIBLE receipt", async () => {
    const t = await tenant({ entitled: true, role: "owner" });
    const prepare = vi.fn(async () => undefined);
    const cycleId = randomUUID();
    const result = await runGoalCycleOccurrence({ tenantId: t.tenantId, runId: t.runId, cycleId }, deps(prepare));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.prepared).toBe(true);
    const row = await decisionRow(t.tenantId, cycleId);
    expect(row.selectedReasonCode).not.toBe("ACTION_POLICY_DENIED");
    expect(row.coverage.actionPolicy).toEqual({
      policy: "evaluatePersistentActionPolicy",
      exactAction: "persistent_operator.goal_cycle.prepare",
      riskClass: "INTERNAL_REVERSIBLE",
      status: "allowed",
      authority: "automatic",
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    });
    expect(row.coverage.channelReadiness).toBeDefined();
  });

  it("missing entitlement: a wait decision with the reason, no preparation, no objective", async () => {
    const t = await tenant({ entitled: false, role: "owner" });
    const prepare = vi.fn(async () => undefined);
    const cycleId = randomUUID();
    await runGoalCycleOccurrence({ tenantId: t.tenantId, runId: t.runId, cycleId }, deps(prepare));
    expect(prepare).not.toHaveBeenCalled();
    const row = await decisionRow(t.tenantId, cycleId);
    expect(row.selectionKind).toBe("wait");
    expect(row.selectedReasonCode).toBe("ACTION_POLICY_DENIED");
    expect(row.coverage.actionPolicy).toMatchObject({ status: "denied", reason: "entitlement_required" });
    const [objectives] = await sql.execute<mysql.RowDataPacket[]>("SELECT id FROM goal_cycle_objectives WHERE tenantId = ?", [t.tenantId]);
    expect(objectives).toEqual([]);
  });

  it("wrong role: a wait decision with role_not_allowed, no preparation", async () => {
    const t = await tenant({ entitled: true, role: "field" });
    const prepare = vi.fn(async () => undefined);
    const cycleId = randomUUID();
    await runGoalCycleOccurrence({ tenantId: t.tenantId, runId: t.runId, cycleId }, deps(prepare));
    expect(prepare).not.toHaveBeenCalled();
    const row = await decisionRow(t.tenantId, cycleId);
    expect(row.selectedReasonCode).toBe("ACTION_POLICY_DENIED");
    expect(row.coverage.actionPolicy).toMatchObject({ status: "denied", reason: "role_not_allowed" });
  });

  it("paused run: a wait decision, no preparation, receipt still recorded", async () => {
    const t = await tenant({ entitled: true, role: "owner", runStatus: "paused" });
    const prepare = vi.fn(async () => undefined);
    const cycleId = randomUUID();
    const d = deps(prepare);
    d.evaluateRun = async ({ runId }) => ({
      run: { id: runId, status: "paused", operatorUserId: t.operator, nextEvaluationAt: null },
      completed: false,
      observation: null,
    });
    await runGoalCycleOccurrence({ tenantId: t.tenantId, runId: t.runId, cycleId }, d);
    expect(prepare).not.toHaveBeenCalled();
    const row = await decisionRow(t.tenantId, cycleId);
    expect(row.selectionKind).toBe("wait");
    expect(row.selectedReasonCode).toBe("GOAL_RUN_INACTIVE");
    expect(row.coverage.actionPolicy).toMatchObject({ status: "allowed" });
  });

  it("decideGoalCycle without a receipt fails closed to a wait", async () => {
    const t = await tenant({ entitled: true, role: "owner" });
    const cycleId = randomUUID();
    const result = await decideGoalCycle({ tenantId: t.tenantId, runId: t.runId, cycleId, registry: defaultVerticalRegistry } as never);
    expect(result.decision.selectionKind).toBe("wait");
    expect(result.decision.selectedReasonCode).toBe("ACTION_POLICY_DENIED");
  });
});
