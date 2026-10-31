import { randomUUID } from "node:crypto";
import type { AwaitingReplies } from "../../../shared/firstTenMinutesKnowledge";
import {
  manualPeriodKey,
  MAX_ROUTINE_ATTEMPTS,
  nextRunAt,
  routineFindings,
  routinePeriodKey,
  summarizeRoutineFindings,
  type RoutineFindings,
  type RoutineRunView,
} from "../../../shared/claireRoutines";
import { clearAwaitingRepliesCache, readAwaitingReplies } from "../../firstTenMinutes/knowledge/awaitingReplies";
import { drizzleRoutineStore, type RoutineRecord, type RoutineStore } from "../../routines/routineStore";
import { runView, scheduleOf } from "./service";

/**
 * Runs Claire routines. A routine only reads the operator's own Gmail (the same read-only reader as the Waiting to
 * hear back card) and records what it found: nothing is sent, labelled or changed anywhere.
 *
 * Each occurrence is claimed by inserting its (routine, period) row, which is unique: a second worker, or a second
 * tick in the same period, finds the row and does nothing. A run that fails is retried on later ticks for the same
 * period, up to MAX_ROUTINE_ATTEMPTS tries; after that the routine moves on to its next time. It is never stuck and
 * never runs one occurrence twice. Gmail that can't be read is a finished run that says why, not a failure.
 */
export type RoutineRunnerDeps = {
  store?: RoutineStore;
  /** what the routine reads; production is the operator's own Gmail, read fresh (the short cache cleared first) */
  read?: (tenantId: string) => Promise<AwaitingReplies | null>;
  clock?: () => Date;
  newId?: () => string;
};

/** A run left "running" this long was abandoned (the process stopped mid-run): it counts as a try and is taken back. */
export const ABANDONED_RUN_MS = 10 * 60_000;
const DUE_BATCH = 50;

export type RoutineTickResult = { done: number; failed: number; skipped: number; movedOn: number };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000) || "unknown error";

function readerFor(deps: RoutineRunnerDeps) {
  const read = deps.read ?? ((tenantId: string) => readAwaitingReplies(tenantId));
  // one fresh read per workspace per tick, however many of its routines are due
  const reads = new Map<string, Promise<AwaitingReplies | null>>();
  return (tenantId: string) => {
    let pending = reads.get(tenantId);
    if (!pending) {
      clearAwaitingRepliesCache(tenantId);
      pending = read(tenantId);
      reads.set(tenantId, pending);
    }
    return pending;
  };
}

async function findingsFor(
  routine: RoutineRecord,
  runId: string,
  now: Date,
  store: RoutineStore,
  read: (tenantId: string) => Promise<AwaitingReplies | null>
): Promise<{ findings: RoutineFindings; summary: string }> {
  const awaiting = await read(routine.tenantId);
  // "who wrote back" looks back to the previous check that actually read Gmail; a first check, the last 7 days
  const previous = routine.kind === "wrote_back" ? await store.latestReadRun(routine.tenantId, routine.id, runId) : null;
  const findings = routineFindings(routine.kind, awaiting, { since: previous ? new Date(previous.startedAt) : null, now });
  return { findings, summary: summarizeRoutineFindings(findings, routine.timeZone) };
}

