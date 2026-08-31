import type { SignalContext } from "./psychSignals";

type CommercialSignalSource = {
  stage: string;
  businessDate: string;
  mission: { status: string };
  followUps: ReadonlyArray<{ dueAt: string; status: string }>;
};

const EXECUTING_MISSION_STATUSES = new Set([
  "game_active",
  "preparing",
  "en_route",
  "arrived",
]);

/**
 * Conservative production projection: only facts this API actually records are
 * populated. Silence, response meaning, and reply cadence remain unknown rather
 * than being invented to make a creature appear.
 */
export function commercialSignalContext(
  source: CommercialSignalSource
): SignalContext {
  const openDueDates = source.followUps
    .filter(item => item.status === "open")
    .map(item => item.dueAt)
    .filter(value => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const nextActionDueAt = openDueDates[0] ?? null;
  const commitmentDueAt =
    openDueDates.find(value => value.slice(0, 10) >= source.businessDate) ?? null;
  const active = source.stage !== "won" && source.stage !== "lost";

  return {
    lastFieldActivityAt: null,
    lastResponseAt: null,
    responseMeaningClassified: true,
    hasOpportunity: active,
    nextActionDueAt,
    commitmentDueAt,
    missionExecuting: EXECUTING_MISSION_STATUSES.has(source.mission.status),
    expectedReplyDays: null,
    stakesAreReal: active,
    today: source.businessDate,
  };
}
