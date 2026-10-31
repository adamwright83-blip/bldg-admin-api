import { randomUUID } from "node:crypto";
import {
  describeRoutine,
  failedRunNote,
  MAX_ROUTINE_ATTEMPTS,
  nextRunAt,
  parseRoutineInstruction,
  ROUTINE_CAN_DO,
  type ParsedRoutine,
  type RoutineRunView,
  type RoutineSchedule,
  type RoutineView,
} from "../../../shared/claireRoutines";
import { drizzleRoutineStore, type RoutineRecord, type RoutineRunRecord, type RoutineStore } from "../../routines/routineStore";

/** Runs shown with each routine on the desk (and in Claire's briefing, the newest one). */
export const RECENT_RUNS = 5;
/** Routines a workspace may have that still run (active or paused). */
export const MAX_LIVE_ROUTINES = 20;

export type RoutineServiceDeps = { store?: RoutineStore; now?: () => Date; newId?: () => string };

export const scheduleOf = (row: Pick<RoutineRecord, "cadence" | "weekday" | "localTime" | "timeZone">): RoutineSchedule => ({
  cadence: row.cadence,
  weekday: row.weekday ?? null,
  localTime: row.localTime,
  timeZone: row.timeZone,
});

const iso = (date: Date | null | undefined) => (date ? new Date(date).toISOString() : null);

/**
 * What happens next to a failed scheduled run, as the routine stands now: a retry is promised only while the routine
 * is active and still due (the runner leaves next_run_at due while it retries). Once it moved on, was paused or was
 * stopped, the note says so, because Claire reads it as lastRun.summary.
 */
function failedScheduledNote(row: RoutineRunRecord, routine: RoutineRecord | undefined): string {
  if (routine?.status === "stopped") return "It didn't finish. The routine is stopped, so it won't run again.";
  if (routine?.status === "paused") return "It didn't finish. The routine is paused; it runs again once you resume it.";
  // while it retries, the runner leaves next_run_at where it was (at or before this run's start); moving on sets it
  // to the next period, after it
  const stillDue = routine ? routine.status === "active" && routine.nextRunAt !== null && new Date(routine.nextRunAt).getTime() <= new Date(row.startedAt).getTime() : false;
  return failedRunNote(row.attempts, row.attempts >= MAX_ROUTINE_ATTEMPTS || !stillDue);
}

export function runView(row: RoutineRunRecord, routine?: RoutineRecord): RoutineRunView {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    attempts: row.attempts,
    startedAt: new Date(row.startedAt).toISOString(),
    finishedAt: iso(row.finishedAt),
    summary: row.status === "done" ? row.summary : null,
    findings: row.status === "done" ? row.findings ?? null : null,
    // the raw error stays on the server: the operator gets plain words about what happens next
    note:
      row.status !== "failed"
        ? null
        : row.trigger === "manual"
          ? "It didn't finish, and nothing changed. Press Run now to try again."
          : failedScheduledNote(row, routine),
  };
}

export function routineView(row: RoutineRecord, runs: readonly RoutineRunRecord[]): RoutineView {
  return {
    id: row.id,
    instruction: row.instruction,
    kind: row.kind,
    cadence: row.cadence,
    weekday: row.weekday ?? null,
    localTime: row.localTime,
    timeZone: row.timeZone,
    status: row.status,
    describe: describeRoutine({ kind: row.kind, cadence: row.cadence, weekday: row.weekday ?? null, localTime: row.localTime }),
    nextRunAt: row.status === "active" ? iso(row.nextRunAt) : null,
    lastRunAt: iso(row.lastRunAt),
    createdAt: new Date(row.createdAt).toISOString(),
    runs: runs.map(run => runView(run, row)),
  };
}

const ORDER: Record<RoutineRecord["status"], number> = { active: 0, paused: 1, stopped: 2 };

/** This workspace's routines, each with its latest runs. Only this tenant's. */
export async function listRoutineViews(tenantId: string, deps: RoutineServiceDeps = {}): Promise<RoutineView[]> {
  const store = deps.store ?? drizzleRoutineStore;
  const rows = await store.listRoutines(tenantId);
  const views = await Promise.all(rows.map(async row => routineView(row, await store.recentRuns(tenantId, row.id, RECENT_RUNS))));
  return views.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

export async function readRoutineView(tenantId: string, id: string, deps: RoutineServiceDeps = {}): Promise<RoutineView | null> {
  const store = deps.store ?? drizzleRoutineStore;
  const row = await store.findRoutine(tenantId, id);
  return row ? routineView(row, await store.recentRuns(tenantId, id, RECENT_RUNS)) : null;
}

/** The operator's words, read by the deterministic parser; saved only when Claire can run it. */
export async function createRoutine(
  input: { tenantId: string; operatorOpenId: string; instruction: string; timeZone: string },
  deps: RoutineServiceDeps = {}
): Promise<{ ok: true; routine: RoutineView } | Extract<ParsedRoutine, { ok: false }>> {
  const store = deps.store ?? drizzleRoutineStore;
  const now = (deps.now ?? (() => new Date()))();
  const instruction = input.instruction.replace(/\s+/g, " ").trim();
  const parsed = parseRoutineInstruction(instruction, input.timeZone);
  if (!parsed.ok) return parsed;
  if ((await store.countLiveRoutines(input.tenantId)) >= MAX_LIVE_ROUTINES)
    return { ok: false, reason: `You have ${MAX_LIVE_ROUTINES} routines already. Stop one before adding another.`, canDo: [...ROUTINE_CAN_DO] };
  const id = (deps.newId ?? randomUUID)();
  const schedule: RoutineSchedule = { cadence: parsed.cadence, weekday: parsed.weekday, localTime: parsed.localTime, timeZone: input.timeZone };
  await store.insertRoutine({
    id,
    tenantId: input.tenantId,
    operatorOpenId: input.operatorOpenId,
    kind: parsed.kind,
    instruction,
    cadence: parsed.cadence,
    weekday: parsed.weekday,
    localTime: parsed.localTime,
    timeZone: input.timeZone,
    status: "active",
    nextRunAt: nextRunAt(schedule, now),
    lastRunAt: null,
  });
  const routine = await readRoutineView(input.tenantId, id, { store });
  if (!routine) throw new Error("The routine was not saved.");
  return { ok: true, routine };
}

export type RoutineStatusChange = "pause" | "resume" | "stop";
export type RoutineChangeResult = { routine: RoutineView } | { notFound: true } | { refused: string };

/**
 * Pause (keeps it, runs nothing), resume (next run recomputed from now: missed times are not caught up) or stop (kept
 * for its history, never runs again). Only this tenant's routine.
 */
export async function changeRoutineStatus(tenantId: string, id: string, change: RoutineStatusChange, deps: RoutineServiceDeps = {}): Promise<RoutineChangeResult> {
  const store = deps.store ?? drizzleRoutineStore;
  const now = (deps.now ?? (() => new Date()))();
  const row = await store.findRoutine(tenantId, id);
  if (!row) return { notFound: true };
  if (row.status === "stopped") return { refused: "This routine is stopped. It's kept for its history; make a new one to start again." };
  if (change === "pause" && row.status !== "paused") await store.updateRoutine(tenantId, id, { status: "paused", nextRunAt: null });
  if (change === "resume") await store.updateRoutine(tenantId, id, { status: "active", nextRunAt: nextRunAt(scheduleOf(row), now) });
  if (change === "stop") await store.updateRoutine(tenantId, id, { status: "stopped", nextRunAt: null });
  const routine = await readRoutineView(tenantId, id, { store });
  return routine ? { routine } : { notFound: true };
}