async function runScheduled(routine: RoutineRecord, now: Date, deps: Required<Pick<RoutineRunnerDeps, "clock" | "newId">> & { store: RoutineStore }, read: (tenantId: string) => Promise<AwaitingReplies | null>) {
  const { store } = deps;
  const finishedAt = () => new Date(Math.max(now.getTime(), deps.clock().getTime()));
  // the operator may have paused or stopped it since the batch was read
  const fresh = await store.findRoutine(routine.tenantId, routine.id);
  if (!fresh || fresh.status !== "active" || !fresh.nextRunAt || fresh.nextRunAt.getTime() > now.getTime()) return "skipped" as const;
  const schedule = scheduleOf(fresh);
  const periodKey = routinePeriodKey(schedule, fresh.nextRunAt);
  const moveOn = (lastRunAt?: Date | null) =>
    store.updateRoutine(fresh.tenantId, fresh.id, { nextRunAt: nextRunAt(schedule, now), ...(lastRunAt ? { lastRunAt } : {}) });

  let run: { id: string; attempts: number };
  const id = deps.newId();
  const claim = await store.insertRun({ id, routineId: fresh.id, tenantId: fresh.tenantId, periodKey, trigger: "schedule", status: "running", attempts: 1, startedAt: now });
  if (claim === "claimed") {
    run = { id, attempts: 1 };
  } else {
    const existing = await store.findRun(fresh.id, periodKey);
    if (!existing) return "skipped" as const;
    const abandoned = existing.status === "running" && existing.startedAt.getTime() < now.getTime() - ABANDONED_RUN_MS;
    if (existing.status === "done") {
      // it ran, and the routine wasn't moved on (the process stopped in between): move it on, don't run it again
      await moveOn(existing.finishedAt);
      return "movedOn" as const;
    }
    if (existing.status === "running" && !abandoned) return "skipped" as const;
    if (existing.attempts >= MAX_ROUTINE_ATTEMPTS) {
      if (abandoned) await store.failRun(existing.id, { error: "It stopped before finishing.", finishedAt: finishedAt() });
      await moveOn();
      return "movedOn" as const;
    }
    if (!(await store.reclaimRun(existing.id, { now, staleBefore: new Date(now.getTime() - ABANDONED_RUN_MS), maxAttempts: MAX_ROUTINE_ATTEMPTS }))) return "skipped" as const;
    run = { id: existing.id, attempts: existing.attempts + 1 };
  }

  try {
    const { findings, summary } = await findingsFor(fresh, run.id, now, store, read);
    const at = finishedAt();
    await store.finishRun(run.id, { findings, summary, finishedAt: at });
    await moveOn(at);
    return "done" as const;
  } catch (error) {
    await store.failRun(run.id, { error: errorText(error), finishedAt: finishedAt() });
    // out of tries: on to its next time; otherwise it stays due and the next tick tries again
    if (run.attempts >= MAX_ROUTINE_ATTEMPTS) await moveOn();
    console.warn("[ClaireRoutines] run failed", { routineId: fresh.id, attempt: run.attempts, error: errorText(error) });
    return "failed" as const;
  }
}

/** One worker tick: every active routine whose time has come, each occurrence at most once. */
export async function runDueRoutines(now: Date = new Date(), deps: RoutineRunnerDeps = {}): Promise<RoutineTickResult> {
  const store = deps.store ?? drizzleRoutineStore;
  const resolved = { store, clock: deps.clock ?? (() => new Date()), newId: deps.newId ?? randomUUID };
  const read = readerFor(deps);
  const result: RoutineTickResult = { done: 0, failed: 0, skipped: 0, movedOn: 0 };
  for (const routine of await store.dueRoutines(now, DUE_BATCH)) {
    try {
      result[await runScheduled(routine, now, resolved, read)] += 1;
    } catch (error) {
      // the claim itself failed (database trouble): nothing ran; the next tick looks again
      console.warn("[ClaireRoutines] could not claim a run", { routineId: routine.id, error: errorText(error) });
      result.skipped += 1;
    }
  }
  return result;
}

export type RunNowResult = { run: RoutineRunView } | { notFound: true } | { refused: string };

/**
 * "Run now" from the desk: this tenant's routine, once per minute however often the button is pressed. It does not
 * change when the routine next runs on its own.
 */
export async function runRoutineNow(tenantId: string, routineId: string, deps: RoutineRunnerDeps & { now?: Date } = {}): Promise<RunNowResult> {
  const store = deps.store ?? drizzleRoutineStore;
  const clock = deps.clock ?? (() => new Date());
  const now = deps.now ?? clock();
  const routine = await store.findRoutine(tenantId, routineId);
  if (!routine) return { notFound: true };
  if (routine.status === "stopped") return { refused: "This routine is stopped. It's kept for its history; make a new one to start again." };
  const periodKey = manualPeriodKey(now);
  const id = (deps.newId ?? randomUUID)();
  if ((await store.insertRun({ id, routineId, tenantId, periodKey, trigger: "manual", status: "running", attempts: 1, startedAt: now })) === "exists") {
    const existing = await store.findRun(routineId, periodKey);
    return existing && existing.tenantId === tenantId ? { run: runView(existing) } : { notFound: true };
  }
  const finishedAt = () => new Date(Math.max(now.getTime(), clock().getTime()));
  try {
    const { findings, summary } = await findingsFor(routine, id, now, store, readerFor(deps));
    const at = finishedAt();
    await store.finishRun(id, { findings, summary, finishedAt: at });
    await store.updateRoutine(tenantId, routineId, { lastRunAt: at });
  } catch (error) {
    await store.failRun(id, { error: errorText(error), finishedAt: finishedAt() });
  }
  const run = await store.findRun(routineId, periodKey);
  return run ? { run: runView(run) } : { notFound: true };
}
