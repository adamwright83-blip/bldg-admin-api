import type { VerticalRegistry } from "../../strategy/verticalTemplates/registry";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { decideGoalCycle } from "./decisionEngine";
import { evaluateMacroGoalRunAndScheduleNext } from "./goalCycleService";
import { evaluateGoalCyclePreparePolicy, type GoalCycleActionPolicy } from "./goalCyclePolicy";
import { resolveCanonicalOperatorIdentity } from "./identity";
import { resolveOperatorTimeZone } from "./operatorAppointmentPolicy";
import type { OperatorAppointmentStore } from "./operatorAppointmentStore";
import { scheduleAuthorizedStrategicCall } from "./strategicCallAuthorization";

export type GoalCycleStepDeps = {
  registry: VerticalRegistry;
  appointmentStore: OperatorAppointmentStore;
  evaluateRun?: typeof evaluateMacroGoalRunAndScheduleNext;
  evaluatePolicy?: typeof evaluateGoalCyclePreparePolicy;
  resolveIdentity?: typeof resolveCanonicalOperatorIdentity;
  resolveTimeZone?: typeof resolveOperatorTimeZone;
  prepare?: typeof prepareStrategicProposal;
  scheduleCall?: typeof scheduleAuthorizedStrategicCall;
  decide?: typeof decideGoalCycle;
};

export type GoalCycleStepResult = {
  runId: string;
  status: string;
  completed: boolean;
  observation: unknown;
  actionPolicy: GoalCycleActionPolicy["status"];
  decisionId: string;
  decisionCreated: boolean;
  objectiveId: string | null;
  selectionKind: string;
  selectedRef: string | null;
  selectedReasonCode: string;
  nextEvaluationAt: string | null;
};

/**
 * One goal-cycle step, run by every goal-cycle worker (the in-process autonomous
 * worker and the procurement worker process). The run is evaluated, the action
 * policy decides whether Claire may prepare for this operator, preparation happens
 * only when it is allowed, and the policy result is recorded in the decision. A
 * denied policy leaves a wait decision with its reason and prepares nothing.
 */
export async function runGoalCycleStep(
  input: { tenantId: string; runId: string; cycleId: string },
  deps: GoalCycleStepDeps
): Promise<GoalCycleStepResult> {
  const evaluateRun = deps.evaluateRun ?? evaluateMacroGoalRunAndScheduleNext;
  const evaluatePolicy = deps.evaluatePolicy ?? evaluateGoalCyclePreparePolicy;
  const resolveIdentity = deps.resolveIdentity ?? resolveCanonicalOperatorIdentity;
  const resolveTimeZone = deps.resolveTimeZone ?? resolveOperatorTimeZone;
  const prepare = deps.prepare ?? prepareStrategicProposal;
  const scheduleCall = deps.scheduleCall ?? scheduleAuthorizedStrategicCall;
  const decide = deps.decide ?? decideGoalCycle;

  const evaluation = await evaluateRun({
    tenantId: input.tenantId,
    runId: input.runId,
    registry: deps.registry,
  });
  const actionPolicy = await evaluatePolicy({ tenantId: input.tenantId, run: evaluation.run });
  if (actionPolicy.status === "allowed") {
    const resolved = await resolveIdentity({
      tenantId: input.tenantId,
      source: { type: "open_id", value: evaluation.run.operatorUserId },
      subsystem: "autonomous_strategy_preparation",
    });
    const timeZone = await resolveTimeZone(input.tenantId);
    if (!resolved.ok || !timeZone) throw new Error("Autonomous strategy identity/timezone unavailable");
    const proposal = await prepare({ identity: resolved.identity, timeZone });
    await scheduleCall({
      identity: resolved.identity,
      timeZone,
      proposalId: proposal.id,
      store: deps.appointmentStore,
    }).catch(error => {
      console.warn(
        "[AutonomousWorkers] Prepared proposal remains available; call scheduling unavailable",
        error instanceof Error ? error.message : String(error)
      );
    });
  }
  const decision = await decide({
    tenantId: input.tenantId,
    runId: input.runId,
    cycleId: input.cycleId,
    registry: deps.registry,
    actionPolicy,
  });
  return {
    runId: evaluation.run.id,
    status: evaluation.run.status,
    completed: evaluation.completed,
    observation: evaluation.observation,
    actionPolicy: actionPolicy.status,
    decisionId: decision.decision.id,
    decisionCreated: decision.created,
    objectiveId: decision.objective?.id ?? null,
    selectionKind: decision.decision.selectionKind,
    selectedRef: decision.decision.selectedRef,
    selectedReasonCode: decision.decision.selectedReasonCode,
    nextEvaluationAt: evaluation.run.nextEvaluationAt?.toISOString() ?? null,
  };
}
