/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { appendGoalCycleDecision } from "./decisionStore";
import { decideGoalCycle } from "./decisionEngine";
import { GoalCycleStore, type ClaimedGoalCycle } from "./goalCycleStore";
import { createIsolatedGoalCycleDb } from "./goalCycleIsolatedDb.testSupport";
import { runGoalCycleOccurrence, type GoalCycleOccurrenceDeps } from "./goalCycleOccurrence";
import { GoalCycleWorker } from "./goalCycleWorker";
import { getGoalCycleObjectiveByDecision, materializeGoalCycleObjective, transitionObjectiveStatus } from "./objectiveStore";
import { evaluatePersistentActionPolicy } from "./actionPolicy";

/**
 * Real-MySQL proof for Stage 1 · 1B. Every scheduled occurrence has its own
 * cycle id and so its own decision; lease retries keep their id; an open
 * objective is re-selected instead of re-minted; the run's chain stays single.
 *
 * Decisions, objectives, identity and policy run on the shared DATABASE_URL.
 * The worker's queue runs on a private database so no parallel test file's
 * worker can claim these cycles (or these workers claim theirs).
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("goal-cycle occurrence identity on MySQL", () => {
  let sql: mysql.Connection;
  let iso: Awaited<ReturnType<typeof createIsolatedGoalCycleDb>>;
  let queue: Pool;

  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    iso = await createIsolatedGoalCycleDb(process.env.DATABASE_URL!);
    queue = iso.pool;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await iso?.drop();
  });

  async function operatorRun() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `ident-1b-${suffix}`;
    const operator = `ident-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Identity test", "Identity test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, operator, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operator]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const run = { id: randomUUID(), tenantId, canonicalOperatorId: `tenant:${tenantId}:operator:${operator}`, operatorUserId: operator };
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', 'active', '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [run.id, tenantId, run.canonicalOperatorId, operator, randomUUID()]
    );
    await iso.insertRun({ ...run, verticalKey: "laundry_fluff_fold" });
    return run;
  }

  type Run = Awaited<ReturnType<typeof operatorRun>>;

  /** The production occurrence with a real policy and real decideGoalCycle; only the metric read and preparation are stubbed. */
  function occurrenceDeps(run: Run, overrides: Partial<GoalCycleOccurrenceDeps> = {}): GoalCycleOccurrenceDeps & { prepared: number } {
    const deps = {
      prepared: 0,
      loadRun: async () => ({ id: run.id, status: "active", canonicalOperatorId: run.canonicalOperatorId, operatorUserId: run.operatorUserId }),
      evaluatePolicy: evaluatePersistentActionPolicy,
      evaluateRun: async () => ({
        run: { id: run.id, status: "active", operatorUserId: run.operatorUserId, nextEvaluationAt: new Date(Date.now() + 3_600_000) },
        completed: false,
        observation: null,
      }),
      prepare: async () => {
        deps.prepared += 1;
      },
      decide: ({ tenantId, runId, cycleId, actionPolicy }: Parameters<GoalCycleOccurrenceDeps["decide"]>[0]) =>
        decideGoalCycle({ tenantId, runId, cycleId, actionPolicy, registry: defaultVerticalRegistry }),
      ...overrides,
    };
    return deps;
  }

  /** One DurableWorker step by hand: claim, run, complete (or fail). */
  async function runOne(store: GoalCycleStore, deps: GoalCycleOccurrenceDeps, leaseMs = 30_000) {
    const step = await store.claimNextStep({ leaseOwner: `hand-${randomUUID()}`, leaseMs });
    if (!step) return null;
    await store.markRunning(step);
    try {
      const result = await runGoalCycleOccurrence({ tenantId: step.tenantId, runId: step.goalRunId, cycleId: step.id }, deps);
      await store.completeStep(step, result);
      return { step, result };
    } catch (error) {
      await store.failStep(step, error, 1);
      return { step, error };
    }
  }

  async function requests(run: Run) {
    const [rows] = await queue.query<mysql.RowDataPacket[]>(
      "SELECT id, idempotencyKey, status, attemptCount FROM goal_cycle_requests WHERE tenantId = ? AND goalRunId = ? ORDER BY createdAt, id",
      [run.tenantId, run.id]
    );
    return rows;
  }
  const liveTicks = (rows: mysql.RowDataPacket[]) => rows.filter(r => ["queued", "retry_scheduled", "leased", "running"].includes(String(r.status)));
  async function decisionsFor(run: Run) {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id, cycleId, selectionKind, selectedReasonCode FROM goal_cycle_decisions WHERE tenantId = ? AND goalRunId = ? ORDER BY createdAt, id",
      [run.tenantId, run.id]
    );
    return rows;
  }
  /** Time passes: the queued successor becomes due. */
  async function makeDue(run: Run) {
    await queue.execute(
      "UPDATE goal_cycle_requests SET availableAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE tenantId = ? AND goalRunId = ? AND status = 'queued'",
      [run.tenantId, run.id]
    );
  }

  it("occurrence 2 gets a new cycle id and a fresh decision; occurrence 1 is finished, not re-queued", async () => {
    const run = await operatorRun();
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    const first = await store.ensureLiveScheduledTick({ tenantId: run.tenantId, goalRunId: run.id });
    const deps = occurrenceDeps(run);

    const one = await runOne(store, deps);
    expect(one?.step.id).toBe(first.id);
    let rows = await requests(run);
    expect(rows.find(r => r.id === first.id)?.status).toBe("completed");
    const successor = liveTicks(rows);
    expect(successor).toHaveLength(1);
    expect(successor[0]!.id).not.toBe(first.id);
    expect(successor[0]!.idempotencyKey).toBe(`scheduled_tick:${run.id}:after:${first.id}`);
    // Not due for an hour.
    expect(await store.claimNextStep({ leaseOwner: "early", leaseMs: 1_000 })).toBeNull();

    await makeDue(run);
    const two = await runOne(store, deps);
    expect(two?.step.id).toBe(successor[0]!.id);
    const decisions = await decisionsFor(run);
    expect(decisions.map(d => d.cycleId)).toEqual([first.id, successor[0]!.id]);
    expect(new Set(decisions.map(d => d.id)).size).toBe(2);
    expect((two!.result as { decisionCreated: boolean }).decisionCreated).toBe(true);
    expect(deps.prepared).toBe(2);
    rows = await requests(run);
    expect(liveTicks(rows)).toHaveLength(1);
    expect(rows).toHaveLength(3);
  });

  it("a lease retry of occurrence 1 keeps its id and does not decide again", async () => {
    const run = await operatorRun();
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    const first = await store.ensureLiveScheduledTick({ tenantId: run.tenantId, goalRunId: run.id });
    let calls = 0;
    const base = occurrenceDeps(run);
    const deps = occurrenceDeps(run, {
      // The first attempt decides, then fails before it can complete.
      decide: async input => {
        calls += 1;
        const decided = await base.decide(input);
        if (calls === 1) throw new Error("worker lost the database after deciding");
        return decided;
      },
    });
    const failed = await runOne(store, deps);
    expect(failed?.step.id).toBe(first.id);
    expect((await requests(run)).find(r => r.id === first.id)?.status).toBe("retry_scheduled");
    await new Promise(resolve => setTimeout(resolve, 20));
    const retried = await runOne(store, deps);
    expect(retried?.step.id).toBe(first.id);
    expect(retried?.step.attemptCount).toBe(2);
    expect((retried!.result as { decisionCreated: boolean }).decisionCreated).toBe(false);
    const decisions = await decisionsFor(run);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.cycleId).toBe(first.id);
  });

  it("unchanged inputs across occurrences re-select one open objective instead of minting one per hour", async () => {
    const run = await operatorRun();
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    await store.ensureLiveScheduledTick({ tenantId: run.tenantId, goalRunId: run.id });
    // Mission Director selecting the same work on the same business day, every occurrence.
    const selecting = occurrenceDeps(run, {
      decide: async ({ tenantId, runId, cycleId, actionPolicy }) => {
        const appended = await appendGoalCycleDecision({
          tenantId, goalRunId: runId, cycleId,
          canonicalOperatorId: run.canonicalOperatorId, operatorUserId: run.operatorUserId, policyVersion: "v1",
          weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: "same-inputs",
          candidateIds: ["candidate:visit-the-louise"], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
          selectionKind: "candidate", selectedRef: "candidate:visit-the-louise", selectedExecutionType: "mission",
          selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
          sourceCoverage: { actionPolicy }, loadout: [], experiment: null,
        });
        const { objective } = await materializeGoalCycleObjective({ tenantId, decision: appended.decision, businessDate: "2026-10-19" });
        return { ...appended, objective };
      },
    });
    const objectiveIds: string[] = [];
    for (let occurrence = 0; occurrence < 3; occurrence += 1) {
      if (occurrence > 0) await makeDue(run);
      const done = await runOne(store, selecting);
      objectiveIds.push(String((done!.result as { objectiveId: string }).objectiveId));
    }
    const decisions = await decisionsFor(run);
    expect(decisions).toHaveLength(3);
    expect(new Set(objectiveIds).size).toBe(1);
    const [objectives] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id, decisionId, latestDecisionId FROM goal_cycle_objectives WHERE tenantId = ?",
      [run.tenantId]
    );
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.decisionId).toBe(decisions[0]!.id);
    expect(objectives[0]!.latestDecisionId).toBe(decisions[2]!.id);
    // Each decision still finds the objective it created or re-selected.
    expect((await getGoalCycleObjectiveByDecision({ tenantId: run.tenantId, decisionId: decisions[2]!.id }))?.id).toBe(objectiveIds[0]);

    // A different business day, or a finished objective, gets a fresh objective.
    const decision = { ...(await appendGoalCycleDecision({
      tenantId: run.tenantId, goalRunId: run.id, cycleId: randomUUID(),
      canonicalOperatorId: run.canonicalOperatorId, operatorUserId: run.operatorUserId, policyVersion: "v1",
      weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: "same-inputs",
      candidateIds: [], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
      selectionKind: "candidate", selectedRef: "candidate:visit-the-louise", selectedExecutionType: "mission",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
      sourceCoverage: {}, loadout: [], experiment: null,
    })).decision };
    const nextDay = await materializeGoalCycleObjective({ tenantId: run.tenantId, decision, businessDate: "2026-10-20" });
    expect(nextDay.created).toBe(true);
    await transitionObjectiveStatus({ tenantId: run.tenantId, objectiveId: objectiveIds[0]!, toStatus: "completed" });
    const later = await appendGoalCycleDecision({ ...decision, cycleId: randomUUID() } as never);
    const afterCompletion = await materializeGoalCycleObjective({ tenantId: run.tenantId, decision: later.decision, businessDate: "2026-10-19" });
    expect(afterCompletion.created).toBe(true);
    expect(afterCompletion.objective.id).not.toBe(objectiveIds[0]);
  });

  it("objective store: two decisions selecting the same work for the same day share one objective", async () => {
    const run = await operatorRun();
    const decide = (cycleId: string) =>
      appendGoalCycleDecision({
        tenantId: run.tenantId, goalRunId: run.id, cycleId,
        canonicalOperatorId: run.canonicalOperatorId, operatorUserId: run.operatorUserId, policyVersion: "v1",
        weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: "same-inputs",
        candidateIds: [], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
        selectionKind: "obligation", selectedRef: "obligation:follow-up-the-louise", selectedExecutionType: "challenge",
        selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
        sourceCoverage: {}, loadout: [], experiment: null,
      });
    const first = await decide(randomUUID());
    const second = await decide(randomUUID());
    expect(second.decision.id).not.toBe(first.decision.id);
    const a = await materializeGoalCycleObjective({ tenantId: run.tenantId, decision: first.decision, businessDate: "2026-10-21" });
    const b = await materializeGoalCycleObjective({ tenantId: run.tenantId, decision: second.decision, businessDate: "2026-10-21" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.objective.id).toBe(a.objective.id);
    expect(b.objective.latestDecisionId).toBe(second.decision.id);
    expect((await getGoalCycleObjectiveByDecision({ tenantId: run.tenantId, decisionId: first.decision.id }))?.id).toBe(a.objective.id);
    expect((await getGoalCycleObjectiveByDecision({ tenantId: run.tenantId, decisionId: second.decision.id }))?.id).toBe(a.objective.id);
    // Retrying the second decision's materialization is idempotent.
    expect((await materializeGoalCycleObjective({ tenantId: run.tenantId, decision: second.decision, businessDate: "2026-10-21" })).objective.id).toBe(a.objective.id);
    const [objectives] = await sql.execute<mysql.RowDataPacket[]>("SELECT id FROM goal_cycle_objectives WHERE tenantId = ?", [run.tenantId]);
    expect(objectives).toHaveLength(1);
  });

  it("two workers on one queue never run the same occurrence twice", async () => {
    const run = await operatorRun();
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    const first = await store.ensureLiveScheduledTick({ tenantId: run.tenantId, goalRunId: run.id });
    const executions: string[] = [];
    const base = occurrenceDeps(run);
    const deps = occurrenceDeps(run, {
      decide: async input => {
        executions.push(input.cycleId);
        await new Promise(resolve => setTimeout(resolve, 300));
        return base.decide(input);
      },
    });
    const workers = [0, 1].map(
      index =>
        new GoalCycleWorker(
          store,
          { leaseOwner: `worker-${index}-${randomUUID()}`, leaseMs: 30_000, pollMs: 10, concurrency: 2, retryBaseMs: 10 },
          input => runGoalCycleOccurrence(input, deps)
        )
    );
    workers.forEach(worker => void worker.start());
    const deadline = Date.now() + 20_000;
    try {
      while (Date.now() < deadline) {
        const rows = await requests(run);
        if (rows.find(r => r.id === first.id)?.status === "completed") break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    } finally {
      await Promise.all(workers.map(worker => worker.stop()));
    }
    expect(executions).toEqual([first.id]);
    expect(await decisionsFor(run)).toHaveLength(1);
    const rows = await requests(run);
    expect(liveTicks(rows)).toHaveLength(1);
    expect(rows).toHaveLength(2);
  }, 40_000);

  it("a worker that dies mid-cycle is recovered by another: same occurrence, one decision, then a successor", async () => {
    const run = await operatorRun();
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    const first = await store.ensureLiveScheduledTick({ tenantId: run.tenantId, goalRunId: run.id });
    // Worker A claims with a short lease, decides, and dies before completing.
    const dead = await store.claimNextStep({ leaseOwner: "dead-worker", leaseMs: 200 });
    expect(dead?.id).toBe(first.id);
    await store.markRunning(dead as ClaimedGoalCycle);
    await runGoalCycleOccurrence({ tenantId: run.tenantId, runId: run.id, cycleId: first.id! }, occurrenceDeps(run));
    expect(await decisionsFor(run)).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 400));

    const recovered = await runOne(store, occurrenceDeps(run));
    expect(recovered?.step.id).toBe(first.id);
    expect(recovered?.step.attemptCount).toBe(2);
    expect((recovered!.result as { decisionCreated: boolean }).decisionCreated).toBe(false);
    // The dead worker's late completion is fenced off by the lease.
    expect(await store.completeStep(dead as ClaimedGoalCycle, { nextEvaluationAt: new Date().toISOString() })).toBe(false);
    const rows = await requests(run);
    expect(rows.find(r => r.id === first.id)?.status).toBe("completed");
    expect(liveTicks(rows)).toHaveLength(1);
    expect(await decisionsFor(run)).toHaveLength(1);
    const [history] = await queue.query<mysql.RowDataPacket[]>(
      "SELECT eventType, leaseOwner FROM goal_cycle_history WHERE tenantId = ? AND requestId = ? ORDER BY id",
      [run.tenantId, first.id]
    );
    expect(history.filter(h => h.eventType === "cycle.leased")).toHaveLength(2);
  });

  it("a pre-1B frozen tick unfreezes through normal code: its next run finishes it and the successor decides afresh", async () => {
    const run = await operatorRun();
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    // Production shape: one scheduled tick that has re-queued itself under the same id since a
    // September decision, so every hour returned that decision.
    const frozenId = randomUUID();
    await queue.execute(
      "INSERT INTO goal_cycle_tenant_state (tenantId) VALUES (?) ON DUPLICATE KEY UPDATE tenantId = tenantId",
      [run.tenantId]
    );
    await queue.execute(
      "INSERT INTO goal_cycle_requests (id, tenantId, goalRunId, triggerType, triggerSourceReference, idempotencyKey, status, availableAt, maxAttempts, attemptCount, resultJson) VALUES (?, ?, ?, 'scheduled_tick', 'autonomous_supervisor:heartbeat', ?, 'queued', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND), 5, 0, ?)",
      [frozenId, run.tenantId, run.id, `auto_tick:${run.id}:2026-09-30T14`, JSON.stringify({ decisionId: "september" })]
    );
    const september = await appendGoalCycleDecision({
      tenantId: run.tenantId, goalRunId: run.id, cycleId: frozenId,
      canonicalOperatorId: run.canonicalOperatorId, operatorUserId: run.operatorUserId, policyVersion: "v1",
      weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: null,
      candidateIds: [], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
      selectionKind: "wait", selectedRef: null, selectedExecutionType: null, selectedReasonCode: "SEPTEMBER_DECISION",
      evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null, sourceCoverage: {}, loadout: [], experiment: null,
    });

    const thaw = await runOne(store, occurrenceDeps(run));
    expect(thaw?.step.id).toBe(frozenId);
    expect((thaw!.result as { decisionId: string; decisionCreated: boolean }).decisionId).toBe(september.decision.id);
    let rows = await requests(run);
    expect(rows.find(r => r.id === frozenId)?.status).toBe("completed");
    const successor = liveTicks(rows);
    expect(successor).toHaveLength(1);
    expect(successor[0]!.id).not.toBe(frozenId);

    await makeDue(run);
    const fresh = await runOne(store, occurrenceDeps(run));
    expect(fresh?.step.id).toBe(successor[0]!.id);
    const decisions = await decisionsFor(run);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]!.id).toBe(september.decision.id);
    expect(decisions[1]!.cycleId).toBe(successor[0]!.id);
    expect(decisions[1]!.selectedReasonCode).not.toBe("SEPTEMBER_DECISION");
    rows = await requests(run);
    expect(rows.find(r => r.id === frozenId)?.idempotencyKey).toBe(`auto_tick:${run.id}:2026-09-30T14`);
  });
});
