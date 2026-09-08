import { ENV } from "../_core/env";
import { getDashboardTimeZone } from "../dashboardZoned";
import {
  isAfterLosAngelesBusinessDateRoll,
  isNightShiftEnabled,
  nightShiftTargetBusinessDate,
  runNightShiftForBusinessDate,
} from "./authoredDayService";
import {
  resolveAutonomousNightShiftScope,
  type NightShiftAutonomousScope,
} from "./nightShiftScope";

const DEFAULT_INTERVAL_MS = 60_000;

type ActiveRun = Promise<void> | null;
const activeRuns = new Map<string, ActiveRun>();

/**
 * Night Shift runs after the LA business date rolls. Dead-time claiming has not
 * landed yet; this scheduler leaves that seam open and authors from real
 * obligations/stops only.
 */
export async function triggerNightShiftRun(
  input?: NightShiftAutonomousScope & { now?: Date }
): Promise<void> {
  if (!isNightShiftEnabled()) return Promise.resolve();
  const scope = input ?? (await resolveAutonomousNightShiftScope());
  if (!scope) return Promise.resolve();
  const now = input?.now ?? new Date();
  const timeZone = getDashboardTimeZone();
  if (!isAfterLosAngelesBusinessDateRoll(now, timeZone)) {
    return Promise.resolve();
  }
  const businessDate = nightShiftTargetBusinessDate(now, timeZone);
  const key = `${scope.tenantId}:${scope.operatorId}:${businessDate}`;
  const existing = activeRuns.get(key);
  if (existing) return existing;
  const run = runNightShiftForBusinessDate({
    tenantId: scope.tenantId,
    operatorId: scope.operatorId,
    userId: scope.userId,
    businessDate,
    now,
  })
    .then(result => {
      if (result.status === "authored") {
        console.info(
          `[NightShift] Authored ${result.authoredDay.businessDate} for ${scope.operatorId}`
        );
      }
    })
    .catch(error => {
      console.warn(
        "[NightShift] Authoring failed closed",
        error instanceof Error ? error.message : error
      );
    })
    .finally(() => {
      activeRuns.delete(key);
    });
  activeRuns.set(key, run);
  return run;
}

export function startNightShiftScheduler(input?: {
  intervalMs?: number;
  scope?: NightShiftAutonomousScope;
}) {
  if (!ENV.goldlineNightShiftEnabled) return () => undefined;
  let warnedMissingScope = false;
  const run = async () => {
    const scope = input?.scope ?? (await resolveAutonomousNightShiftScope());
    if (!scope) {
      if (!warnedMissingScope) {
        console.warn(
          "[NightShift] Autonomous authoring disabled until OWNER_OPEN_ID resolves to a real user."
        );
        warnedMissingScope = true;
      }
      return;
    }
    await triggerNightShiftRun(scope);
  };
  void run();
  const timer = setInterval(run, input?.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
