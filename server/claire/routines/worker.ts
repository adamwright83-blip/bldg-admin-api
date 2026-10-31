import { runDueRoutines } from "./runner";

export const CLAIRE_ROUTINES_TICK_MS = 5 * 60_000;

/** On in production (CLAIRE_ROUTINES_WORKER=0 turns it off there); anywhere else only with CLAIRE_ROUTINES_WORKER=1. */
export function claireRoutinesWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CLAIRE_ROUTINES_WORKER?.trim();
  if (flag === "1") return true;
  if (flag === "0") return false;
  return env.NODE_ENV === "production";
}

function tickEvery(env: NodeJS.ProcessEnv): number {
  // tests and e2e may tick faster; never faster than every second
  const requested = Number(env.CLAIRE_ROUTINES_TICK_MS);
  return Number.isFinite(requested) && requested >= 1000 ? requested : CLAIRE_ROUTINES_TICK_MS;
}

/** Runs due routines every five minutes, one tick at a time. Returns a stop function. */
export function startClaireRoutines(options: { everyMs?: number; env?: NodeJS.ProcessEnv } = {}): () => void {
  const env = options.env ?? process.env;
  if (!claireRoutinesWorkerEnabled(env)) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runDueRoutines(new Date());
      if (result.done || result.failed || result.movedOn) console.log("[ClaireRoutines] tick", result);
    } catch (error) {
      console.warn("[ClaireRoutines] tick failed:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), options.everyMs ?? tickEvery(env));
  timer.unref?.();
  return () => clearInterval(timer);
}
