/**
 * The one seam the scheduled-call executor calls for Daphne decision points.
 * It first records any proximal outcomes that are now due (from the Day Line),
 * then opens and records today's decision. Off unless DAPHNE_V2_DECISION_POINTS;
 * any failure returns null so the call proceeds exactly as it would without Daphne.
 */
import type { CanonicalOperatorIdentity } from "../persistentOperator/identity";
import type { ShowrunnerBriefing } from "../../claire/showrunner/showrunnerBriefing";
import { loadDriverDayLineForCall, type DriverDayLineCallFacts } from "../../claire/showrunner/driverDayLineCall";
import {
  evaluateDaphneDecisionOutcomes,
  isDaphneDecisionPointsEnabled,
  openDaphneDecisionPoint,
  type DaphneCallDecision,
} from "./decisionPoints";

export async function prepareDaphneCallDecision(
  input: {
    identity: CanonicalOperatorIdentity;
    purpose: "morning_readiness" | "evening_debrief";
    briefing: ShowrunnerBriefing;
    timeZone: string;
    now: Date;
    env?: NodeJS.ProcessEnv;
  },
  deps: {
    open?: typeof openDaphneDecisionPoint;
    evaluate?: typeof evaluateDaphneDecisionOutcomes;
    loadDayLine?: (businessDate: string) => Promise<DriverDayLineCallFacts | null>;
  } = {}
): Promise<DaphneCallDecision | null> {
  const { identity, briefing, now } = input;
  if (!isDaphneDecisionPointsEnabled(identity.tenantId, input.env)) return null;
  const operator = {
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    operatorUserId: identity.canonicalOpenId,
  };
  const loadDayLine =
    deps.loadDayLine ??
    (async (businessDate: string) =>
      businessDate === briefing.businessDate && briefing.driverDayLine
        ? briefing.driverDayLine
        : loadDriverDayLineForCall({
            caller: {
              tenantId: identity.tenantId,
              userId: identity.canonicalOpenId,
              includeAllAssignees: identity.membership.canonical !== "field",
              dayDirectorActorId: identity.dayDirectorActorId,
              dayDirectorActorIds: identity.dayDirectorActorIds,
              canonicalOperatorId: identity.canonicalOperatorId,
            },
            businessDate,
            now,
            timeZone: input.timeZone,
          }));
  try {
    const outcomes = await (deps.evaluate ?? evaluateDaphneDecisionOutcomes)({
      operator,
      now,
      timeZone: input.timeZone,
      loadDayLine,
      env: input.env,
    });
    if (outcomes.length)
      console.info("[DaphneDecisionPoint]", JSON.stringify({ event: "outcomes_recorded", count: outcomes.length }));
  } catch (error) {
    console.warn("[DaphneDecisionPoint]", JSON.stringify({ event: "outcome_evaluation_failed", message: String(error).slice(0, 200) }));
  }
  try {
    const decision = await (deps.open ?? openDaphneDecisionPoint)({
      operator,
      purpose: input.purpose,
      briefing,
      now,
      env: input.env,
    });
    console.info(
      "[DaphneDecisionPoint]",
      JSON.stringify({ event: "decision", purpose: input.purpose, recorded: Boolean(decision), framing: decision?.framing ?? null })
    );
    return decision;
  } catch (error) {
    console.warn("[DaphneDecisionPoint]", JSON.stringify({ event: "decision_failed", message: String(error).slice(0, 200) }));
    return null;
  }
}
