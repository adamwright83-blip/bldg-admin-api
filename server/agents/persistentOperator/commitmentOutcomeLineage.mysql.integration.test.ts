/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { workThreadCandidateId } from "../../../shared/workThread";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { sweepObservationBridges } from "./autonomousWorkerService";
import { bridgeCommitmentCompletion } from "./commitmentExecutionBridge";
import { createIsolatedGoalCycleDb } from "./goalCycleIsolatedDb.testSupport";
import { advance, at, createGoalLoopHarness, DAY, HOUR, startLosAngelesMorning, today, ZONE } from "./goalLoopHarness.testSupport";
import { readObservationBridgeBacklog } from "./observationBridgeStore";

/**
 * Real-MySQL proof for Phase 2 · Slice C: an approved commitment's completion
 * reaches the exact goal objective its approval recorded, as execution
 * evidence only; business results arrive separately and attach to the
 * originating opportunity; failures are persisted and retried.
 *
 * Production paths throughout: browser-sync CleanCloud imports (which also run
 * the paid-order bridge), the goal-cycle occurrence (preparation, Mission
 * Director, decision), exact-revision approval, the Day Line router's
 * completeItem with the operator's authenticated context, and the worker's
 * observation-bridge sweep. Only `Date` is faked, from the next 09:00 in Los
 * Angeles, so every component reads one clock.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("approved commitment → execution → observation on MySQL", () => {
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

  const tenant = () => loop.tenant({ prefix: "c" });
  const runOccurrence: ReturnType<typeof createGoalLoopHarness>["runOccurrence"] = (t, store) => loop.runOccurrence(t, store);
  const approveStrategy: ReturnType<typeof createGoalLoopHarness>["approveStrategy"] = t => loop.approveStrategy(t);
  const completeOnDayLine: ReturnType<typeof createGoalLoopHarness>["completeOnDayLine"] = (t, id, extra) => loop.completeOnDayLine(t, id, extra);
  const rows: ReturnType<typeof createGoalLoopHarness>["rows"] = (query, params) => loop.rows(query, params);
  const outcomesOf = (tenantId: string) => loop.outcomesOf(tenantId);
  const metadataOf = (tenantId: string, commitmentId: string) => loop.metadataOf(tenantId, commitmentId);
  const obligationOf = (tenantId: string, sourceKey: string) => loop.obligationOf(tenantId, sourceKey);
  const objectiveOf = async (tenantId: string, id: string) => (await rows("SELECT id, status, workThreadId FROM goal_cycle_objectives WHERE tenantId = ? AND id = ?", [tenantId, id]))[0];

  it("binds completion to the approved objective as operator testimony, attaches the targeted customer's paid order once, and the next decision learns from it", async () => {
    const { t, store } = await tenant();
    const first = await runOccurrence(t, store);
    const objectiveId = String(first.objectiveId);
    const threadId = String(first.selectedRef).replace("work_thread:", "");
    const { item, commitmentId, unbound } = await approveStrategy(t);
    expect(unbound).toEqual([]);
    expect(item.customerTargets?.map(target => target.displayName)).toEqual(["Bea Lund", "Alma Reyes"]);
    expect(item.observationWindowDays).toBe(14);
    expect((await metadataOf(t.tenantId, commitmentId)).observationPlan).toEqual({ targets: item.customerTargets, windowDays: 14 });

    // The approved day arrives; the day's CleanCloud sync runs; the operator does the work.
    at(item.businessDate, "10:00:00");
    await t.importLedger([], new Date());
    const completed = await completeOnDayLine(t, commitmentId);
    expect(completed.success).toBe(true);
    expect(completed.goalEvidence).toMatchObject({ status: "recorded", objectiveId, evidenceClass: "operator_attested" });
    expect(completed.goalEvidence!.message).toMatch(/your report of the work; its results are pending until/);
    expect(completed.goalEvidence!.observation).toMatchObject({ status: "pending", targets: item.customerTargets });
    const window = completed.goalEvidence!.observation!;
    expect(Date.parse(window.windowEnd!) - Date.parse(window.windowStart)).toBe(14 * DAY);

    let outcomes = await outcomesOf(t.tenantId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      objectiveId,
      outcomeKind: "action_verification",
      impactClass: "action_verification",
      evidenceClass: "operator_attested",
      evidenceReference: `day_director_commitments:${commitmentId}:completed`,
      monetaryValueCents: null,
    });
    expect(await objectiveOf(t.tenantId, objectiveId)).toMatchObject({ status: "action_executed", workThreadId: threadId });
    expect(await obligationOf(t.tenantId, commitmentId)).toMatchObject({ status: "bridged", attemptCount: 1 });

    // A retried completion and the reconciliation sweep replay to the same outcome.
    expect(await bridgeCommitmentCompletion({ tenantId: t.tenantId, commitmentId, evidenceReference: "voice_incab_receipt_retry", sourceSystem: "driver_cockpit_hud", actorId: t.openId })).toMatchObject({ status: "recorded", objectiveId });
    await sweepObservationBridges({ leaseOwner: "test-sweep", tenantId: t.tenantId });
    expect(await outcomesOf(t.tenantId)).toHaveLength(1);

    // Bea, a targeted customer, pays inside the window. Cruz, not targeted, pays too.
    advance(2 * DAY);
    await t.importLedger(
      [
        { name: "Bea Lund", customerId: "c2", address: "1800 Griffith Park Blvd Los Angeles CA 90026", daysAgo: [0], total: "61.00" },
        { name: "Cruz Ortega", customerId: "c3", address: "3100 Sunset Blvd Los Angeles CA 90026", daysAgo: [0], total: "40.00" },
      ],
      new Date()
    );
    outcomes = await outcomesOf(t.tenantId);
    const paid = outcomes.filter(o => o.outcomeKind === "cleancloud_order_paid");
    expect(paid).toHaveLength(1);
    const paidMetadata = typeof paid[0]!.metadataJson === "string" ? JSON.parse(paid[0]!.metadataJson) : paid[0]!.metadataJson;
    expect(paid[0]).toMatchObject({ objectiveId, impactClass: "commercial_revenue", evidenceClass: "authoritative_external", monetaryValueCents: 6100 });
    expect(paidMetadata.attribution).toMatchObject({ kind: "contacted_customer_paid_within_window", causal: false, attemptCommitmentId: commitmentId, workThreadId: threadId, identityKey: "cleancloud:c2" });
    const observation = (await metadataOf(t.tenantId, commitmentId)).observation;
    expect(observation.status).toBe("result_observed");
    expect(observation.results).toHaveLength(1);

    // The same order arriving again in the next sync is the same fact.
    await t.importLedger([], new Date());
    expect((await outcomesOf(t.tenantId)).filter(o => o.outcomeKind === "cleancloud_order_paid")).toHaveLength(1);

    // The next decision consumes it: Mission Director ranks the thread with the supported result.
    advance(HOUR + 60_000);
    await runOccurrence(t, store);
    const [plan] = await rows("SELECT outcomeJson FROM mission_director_plans WHERE tenantId = ? AND businessDate = ? ORDER BY revision DESC LIMIT 1", [t.tenantId, today()]);
    const outcome = typeof plan!.outcomeJson === "string" ? JSON.parse(plan!.outcomeJson) : plan!.outcomeJson;
    const threadWork = outcome.workPlan.ranking.find((r: { workId: string }) => r.workId === workThreadCandidateId(threadId));
    expect(threadWork.factors.find((f: { name: string }) => f.name === "outcome_learning_delta")).toMatchObject({ value: "contradicted:0,supported:1", effect: 60 });
    const [diagnosis] = await rows("SELECT payloadJson FROM strategic_diagnoses WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1", [t.tenantId]);
    const payload = typeof diagnosis!.payloadJson === "string" ? JSON.parse(diagnosis!.payloadJson) : diagnosis!.payloadJson;
    expect(payload.outcomeRefs).toContain(String(paid[0]!.id));
    expect(payload.primaryConstraint).toBe("retention");
  }, 240_000);

  it("reports unlinked work honestly, never promotes testimony, persists a failed bridge for retry, and keeps an unanswered observation pending", async () => {
    const { t, store } = await tenant();

    // Work the operator asked for directly has no goal lineage: done, honestly unlinked.
    const instructed = await t.instruct("Call Alma Reyes about restarting weekly laundry", today());
    const unlinked = await completeOnDayLine(t, instructed);
    expect(unlinked).toMatchObject({ success: true, goalEvidence: { status: "unlinked", reason: "no_approval_lineage" } });
    expect(unlinked.goalEvidence!.message).toMatch(/can't count toward the goal/);
    expect(await obligationOf(t.tenantId, instructed)).toMatchObject({ status: "unrelated" });

    // An approved recommendation with no goal objective yet (no decision has run): also unlinked.
    await prepareStrategicProposal({ identity: t.identity, timeZone: t.zone });
    const early = await approveStrategy(t);
    expect(early.unbound).toEqual([early.item.id]);
    at(early.item.businessDate, "10:00:00");
    await t.importLedger([], new Date());
    expect(await completeOnDayLine(t, early.commitmentId)).toMatchObject({ goalEvidence: { status: "unlinked", reason: "no_goal_objective" } });
    expect(await outcomesOf(t.tenantId)).toEqual([]);

    // Next week: the cycle selects the opportunity, so its objective exists before approval.
    at(formatInTimeZone(new Date(Date.now() + 7 * DAY), ZONE, "yyyy-MM-dd"), "09:00:00");
    await t.importLedger([], new Date());
    const decided = await runOccurrence(t, store);
    const objectiveId = String(decided.objectiveId);
    const linked = await approveStrategy(t);
    expect(linked.unbound).toEqual([]);
    at(linked.item.businessDate, "10:00:00");
    await t.importLedger([], new Date());

    // Operator testimony claiming to be external evidence is refused, and nothing is recorded.
    const claimed = await completeOnDayLine(t, linked.commitmentId, { evidenceClass: "authoritative_external", evidenceReference: "operator-says-the-customer-confirmed" });
    expect(claimed).toMatchObject({ success: true, goalEvidence: { status: "rejected", reason: "authoritative_external_evidence_missing" } });
    expect(await outcomesOf(t.tenantId)).toEqual([]);
    expect(await obligationOf(t.tenantId, linked.commitmentId)).toMatchObject({ status: "rejected" });

    // A second approved execution whose bridge fails: persisted for retry, then recovered by the sweep.
    advance(HOUR);
    const retried = await runOccurrence(t, store);
    expect(String(retried.objectiveId)).toBe(objectiveId);
    const second = await approveStrategy(t);
    at(second.item.businessDate, "11:00:00");
    await t.importLedger([], new Date());
    await t.dayDirector.complete({ commitmentId: second.commitmentId });
    const failed = await bridgeCommitmentCompletion(
      { tenantId: t.tenantId, commitmentId: second.commitmentId, sourceSystem: "driver_cockpit_hud", actorId: t.openId },
      { handler: async () => { throw new Error("database unavailable"); } }
    );
    expect(failed).toMatchObject({ status: "pending_retry" });
    expect(await obligationOf(t.tenantId, second.commitmentId)).toMatchObject({ status: "pending", attemptCount: 1, lastError: "database unavailable" });
    expect((await readObservationBridgeBacklog({ tenantId: t.tenantId })).retrying).toBe(1);
    advance(5 * 60_000);
    const swept = await sweepObservationBridges({ leaseOwner: "test-sweep", tenantId: t.tenantId });
    expect(swept.errors).toEqual([]);
    expect(await obligationOf(t.tenantId, second.commitmentId)).toMatchObject({ status: "bridged", attemptCount: 2 });

    // A third execution completed through the Day Director's own control, which
    // never calls the bridge (as after a crash): the sweep discovers and records it.
    advance(HOUR);
    await runOccurrence(t, store);
    const third = await approveStrategy(t);
    at(third.item.businessDate, "12:00:00");
    await t.importLedger([], new Date());
    await t.dayDirector.complete({ commitmentId: third.commitmentId });
    expect(await obligationOf(t.tenantId, third.commitmentId)).toBeUndefined();
    const reconciled = await sweepObservationBridges({ leaseOwner: "test-sweep", tenantId: t.tenantId });
    expect(reconciled).toMatchObject({ discovered: 1, errors: [] });
    expect(await obligationOf(t.tenantId, third.commitmentId)).toMatchObject({ status: "bridged" });
    const executions = (await outcomesOf(t.tenantId)).filter(o => o.outcomeKind === "action_verification");
    expect(executions.map(e => e.evidenceReference).sort()).toEqual(
      [second.commitmentId, third.commitmentId].map(id => `day_director_commitments:${id}:completed`).sort()
    );
    expect(executions.every(e => e.objectiveId === objectiveId && e.evidenceClass === "operator_attested")).toBe(true);

    // No targeted customer pays. After the windows close the observations are
    // still pending: not contradicted, not supported, and nothing learns a failure.
    advance(15 * DAY);
    await t.importLedger([], new Date());
    await sweepObservationBridges({ leaseOwner: "test-sweep", tenantId: t.tenantId });
    await runOccurrence(t, store);
    for (const id of [second.commitmentId, third.commitmentId]) {
      const observation = (await metadataOf(t.tenantId, id)).observation;
      expect(observation).toMatchObject({ status: "pending", results: [] });
      expect(Date.parse(observation.windowEnd)).toBeLessThan(Date.now());
    }
    expect(await objectiveOf(t.tenantId, objectiveId)).toMatchObject({ status: "action_executed" });
    const [suppressions] = await rows("SELECT COUNT(*) AS n FROM goal_cycle_learned_deltas WHERE tenantId = ? AND deltaType = 'suppress'", [t.tenantId]);
    expect(Number(suppressions!.n)).toBe(0);
    const [diagnosis] = await rows("SELECT payloadJson FROM strategic_diagnoses WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1", [t.tenantId]);
    const payload = typeof diagnosis!.payloadJson === "string" ? JSON.parse(diagnosis!.payloadJson) : diagnosis!.payloadJson;
    expect(payload.primaryConstraint).toBe("retention");
    expect(await readObservationBridgeBacklog({ tenantId: t.tenantId })).toMatchObject({ retrying: 0, needsReview: 0 });
  }, 240_000);
});
