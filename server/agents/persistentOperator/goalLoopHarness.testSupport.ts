/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { vi } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { currentDayLineRouter } from "../../planning/dayline/currentDayLineRouter";
import { respondToStrategicProposal } from "../../strategy/strategicApproval";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import {
  createWorkThreadTenant,
  SILVER_LAKE_LEDGER,
  type LedgerCustomer,
  type WorkThreadTenant,
} from "../../strategy/workThreadTenant.testSupport";
import { setActiveMacroGoal } from "../../claire/macroGoalService";
import { decideGoalCycle } from "./decisionEngine";
import { GoalCycleStore } from "./goalCycleStore";
import { defaultGoalCycleOccurrenceDeps, runGoalCycleOccurrence, type GoalCycleOccurrenceDeps } from "./goalCycleOccurrence";
import { activateMacroGoalRun } from "./macroGoalRuns";

/**
 * The operator's goal loop on real MySQL for Phase 2 tests: a seeded tenant,
 * production goal-cycle occurrences on an isolated queue, exact-revision
 * approval, and Day Line completion through the authenticated router. Only
 * `Date` is faked, so every component reads one clock.
 */
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const ZONE = "America/Los_Angeles";

/** Fakes only `Date`, starting at the next 09:00 in Los Angeles. Timers and the database stay real. */
export function startLosAngelesMorning() {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const now = new Date();
  const nine = fromZonedTime(`${formatInTimeZone(now, ZONE, "yyyy-MM-dd")}T09:00:00`, ZONE);
  vi.setSystemTime(nine.getTime() > now.getTime() ? nine : fromZonedTime(`${formatInTimeZone(new Date(now.getTime() + DAY), ZONE, "yyyy-MM-dd")}T09:00:00`, ZONE));
}
/** Moves the clock forward to a local date and time; never backwards. */
export const at = (date: string, time = "09:00:00") => {
  const target = fromZonedTime(`${date}T${time}`, ZONE);
  if (target.getTime() > Date.now()) vi.setSystemTime(target);
};
export const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
export const today = () => formatInTimeZone(new Date(), ZONE, "yyyy-MM-dd");

export type CompletionResponse = {
  success: boolean;
  goalEvidence?: {
    status: string;
    reason?: string;
    message: string;
    objectiveId?: string;
    evidenceClass?: string;
    observation?: { status: string; windowStart: string; windowEnd: string | null; targets: Array<{ identityKey: string; displayName: string }> };
  };
};

