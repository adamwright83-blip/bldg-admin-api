import { ENV } from "../_core/env";
import { getDashboardTimeZone } from "../dashboardZoned";
import {
  isAfterLosAngelesBusinessDateRoll,
  isNightShiftEnabled,
  nightShiftTargetBusinessDate,
  runNightShiftForBusinessDate,
} from "./authoredDayService";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TENANT = "default";

type ActiveRun = Promise<void> | null;
const activeRuns = new Map<string, ActiveRun>();

/**
 * Night Shift runs after the LA business date rolls. Dead-time claiming has not
 * landed yet; this scheduler leaves that seam open and authors from real
 * obligations/stops only.
 */
export function triggerNightShiftRun(input: {
  tenantId?: string;
  operatorId: string;
  userId: string;
  now?: Date;
}): Promise<void> {
  if (!isNightShiftEnabled()) return Promise.resolve();
  const tenantId = input.tenantId ?? DEFAULT_TENANT;
  const now = input.now ?? new Date();
  const timeZone = getDashboardTimeZone();
  if (!isAfterLosAngelesBusinessDateRoll(now, timeZone)) {
    return Promise.resolve();
  }
  const businessDate = nightShiftTargetBusinessDate(now, timeZone);
  const key = `${tenantId}:${input.operatorId}:${businessDate}`;
  const existing = activeRuns.get(key);
  if (existing) return existing;
  const run = runNightShiftForBusinessDate({
    tenantId,
    operatorId: input.operatorId,
    userId: input.userId,
    businessDate,
    now,
  })
    .then(result => {
      if (result.status === "authored") {
        console.info(
          `[NightShift] Authored ${result.authoredDay.businessDate} for ${input.operatorId}`
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
  tenantId?: string;
  operatorId?: string;
  userId?: string;
}) {
  if (!ENV.goldlineNightShiftEnabled) return () => undefined;
  const run = () =>
    triggerNightShiftRun({
      tenantId: input?.tenantId ?? DEFAULT_TENANT,
      operatorId: input?.operatorId ?? (ENV.ownerOpenId || "owner"),
      userId: input?.userId ?? "1",
    });
  void run();
  const timer = setInterval(run, input?.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
