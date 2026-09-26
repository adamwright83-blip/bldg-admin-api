import { ENV } from "../_core/env";
import { CandyBarOrchestrator } from "./orchestrator";

const activeTicks = new Map<string, Promise<unknown>>();

/**
 * Candy Bar heartbeat — recovery only. Disabled unless CANDY_BAR_ENABLED=true.
 * No overlapping work for the same run key; bounded runs per tick; timer.unref().
 */
export function startCandyBarHeartbeat(input: {
  orchestrator: CandyBarOrchestrator;
  intervalMs?: number;
  maxRunsPerTick?: number;
}) {
  if (!ENV.candyBarEnabled) return () => undefined;
  const intervalMs = input.intervalMs ?? ENV.candyBarHeartbeatMs;
  const maxRuns = input.maxRunsPerTick ?? 3;

  const tick = async () => {
    const key = "global";
    if (activeTicks.get(key)) return activeTicks.get(key);
    const work = input.orchestrator
      .heartbeat({ maxRuns })
      .catch(error => {
        console.warn(
          "[CandyBar] heartbeat failed closed",
          error instanceof Error ? error.message : error
        );
      })
      .finally(() => {
        activeTicks.delete(key);
      });
    activeTicks.set(key, work);
    return work;
  };

  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