export function createGoalLoopHarness(sql: mysql.Connection, iso: { pool: Pool; insertRun: (run: { id: string; tenantId: string; canonicalOperatorId: string; operatorUserId: string; verticalKey: string }) => Promise<void> }) {
  const queue = iso.pool;
  const rows = async (query: string, params: unknown[]) => (await sql.execute<mysql.RowDataPacket[]>(query, params))[0];
  const created: string[] = [];

  /**
   * Closes the goals of the tenants this harness made, so suites that sweep
   * every active goal on the shared test database (the goal bootstrap) do not
   * also walk these.
   */
  async function retireTenants() {
    for (const tenantId of created.splice(0))
      await sql.execute("UPDATE operator_macro_goals SET status = 'closed' WHERE tenantId = ? AND status = 'active'", [tenantId]);
  }

  async function tenant(input: { prefix: string; focus?: string; ledger?: LedgerCustomer[] } = { prefix: "loop" }) {
    const t = await createWorkThreadTenant(sql, { prefix: input.prefix, focus: input.focus ?? "Maximize sales in Silver Lake", now: new Date() });
    created.push(t.tenantId);
    await t.importLedger(input.ledger ?? SILVER_LAKE_LEDGER, new Date());
    await iso.insertRun({ id: t.run.id, tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId, operatorUserId: t.openId, verticalKey: t.verticalKey });
    const store = new GoalCycleStore(queue, { perTenantConcurrency: 4 });
    await store.ensureLiveScheduledTick({ tenantId: t.tenantId, goalRunId: t.run.id });
    return { t, store };
  }

  /**
   * The operator sets another goal through the store the goal routers use (an
   * additional goal, or an explicit replacement), and its run is activated and
   * queued the way the goal bootstrap does it.
   */
  async function addGoal(
    t: WorkThreadTenant,
    store: GoalCycleStore,
    goal: { objective: string; metricKey: string; targetValue: number; unit: string; replacesGoalId?: string },
    options: { activate?: boolean } = { activate: true }
  ) {
    const saved = await setActiveMacroGoal({
      tenantId: t.tenantId,
      operatorUserId: t.openId,
      ...goal,
      targetDate: null,
      source: "operator_attested",
      sourceNote: "Goal loop test",
    });
    if (options.activate === false) return { goal: saved, run: null };
    const run = await activateMacroGoalRun({
      tenantId: t.tenantId,
      identity: t.identity,
      verticalKey: t.verticalKey,
      policyVersion: "v1",
      registry: defaultVerticalRegistry,
      goal: saved,
    });
    await iso.insertRun({ id: run.id, tenantId: t.tenantId, canonicalOperatorId: t.identity.canonicalOperatorId, operatorUserId: t.openId, verticalKey: t.verticalKey });
    await store.ensureLiveScheduledTick({ tenantId: t.tenantId, goalRunId: run.id });
    return { goal: saved, run };
  }

  /** Production occurrence wiring; only the goal metric read is stubbed (as in the 1B occurrence test). */
  function occurrenceDeps(t: WorkThreadTenant, runId: string = t.run.id): GoalCycleOccurrenceDeps {
    const production = defaultGoalCycleOccurrenceDeps({ registry: defaultVerticalRegistry, appointmentStore: undefined as never });
    return {
      ...production,
      evaluateRun: async () => ({
        run: { id: runId, status: "active", operatorUserId: t.openId, nextEvaluationAt: new Date(Date.now() + HOUR) },
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
  async function runOccurrence(t: WorkThreadTenant, store: GoalCycleStore, runId: string = t.run.id) {
    await queue.execute(
      "UPDATE goal_cycle_requests SET availableAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE tenantId = ? AND goalRunId = ? AND status = 'queued'",
      [t.tenantId, runId]
    );
    const step = await store.claimNextStep({ leaseOwner: `loop-${randomUUID()}`, leaseMs: 60_000 });
    if (!step || step.tenantId !== t.tenantId || step.goalRunId !== runId) throw new Error("This run's occurrence was not the one due");
    await store.markRunning(step);
    const result = await runGoalCycleOccurrence({ tenantId: step.tenantId, runId: step.goalRunId, cycleId: step.id }, occurrenceDeps(t, runId));
    await store.completeStep(step, result);
    return { ...result, cycleId: step.id };
  }

  /** The operator approves the strategy recommendation in the current proposal (as the screen loads it; a weekend plans next week). */
  async function approveStrategy(t: WorkThreadTenant) {
    const proposal = await prepareStrategicProposal({ identity: t.identity, timeZone: t.zone });
    const item = proposal.items.find(i => i.planId.startsWith("strategic_diagnosis:"));
    if (!item) throw new Error(`No strategy recommendation to approve: ${proposal.uncertainty.join(" | ")}`);
    const approved = await respondToStrategicProposal({
      identity: t.identity, proposalId: proposal.id, revision: proposal.revision,
      action: "approve", itemIds: [item.id], source: "authenticated_app",
    });
    if (approved.failedItems.length) throw new Error(`Approval failed for ${approved.failedItems.join(", ")}`);
    return { proposal, item, commitmentId: approved.actionIds[0]!, unbound: approved.unboundItems };
  }

  function dayLine(t: WorkThreadTenant) {
    return currentDayLineRouter.createCaller({ tenantId: t.tenantId, user: { id: t.userId, openId: t.openId, role: "user", name: "Op" }, req: undefined, res: undefined, vendorSession: null } as never);
  }

  /** The operator marks the commitment done from today's Day Line, as the cockpit does. */
  async function completeOnDayLine(
    t: WorkThreadTenant,
    commitmentId: string,
    extra: { evidenceClass?: "authoritative_external" | "operator_attested"; evidenceReference?: string } = {}
  ): Promise<CompletionResponse> {
    const line = await dayLine(t).today();
    const item = line.items.find(i => i.id.endsWith(`:${commitmentId}`) || i.lineage?.commitmentId === commitmentId);
    if (!item) throw new Error(`Commitment ${commitmentId} is not on today's Day Line`);
    return dayLine(t).completeItem({
      itemId: item.id,
      lineage: item.lineage,
      evidenceReference: extra.evidenceReference ?? `voice_incab_receipt_${randomUUID().slice(0, 8)}`,
      sourceSystem: "driver_cockpit_hud",
      ...(extra.evidenceClass ? { evidenceClass: extra.evidenceClass } : {}),
    }) as Promise<CompletionResponse>;
  }

  /** Decide, approve the strategy recommendation, and complete it on its day: one executed attempt. */
  async function executeStrategyAttempt(t: WorkThreadTenant, store: GoalCycleStore) {
    const decided = await runOccurrence(t, store);
    const approved = await approveStrategy(t);
    at(approved.item.businessDate, "10:00:00");
    await t.importLedger([], new Date());
    const completed = await completeOnDayLine(t, approved.commitmentId);
    return { decided, ...approved, completed };
  }

  const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
  const metadataOf = async (tenantId: string, commitmentId: string) =>
    json((await rows("SELECT metadataJson FROM day_director_commitments WHERE tenantId = ? AND id = ?", [tenantId, commitmentId]))[0]!.metadataJson);
  const outcomesOf = (tenantId: string) =>
    rows("SELECT id, objectiveId, outcomeKind, impactClass, epistemicStatus, evidenceClass, evidenceReference, monetaryValueCents, metadataJson FROM goal_cycle_outcomes WHERE tenantId = ? ORDER BY createdAt, id", [tenantId]);
  const obligationOf = async (tenantId: string, sourceKey: string) =>
    (await rows("SELECT sourceKind, status, attemptCount, lastError, resultJson FROM observation_bridge_obligations WHERE tenantId = ? AND sourceKey = ?", [tenantId, sourceKey]))[0];

  return { rows, json, tenant, retireTenants, addGoal, runOccurrence, approveStrategy, dayLine, completeOnDayLine, executeStrategyAttempt, metadataOf, outcomesOf, obligationOf };
}
