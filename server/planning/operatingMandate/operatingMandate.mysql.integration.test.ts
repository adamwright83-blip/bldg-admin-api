import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readCanonicalRevenue } from "../../analytics/canonicalRevenue";
import { createIsolatedGoalCycleDb } from "../../agents/persistentOperator/goalCycleIsolatedDb.testSupport";
import {
  advance,
  at,
  createGoalLoopHarness,
  DAY,
  startLosAngelesMorning,
  today,
  ZONE,
} from "../../agents/persistentOperator/goalLoopHarness.testSupport";
import { activateMacroGoalRun, parseAuthoritativeMetricObservation } from "../../agents/persistentOperator/macroGoalRuns";
import { persistentOperatorRouter } from "../../agents/persistentOperator/persistentOperatorRouter";
import { readObjectiveArea } from "../../strategy/strategicEvidenceReaders";
import { latestStrategicDiagnosis } from "../../strategy/strategicStore";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { createWorkThreadTenant, SILVER_LAKE_LEDGER, type WorkThreadTenant } from "../../strategy/workThreadTenant.testSupport";
import { readWinBackDossier } from "../../strategy/winBackDossier";
import { loadRankingContext } from "../missionDirector/missionDirectorService";

/**
 * Real-MySQL proof for Phase 2 · Slice B: one resolved, versioned operating
 * mandate that Strategic Diagnosis, Mission Director and the goal-cycle
 * decision all consume, in the seven situations the brief names.
 *
 * Goals are set through the store the goal routers use; conversational
 * remarks through Daphne's store; operator decisions through the
 * authenticated persistent-operator router; diagnoses through production
 * strategic preparation; decisions through production goal-cycle
 * occurrences; completion through the Day Line router; payments through the
 * CleanCloud browser-sync import. Only `Date` is faked.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const ALMA = SILVER_LAKE_LEDGER[0]!;
const DANA = SILVER_LAKE_LEDGER[3]!;
const SILVER_LAKE_TARGET = {
  objective: "$2,000 a month in Silver Lake",
  metricKey: "net_sales_per_period@area:silver_lake",
  targetValue: 2000,
  unit: "USD",
};

describeMysql("operating mandate on MySQL", () => {
  let sql: mysql.Connection;
  let iso: Awaited<ReturnType<typeof createIsolatedGoalCycleDb>>;
  let loop: ReturnType<typeof createGoalLoopHarness>;
  const previousKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = "";
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    iso = await createIsolatedGoalCycleDb(process.env.DATABASE_URL!);
    loop = createGoalLoopHarness(sql, iso);
  }, 120_000);
  beforeEach(() => startLosAngelesMorning());
  afterEach(async () => {
    await loop.retireTenants();
    vi.useRealTimers();
  });
  afterAll(async () => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    await sql?.end();
    await iso?.drop();
  });

  const operator = (t: WorkThreadTenant) =>
    persistentOperatorRouter.createCaller({
      tenantId: t.tenantId,
      user: { id: t.userId, openId: t.openId, role: "user", name: "Op" },
      req: undefined,
      res: undefined,
      vendorSession: null,
    } as never);
  const mandateOf = async (t: WorkThreadTenant) => (await operator(t).operatingMandate())!;
  const proposalOf = (t: WorkThreadTenant) => prepareStrategicProposal({ identity: t.identity, timeZone: t.zone });
  const goalRows = (tenantId: string) =>
    loop.rows("SELECT id, metricKey, status, supersededById FROM operator_macro_goals WHERE tenantId = ? ORDER BY createdAt, id", [tenantId]);
  const runRows = (tenantId: string) =>
    loop.rows("SELECT id, macroGoalId, status, baselineValue FROM macro_goal_runs WHERE tenantId = ? ORDER BY createdAt, id", [tenantId]);
  const decisionOf = async (tenantId: string, cycleId: string) => {
    const [row] = await loop.rows(
      "SELECT goalRunId, selectionKind, selectedRef, selectedReasonCode, missionDirectorRevision, sourceCoverageJson FROM goal_cycle_decisions WHERE tenantId = ? AND cycleId = ?",
      [tenantId, cycleId]
    );
    return { ...row!, coverage: loop.json(row!.sourceCoverageJson) as Record<string, any> };
  };
  /** A real gap on the database clock, which stamps remarks and decisions. */
  const tick = () => new Promise(resolve => setTimeout(resolve, 15));
  /** Goals stamped in the same second order by id, so compare goal lists as sets. */
  const sorted = <T>(items: readonly T[]) => [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  it("1. a 50-customer target, then interest in Silver Lake: the remark focuses the work and never becomes the goal", async () => {
    const { t } = await loop.tenant({ prefix: "b1" });
    const { mandate } = await mandateOf(t);
    const goal = mandate.outcomes[0]!;
    expect(mandate.outcomes).toHaveLength(1);
    expect(goal).toMatchObject({ statement: "Get to 50 active customers", baseMetricKey: "active_customers", area: null, target: 50, confirmation: "confirmed", primary: false });
    expect(mandate.leadingOutcome).toEqual({ id: goal.id, basis: "sole_outcome" });
    expect(mandate.primaryOutcomeId).toBeNull();
    expect(mandate.focuses.find(f => f.id === mandate.appliedFocusId)).toMatchObject({
      area: "silver_lake",
      label: "Silver Lake",
      confirmation: "inferred",
      status: "active",
      relationship: { kind: "serves", outcomeId: goal.id, confirmation: "inferred" },
    });
    expect(mandate.uncertainty.join(" ")).toMatch(/Silver Lake comes from conversation, not a confirmed goal or focus/);

    const proposal = await proposalOf(t);
    const d = proposal.diagnosis;
    expect(d.goal).toMatchObject({ statement: "Get to 50 active customers", metricKey: "active_customers", target: 50 });
    expect(d.objective).toMatchObject({ area: "Silver Lake", confirmation: "inferred" });
    expect(d.currentCondition).toMatch(/^You mentioned: Maximize sales in Silver Lake \(not a confirmed goal\)\./);
    expect(d.actions[0]!.intendedOutcome).toBe("A defensible next experiment toward: Get to 50 active customers");
    expect(d.mandate).toMatchObject({
      revision: mandate.revision,
      leadingOutcomeId: goal.id,
      primaryOutcomeId: null,
      servesOutcomeIds: [goal.id],
      focus: { area: "silver_lake", confirmation: "inferred" },
      methodApplied: false,
    });
    if (proposal.weeklyPlan) expect(proposal.weeklyPlan.objective).toBe("Get to 50 active customers (starting in Silver Lake)");
    // The remark created no goal and touched no run.
    expect((await goalRows(t.tenantId)).map(g => [g.metricKey, g.status])).toEqual([["active_customers", "active"]]);
    expect((await runRows(t.tenantId)).map(r => [r.id, r.status])).toEqual([[t.run.id, "active"]]);

    // Choosing the only goal as first changes no wording; the next preparation
    // still carries it rather than reusing the hour-old diagnosis.
    await operator(t).decideOperatingMandate({ kind: "primary_outcome", outcomeId: goal.id });
    await proposalOf(t);
    expect((await latestStrategicDiagnosis(t.identity))?.mandate).toMatchObject({ primaryOutcomeId: goal.id, leadingOutcomeId: goal.id });
  }, 300_000);

  it("2. a separate Silver Lake revenue target is its own goal and run; neither goal is first until the operator says so", async () => {
    const { t, store } = await loop.tenant({ prefix: "b2" });
    const customers = (await mandateOf(t)).mandate.outcomes[0]!;
    const silverLake = await loop.addGoal(t, store, SILVER_LAKE_TARGET);
    const silverLakeId = `operator_macro_goals:${silverLake.goal.id}`;

    // Both goals stay active, each with its own run; the newer replaced nothing.
    expect(sorted((await goalRows(t.tenantId)).map(g => [g.id, g.status]))).toEqual(
      sorted([
        [customers.goalId, "active"],
        [silverLake.goal.id, "active"],
      ])
    );
    const runs = await runRows(t.tenantId);
    expect(sorted(runs.map(r => [r.macroGoalId, r.status]))).toEqual(
      sorted([
        [customers.goalId, "active"],
        [silverLake.goal.id, "active"],
      ])
    );
    // The Silver Lake run measures Silver Lake orders only: Cruz's two $40 orders
    // this month, not Dana's in Beverly Hills.
    expect(Number(runs.find(r => r.macroGoalId === silverLake.goal.id)!.baselineValue)).toBe(80);

    const { mandate } = await mandateOf(t);
    expect(sorted(mandate.outcomes.map(o => [o.id, o.baseMetricKey, o.area]))).toEqual(
      sorted([
        [customers.id, "active_customers", null],
        [silverLakeId, "net_sales_per_period", "silver_lake"],
      ])
    );
    expect(mandate.primaryOutcomeId).toBeNull();
    expect(mandate.leadingOutcome).toBeNull();
    expect(mandate.conflicts.find(c => c.kind === "competing_outcomes")).toMatchObject({ status: "unresolved", resource: "daily_primary_work" });
    // The Silver Lake remark now belongs to the Silver Lake goal.
    expect(mandate.focuses.find(f => f.id === mandate.appliedFocusId)?.relationship).toEqual({ kind: "serves", outcomeId: silverLakeId, confirmation: "inferred" });

    const d = (await proposalOf(t)).diagnosis;
    // Not the newest goal: both, with neither first.
    expect(d.goal.metricKey).toBe("unprioritized_goals");
    expect(d.mandate).toMatchObject({ leadingOutcomeId: null, primaryOutcomeId: null });
    expect([...d.mandate!.servesOutcomeIds].sort()).toEqual([customers.id, silverLakeId].sort());
    expect(d.actions[0]!.intendedOutcome).toMatch(/^A defensible next experiment toward: /);
    expect(d.actions[0]!.intendedOutcome).toContain("Get to 50 active customers");
    expect(d.actions[0]!.intendedOutcome).toContain("$2,000 a month in Silver Lake");
    expect(d.uncertainty).toContain("2 goals are active and none is confirmed as first.");
  }, 300_000);

  it("3. a change of strategy changes the method and its Work Thread, never the goal, its run or its baseline", async () => {
    const { t } = await loop.tenant({ prefix: "b3" });
    const before = (await mandateOf(t)).mandate;
    const goal = before.outcomes[0]!;
    const first = await proposalOf(t);
    expect(first.diagnosis.selectedApproach).toBe("Win back lapsed Silver Lake customers");
    const winBack = first.items.find(i => i.planId.startsWith("strategic_diagnosis:"))!;
    const runsBefore = await runRows(t.tenantId);

    const decided = (await operator(t).decideOperatingMandate({
      kind: "method",
      outcomeId: goal.id,
      lever: "acquisition",
      population: "new_customers",
      area: "Silver Lake",
      statement: "Find new Silver Lake customers door to door",
    }))!;
    expect(decided.created).toBe(true);
    expect(decided.mandate.revision).not.toBe(decided.previousRevision);
    const { mandate } = await mandateOf(t);
    const methodRef = `operating_mandate_decisions:${decided.decision.id}`;
    // Same goal, same revision of it; same run and baseline; no new goal row.
    expect(mandate.outcomes).toEqual(before.outcomes);
    expect(await runRows(t.tenantId)).toEqual(runsBefore);
    expect(await goalRows(t.tenantId)).toHaveLength(1);
    expect(mandate.statedMethodId).toBe(methodRef);
    expect(mandate.hypotheses.find(h => h.id === methodRef)).toMatchObject({
      origin: "operator_stated",
      confirmation: "confirmed",
      epistemicStatus: "unproven",
      lever: "acquisition",
      population: "new_customers",
      area: "silver_lake",
      outcomeId: goal.id,
    });

    const second = await proposalOf(t);
    const d = second.diagnosis;
    expect(d.goal).toMatchObject({ metricKey: "active_customers", target: 50 });
    expect(d.selectedApproach).toBe("Find new Silver Lake customers through building and door outreach");
    expect(d.mandate).toMatchObject({ methodApplied: true, statedMethodId: methodRef });
    const alternative = d.options.find(o => o.id !== d.selectedOptionId)!;
    expect(alternative.approach).toBe("Win back lapsed Silver Lake customers");
    expect(alternative.reason).toMatch(/^Not chosen because you asked for new customers/);
    expect(d.actions[0]!.opportunity).toMatchObject({ lever: "acquisition", population: "new_customers", area: "silver_lake" });
    const outreach = second.items.find(i => i.planId.startsWith("strategic_diagnosis:"))!;
    expect(outreach.workThreadId).toBeTruthy();
    expect(outreach.workThreadId).not.toBe(winBack.workThreadId);
  }, 300_000);

  it("4. an explicit replacement supersedes a confirmed goal on another metric, and its run decides nothing more", async () => {
    const { t, store } = await loop.tenant({ prefix: "b4" });
    const customers = (await mandateOf(t)).mandate.outcomes[0]!;
    const replacement = await loop.addGoal(
      t,
      store,
      { objective: "Reach $3,000 in monthly sales", metricKey: "net_sales_per_period", targetValue: 3000, unit: "USD", replacesGoalId: customers.goalId },
      { activate: false }
    );
    const replacementId = `operator_macro_goals:${replacement.goal.id}`;
    expect(await goalRows(t.tenantId)).toEqual([
      expect.objectContaining({ id: customers.goalId, status: "superseded", supersededById: replacement.goal.id }),
      expect.objectContaining({ id: replacement.goal.id, status: "active" }),
    ]);
    const { mandate } = await mandateOf(t);
    expect(mandate.outcomes.map(o => o.id)).toEqual([replacementId]);
    expect(mandate.leadingOutcome).toEqual({ id: replacementId, basis: "sole_outcome" });
    expect(mandate.history).toContainEqual(expect.objectContaining({ ref: customers.id, status: "superseded", supersededBy: replacementId }));

    // The replaced goal's run, already queued, decides nothing more for it.
    const stale = await loop.runOccurrence(t, store);
    expect(await decisionOf(t.tenantId, stale.cycleId)).toMatchObject({ selectionKind: "wait", selectedReasonCode: "GOAL_OUTCOME_NOT_ACTIVE" });
    expect(await loop.rows("SELECT id FROM goal_cycle_objectives WHERE tenantId = ?", [t.tenantId])).toEqual([]);

    // Activating the replacement's run stops the replaced goal's run.
    const run = await activateMacroGoalRun({
      tenantId: t.tenantId,
      identity: t.identity,
      verticalKey: t.verticalKey,
      policyVersion: "v1",
      registry: defaultVerticalRegistry,
      goal: replacement.goal,
    });
    expect((await runRows(t.tenantId)).map(r => [r.id, r.status])).toEqual([
      [t.run.id, "superseded"],
      [run.id, "active"],
    ]);
  }, 300_000);

  it("5. two goals compete for the day's one primary piece of work: open until the operator chooses, and shared work is one objective", async () => {
    const { t, store } = await loop.tenant({ prefix: "b5" });
    const customers = (await mandateOf(t)).mandate.outcomes[0]!;
    const silverLake = await loop.addGoal(t, store, SILVER_LAKE_TARGET);
    const silverLakeId = `operator_macro_goals:${silverLake.goal.id}`;
    const conflict = (await mandateOf(t)).mandate.conflicts.find(c => c.kind === "competing_outcomes")!;
    expect(conflict).toMatchObject({ status: "unresolved", resource: "daily_primary_work" });
    expect(sorted(conflict.refs)).toEqual(sorted([customers.id, silverLakeId]));

    // Each goal's run decides; both choose the day's one primary, and the work they share is one objective.
    const one = await decisionOf(t.tenantId, (await loop.runOccurrence(t, store)).cycleId);
    const two = await decisionOf(t.tenantId, (await loop.runOccurrence(t, store, silverLake.run!.id)).cycleId);
    expect([one.selectionKind, two.selectionKind]).toEqual(["candidate", "candidate"]);
    expect(two.selectedRef).toBe(one.selectedRef);
    for (const d of [one, two])
      expect(d.coverage.mandate).toMatchObject({ status: "available", primaryOutcomeId: null, leadingOutcomeId: null, unresolvedConflicts: [conflict.id] });
    expect(one.coverage.mandate.outcomeId).toBe(customers.id);
    expect(two.coverage.mandate.outcomeId).toBe(silverLakeId);
    expect([...one.coverage.mandate.selectedWorkServesOutcomeIds].sort()).toEqual([customers.id, silverLakeId].sort());
    const objectives = await loop.rows("SELECT id, goalRunId, workThreadId FROM goal_cycle_objectives WHERE tenantId = ?", [t.tenantId]);
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.goalRunId).toBe(t.run.id);

    // The operator chooses the Silver Lake goal first.
    const chosen = (await operator(t).decideOperatingMandate({ kind: "primary_outcome", outcomeId: silverLakeId }))!;
    const { mandate } = await mandateOf(t);
    expect(mandate.primaryOutcomeId).toBe(silverLakeId);
    expect(mandate.leadingOutcome).toEqual({ id: silverLakeId, basis: "confirmed_primary" });
    expect(mandate.conflicts.find(c => c.kind === "competing_outcomes")).toMatchObject({
      status: "resolved",
      resolution: { by: "confirmed_primary", ref: `operating_mandate_decisions:${chosen.decision.id}` },
    });
    // Mission Director ranks with the choice, and re-plans because of it.
    const context = await loadRankingContext({ tenantId: t.tenantId, operatorUserIds: [t.openId], businessDate: today(), timeZone: ZONE });
    expect(context.macroGoal).toMatchObject({ metricKey: SILVER_LAKE_TARGET.metricKey, objective: SILVER_LAKE_TARGET.objective });
    expect(sorted(context.outcomes!.map(o => [o.id, o.primary]))).toEqual(
      sorted([
        [customers.id, false],
        [silverLakeId, true],
      ])
    );
    const three = await decisionOf(t.tenantId, (await loop.runOccurrence(t, store)).cycleId);
    expect(three.coverage.mandate).toMatchObject({ primaryOutcomeId: silverLakeId, leadingOutcomeId: silverLakeId, unresolvedConflicts: [] });
    expect(Number(three.missionDirectorRevision)).toBeGreaterThan(Number(two.missionDirectorRevision));
    // Repeating the choice records nothing; a goal that is not the operator's cannot be chosen.
    const again = (await operator(t).decideOperatingMandate({ kind: "primary_outcome", outcomeId: silverLakeId }))!;
    expect(again.created).toBe(false);
    expect(again.mandate.revision).toBe(again.previousRevision);
    await expect(operator(t).decideOperatingMandate({ kind: "primary_outcome", outcomeId: "operator_macro_goals:not-yours" })).rejects.toThrow(/not one of your active goals/);
  }, 300_000);

  it("6. a newer confirmed focus overrides an older conversational one, and a newer remark waits to be confirmed", async () => {
    const { t } = await loop.tenant({ prefix: "b6" });
    const initial = (await mandateOf(t)).mandate;
    const customers = initial.outcomes[0]!;
    const remarkRef = initial.appliedFocusId!;
    expect(remarkRef).toMatch(/^daphne_goals:/);
    await tick();
    const confirmed = (await operator(t).decideOperatingMandate({
      kind: "focus",
      action: "confirm",
      area: "Beverly Hills",
      statement: "Focus on Beverly Hills",
      servesOutcomeId: customers.id,
    }))!;
    const decisionRef = `operating_mandate_decisions:${confirmed.decision.id}`;
    let { mandate } = await mandateOf(t);
    expect(mandate.appliedFocusId).toBe(decisionRef);
    expect(mandate.focuses.find(f => f.id === decisionRef)).toMatchObject({
      area: "beverly_hills",
      label: "Beverly Hills",
      confirmation: "confirmed",
      status: "active",
      relationship: { kind: "serves", outcomeId: customers.id, confirmation: "confirmed" },
    });
    expect(mandate.focuses.find(f => f.id === remarkRef)).toMatchObject({ status: "overridden", statusReason: "older_than_confirmed_focus", overriddenBy: decisionRef });
    expect(mandate.conflicts.find(c => c.refs.includes(remarkRef))).toMatchObject({
      kind: "remark_vs_confirmed_intent",
      status: "resolved",
      resolution: { by: "confirmed_intent_precedence", ref: decisionRef },
    });

    // Every reader of the focus follows the confirmed one: the area's call sheets and the diagnosis.
    const area = () => readObjectiveArea({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId });
    expect((await area())?.label).toBe("Beverly Hills");
    const d = (await proposalOf(t)).diagnosis;
    expect(d.goal).toMatchObject({ metricKey: "active_customers", target: 50 });
    expect(d.objective).toMatchObject({ area: "Beverly Hills", confirmation: "confirmed" });
    expect(d.mandate?.focus).toMatchObject({ id: decisionRef, area: "beverly_hills", confirmation: "confirmed" });
    expect(d.actions[0]!.opportunity?.area).toBe("beverly_hills");

    // A newer remark does not undo the confirmed focus; it waits to be confirmed.
    await tick();
    const newer = await t.focusOn("Let's push Silver Lake again");
    ({ mandate } = await mandateOf(t));
    expect(mandate.appliedFocusId).toBe(decisionRef);
    expect(mandate.focuses.find(f => f.id === `daphne_goals:${newer.id}`)).toMatchObject({
      confirmation: "inferred",
      status: "pending_confirmation",
      statusReason: "newer_remark_does_not_override_confirmed_focus",
    });
    expect((await area())?.label).toBe("Beverly Hills");
    expect((await proposalOf(t)).diagnosis.objective).toMatchObject({ area: "Beverly Hills", confirmation: "confirmed" });
  }, 300_000);

  it("a neighborhood the business has never sold in does not steer its strategy until the operator confirms it", async () => {
    // Every order is in Beverly Hills; the operator once mentioned Silver Lake.
    const { t } = await loop.tenant({ prefix: "bg", ledger: [DANA, { ...DANA, name: "Eli Park", customerId: "c5", daysAgo: [70, 65] }] });
    const { mandate } = await mandateOf(t);
    expect(mandate.appliedFocusId).toBeNull();
    expect(mandate.focuses[0]).toMatchObject({ area: "silver_lake", confirmation: "inferred", status: "not_applicable", statusReason: "no_orders_in_area" });
    expect(mandate.uncertainty.join(" ")).toMatch(/none of the business's recorded orders are there/);
    expect(await readObjectiveArea({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId })).toBeNull();
    const d = (await proposalOf(t)).diagnosis;
    expect(d.objective).toBeUndefined();
    expect(d.actions[0]!.opportunity?.area).toBeNull();
    expect(d.selectedApproach).not.toMatch(/Silver Lake/);
  }, 300_000);

  it("an outage never hides a remarked area: its call sheet is withheld, not silently dropped", async () => {
    // The Claire Desk acceptance fixture: a remark about Silver Lake, a CleanCloud
    // binding whose import failed, and no orders on record at all.
    const t = await createWorkThreadTenant(sql, { prefix: "bo", focus: "Win back lapsed customers in Silver Lake", now: new Date() });
    try {
      await sql.execute(
        "INSERT INTO cleancloud_browser_sync_bindings (tenantId,id,storeId,storeLabel,createdBy,lastSuccessAt) VALUES (?,?,?,?,?,NULL)",
        [t.tenantId, randomUUID(), "fixture-store", "Fixture store", "test"]
      );
      await sql.execute(
        "INSERT INTO cleancloud_browser_sync_attempts (id,tenantId,outcome,message,rangeFrom,rangeTo,rowCount) VALUES (?,?,?,?,?,?,?)",
        [randomUUID(), t.tenantId, "failed", "Fixture import failed", "2026-10-01", "2026-10-14", 0]
      );
      // The import failed a few minutes after setup (past the one-minute source-evidence cache).
      advance(2 * 60_000);
      // Unknown is not absence: the remark stays, marked as unread.
      const { mandate } = await mandateOf(t);
      expect(mandate.focuses.find(f => f.id === mandate.appliedFocusId)).toMatchObject({ area: "silver_lake", status: "active", statusReason: "area_orders_unknown" });
      // The area's call sheet says it is withheld, and never claims nobody lapsed.
      expect((await readObjectiveArea({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId }))?.label).toBe("Silver Lake");
      const dossier = await readWinBackDossier({ tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId, timeZone: ZONE, now: new Date() });
      expect(dossier).toMatchObject({ area: "Silver Lake", lapsedCount: null, emptyMeansNoLapsedCustomers: false, contacts: [] });
      expect(dossier!.freshness).not.toBe("current");
      expect(dossier!.withheldReason).toBeTruthy();
      // Strategy does not plan Silver Lake work on figures it cannot read.
      const d = (await proposalOf(t)).diagnosis;
      expect(d.actions[0]!.opportunity?.area ?? null).toBeNull();
      expect(d.selectedApproach).not.toMatch(/Silver Lake/);
    } finally {
      await sql.execute("UPDATE operator_macro_goals SET status = 'closed' WHERE tenantId = ? AND status = 'active'", [t.tenantId]);
    }
  }, 300_000);

  it("7. one sale is evidence for both goals it advances, recorded once and counted once", async () => {
    const { t, store } = await loop.tenant({ prefix: "b7" });
    const customers = (await mandateOf(t)).mandate.outcomes[0]!;
    const silverLake = await loop.addGoal(t, store, SILVER_LAKE_TARGET);
    const silverLakeId = `operator_macro_goals:${silverLake.goal.id}`;

    // Both goals' runs select the shared Silver Lake win-back: one objective, approved and done.
    await loop.runOccurrence(t, store);
    await loop.runOccurrence(t, store, silverLake.run!.id);
    const approved = await loop.approveStrategy(t);
    at(approved.item.businessDate, "10:00:00");
    await t.importLedger([], new Date());
    const completed = await loop.completeOnDayLine(t, approved.commitmentId);
    expect(completed.goalEvidence).toMatchObject({ status: "recorded" });
    const objectives = await loop.rows("SELECT id FROM goal_cycle_objectives WHERE tenantId = ?", [t.tenantId]);
    expect(objectives).toHaveLength(1);
    expect(completed.goalEvidence!.objectiveId).toBe(objectives[0]!.id);

    const read = async (metricKey: string) =>
      parseAuthoritativeMetricObservation(
        await defaultVerticalRegistry.resolveMetric(t.verticalKey, metricKey).reader({ tenantId: t.tenantId, asOf: new Date(), timeZone: ZONE })
      );
    // Alma, a targeted lapsed Silver Lake customer, pays the next day.
    advance(DAY);
    const areaBefore = await read(SILVER_LAKE_TARGET.metricKey);
    const activeBefore = await read("active_customers");
    await t.importLedger([{ ...ALMA, daysAgo: [0] }], new Date());

    // One goal result, on the one objective.
    const paid = (await loop.outcomesOf(t.tenantId)).filter(o => o.outcomeKind === "cleancloud_order_paid");
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ objectiveId: objectives[0]!.id, monetaryValueCents: 4800 });

    // One economic event in the canonical ledger.
    const [order] = await loop.rows(
      "SELECT cleancloudOrderId FROM cleancloud_paid_orders WHERE tenantId = ? AND cleancloudCustomerId = ? ORDER BY paymentDateUtc DESC, id DESC LIMIT 1",
      [t.tenantId, ALMA.customerId]
    );
    const ledger = await readCanonicalRevenue({ tenantId: t.tenantId, from: today(), to: today(), timeZone: ZONE, now: new Date() });
    expect(ledger.status).toBe("ok");
    if (ledger.status === "ok") expect(ledger.includedEvents.filter(e => e.orderNumber === String(order!.cleancloudOrderId))).toHaveLength(1);

    // Each goal's own authoritative reader counts it once.
    const areaAfter = await read(SILVER_LAKE_TARGET.metricKey);
    expect(areaAfter.value! - areaBefore.value!).toBe(48);
    const activeAfter = await read("active_customers");
    if (activeBefore.value !== null && activeAfter.value !== null) expect(activeAfter.value - activeBefore.value).toBe(1);

    // The mandate attributes the one result to both goals it advances, and counts it once.
    const { evidence } = await mandateOf(t);
    const ref = `goal_cycle_outcomes:${paid[0]!.id}`;
    expect(evidence.items).toEqual([expect.objectContaining({ evidenceRef: ref, kind: "paid_order", cents: 4800, area: "silver_lake" })]);
    expect(sorted(evidence.items[0]!.advancesOutcomeIds)).toEqual(sorted([customers.id, silverLakeId]));
    expect(evidence.byOutcome[customers.id]).toEqual([ref]);
    expect(evidence.byOutcome[silverLakeId]).toEqual([ref]);
    expect(evidence.distinctEvidenceCount).toBe(1);
    expect(evidence.distinctCents).toBe(4800);
  }, 300_000);
});
