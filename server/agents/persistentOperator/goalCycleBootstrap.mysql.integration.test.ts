/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Real-MySQL proof for Stage 1 1D: the supervisor sweep keeps exactly one live
 * scheduled tick per active run and prepares nothing. A dead-lettered tick is
 * replaced once, not revived, and repeated sweeps add no rows.
 */
const preparation = vi.hoisted(() => ({ prepareStrategicProposal: vi.fn() }));
vi.mock("../../strategy/strategicPreparation", () => preparation);

const { ensureAutonomousGoalBootstrap } = await import("./autonomousWorkerService");
const { GoalCycleStore } = await import("./goalCycleStore");

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

let sql: mysql.Connection;
let pool: mysql.Pool;

describeMysql("goal-cycle supervisor sweep on MySQL", () => {
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 4, supportBigNumbers: true, bigNumberStrings: true });
  });
  afterAll(async () => {
    await pool?.end();
    await sql?.end();
  });

  it("a dead-lettered tick plus repeated sweeps leaves exactly one live tick and prepares nothing", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `sweep-${suffix}`;
    const openId = `op-${suffix}`;
    const goalId = randomUUID();
    const runId = randomUUID();
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Sweep", "Sweep", "#123456", "Op", "op@example.invalid", "America/Los_Angeles"]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, openId]);
    // Entitled like production's tenant, so a sweep that prepared would be allowed to.
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,'persistent_operator','manual',true)", [tenantId]);
    await sql.execute(
      "INSERT INTO operator_macro_goals (id,tenantId,operatorUserId,objective,metricKey,targetValue,unit,source,sourceNote,status) VALUES (?,?,?,?,?,?,?,'operator_attested',?,'active')",
      [goalId, tenantId, openId, "Get to 50 active customers", "active_customers", 50, "customers", "fixture"]
    );
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', 'active', '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [runId, tenantId, `tenant:${tenantId}:operator:${openId}`, openId, goalId]
    );
    // The run's only tick has already dead-lettered (fixture state).
    const deadId = randomUUID();
    await sql.execute(
      `INSERT INTO goal_cycle_requests
         (id, tenantId, goalRunId, triggerType, triggerSourceReference, idempotencyKey, status, availableAt, maxAttempts, attemptCount)
       VALUES (?, ?, ?, 'scheduled_tick', 'autonomous_supervisor:heartbeat', ?, 'dead_letter', CURRENT_TIMESTAMP(3), 5, 5)`,
      [deadId, tenantId, runId, `auto_tick:${runId}:2026-10-18T01`]
    );

    const store = new GoalCycleStore(pool);
    for (let sweep = 0; sweep < 3; sweep++) {
      await ensureAutonomousGoalBootstrap({ store });
    }

    const [ticks] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT id, status, idempotencyKey FROM goal_cycle_requests WHERE tenantId = ? AND goalRunId = ? AND triggerType = 'scheduled_tick'",
      [tenantId, runId]
    );
    const live = ticks.filter(tick => ["queued", "retry_scheduled", "leased", "running"].includes(String(tick.status)));
    expect(live).toHaveLength(1);
    expect(ticks).toHaveLength(2);
    expect(ticks.find(tick => tick.id === deadId)?.status).toBe("dead_letter");
    expect(live[0]!.idempotencyKey).toBe(`scheduled_tick:${runId}:after:${deadId}`);

    expect(preparation.prepareStrategicProposal).not.toHaveBeenCalled();
    const [proposals] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT id FROM strategic_planning_proposals WHERE tenantId = ?",
      [tenantId]
    );
    expect(proposals).toHaveLength(0);
  });
});
