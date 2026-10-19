/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { weekStartMonday } from "../../shared/weeklyMissionReadiness";
import { workThreadCandidateId } from "../../shared/workThread";
import { decideGoalCycle } from "../agents/persistentOperator/decisionEngine";
import { GoalCycleStore } from "../agents/persistentOperator/goalCycleStore";
import { createIsolatedGoalCycleDb } from "../agents/persistentOperator/goalCycleIsolatedDb.testSupport";
import {
  defaultGoalCycleOccurrenceDeps,
  runGoalCycleOccurrence,
  type GoalCycleOccurrenceDeps,
} from "../agents/persistentOperator/goalCycleOccurrence";
import { closeWorkThread } from "../agents/persistentOperator/workThreadStore";
import { respondToStrategicProposal, reviseStrategicProposal } from "./strategicApproval";
import { prepareStrategicProposal } from "./strategicPreparation";
import { latestStrategicProposal } from "./strategicStore";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
import {
  createWorkThreadTenant,
  SILVER_LAKE_LEDGER,
  type WorkThreadTenant,
} from "./workThreadTenant.testSupport";

/**
 * Real-MySQL proof for Phase 2 · Slice A: durable Work Thread identity.
 *
 * Production code throughout: CleanCloud history arrives through the
 * browser-sync import, the operator's goal and Daphne focus are stored as
 * usual, and each goal-cycle occurrence runs runGoalCycleOccurrence with the
 * real action policy, prepareStrategicProposal (diagnosis, Mission Director,
 * proposal) and decideGoalCycle (candidate feed, Mission Director, objective
 * store). Only the metric evaluation is stubbed, as in the 1B occurrence test.
 * The occurrence queue is a private database so no parallel test file's
 * worker can claim these cycles.
 *
 * Time: only `Date` is faked, so every component (preparation, Mission
 * Director, the decision engine) reads one clock, starting at the next 09:00
 * in Los Angeles. Timers and the database run in real time; due occurrences
 * are made due explicitly.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const HOUR = 3_600_000;
const SILVER_LAKE_WIN_BACK = "strategy:v1:laundry_fluff_fold:retention:lapsed_customers:area=silver_lake";
const ZONE = "America/Los_Angeles";

function nextMorningInLosAngeles(): Date {
  const now = new Date();
  const nine = fromZonedTime(`${formatInTimeZone(now, ZONE, "yyyy-MM-dd")}T09:00:00`, ZONE);
  return nine.getTime() > now.getTime() ? nine : fromZonedTime(`${formatInTimeZone(new Date(now.getTime() + 24 * HOUR), ZONE, "yyyy-MM-dd")}T09:00:00`, ZONE);
}
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describeMysql("Work Thread identity on MySQL", () => {
  let sql: mysql.Connection;
  let iso: Awaited<ReturnType<typeof createIsolatedGoalCycleDb>>;
  let queue: Pool;
  const previousKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    // Preparation research uses its deterministic source receipt; no model call.
    process.env.ANTHROPIC_API_KEY = "";
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    iso = await createIsolatedGoalCycleDb(process.env.DATABASE_URL!);
    queue = iso.pool;
  }, 120_000);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(nextMorningInLosAngeles());
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    await sql?.end();
    await iso?.drop();
  });

  async function tenant(focus: string, now: Date) {
    const t = await createWorkThreadTenant(sql, { prefix: "wt", focus, now });
    await t.importLedger(SILVER_LAKE_LEDGER, now);
    await iso.insertRun({ id: t.run.id, tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId, operatorUserId: t.openId, verticalKey: "laundry_fluff_fold" });
    return t;
  }

  /** Production occurrence wiring; only the goal metric read is stubbed. */
  function occurrenceDeps(t: WorkThreadTenant): GoalCycleOccurrenceDeps {
    const production = defaultGoalCycleOccurrenceDeps({ registry: defaultVerticalRegistry, appointmentStore: undefined as never });
    return {
      ...production,
      evaluateRun: async () => ({
        run: { id: t.run.id, status: "active", operatorUserId: t.openId, nextEvaluationAt: new Date(Date.now() + HOUR) },
        completed: false,
        observation: null,
      }),
      // The production preparation, minus the call scheduling no test may place.
      prepare: async () => {
        await prepareStrategicProposal({ identity: t.identity, timeZone: t.zone });
      },
      decide: input => decideGoalCycle({ ...input, registry: defaultVerticalRegistry }),
    };
  }

  /** One worker step by hand: this run's next occurrence becomes due, is claimed, run and completed. */
  async function runOccurrence(t: WorkThreadTenant, store: GoalCycleStore, deps: GoalCycleOccurrenceDeps) {
    await queue.execute(
      "UPDATE goal_cycle_requests SET availableAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE tenantId = ? AND goalRunId = ? AND status = 'queued'",
      [t.tenantId, t.run.id]
    );
    const step = await store.claimNextStep({ leaseOwner: `wt-${randomUUID()}`, leaseMs: 60_000 });
    if (!step || step.tenantId !== t.tenantId) throw new Error("This run's occurrence was not the one due");
    await store.markRunning(step);
    const result = await runGoalCycleOccurrence({ tenantId: step.tenantId, runId: step.goalRunId, cycleId: step.id }, deps);
    await store.completeStep(step, result);
    return result;
  }

  const rows = async (query: string, params: unknown[]) => (await sql.execute<mysql.RowDataPacket[]>(query, params))[0];
  const threadsOf = (tenantId: string) =>
    rows("SELECT id, opportunityKey, generation, status, kind, title FROM work_threads WHERE tenantId = ? ORDER BY createdAt, generation", [tenantId]);
  const decisionsOf = (tenantId: string) =>
    rows(
      "SELECT id, selectionKind, selectedRef, workThreadId, JSON_UNQUOTE(JSON_EXTRACT(sourceCoverageJson, '$.workThread.status')) AS threadStatus FROM goal_cycle_decisions WHERE tenantId = ? ORDER BY createdAt, id",
      [tenantId]
    );
  const objectivesOf = (tenantId: string) =>
    rows("SELECT id, decisionId, latestDecisionId, workThreadId, selectedRef, status, businessDate, title FROM goal_cycle_objectives WHERE tenantId = ? ORDER BY createdAt, id", [tenantId]);
  const diagnosesOf = async (tenantId: string) =>
    (await rows("SELECT id, payloadJson FROM strategic_diagnoses WHERE tenantId = ? ORDER BY createdAt, id", [tenantId])).map(row => {
      const payload = typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson) : row.payloadJson;
      return { id: String(row.id), thread: payload.actions[0]?.workThreadId as string | undefined, condition: payload.actions[0]?.completionCondition as string, statement: payload.objective?.statement as string | undefined };
    });

  it("one opportunity keeps one thread and one open objective across occurrences, re-diagnoses, wording, a restart, a day, a revision and approval", async () => {
    const t = await tenant("Maximize sales in Silver Lake", new Date());
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    await store.ensureLiveScheduledTick({ tenantId: t.tenantId, goalRunId: t.run.id });
    const deps = occurrenceDeps(t);

    // 1. First occurrence: the opportunity is diagnosed, threaded, selected and presented.
    const first = await runOccurrence(t, store, deps);
    const [thread] = await threadsOf(t.tenantId);
    expect(thread).toMatchObject({ opportunityKey: SILVER_LAKE_WIN_BACK, generation: 1, status: "open", kind: "strategy_opportunity" });
    const threadId = String(thread!.id);
    expect(first.selectedRef).toBe(workThreadCandidateId(threadId));
    expect(first.objectiveId).toBeTruthy();

    // 2. An hour later the diagnosis is refreshed under a new id; same thread, same objective.
    advance(HOUR + 60_000);
    const second = await runOccurrence(t, store, deps);
    expect(second.decisionId).not.toBe(first.decisionId);
    expect(second.objectiveId).toBe(first.objectiveId);

    // 3. Wording and targets change: the operator restates the focus, and a
    //    third Silver Lake customer lapses, so the customers named change.
    await t.focusOn("Grow Silver Lake revenue");
    await t.importLedger([{ name: "Ellis Park", customerId: "c5", address: "2500 Hyperion Ave Los Angeles CA 90039", daysAgo: [130, 90], total: "75.00" }], new Date());
    advance(HOUR + 60_000);
    const third = await runOccurrence(t, store, deps);
    expect(third.objectiveId).toBe(first.objectiveId);

    // 4. Worker restart: a new store and new wiring; nothing survives in memory.
    const restarted = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    advance(HOUR + 60_000);
    const fourth = await runOccurrence(t, restarted, occurrenceDeps(t));
    expect(fourth.objectiveId).toBe(first.objectiveId);

    // 5. The next business day: the open objective is re-presented, not re-minted.
    advance(24 * HOUR);
    await t.importLedger([], new Date()); // the day's CleanCloud sync
    const fifth = await runOccurrence(t, restarted, occurrenceDeps(t));
    expect(fifth.objectiveId).toBe(first.objectiveId);

    const diagnoses = await diagnosesOf(t.tenantId);
    expect(new Set(diagnoses.map(d => d.id)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(diagnoses.map(d => d.thread))).toEqual(new Set([threadId]));
    expect(diagnoses[0]!.condition).toContain("Bea Lund, Alma Reyes");
    expect(diagnoses.at(-1)!.condition).toContain("Ellis Park");
    expect(diagnoses.at(-1)!.statement).toBe("Grow Silver Lake revenue");

    const decisions = await decisionsOf(t.tenantId);
    expect(decisions).toHaveLength(5);
    for (const decision of decisions)
      expect(decision).toMatchObject({ selectionKind: "candidate", selectedRef: workThreadCandidateId(threadId), workThreadId: threadId, threadStatus: "resolved" });
    let objectives = await objectivesOf(t.tenantId);
    expect(objectives).toHaveLength(1);
    expect(objectives[0]).toMatchObject({
      id: first.objectiveId,
      decisionId: first.decisionId,
      latestDecisionId: fifth.decisionId,
      workThreadId: threadId,
      status: "presented",
      businessDate: formatInTimeZone(new Date(), t.zone, "yyyy-MM-dd"),
    });
    expect(await threadsOf(t.tenantId)).toHaveLength(1);

    // 6. The operator revises the proposed item's wording, then approves the revision.
    const weekStart = weekStartMonday(formatInTimeZone(new Date(), t.zone, "yyyy-MM-dd"));
    const proposal = (await latestStrategicProposal(t.identity, weekStart)) ?? (await latestStrategicProposal(t.identity, (await prepareStrategicProposal({ identity: t.identity, timeZone: t.zone, now: new Date() })).weekStart));
    const strategyItem = proposal!.items.find(item => item.planId.startsWith("strategic_diagnosis:"))!;
    expect(strategyItem).toMatchObject({ candidateId: workThreadCandidateId(threadId), workThreadId: threadId });
    const revised = await reviseStrategicProposal({
      identity: t.identity,
      proposalId: proposal!.id,
      revision: proposal!.revision,
      itemId: strategyItem.id,
      title: "Call the lapsed Silver Lake regulars",
      now: new Date(),
    });
    const revisedItem = revised.items.find(item => item.id === strategyItem.id)!;
    expect(revisedItem).toMatchObject({ title: "Call the lapsed Silver Lake regulars", workThreadId: threadId });
    const approved = await respondToStrategicProposal({
      identity: t.identity,
      proposalId: revised.id,
      revision: revised.revision,
      action: "approve",
      itemIds: [revisedItem.id],
      source: "authenticated_app",
      now: new Date(),
    });
    expect(approved.failedItems).toEqual([]);
    expect(approved.unboundItems).toEqual([]);
    const [commitment] = await rows("SELECT id, metadataJson FROM day_director_commitments WHERE tenantId = ? AND id = ?", [t.tenantId, approved.actionIds[0]]);
    const metadata = typeof commitment!.metadataJson === "string" ? JSON.parse(commitment!.metadataJson) : commitment!.metadataJson;
    expect(metadata.objectiveLineage).toEqual({ objectiveId: first.objectiveId, objectiveStatus: "accepted" });
    expect(metadata.workThread).toEqual({ id: threadId });

    // 7. Execution continues on the same thread: the approved commitment and the
    //    strategy recommendation both lead back to the one accepted objective.
    advance(HOUR + 60_000);
    const sixth = await runOccurrence(t, restarted, occurrenceDeps(t));
    expect(sixth.objectiveId).toBe(first.objectiveId);
    const [continued] = (await decisionsOf(t.tenantId)).slice(-1);
    expect(continued).toMatchObject({ workThreadId: threadId, threadStatus: "resolved" });
    objectives = await objectivesOf(t.tenantId);
    expect(objectives).toHaveLength(1);
    expect(objectives[0]).toMatchObject({ id: first.objectiveId, status: "accepted", latestDecisionId: sixth.decisionId, workThreadId: threadId });
    expect(await threadsOf(t.tenantId)).toHaveLength(1);
    // While that approved execution is open, the opportunity is not proposed again.
    const afterApproval = (await latestStrategicProposal(t.identity, weekStartMonday(formatInTimeZone(new Date(), t.zone, "yyyy-MM-dd"))))!;
    expect(afterApproval.id).not.toBe(revised.id);
    expect(afterApproval.items.some(item => item.planId.startsWith("strategic_diagnosis:"))).toBe(false);
    expect(afterApproval.uncertainty.join(" ")).toContain("is already approved and still open on the Day Line");
  }, 240_000);

  it("distinct customer actions and distinct experiments stay distinct, even in the same neighborhood with the same action type", async () => {
    const t = await tenant("Maximize sales in Silver Lake", new Date());
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    await store.ensureLiveScheduledTick({ tenantId: t.tenantId, goalRunId: t.run.id });
    const deps = occurrenceDeps(t);
    const today = formatInTimeZone(new Date(), t.zone, "yyyy-MM-dd");

    // Two Silver Lake win-back calls the operator asked for: same neighborhood,
    // same action type, different customers. Mission Director continues them first.
    const almaCall = await t.instruct("Call Alma Reyes about restarting weekly laundry", today);
    const beaCall = await t.instruct("Call Bea Lund about restarting weekly laundry", today);
    const calls = new Set([almaCall, beaCall]);
    const selected: Array<{ commitmentId: string; objectiveId: string }> = [];
    for (let i = 0; i < 2; i += 1) {
      const result = await runOccurrence(t, store, deps);
      const commitmentId = String(result.selectedRef).split(":").at(-1)!;
      expect(calls.has(commitmentId)).toBe(true);
      selected.push({ commitmentId, objectiveId: String(result.objectiveId) });
      // The call is done; the next occurrence moves on.
      await t.dayDirector.complete({ commitmentId });
      advance(HOUR + 60_000);
    }
    expect(new Set(selected.map(s => s.commitmentId))).toEqual(calls);

    // With both calls done, the area-wide win-back program is selected.
    const program = await runOccurrence(t, store, deps);
    const threads = await threadsOf(t.tenantId);
    const winBack = threads.find(row => row.opportunityKey === SILVER_LAKE_WIN_BACK)!;
    expect(program.selectedRef).toBe(workThreadCandidateId(String(winBack.id)));
    const customerThreads = threads.filter(row => row.kind === "work_subject");
    expect(customerThreads.map(row => row.opportunityKey).sort()).toEqual(
      [...calls].map(id => `work:v1:wgc:${t.tenantId}:day_director_commitment:${id}`).sort()
    );

    let objectives = await objectivesOf(t.tenantId);
    expect(objectives).toHaveLength(3);
    // Each action has its own objective on its own thread; none was folded into another.
    expect(new Set(objectives.map(o => o.workThreadId)).size).toBe(3);
    for (const call of selected) {
      const objective = objectives.find(o => o.id === call.objectiveId)!;
      const callThread = customerThreads.find(row => row.opportunityKey.endsWith(call.commitmentId))!;
      expect(objective.workThreadId).toBe(callThread.id);
    }
    expect(objectives.find(o => o.id === program.objectiveId)!.workThreadId).toBe(winBack.id);

    // A different experiment: the operator turns to Beverly Hills, where no one has lapsed.
    await t.focusOn("Grow sales in Beverly Hills");
    advance(HOUR + 60_000);
    const beverlyHills = await runOccurrence(t, store, deps);
    const acquisition = (await threadsOf(t.tenantId)).find(row => row.opportunityKey === "strategy:v1:laundry_fluff_fold:acquisition:new_customers:area=beverly_hills")!;
    expect(acquisition).toBeTruthy();
    expect(beverlyHills.selectedRef).toBe(workThreadCandidateId(String(acquisition.id)));
    expect(beverlyHills.objectiveId).not.toBe(program.objectiveId);

    // The same neighborhood and action type again, after the first win-back
    // experiment has concluded: a new thread (generation 2), not the old one reopened.
    await closeWorkThread({ tenantId: t.tenantId, threadId: String(winBack.id), reason: "experiment_concluded", now: new Date() });
    await t.focusOn("Maximize sales in Silver Lake");
    advance(HOUR + 60_000);
    const again = await runOccurrence(t, store, deps);
    const generations = (await threadsOf(t.tenantId)).filter(row => row.opportunityKey === SILVER_LAKE_WIN_BACK);
    expect(generations.map(row => [row.generation, row.status])).toEqual([[1, "closed"], [2, "open"]]);
    const secondGeneration = String(generations[1]!.id);
    expect(secondGeneration).not.toBe(String(winBack.id));
    expect(again.selectedRef).toBe(workThreadCandidateId(secondGeneration));
    expect(again.objectiveId).not.toBe(program.objectiveId);

    objectives = await objectivesOf(t.tenantId);
    expect(objectives).toHaveLength(5);
    // The first experiment's history still points at its own thread.
    expect(objectives.find(o => o.id === program.objectiveId)!.workThreadId).toBe(winBack.id);
    expect(objectives.find(o => o.id === again.objectiveId)!.workThreadId).toBe(secondGeneration);
    const decisions = await decisionsOf(t.tenantId);
    expect(decisions.every(d => d.threadStatus === "resolved" && d.workThreadId)).toBe(true);
  }, 240_000);
});
